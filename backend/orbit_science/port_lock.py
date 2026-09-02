"""
Exclusive port ownership for science gRPC workers.

Prevents multi-listener zombies on macOS where SO_REUSEPORT can allow a second
process to bind the same port while the first still listens.
"""

from __future__ import annotations

import fcntl
import os
import socket
from pathlib import Path
from typing import BinaryIO, Optional, Tuple

# Keep lock files outside repo churn; still local to project if BASE set.
_DEFAULT_LOCK_DIR = Path(__file__).resolve().parents[2] / ".edge-pids"


def port_has_listener(port: int, host: str = "127.0.0.1") -> bool:
    """True if something already accepts TCP connections on host:port."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.3)
    try:
        # connect_ex returns 0 if something is listening
        return s.connect_ex((host, port)) == 0
    finally:
        s.close()


def try_exclusive_tcp_bind(port: int, host: str = "0.0.0.0") -> bool:
    """
    Attempt a bind with REUSEADDR off and REUSEPORT off.
    Returns True if bind succeeded (caller must close the socket).
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        # Explicitly avoid reuse flags that enable dual-listen
        if hasattr(socket, "SO_REUSEADDR"):
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
        if hasattr(socket, "SO_REUSEPORT"):
            try:
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 0)
            except OSError:
                pass
        s.bind((host, port))
        s.close()
        return True
    except OSError:
        s.close()
        return False


def acquire_exclusive_port(
    port: int,
    *,
    lock_dir: Optional[Path] = None,
    service_name: str = "science",
) -> Tuple[BinaryIO, Path]:
    """
    Acquire an exclusive flock for ``port`` and refuse if the port is live.

    Returns (lock_file, lock_path). Keep ``lock_file`` open for process life.
    Raises SystemExit with a clear message if another instance holds the lock
    or the port already has a listener.
    """
    lock_dir = Path(lock_dir) if lock_dir else _DEFAULT_LOCK_DIR
    lock_dir.mkdir(parents=True, exist_ok=True)
    lock_path = lock_dir / f"{service_name}-{port}.lock"

    # Open and lock non-blocking
    lock_file = open(lock_path, "a+", encoding="utf-8")
    try:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock_file.seek(0)
        other = lock_file.read().strip() or "unknown"
        lock_file.close()
        raise SystemExit(
            f"{service_name}: port {port} already owned by another process "
            f"(lock held, pid_file={other!r}). Refuse multi-listener start."
        ) from None

    # Port already accepting connections?
    if port_has_listener(port):
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
        lock_file.close()
        raise SystemExit(
            f"{service_name}: port {port} already has a TCP listener. "
            f"Refuse multi-listener start. Stop the other process first."
        )

    # Probe exclusive bind (catches some dual-bind edge cases)
    if not try_exclusive_tcp_bind(port):
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
        lock_file.close()
        raise SystemExit(
            f"{service_name}: cannot exclusively bind port {port}. "
            f"Refuse multi-listener start."
        )

    lock_file.seek(0)
    lock_file.truncate()
    lock_file.write(f"{os.getpid()}\n")
    lock_file.flush()
    return lock_file, lock_path
