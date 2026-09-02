"""Exclusive port lock — shipped backend.orbit_science.port_lock."""

from __future__ import annotations

import socket
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.orbit_science.port_lock import (  # noqa: E402
    acquire_exclusive_port,
    port_has_listener,
    try_exclusive_tcp_bind,
)


def _free_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class TestPortLock(unittest.TestCase):
    def test_acquire_then_second_refuses(self):
        port = _free_port()
        with tempfile.TemporaryDirectory() as td:
            lock_dir = Path(td)
            f1, p1 = acquire_exclusive_port(
                port, lock_dir=lock_dir, service_name="test"
            )
            self.assertTrue(p1.exists())
            # Second acquire must SystemExit
            with self.assertRaises(SystemExit) as cm:
                acquire_exclusive_port(
                    port, lock_dir=lock_dir, service_name="test"
                )
            self.assertIn("already", str(cm.exception).lower())
            f1.close()

    def test_listener_detected(self):
        # Bind a real listener, then port_has_listener must see it
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.listen(1)
        try:
            self.assertTrue(port_has_listener(port, host="127.0.0.1"))
            self.assertFalse(try_exclusive_tcp_bind(port, host="127.0.0.1"))
        finally:
            s.close()


if __name__ == "__main__":
    unittest.main()
