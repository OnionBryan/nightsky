# ============================================================
#  NOAA-21 Orbit & Night Sky Viewer - Docker Image
#  Runs all 4 services in a single container
# ============================================================

FROM python:3.12-slim

LABEL maintainer="bryan" \
      description="NOAA-21 Orbit Tracker & Night Sky Viewer"

# System deps
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements first (for layer caching)
COPY backend/requirements.txt /app/backend/requirements.txt
COPY nightsky/backend/requirements.txt /app/nightsky/backend/requirements.txt

# Install Python dependencies
RUN pip install --no-cache-dir \
    -r /app/backend/requirements.txt \
    -r /app/nightsky/backend/requirements.txt

# Download ephemeris data at build time
RUN curl -L -o /app/de421.bsp \
    https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de421.bsp

# Copy application code
COPY backend/ /app/backend/
COPY frontend/ /app/frontend/
COPY nightsky/ /app/nightsky/

# Place ephemeris where the nightsky backend expects it
RUN cp /app/de421.bsp /app/nightsky/backend/de421.bsp

# Patch nightsky backend to bind to 0.0.0.0 (required for Docker networking)
# The Python source binds to 127.0.0.1 which is unreachable from outside the container
RUN sed -i "s/host='127.0.0.1'/host='0.0.0.0'/" /app/nightsky/backend/server.py

# Copy entrypoint
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 5050 5051 8080 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:5050/api/current && \
        curl -f http://localhost:5051/api/nightsky/health || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
