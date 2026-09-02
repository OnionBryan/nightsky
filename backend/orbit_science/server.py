"""
Orbit Science gRPC worker.

Listens on :50051. Imports existing SGP4/TLE modules from backend/.

Run from repo root:
    backend/venv/bin/python -m backend.orbit_science.server
"""

from __future__ import annotations

import json
import logging
import signal
import sys
from concurrent import futures
from datetime import datetime, timezone, timedelta
from pathlib import Path

import grpc
from dateutil.parser import parse as parse_datetime

# Make `backend/` importable when executed as a package module
_BACKEND_DIR = Path(__file__).resolve().parent.parent
_REPO_ROOT = _BACKEND_DIR.parent
for _p in (_REPO_ROOT, _BACKEND_DIR, Path(__file__).resolve().parent):
    _s = str(_p)
    if _s not in sys.path:
        sys.path.insert(0, _s)

from backend.orbit_science import orbit_pb2, orbit_pb2_grpc  # noqa: E402
from backend.orbit_science.coverage import compute_coverage_grid  # noqa: E402
from backend.orbit_science.firms import fetch_fires  # noqa: E402
from backend.orbit_science.simbad import query_region, resolve_name  # noqa: E402
from backend.orbit_science.cutouts import (  # noqa: E402
    build_cutout,
    build_cutout_multi,
    list_surveys,
)
from backend.orbit_science.pass_prediction import predict_passes_for_propagator  # noqa: E402
from tle_fetcher import (  # noqa: E402
    DEFAULT_SATELLITE,
    SATELLITE_CATALOG,
    fetch_tle,
    get_constellation_info,
    get_orbital_params,
    get_satellite_info,
)
from orbit_propagator import OrbitPropagator, generate_swath_polygon  # noqa: E402

logger = logging.getLogger("orbit_science")

_propagators: dict = {}
_tle_data: dict = {}
_last_refresh: dict = {}
_heatmap_cache: dict = {}
REFRESH_INTERVAL_HOURS = 6

# Bind IPv4 explicitly — Go dials 127.0.0.1; [::] alone can be IPv6-only on macOS.
LISTEN_ADDR = "0.0.0.0:50051"


def get_propagator(sat_key: str = DEFAULT_SATELLITE) -> OrbitPropagator:
    if not sat_key or sat_key not in SATELLITE_CATALOG:
        sat_key = DEFAULT_SATELLITE

    now = datetime.now(timezone.utc)
    sat_info = SATELLITE_CATALOG[sat_key]

    if (
        sat_key not in _propagators
        or sat_key not in _last_refresh
        or (now - _last_refresh[sat_key]).total_seconds() > REFRESH_INTERVAL_HOURS * 3600
    ):
        tle = fetch_tle(sat_info["norad_id"])
        _tle_data[sat_key] = tle
        _propagators[sat_key] = OrbitPropagator(tle["line1"], tle["line2"])
        _last_refresh[sat_key] = now
        logger.info("TLE for %s refreshed at %s", sat_info["name"], now.isoformat())

    return _propagators[sat_key]


def get_tle_data(sat_key: str = DEFAULT_SATELLITE) -> dict:
    if sat_key not in _tle_data:
        get_propagator(sat_key)
    return _tle_data.get(sat_key, {})


def _resolve_sat(sat_key: str) -> str:
    if not sat_key or sat_key not in SATELLITE_CATALOG:
        return DEFAULT_SATELLITE
    return sat_key


def _parse_utc(value: str, field: str, context) -> datetime:
    try:
        dt = parse_datetime(value)
    except Exception as e:
        context.abort(grpc.StatusCode.INVALID_ARGUMENT, f"Invalid {field}: {e}")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


class OrbitScienceServicer(orbit_pb2_grpc.OrbitScienceServicer):
    def ListSatellites(self, request, context):
        sat_metadata = []
        for s in get_constellation_info():
            sat_metadata.append(
                orbit_pb2.SatelliteMetadata(
                    key=s["key"],
                    name=s["name"],
                    norad_id=s["norad_id"],
                    color=s["color"],
                    launch_year=s["launch_year"],
                    category=s.get("category", ""),
                    operator=s.get("operator", ""),
                    swath_km=float(s.get("swath_km", 0.0) or 0.0),
                )
            )
        return orbit_pb2.ListSatellitesResponse(
            satellites=sat_metadata,
            default_satellite=DEFAULT_SATELLITE,
        )

    def GetTLE(self, request, context):
        sat_key = _resolve_sat(request.satellite)
        tle = get_tle_data(sat_key)
        if not tle or "line2" not in tle:
            context.abort(grpc.StatusCode.UNAVAILABLE, f"No TLE for {sat_key}")
        sat_info = get_satellite_info(sat_key) or {}
        orbital_params_dict = get_orbital_params(tle["line2"])

        op = orbit_pb2.OrbitalParams(
            inclination_deg=orbital_params_dict["inclination_deg"],
            raan_deg=orbital_params_dict["raan_deg"],
            eccentricity=orbital_params_dict["eccentricity"],
            arg_perigee_deg=orbital_params_dict["arg_perigee_deg"],
            mean_anomaly_deg=orbital_params_dict["mean_anomaly_deg"],
            mean_motion=orbital_params_dict["mean_motion"],
            orbit_number=orbital_params_dict["orbit_number"],
        )

        return orbit_pb2.GetTLEResponse(
            satellite_key=sat_key,
            name=sat_info.get("name", tle.get("name", "Unknown")),
            norad_id=int(sat_info.get("norad_id", 0) or 0),
            tle_line1=tle["line1"],
            tle_line2=tle["line2"],
            epoch=tle["epoch"],
            age_hours=float(tle["age_hours"]),
            source=tle["source"],
            orbital_params=op,
        )

    def GetCurrentPosition(self, request, context):
        sat_key = _resolve_sat(request.satellite)
        prop = get_propagator(sat_key)
        sat_info = get_satellite_info(sat_key) or {}

        if request.HasField("at") and request.at:
            at_time = _parse_utc(request.at, "at", context)
            pos = prop.propagate(at_time)
        else:
            pos = prop.get_current_position()

        if pos is None:
            context.abort(grpc.StatusCode.INTERNAL, "Propagation failed")

        orbit_info = prop.get_orbit_info()
        return orbit_pb2.PositionResponse(
            latitude=pos["latitude"],
            longitude=pos["longitude"],
            altitude_km=pos["altitude_km"],
            velocity_km_s=pos["velocity_km_s"],
            orbit_number=int(orbit_info["current_orbit_number"]),
            satellite_key=sat_key,
            satellite_name=sat_info.get("name", "Unknown"),
            color=sat_info.get("color", "#ff6b6b"),
            timestamp=pos["timestamp"],
        )

    def GetTrack(self, request, context):
        sat_key = _resolve_sat(request.satellite)
        prop = get_propagator(sat_key)

        if request.start:
            start = _parse_utc(request.start, "start", context)
        else:
            start = datetime.now(timezone.utc)

        if request.end:
            end = _parse_utc(request.end, "end", context)
        elif request.duration_minutes > 0:
            end = start + timedelta(minutes=min(int(request.duration_minutes), 1440))
        else:
            end = start + timedelta(minutes=90)

        if end < start:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "end must be >= start")

        step = max(10, min(300, int(request.step_seconds))) if request.step_seconds > 0 else 60
        positions = prop.generate_track(start, end, step)

        track_positions = [
            orbit_pb2.TrackPosition(
                lat=p["latitude"],
                lon=p["longitude"],
                alt=p["altitude_km"],
                time=p["timestamp"],
            )
            for p in positions
        ]

        return orbit_pb2.TrackResponse(
            positions=track_positions,
            step_seconds=step,
            total_points=len(positions),
            start=start.isoformat(),
            end=end.isoformat(),
        )

    def GetOrbitInfo(self, request, context):
        sat_key = _resolve_sat(request.satellite)
        prop = get_propagator(sat_key)
        tle = get_tle_data(sat_key)
        sat_info = get_satellite_info(sat_key) or {}
        info = prop.get_orbit_info()

        return orbit_pb2.OrbitInfoResponse(
            inclination_deg=info["inclination_deg"],
            eccentricity=info["eccentricity"],
            mean_motion_rev_day=info["mean_motion_rev_day"],
            period_minutes=info["period_minutes"],
            altitude_km=info["altitude_km"],
            tle_epoch=info["tle_epoch"],
            tle_age_hours=info["tle_age_hours"],
            current_orbit_number=int(info["current_orbit_number"]),
            satellite_key=sat_key,
            satellite_name=sat_info.get("name", tle.get("name", "Unknown")),
            color=sat_info.get("color", "#ff6b6b"),
            swath_km=float(sat_info.get("swath_km", 3060) or 0),
            tle_source=tle.get("source", ""),
        )

    def GetSwath(self, request, context):
        sat_key = _resolve_sat(request.satellite)
        prop = get_propagator(sat_key)
        pos = prop.get_current_position()
        if pos is None:
            context.abort(grpc.StatusCode.INTERNAL, "Propagation failed")

        radius = request.radius_km if request.radius_km > 0 else 1530.0
        polygon = generate_swath_polygon(pos["latitude"], pos["longitude"], radius)
        poly_points = [orbit_pb2.Point(lon=p[0], lat=p[1]) for p in polygon]

        return orbit_pb2.SwathResponse(
            center=orbit_pb2.Point(lat=pos["latitude"], lon=pos["longitude"]),
            radius_km=radius,
            polygon=poly_points,
            timestamp=pos["timestamp"],
        )

    def GetPolarCrossings(self, request, context):
        sat_key = _resolve_sat(request.satellite)
        prop = get_propagator(sat_key)
        hours = max(1, min(48, int(request.hours))) if request.hours > 0 else 24

        # find_equator_crossings is the correct name; polar is legacy alias
        crossings = prop.find_equator_crossings(duration_hours=hours)
        asc = [
            orbit_pb2.Crossing(time=c["time"], longitude=c["longitude"])
            for c in crossings.get("ascending_nodes", [])
        ]
        desc = [
            orbit_pb2.Crossing(time=c["time"], longitude=c["longitude"])
            for c in crossings.get("descending_nodes", [])
        ]
        return orbit_pb2.PolarCrossingsResponse(
            ascending_nodes=asc,
            descending_nodes=desc,
        )

    def GetCoverageHeatmap(self, request, context):
        sat_key = _resolve_sat(request.satellite)
        hours = max(1, min(48, int(request.hours))) if request.hours > 0 else 24
        grid_size = max(1, min(5, int(request.grid_size))) if request.grid_size > 0 else 2

        sat_info = SATELLITE_CATALOG[sat_key]
        swath_km = float(sat_info.get("swath_km", 3060) or 0)
        half_width_km = swath_km / 2.0

        if swath_km <= 0:
            return orbit_pb2.CoverageHeatmapResponse(
                grid_size=grid_size,
                hours=hours,
                satellite=sat_key,
                swath_km=0,
                max_passes=0,
                cell_count=0,
                cells=[],
            )

        prop = get_propagator(sat_key)
        tle_epoch_str = prop.tle_epoch.isoformat()
        cache_key = (sat_key, hours, grid_size)
        cached = _heatmap_cache.get(cache_key)
        if cached and cached["tle_epoch"] == tle_epoch_str:
            return cached["response"]

        now = datetime.now(timezone.utc)
        end = now + timedelta(hours=hours)
        # Heatmap is heavy; cap step for longer windows
        step = 60 if hours > 12 else 30
        positions = prop.generate_track(now, end, step_seconds=step)
        grid, _n_lat, _n_lon = compute_coverage_grid(positions, half_width_km, grid_size)

        cells = []
        max_count = 0
        for (lat_idx, lon_idx), count in grid.items():
            cell_lat = -90.0 + lat_idx * grid_size + grid_size / 2.0
            cell_lon = -180.0 + lon_idx * grid_size + grid_size / 2.0
            cells.append(
                orbit_pb2.HeatmapCell(
                    lat=round(cell_lat, 1),
                    lon=round(cell_lon, 1),
                    passes=int(count),
                )
            )
            if count > max_count:
                max_count = count

        response = orbit_pb2.CoverageHeatmapResponse(
            grid_size=grid_size,
            hours=hours,
            satellite=sat_key,
            swath_km=swath_km,
            max_passes=max_count,
            cell_count=len(cells),
            cells=cells,
        )
        _heatmap_cache[cache_key] = {
            "response": response,
            "tle_epoch": tle_epoch_str,
            "computed_at": now,
        }
        return response

    def GetFires(self, request, context):
        """NASA FIRMS active-fire proxy (Flask-compatible payload)."""
        sat = request.satellite or "noaa21"
        hours = int(request.hours) if request.hours > 0 else 24
        result = fetch_fires(satellite=sat, hours=hours)

        points = [
            orbit_pb2.FirePoint(
                lat=float(f["lat"]),
                lon=float(f["lon"]),
                brightness=float(f.get("brightness", 0) or 0),
                confidence=str(f.get("confidence", "")),
                frp=float(f.get("frp", 0) or 0),
                acq_date=str(f.get("acq_date", "") or ""),
                acq_time=str(f.get("acq_time", "") or ""),
                daynight=str(f.get("daynight", "") or ""),
            )
            for f in result.get("fires", [])
        ]
        return orbit_pb2.GetFiresResponse(
            fires=points,
            count=int(result.get("count", len(points))),
            source=str(result.get("source", "")),
            day_range=int(result.get("day_range", 0) or 0),
            cached=bool(result.get("cached", False)),
            error=str(result.get("error", "") or ""),
        )

    @staticmethod
    def _json_blob(result: dict, status: int) -> orbit_pb2.JsonBlob:
        err = ""
        if isinstance(result, dict) and result.get("error"):
            err = str(result["error"])
        return orbit_pb2.JsonBlob(
            json=json.dumps(result, default=str),
            error=err,
            status_code=int(status),
        )

    def SimbadRegion(self, request, context):
        radius = request.radius if request.radius > 0 else 1.0
        limit = int(request.limit) if request.limit > 0 else 20
        result, status = query_region(request.ra, request.dec, radius=radius, limit=limit)
        return self._json_blob(result, status)

    def SimbadResolve(self, request, context):
        result, status = resolve_name(request.name)
        return self._json_blob(result, status)

    def ListSurveys(self, request, context):
        return self._json_blob(list_surveys(), 200)

    def GetCutout(self, request, context):
        survey = request.survey or "dss2_color"
        fov = request.fov if request.fov > 0 else 0.1
        width = int(request.width) if request.width > 0 else 500
        height = int(request.height) if request.height > 0 else 500
        fmt = request.format or "jpg"
        result, status = build_cutout(
            request.ra,
            request.dec,
            fov=fov,
            survey=survey,
            width=width,
            height=height,
            output_format=fmt,
        )
        return self._json_blob(result, status)

    def GetCutoutMulti(self, request, context):
        fov = request.fov if request.fov > 0 else 0.1
        surveys = None
        if request.surveys:
            surveys = [s.strip() for s in request.surveys.split(",") if s.strip()]
        result = build_cutout_multi(request.ra, request.dec, fov=fov, surveys=surveys)
        return self._json_blob(result, 200)

    def GetSitePasses(self, request, context):
        sat_key = _resolve_sat(request.satellite)
        prop = get_propagator(sat_key)
        hours = float(request.hours) if request.hours > 0 else 24.0
        hours = max(1.0, min(72.0, hours))
        min_el = float(request.min_elevation_deg) if request.min_elevation_deg > 0 else 10.0
        step = int(request.step_seconds) if request.step_seconds > 0 else 30
        step = max(15, min(120, step))
        site_alt = float(request.site_alt_km) if request.site_alt_km else 0.0

        if request.HasField("start") and request.start:
            start = _parse_utc(request.start, "start", context)
        else:
            start = datetime.now(timezone.utc)

        passes = predict_passes_for_propagator(
            prop,
            request.lat,
            request.lon,
            start=start,
            hours=hours,
            step_seconds=step,
            min_elevation_deg=min_el,
            site_alt_km=site_alt,
        )
        end = start + timedelta(hours=hours)
        out = []
        for p in passes:
            sp = orbit_pb2.SitePass(
                aos=p["aos"],
                los=p["los"],
                max_elevation=float(p["max_elevation"]),
                max_elevation_time=p["max_elevation_time"],
                duration_seconds=int(p["duration_seconds"]),
                duration_minutes=float(p["duration_minutes"]),
                site_daylight_at_max=bool(p["site_daylight_at_max"]),
                site_solar_elevation_at_max=float(p["site_solar_elevation_at_max"]),
                visual_pass_candidate=bool(p["visual_pass_candidate"]),
            )
            if p.get("sat_sunlit_at_max") is not None:
                sp.sat_sunlit_at_max = bool(p["sat_sunlit_at_max"])
            out.append(sp)
        return orbit_pb2.GetSitePassesResponse(
            satellite=sat_key,
            lat=request.lat,
            lon=request.lon,
            min_elevation_deg=min_el,
            window_start=start.isoformat(),
            window_end=end.isoformat(),
            passes=out,
            count=len(out),
        )


def _port_from_addr(addr: str) -> int:
    return int(addr.rsplit(":", 1)[-1])


def serve(addr: str = LISTEN_ADDR) -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    from backend.orbit_science.port_lock import acquire_exclusive_port

    port = _port_from_addr(addr)
    # Hold flock for process lifetime — second unsupervised start must exit.
    lock_file, lock_path = acquire_exclusive_port(
        port, service_name="orbit_science"
    )
    logger.info("Acquired exclusive lock %s for port %s", lock_path, port)

    server = grpc.server(
        futures.ThreadPoolExecutor(max_workers=8),
        options=[
            ("grpc.max_send_message_length", 64 * 1024 * 1024),
            ("grpc.max_receive_message_length", 64 * 1024 * 1024),
        ],
    )
    orbit_pb2_grpc.add_OrbitScienceServicer_to_server(OrbitScienceServicer(), server)
    bound = server.add_insecure_port(addr)
    if bound == 0:
        raise RuntimeError(f"Failed to bind gRPC port {addr}")
    server.start()
    logger.info("Orbit Science gRPC server listening on %s", addr)

    def _stop(*_args):
        logger.info("Shutting down...")
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
