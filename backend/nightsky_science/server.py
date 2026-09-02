"""
Nightsky Science gRPC worker.

Listens on :50052. Calls pure nightsky/backend modules via services.py
(no WSGI framework on the science hot path).

Run from repo root:
    backend/venv/bin/python -m backend.nightsky_science.server
"""

from __future__ import annotations

import json
import logging
import signal
import sys
from concurrent import futures
from pathlib import Path

import grpc

_REPO = Path(__file__).resolve().parents[2]
_NIGHTSKY_BACKEND = _REPO / "nightsky" / "backend"
_HERE = Path(__file__).resolve().parent

for p in (_REPO, _HERE, _NIGHTSKY_BACKEND):
    s = str(p)
    if s not in sys.path:
        sys.path.insert(0, s)

from backend.nightsky_science import nightsky_pb2, nightsky_pb2_grpc  # noqa: E402
from backend.nightsky_science import services  # noqa: E402

logger = logging.getLogger("nightsky_science")
LISTEN_ADDR = "0.0.0.0:50052"


def _json(result: dict, status: int) -> nightsky_pb2.JsonResponse:
    err = ""
    if isinstance(result, dict) and result.get("error"):
        err = str(result["error"])
    return nightsky_pb2.JsonResponse(
        json=json.dumps(result, default=str),
        error=err,
        status_code=int(status),
    )


class NightskyScienceServicer(nightsky_pb2_grpc.NightskyScienceServicer):
    def Health(self, request, context):
        data, _ = services.health()
        return nightsky_pb2.HealthResponse(
            status=data.get("status", "ok"),
            service=data.get("service", "nightsky-science"),
        )

    def Geocode(self, request, context):
        return _json(*services.geocode(request.q))

    def Options(self, request, context):
        return _json(*services.options())

    def Planets(self, request, context):
        return _json(*services.planets(request.lat, request.lon))

    def Moon(self, request, context):
        return _json(*services.moon(request.lat, request.lon))

    def LocationInfo(self, request, context):
        return _json(*services.location_info(request.lat, request.lon))

    def GeostationaryVisible(self, request, context):
        return _json(
            *services.geostationary_visible(
                request.lat,
                request.lon,
                category=request.category or "",
                min_elevation=request.min_elevation or 5.0,
            )
        )

    def GeostationaryArc(self, request, context):
        return _json(
            *services.geostationary_arc(
                request.lat, request.lon, points=request.points or 72
            )
        )

    def GeostationaryLookup(self, request, context):
        return _json(
            *services.geostationary_lookup(
                request.lat, request.lon, request.sat_lon
            )
        )

    def GeostationaryList(self, request, context):
        return _json(*services.geostationary_list(request.category or ""))

    def Twilight(self, request, context):
        return _json(*services.twilight(request.lat, request.lon))

    def RiseSet(self, request, context):
        return _json(*services.riseset(request.lat, request.lon, request.object))

    def Weather(self, request, context):
        return _json(*services.weather(request.lat, request.lon))

    def GenerateSky(self, request, context):
        try:
            payload = json.loads(request.request_json or "{}")
        except json.JSONDecodeError as e:
            return nightsky_pb2.ImageResponse(
                error=f"Invalid JSON: {e}", status_code=400
            )
        data, status, ctype, err = services.generate_sky(payload)
        if err or status >= 400:
            return nightsky_pb2.ImageResponse(
                error=err or "generate failed", status_code=status
            )
        return nightsky_pb2.ImageResponse(
            data=data or b"",
            content_type=ctype,
            status_code=status,
        )

    def AuroraKp(self, request, context):
        return _json(*services.aurora_kp(request.lat))

    def LightPollution(self, request, context):
        return _json(*services.light_pollution(request.lat, request.lon))

    def SatelliteTLE(self, request, context):
        return _json(
            *services.satellite_tle(
                group=request.group or "",
                norad_id=request.norad_id or "",
            )
        )

    def Ephemeris(self, request, context):
        return _json(*services.ephemeris(request.name, request.lat, request.lon))

    def SessionGoNoGo(self, request, context):
        return _json(*services.session_go_no_go(request.lat, request.lon))


def _port_from_addr(addr: str) -> int:
    return int(addr.rsplit(":", 1)[-1])


def serve(addr: str = LISTEN_ADDR) -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    # Shared lock helper (same as orbit science)
    from backend.orbit_science.port_lock import acquire_exclusive_port

    port = _port_from_addr(addr)
    lock_file, lock_path = acquire_exclusive_port(
        port, service_name="nightsky_science"
    )
    logger.info("Acquired exclusive lock %s for port %s", lock_path, port)

    server = grpc.server(
        futures.ThreadPoolExecutor(max_workers=8),
        options=[
            ("grpc.max_send_message_length", 64 * 1024 * 1024),
            ("grpc.max_receive_message_length", 64 * 1024 * 1024),
        ],
    )
    nightsky_pb2_grpc.add_NightskyScienceServicer_to_server(
        NightskyScienceServicer(), server
    )
    bound = server.add_insecure_port(addr)
    if bound == 0:
        raise RuntimeError(f"Failed to bind gRPC port {addr}")
    server.start()
    logger.info("Nightsky Science gRPC server listening on %s", addr)

    def _stop(*_a):
        logger.info("Shutting down nightsky science...")
        server.stop(grace=5)
        try:
            lock_file.close()
        except Exception:
            pass

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)
    server.wait_for_termination()


def main() -> None:
    serve()


if __name__ == "__main__":
    main()
