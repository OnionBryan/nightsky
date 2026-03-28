#!/bin/bash
# ============================================================
#  NOAA-21 Orbit & Night Sky Viewer - Docker Entrypoint
#  Starts all 4 services and keeps the container running
# ============================================================

set -e

echo "============================================"
echo "  NOAA-21 Orbit & Night Sky Viewer (Docker)"
echo "============================================"
echo ""

# Track child PIDs for cleanup
PIDS=()

cleanup() {
    echo ""
    echo "Shutting down all services..."
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    wait
    echo "All services stopped."
    exit 0
}
trap cleanup SIGINT SIGTERM

# [1/4] Orbit Backend API
echo "[1/4] Starting Orbit Backend API on port 5050..."
cd /app/backend
python server.py &
PIDS+=($!)

sleep 2

# [2/4] Orbit Frontend
echo "[2/4] Starting Orbit Frontend on port 8080..."
cd /app/frontend
python -m http.server 8080 --bind 0.0.0.0 &
PIDS+=($!)

# [3/4] Night Sky Backend
echo "[3/4] Starting Night Sky Backend on port 5051..."
cd /app/nightsky/backend
python server.py &
PIDS+=($!)

sleep 2

# [4/4] Night Sky Frontend
echo "[4/4] Starting Night Sky Frontend on port 8081..."
cd /app/nightsky/frontend
python -m http.server 8081 --bind 0.0.0.0 &
PIDS+=($!)

sleep 1

# Health check
echo ""
echo "Running health checks..."
for url in \
    "http://localhost:5050/api/current" \
    "http://localhost:5051/api/nightsky/health" \
    "http://localhost:8080/" \
    "http://localhost:8081/"; do
    status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null || echo "000")
    if [ "$status" -ge 200 ] && [ "$status" -lt 400 ]; then
        echo "  [OK]   $url"
    else
        echo "  [WARN] $url - HTTP $status"
    fi
done

echo ""
echo "============================================"
echo "  All services running"
echo "============================================"
echo ""
echo "  Orbit API:         http://localhost:5050"
echo "  Night Sky API:     http://localhost:5051"
echo "  Satellite Viewer:  http://localhost:8080"
echo "  Night Sky Viewer:  http://localhost:8081"
echo ""

# Wait for any child to exit
wait -n
echo "A service exited unexpectedly. Shutting down..."
cleanup
