#!/bin/bash
# ============================================================
#  NOAA-21 Orbit & Night Sky Viewer - Startup Script
#  Launches all 4 services and opens browsers
# ============================================================

BASE_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$BASE_DIR/venv"

echo "============================================"
echo "  NOAA-21 Orbit & Night Sky Viewer"
echo "============================================"
echo ""

# ----------------------------------------------------------
# Pre-flight: verify venv exists
# ----------------------------------------------------------
if [ ! -d "$VENV_DIR" ]; then
    echo "  ERROR: Virtual environment not found at $VENV_DIR"
    echo "  Run ./install.sh first."
    exit 1
fi

source "$VENV_DIR/bin/activate"

# ----------------------------------------------------------
# Kill any existing processes on our ports
# ----------------------------------------------------------
echo "Stopping any existing processes..."

for port in 5050 5051 8080 8081; do
    pid=$(lsof -ti :$port 2>/dev/null)
    if [ -n "$pid" ]; then
        echo "  Killing process $pid on port $port"
        kill -9 $pid 2>/dev/null
    fi
done

sleep 1

# ----------------------------------------------------------
# [1/4] Orbit Backend API (port 5050)
# ----------------------------------------------------------
echo ""
echo "[1/4] Starting Orbit Backend API on port 5050..."
cd "$BASE_DIR/backend"
python server.py > /dev/null 2>&1 &
BACKEND_PID=$!
echo "  Orbit Backend PID: $BACKEND_PID"

sleep 2

# ----------------------------------------------------------
# [2/4] Orbit Frontend (port 8080)
# ----------------------------------------------------------
echo ""
echo "[2/4] Starting Orbit Frontend on port 8080..."
cd "$BASE_DIR/frontend"
python -m http.server 8080 --bind 0.0.0.0 > /dev/null 2>&1 &
SAT_PID=$!
echo "  Orbit Frontend PID: $SAT_PID"

# ----------------------------------------------------------
# [3/4] Night Sky Backend (port 5051)
# ----------------------------------------------------------
echo ""
echo "[3/4] Starting Night Sky Backend on port 5051..."
cd "$BASE_DIR/nightsky/backend"
python server.py > /dev/null 2>&1 &
SKY_BACKEND_PID=$!
echo "  Night Sky Backend PID: $SKY_BACKEND_PID"

sleep 2

# ----------------------------------------------------------
# [4/4] Night Sky Frontend (port 8081)
# ----------------------------------------------------------
echo ""
echo "[4/4] Starting Night Sky Frontend on port 8081..."
cd "$BASE_DIR/nightsky/frontend"
python -m http.server 8081 --bind 0.0.0.0 > /dev/null 2>&1 &
SKY_PID=$!
echo "  Night Sky Frontend PID: $SKY_PID"

sleep 1

# ----------------------------------------------------------
# Health checks
# ----------------------------------------------------------
echo ""
echo "Running health checks..."

check_service() {
    local name="$1"
    local url="$2"
    local status
    status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null)
    if [ "$status" -ge 200 ] && [ "$status" -lt 400 ]; then
        echo "  [OK]   $name ($url) - HTTP $status"
        return 0
    else
        echo "  [FAIL] $name ($url) - HTTP $status"
        return 1
    fi
}

HEALTHY=0
check_service "Orbit API"       "http://localhost:5050/api/current" && ((HEALTHY++))
check_service "Night Sky API"   "http://localhost:5051/api/nightsky/health" && ((HEALTHY++))
check_service "Orbit Frontend"  "http://localhost:8080/" && ((HEALTHY++))
check_service "Night Sky Front" "http://localhost:8081/" && ((HEALTHY++))

echo ""
echo "  $HEALTHY/4 services healthy"

# ----------------------------------------------------------
# Summary and browser launch
# ----------------------------------------------------------
echo ""
echo "============================================"
echo "  All services started!"
echo "============================================"
echo ""
echo "  Orbit API:            http://localhost:5050"
echo "  Night Sky API:        http://localhost:5051"
echo "  Satellite Viewer:     http://localhost:8080"
echo "  Night Sky Viewer:     http://localhost:8081"
echo ""

# Open browser - prefer Chrome, fall back to default
echo "Opening browsers..."
if [ "$(uname)" = "Darwin" ]; then
    if [ -d "/Applications/Google Chrome.app" ]; then
        open -a "Google Chrome" "http://localhost:8080"
        open -a "Google Chrome" "http://localhost:8081"
    else
        open "http://localhost:8080"
        open "http://localhost:8081"
    fi
elif command -v xdg-open &>/dev/null; then
    if command -v google-chrome &>/dev/null; then
        google-chrome "http://localhost:8080" &
        google-chrome "http://localhost:8081" &
    else
        xdg-open "http://localhost:8080" &
        xdg-open "http://localhost:8081" &
    fi
fi

echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# ----------------------------------------------------------
# Trap Ctrl+C to clean shutdown
# ----------------------------------------------------------
cleanup() {
    echo ""
    echo "Shutting down..."
    kill $BACKEND_PID $SAT_PID $SKY_BACKEND_PID $SKY_PID 2>/dev/null
    echo "All services stopped."
    exit 0
}
trap cleanup SIGINT SIGTERM

# Keep script running
wait
