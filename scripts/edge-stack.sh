#!/usr/bin/env bash
# Supervised start/stop for Go edge + two science workers.
# Ensures exactly one listener per science/edge port.
set -euo pipefail

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$BASE_DIR"

PY="${BASE_DIR}/backend/venv/bin/python"
EDGE_BIN="${EDGE_BIN:-}"
PID_DIR="${BASE_DIR}/.edge-pids"
LOG_DIR="${BASE_DIR}/.edge-logs"

ORBIT_SCI_PORT=50051
NS_SCI_PORT=50052
ORBIT_HTTP_PORT=5050
NS_HTTP_PORT=5051

EDGE_PORTS=("$ORBIT_SCI_PORT" "$NS_SCI_PORT" "$ORBIT_HTTP_PORT" "$NS_HTTP_PORT")

mkdir -p "$PID_DIR" "$LOG_DIR"

kill_port() {
  local port=$1
  local pids
  # Only LISTEN sockets — do not kill clients holding ESTABLISHED connections.
  pids=$(lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null || true)
  if [[ -n "${pids}" ]]; then
    echo "  clearing port ${port}: ${pids}"
    # shellcheck disable=SC2086
    kill -9 ${pids} 2>/dev/null || true
    sleep 0.2
  fi
}

clear_edge_ports() {
  # Port-only cleanup — never pgrep command lines (can match the supervisor shell itself).
  for p in "${EDGE_PORTS[@]}"; do
    kill_port "$p"
  done
  sleep 0.3
}

count_listeners() {
  local port=$1
  local n
  n=$(lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null | sort -u | wc -l | tr -d ' ')
  echo "${n:-0}"
}

assert_single() {
  local port=$1
  local name=$2
  local n
  n=$(count_listeners "$port")
  if [[ "$n" -ne 1 ]]; then
    echo "ERROR: expected 1 listener on :${port} (${name}), found ${n}"
    lsof -i "tcp:${port}" 2>/dev/null || true
    return 1
  fi
  echo "  ok :${port} (${name}) pid=$(lsof -ti "tcp:${port}" | head -1)"
}

cmd_stop() {
  echo "Stopping edge stack..."
  clear_edge_ports
  rm -f "$PID_DIR"/*.pid 2>/dev/null || true
  echo "Stopped."
}

cmd_start() {
  if [[ ! -x "$PY" ]]; then
    echo "ERROR: backend venv python not found at $PY"
    echo "Run: make install  (or create backend/venv with deps)"
    exit 1
  fi

  echo "Clearing stale listeners on edge ports..."
  clear_edge_ports

  if [[ -z "$EDGE_BIN" ]]; then
    EDGE_BIN="${LOG_DIR}/noaa-edge"
    echo "Building Go edge → $EDGE_BIN"
    go build -o "$EDGE_BIN" ./cmd/server/
  fi

  echo "Starting orbit science :${ORBIT_SCI_PORT}"
  nohup "$PY" -m backend.orbit_science.server \
    >"$LOG_DIR/orbit_science.log" 2>&1 &
  echo $! >"$PID_DIR/orbit_science.pid"

  echo "Starting nightsky science :${NS_SCI_PORT}"
  nohup "$PY" -m backend.nightsky_science.server \
    >"$LOG_DIR/nightsky_science.log" 2>&1 &
  echo $! >"$PID_DIR/nightsky_science.pid"

  # wait for gRPC ports
  for i in $(seq 1 40); do
    o=$(count_listeners "$ORBIT_SCI_PORT")
    n=$(count_listeners "$NS_SCI_PORT")
    if [[ "$o" -ge 1 && "$n" -ge 1 ]]; then
      break
    fi
    sleep 0.25
  done
  assert_single "$ORBIT_SCI_PORT" "orbit science"
  assert_single "$NS_SCI_PORT" "nightsky science"

  echo "Starting Go edge :${ORBIT_HTTP_PORT} + :${NS_HTTP_PORT}"
  nohup "$EDGE_BIN" >"$LOG_DIR/edge.log" 2>&1 &
  echo $! >"$PID_DIR/edge.pid"
  sleep 0.5
  assert_single "$ORBIT_HTTP_PORT" "orbit HTTP"
  assert_single "$NS_HTTP_PORT" "nightsky HTTP"

  echo ""
  echo "Edge stack up."
  echo "  Orbit UI+API:     http://localhost:${ORBIT_HTTP_PORT}/"
  echo "  Night Sky UI+API: http://localhost:${NS_HTTP_PORT}/"
  echo "  Lore catalog:     http://localhost:${NS_HTTP_PORT}/data/constellations.json"
  echo "  curl http://localhost:${ORBIT_HTTP_PORT}/api/health"
  echo "  curl http://localhost:${NS_HTTP_PORT}/api/nightsky/health"
}

cmd_status() {
  for p in "${EDGE_PORTS[@]}"; do
    n=$(count_listeners "$p")
    echo "  :$p listeners=$n $(lsof -ti tcp:$p 2>/dev/null | tr '\n' ' ')"
  done
}

cmd_refuse_second() {
  # Start a real second science worker; it must exit non-zero and leave 1 LISTEN.
  if [[ "$(count_listeners "$ORBIT_SCI_PORT")" -ne 1 ]]; then
    echo "Stack not running; start first (need 1 listener on :${ORBIT_SCI_PORT})"
    exit 1
  fi
  before=$(count_listeners "$ORBIT_SCI_PORT")
  echo "listeners before second start: $before"
  echo "Starting REAL second: python -m backend.orbit_science.server ..."
  set +e
  # Do not background forever — capture exit. Timeout protects if lock fails open.
  timeout 5 "$PY" -m backend.orbit_science.server \
    >"$LOG_DIR/second_science.log" 2>&1
  rc=$?
  set -e
  # timeout returns 124 if still running (bad — would mean dual bind succeeded)
  after=$(count_listeners "$ORBIT_SCI_PORT")
  echo "second_exit_code=$rc listeners_after=$after"
  echo "--- second_science.log ---"
  cat "$LOG_DIR/second_science.log" || true
  if [[ "$after" -ne 1 ]]; then
    echo "ERROR: multi-listener after second science start (got $after)"
    # kill any extras that snuck in
    clear_edge_ports
    exit 1
  fi
  # Expect non-zero exit (SystemExit from port lock) — not success, not hang
  if [[ "$rc" -eq 0 ]]; then
    echo "ERROR: second science exited 0 (should refuse)"
    exit 1
  fi
  if [[ "$rc" -eq 124 ]]; then
    echo "ERROR: second science still running after 5s (dual-bind zombie risk)"
    exit 1
  fi
  # Edge still healthy
  if ! curl -sf "http://localhost:${ORBIT_HTTP_PORT}/api/health" | grep -q '"grpc":"up"'; then
    echo "ERROR: edge health failed after second-start attempt"
    exit 1
  fi
  echo "single_listener_ok real_second_refused exit=$rc"
}

usage() {
  echo "Usage: $0 {start|stop|status|restart|refuse-second}"
  exit 1
}

case "${1:-}" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  restart) cmd_stop; cmd_start ;;
  refuse-second) cmd_refuse_second ;;
  *) usage ;;
esac
