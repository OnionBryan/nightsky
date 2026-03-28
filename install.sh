#!/bin/bash
# ============================================================
#  NOAA-21 Orbit & Night Sky Viewer - Install Script
#  First-run setup: venv, dependencies, ephemeris data
# ============================================================

set -e

BASE_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$BASE_DIR/venv"
EPHEMERIS="$BASE_DIR/nightsky/backend/de421.bsp"
EPHEMERIS_URL="https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de421.bsp"

echo "============================================"
echo "  NOAA-21 Orbit & Night Sky Viewer"
echo "  Install Script"
echo "============================================"
echo ""

# ----------------------------------------------------------
# 1. Check Python version (3.10+)
# ----------------------------------------------------------
echo "[1/4] Checking Python version..."

PYTHON=""
for cmd in python3 python; do
    if command -v "$cmd" &>/dev/null; then
        ver=$("$cmd" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null)
        major=$(echo "$ver" | cut -d. -f1)
        minor=$(echo "$ver" | cut -d. -f2)
        if [ "$major" -ge 3 ] && [ "$minor" -ge 10 ]; then
            PYTHON="$cmd"
            echo "  Found $cmd ($ver)"
            break
        fi
    fi
done

if [ -z "$PYTHON" ]; then
    echo "  ERROR: Python 3.10+ is required but not found."
    echo "  Install Python from https://www.python.org/downloads/"
    exit 1
fi

# ----------------------------------------------------------
# 2. Create shared virtual environment
# ----------------------------------------------------------
echo ""
echo "[2/4] Setting up virtual environment..."

if [ -d "$VENV_DIR" ]; then
    echo "  Virtual environment already exists at $VENV_DIR"
    echo "  Upgrading pip..."
    source "$VENV_DIR/bin/activate"
    pip install --upgrade pip --quiet
else
    echo "  Creating virtual environment at $VENV_DIR"
    "$PYTHON" -m venv "$VENV_DIR"
    source "$VENV_DIR/bin/activate"
    pip install --upgrade pip --quiet
fi

# ----------------------------------------------------------
# 3. Install dependencies from both requirements files
# ----------------------------------------------------------
echo ""
echo "[3/4] Installing dependencies..."

echo "  Installing orbit backend requirements..."
pip install -r "$BASE_DIR/backend/requirements.txt" --quiet

echo "  Installing nightsky backend requirements..."
pip install -r "$BASE_DIR/nightsky/backend/requirements.txt" --quiet

echo "  All dependencies installed."

# ----------------------------------------------------------
# 4. Download ephemeris file if not present
# ----------------------------------------------------------
echo ""
echo "[4/4] Checking ephemeris data..."

if [ -f "$EPHEMERIS" ]; then
    SIZE=$(wc -c < "$EPHEMERIS" | tr -d ' ')
    echo "  de421.bsp already exists ($SIZE bytes)"
else
    echo "  Downloading de421.bsp (~16MB) from JPL..."
    echo "  URL: $EPHEMERIS_URL"
    if command -v curl &>/dev/null; then
        curl -L --progress-bar -o "$EPHEMERIS" "$EPHEMERIS_URL"
    elif command -v wget &>/dev/null; then
        wget --show-progress -O "$EPHEMERIS" "$EPHEMERIS_URL"
    else
        echo "  ERROR: Neither curl nor wget found. Install one and re-run."
        exit 1
    fi
    echo "  Downloaded de421.bsp ($(wc -c < "$EPHEMERIS" | tr -d ' ') bytes)"
fi

# ----------------------------------------------------------
# Make start.sh executable
# ----------------------------------------------------------
chmod +x "$BASE_DIR/start.sh"

# ----------------------------------------------------------
# Done
# ----------------------------------------------------------
echo ""
echo "============================================"
echo "  Installation complete!"
echo "============================================"
echo ""
echo "  Virtual environment: $VENV_DIR"
echo "  Ephemeris data:      $EPHEMERIS"
echo ""
echo "  To start all services:"
echo "    ./start.sh"
echo ""
echo "  Or use make:"
echo "    make run"
echo ""
