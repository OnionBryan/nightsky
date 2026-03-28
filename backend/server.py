"""
Flask API Server for NOAA-21 Orbital Visualization & Night Sky Viewer

Endpoints:
    GET /api/tle - Current TLE data
    GET /api/current - Current satellite position
    GET /api/track - Ground track positions
    GET /api/orbit-info - Orbital parameters
    GET /api/swath - Current swath polygon
    GET /api/simbad/region - Query objects in a sky region
    GET /api/simbad/resolve - Resolve object name to coordinates
"""

from flask import Flask, jsonify, request
from flask_cors import CORS
from datetime import datetime, timezone, timedelta
from dateutil.parser import parse as parse_datetime
import math
import requests as http_requests  # renamed to avoid conflict with flask.request
import csv
import os
from io import StringIO

from tle_fetcher import (
    fetch_tle, get_orbital_params, SATELLITE_CATALOG, DEFAULT_SATELLITE,
    get_satellite_info, get_constellation_info
)
from orbit_propagator import OrbitPropagator, generate_swath_polygon

app = Flask(__name__)
CORS(app)

# Global propagator instances (refreshed when TLE updates)
_propagators = {}  # keyed by satellite key
_tle_data = {}     # keyed by satellite key
_last_refresh = {}  # keyed by satellite key

REFRESH_INTERVAL_HOURS = 6  # Refresh TLE every 6 hours

# Coverage heatmap cache: keyed by (sat_key, hours, grid_size)
_heatmap_cache = {}  # {cache_key: {"data": ..., "computed_at": datetime, "tle_epoch": str}}

# ============================================
# FIRMS Active Fire Data
# ============================================
FIRMS_MAP_KEY = os.environ.get('FIRMS_MAP_KEY', 'DEMO_KEY')
FIRMS_BASE = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv'
FIRMS_SOURCE_MAP = {
    "noaa21": "VIIRS_NOAA21_NRT",
    "noaa20": "VIIRS_NOAA20_NRT",
    "suominpp": "VIIRS_SNPP_NRT",
}

# Simple in-memory cache: { key: (timestamp, data) }
_fires_cache = {}
FIRES_CACHE_TTL = 900  # 15 minutes in seconds
FIRES_MAX_POINTS = 5000


def _get_fires_cached(key: str):
    """Return cached data if still fresh, else None."""
    if key in _fires_cache:
        ts, data = _fires_cache[key]
        if (datetime.now(timezone.utc) - ts).total_seconds() < FIRES_CACHE_TTL:
            return data
    return None


def _set_fires_cached(key: str, data):
    """Store data in cache with current timestamp."""
    _fires_cache[key] = (datetime.now(timezone.utc), data)


def get_propagator(sat_key: str = DEFAULT_SATELLITE) -> OrbitPropagator:
    """Get or create the orbit propagator for a satellite, refreshing TLE if stale."""
    global _propagators, _tle_data, _last_refresh

    if sat_key not in SATELLITE_CATALOG:
        sat_key = DEFAULT_SATELLITE

    now = datetime.now(timezone.utc)
    sat_info = SATELLITE_CATALOG[sat_key]

    # Check if we need to refresh
    if (sat_key not in _propagators or sat_key not in _last_refresh or
        (now - _last_refresh[sat_key]).total_seconds() > REFRESH_INTERVAL_HOURS * 3600):

        tle = fetch_tle(sat_info["norad_id"])
        _tle_data[sat_key] = tle
        _propagators[sat_key] = OrbitPropagator(tle["line1"], tle["line2"])
        _last_refresh[sat_key] = now
        print(f"TLE for {sat_info['name']} refreshed at {now.isoformat()}")

    return _propagators[sat_key]


def get_tle_data(sat_key: str = DEFAULT_SATELLITE) -> dict:
    """Get cached TLE data for a satellite."""
    global _tle_data
    if sat_key not in _tle_data:
        get_propagator(sat_key)  # This will populate _tle_data
    return _tle_data.get(sat_key, {})


@app.route("/")
def index():
    """Health check endpoint."""
    return jsonify({
        "service": "JPSS Constellation Orbit API",
        "status": "running",
        "satellites": list(SATELLITE_CATALOG.keys()),
        "endpoints": [
            "/api/satellites",
            "/api/tle",
            "/api/current",
            "/api/track",
            "/api/orbit-info",
            "/api/swath",
            "/api/constellation/current",
            "/api/fires"
        ]
    })


@app.route("/api/satellites")
def api_satellites():
    """Return list of available satellites."""
    return jsonify({
        "satellites": get_constellation_info(),
        "default": DEFAULT_SATELLITE
    })


@app.route("/api/tle")
def api_tle():
    """Return current TLE data and metadata.

    Query params:
        satellite: satellite key (default: noaa21)
    """
    sat_key = request.args.get("satellite", DEFAULT_SATELLITE)
    tle = get_tle_data(sat_key)
    sat_info = get_satellite_info(sat_key) or {}
    orbital_params = get_orbital_params(tle["line2"])

    return jsonify({
        "satellite_key": sat_key,
        "name": sat_info.get("name", tle.get("name", "Unknown")),
        "norad_id": sat_info.get("norad_id"),
        "tle_line1": tle["line1"],
        "tle_line2": tle["line2"],
        "epoch": tle["epoch"],
        "age_hours": tle["age_hours"],
        "source": tle["source"],
        "orbital_params": orbital_params
    })


@app.route("/api/current")
def api_current():
    """Return current (or historical) satellite position.

    Query params:
        satellite: satellite key (default: noaa21)
        at: ISO datetime to propagate to (optional, default: now)
    """
    sat_key = request.args.get("satellite", DEFAULT_SATELLITE)
    at_str = request.args.get("at")
    sat_info = get_satellite_info(sat_key) or {}
    prop = get_propagator(sat_key)

    if at_str:
        try:
            at_time = parse_datetime(at_str)
            if at_time.tzinfo is None:
                at_time = at_time.replace(tzinfo=timezone.utc)
            pos = prop.propagate(at_time)
        except Exception:
            return jsonify({"error": "Invalid 'at' datetime parameter"}), 400
    else:
        pos = prop.get_current_position()

    if pos is None:
        return jsonify({"error": "Propagation failed"}), 500

    # Add orbit info
    orbit_info = prop.get_orbit_info()
    pos["orbit_number"] = orbit_info["current_orbit_number"]
    pos["satellite_key"] = sat_key
    pos["satellite_name"] = sat_info.get("name", "Unknown")
    pos["color"] = sat_info.get("color", "#ff6b6b")

    return jsonify(pos)


@app.route("/api/track")
def api_track():
    """
    Return ground track positions.

    Query params:
        satellite: satellite key (default: noaa21)
        start: ISO datetime (default: now)
        end: ISO datetime (default: start + 90 minutes)
        step: seconds between positions (default: 60)
        duration: minutes from start (alternative to end)
    """
    sat_key = request.args.get("satellite", DEFAULT_SATELLITE)
    prop = get_propagator(sat_key)

    # Parse parameters
    start_str = request.args.get("start")
    end_str = request.args.get("end")
    duration = request.args.get("duration", type=int)
    step = request.args.get("step", default=60, type=int)

    # Validate step (10 seconds to 5 minutes)
    step = max(10, min(300, step))

    # Determine time range
    if start_str:
        try:
            start = parse_datetime(start_str)
            if start.tzinfo is None:
                start = start.replace(tzinfo=timezone.utc)
        except ValueError:
            return jsonify({"error": "Invalid start datetime"}), 400
    else:
        start = datetime.now(timezone.utc)

    if end_str:
        try:
            end = parse_datetime(end_str)
            if end.tzinfo is None:
                end = end.replace(tzinfo=timezone.utc)
        except ValueError:
            return jsonify({"error": "Invalid end datetime"}), 400
    elif duration:
        # Limit duration to 24 hours
        duration = min(duration, 1440)
        end = start + timedelta(minutes=duration)
    else:
        # Default: 90 minutes (roughly one orbit)
        end = start + timedelta(minutes=90)

    # Generate track
    positions = prop.generate_track(start, end, step)

    # Simplify output format
    track = [{
        "lat": p["latitude"],
        "lon": p["longitude"],
        "alt": p["altitude_km"],
        "time": p["timestamp"]
    } for p in positions]

    return jsonify({
        "positions": track,
        "step_seconds": step,
        "total_points": len(track),
        "start": start.isoformat(),
        "end": end.isoformat()
    })


@app.route("/api/orbit-info")
def api_orbit_info():
    """Return orbital parameters and TLE metadata.

    Query params:
        satellite: satellite key (default: noaa21)
    """
    sat_key = request.args.get("satellite", DEFAULT_SATELLITE)
    sat_info = get_satellite_info(sat_key) or {}
    prop = get_propagator(sat_key)
    tle = get_tle_data(sat_key)

    info = prop.get_orbit_info()
    info["satellite_key"] = sat_key
    info["satellite_name"] = sat_info.get("name", tle.get("name", "Unknown"))
    info["color"] = sat_info.get("color", "#ff6b6b")
    info["swath_km"] = sat_info.get("swath_km", 3060)
    info["tle_source"] = tle["source"]

    return jsonify(info)


@app.route("/api/swath")
def api_swath():
    """
    Return current VIIRS swath polygon.

    Query params:
        satellite: satellite key (default: noaa21)
        radius: swath half-width in km (default: 1530)
    """
    sat_key = request.args.get("satellite", DEFAULT_SATELLITE)
    prop = get_propagator(sat_key)
    pos = prop.get_current_position()

    if pos is None:
        return jsonify({"error": "Propagation failed"}), 500

    radius = request.args.get("radius", default=1530, type=float)

    # Generate swath polygon
    polygon = generate_swath_polygon(pos["latitude"], pos["longitude"], radius)

    return jsonify({
        "center": {
            "lat": pos["latitude"],
            "lon": pos["longitude"]
        },
        "radius_km": radius,
        "polygon": polygon,
        "timestamp": pos["timestamp"]
    })


@app.route("/api/polar-crossings")
def api_polar_crossings():
    """Return upcoming polar crossing times.

    Query params:
        satellite: satellite key (default: noaa21)
        hours: hours to look ahead (default: 24, max: 48)
    """
    sat_key = request.args.get("satellite", DEFAULT_SATELLITE)
    prop = get_propagator(sat_key)
    hours = request.args.get("hours", default=24, type=int)
    hours = min(hours, 48)  # Limit to 48 hours

    crossings = prop.find_polar_crossings(duration_hours=hours)
    return jsonify(crossings)


@app.route("/api/coverage")
def api_coverage():
    """
    Return swath coverage data for accumulated view.

    Query params:
        satellite: satellite key (default: noaa21)
        duration: minutes of coverage (default: 90, max: 1440)
        step: seconds between swath samples (default: 60)
    """
    sat_key = request.args.get("satellite", DEFAULT_SATELLITE)
    prop = get_propagator(sat_key)

    duration = request.args.get("duration", default=90, type=int)
    duration = min(duration, 1440)  # Max 24 hours
    step = request.args.get("step", default=60, type=int)
    step = max(30, min(300, step))

    # Generate track
    positions = prop.generate_track_minutes(duration, step)

    # Generate swath polygons for each position
    swaths = []
    for i, pos in enumerate(positions):
        swaths.append({
            "center": [pos["longitude"], pos["latitude"]],
            "time": pos["timestamp"],
            "index": i
        })

    return jsonify({
        "swaths": swaths,
        "duration_minutes": duration,
        "step_seconds": step,
        "swath_radius_km": 1530,
        "total_positions": len(swaths)
    })


def _haversine_km(lat1, lon1, lat2, lon2):
    """Haversine distance in km between two lat/lon points (degrees)."""
    R = 6371.0
    rlat1, rlon1, rlat2, rlon2 = (math.radians(v) for v in (lat1, lon1, lat2, lon2))
    dlat = rlat2 - rlat1
    dlon = rlon2 - rlon1
    a = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def _compute_coverage_grid(positions, half_width_km, grid_size):
    """
    Build a {(lat_idx, lon_idx): pass_count} grid from propagated positions.

    For each position, marks all grid cells whose centers fall within
    half_width_km of the sub-satellite point.
    """
    R = 6371.0
    angular_radius = half_width_km / R * (180.0 / math.pi)  # ~13.85 deg for 1530 km
    n_lat = int(180 / grid_size)
    n_lon = int(360 / grid_size)
    grid = {}

    for pos in positions:
        plat = pos["latitude"]
        plon = pos["longitude"]

        lat_min = max(-90.0, plat - angular_radius - grid_size)
        lat_max = min(90.0, plat + angular_radius + grid_size)

        lat_idx_lo = max(0, int((lat_min + 90) / grid_size))
        lat_idx_hi = min(n_lat - 1, int((lat_max + 90) / grid_size))

        for lat_idx in range(lat_idx_lo, lat_idx_hi + 1):
            cell_lat = -90.0 + lat_idx * grid_size + grid_size / 2.0

            # Longitude range narrows at high latitudes
            cos_lat = math.cos(math.radians(cell_lat))
            if cos_lat > 0.001:
                lon_range = angular_radius / cos_lat
            else:
                lon_range = 180.0  # near poles, check all longitudes

            lon_min = plon - lon_range - grid_size
            lon_max = plon + lon_range + grid_size

            lon_idx_lo = int((lon_min + 180) / grid_size) % n_lon
            lon_idx_hi = int((lon_max + 180) / grid_size) % n_lon

            # Handle wrapping around the antimeridian
            if lon_idx_lo <= lon_idx_hi:
                lon_range_iter = range(lon_idx_lo, lon_idx_hi + 1)
            else:
                lon_range_iter = list(range(lon_idx_lo, n_lon)) + list(range(0, lon_idx_hi + 1))

            for lon_idx in lon_range_iter:
                cell_lon = -180.0 + lon_idx * grid_size + grid_size / 2.0
                dist = _haversine_km(plat, plon, cell_lat, cell_lon)
                if dist <= half_width_km:
                    key = (lat_idx, lon_idx)
                    grid[key] = grid.get(key, 0) + 1

    return grid, n_lat, n_lon


@app.route("/api/coverage-heatmap")
def api_coverage_heatmap():
    """
    Return grid-based coverage heatmap data.

    Propagates the satellite for the requested duration, then counts
    how many swath passes cover each grid cell.

    Query params:
        satellite: satellite key (default: noaa21)
        hours: hours of coverage (default: 24, max: 48)
        grid: cell size in degrees (default: 2, min: 1, max: 5)
    """
    sat_key = request.args.get("satellite", DEFAULT_SATELLITE)
    if sat_key not in SATELLITE_CATALOG:
        sat_key = DEFAULT_SATELLITE

    hours = request.args.get("hours", default=24, type=int)
    hours = max(1, min(48, hours))
    grid_size = request.args.get("grid", default=2, type=int)
    grid_size = max(1, min(5, grid_size))

    sat_info = SATELLITE_CATALOG[sat_key]
    swath_km = sat_info.get("swath_km", 3060)
    half_width_km = swath_km / 2.0

    # Check cache -- reuse if same params and TLE hasn't changed
    prop = get_propagator(sat_key)
    tle_epoch_str = prop.tle_epoch.isoformat()
    cache_key = (sat_key, hours, grid_size)

    if cache_key in _heatmap_cache:
        cached = _heatmap_cache[cache_key]
        if cached["tle_epoch"] == tle_epoch_str:
            return jsonify(cached["data"])

    # Propagate at 30-second steps
    now = datetime.now(timezone.utc)
    end = now + timedelta(hours=hours)
    positions = prop.generate_track(now, end, step_seconds=30)

    # Build grid
    grid, n_lat, n_lon = _compute_coverage_grid(positions, half_width_km, grid_size)

    # Format output cells
    cells = []
    max_count = 0
    for (lat_idx, lon_idx), count in grid.items():
        cell_lat = -90.0 + lat_idx * grid_size + grid_size / 2.0
        cell_lon = -180.0 + lon_idx * grid_size + grid_size / 2.0
        cells.append({"lat": round(cell_lat, 1), "lon": round(cell_lon, 1), "passes": count})
        if count > max_count:
            max_count = count

    result = {
        "grid_size": grid_size,
        "hours": hours,
        "satellite": sat_key,
        "swath_km": swath_km,
        "max_passes": max_count,
        "cell_count": len(cells),
        "cells": cells
    }

    # Cache the result
    _heatmap_cache[cache_key] = {
        "data": result,
        "computed_at": now,
        "tle_epoch": tle_epoch_str
    }

    return jsonify(result)


@app.route("/api/constellation/current")
def api_constellation_current():
    """Return current positions for all satellites in the constellation."""
    results = []

    for sat_key, sat_info in SATELLITE_CATALOG.items():
        try:
            prop = get_propagator(sat_key)
            pos = prop.get_current_position()

            if pos:
                orbit_info = prop.get_orbit_info()
                results.append({
                    "satellite_key": sat_key,
                    "name": sat_info["name"],
                    "norad_id": sat_info["norad_id"],
                    "color": sat_info["color"],
                    "swath_km": sat_info["swath_km"],
                    "latitude": pos["latitude"],
                    "longitude": pos["longitude"],
                    "altitude_km": pos["altitude_km"],
                    "velocity_km_s": pos["velocity_km_s"],
                    "orbit_number": orbit_info["current_orbit_number"],
                    "timestamp": pos["timestamp"]
                })
        except Exception as e:
            print(f"Error fetching {sat_key}: {e}")
            continue

    return jsonify({
        "satellites": results,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "count": len(results)
    })


# ============================================
# NASA FIRMS Active Fire Overlay
# ============================================

@app.route("/api/fires")
def api_fires():
    """
    Proxy NASA FIRMS active fire data with caching and filtering.

    Query params:
        hours: time window label (default: 24, accepted: 24/48)
        satellite: satellite key for FIRMS source (default: noaa21)
    """
    sat_key = request.args.get("satellite", "noaa21")
    days = 1
    hours_param = request.args.get("hours", default=24, type=int)
    if hours_param > 24:
        days = 2

    source = FIRMS_SOURCE_MAP.get(sat_key, "VIIRS_NOAA21_NRT")
    cache_key = f"fires_{source}_world_{days}"

    cached = _get_fires_cached(cache_key)
    if cached:
        return jsonify(cached)

    url = f"{FIRMS_BASE}/{FIRMS_MAP_KEY}/{source}/world/{days}"

    try:
        resp = http_requests.get(url, timeout=30)
        resp.raise_for_status()
    except http_requests.exceptions.Timeout:
        return jsonify({"error": "FIRMS API timed out", "fires": [], "count": 0}), 504
    except http_requests.exceptions.RequestException as e:
        return jsonify({"error": f"FIRMS request failed: {str(e)}", "fires": [], "count": 0}), 502

    # Parse CSV response
    confidence_order = {"low": 0, "nominal": 1, "high": 2}
    fires = []

    try:
        reader = csv.DictReader(StringIO(resp.text))
        for row in reader:
            conf = row.get("confidence", "low").strip()
            if confidence_order.get(conf, 0) < 1:
                continue  # skip 'low' confidence

            try:
                lat = float(row.get("latitude", 0))
                lon = float(row.get("longitude", 0))
                brightness = float(row.get("bright_ti4", 0))
                frp = float(row.get("frp", 0))
            except (ValueError, TypeError):
                continue

            fires.append({
                "lat": lat,
                "lon": lon,
                "brightness": brightness,
                "confidence": conf,
                "frp": frp,
                "acq_date": row.get("acq_date", ""),
                "acq_time": row.get("acq_time", ""),
                "daynight": row.get("daynight", ""),
            })

            if len(fires) >= FIRES_MAX_POINTS:
                break
    except Exception as e:
        return jsonify({"error": f"Failed to parse FIRMS CSV: {str(e)}", "fires": [], "count": 0}), 500

    result = {
        "fires": fires,
        "count": len(fires),
        "source": source,
        "day_range": days,
        "cached": False
    }

    _set_fires_cached(cache_key, result)
    return jsonify(result)


# ============================================
# SIMBAD Astronomical Database Endpoints
# ============================================

SIMBAD_TAP_URL = "https://simbad.u-strasbg.fr/simbad/sim-tap/sync"
SIMBAD_RESOLVE_URL = "https://simbad.u-strasbg.fr/simbad/sim-nameresolver"

# Common SIMBAD object type codes to readable names
SIMBAD_OBJECT_TYPES = {
    "*": "Star",
    "**": "Double Star",
    "*iC": "Star in Cluster",
    "*iN": "Star in Nebula",
    "AB*": "Asymptotic Giant Branch Star",
    "Ae*": "Herbig Ae/Be Star",
    "AGN": "Active Galactic Nucleus",
    "Bla": "BL Lac Object",
    "BS*": "Blue Straggler",
    "BY*": "Variable of BY Dra type",
    "C*": "Carbon Star",
    "Ce*": "Cepheid Variable",
    "Cl*": "Star Cluster",
    "CV*": "Cataclysmic Variable",
    "DN*": "Dwarf Nova",
    "Em*": "Emission-line Star",
    "ER*": "Eclipsing Binary",
    "G": "Galaxy",
    "GiC": "Galaxy in Cluster",
    "GiG": "Galaxy in Group",
    "GiP": "Galaxy in Pair",
    "GlC": "Globular Cluster",
    "HB*": "Horizontal Branch Star",
    "HII": "HII Region",
    "HV*": "High Velocity Star",
    "IG": "Interacting Galaxy",
    "IR": "Infrared Source",
    "LP*": "Long Period Variable",
    "Mi*": "Mira Variable",
    "Neb": "Nebula",
    "No*": "Nova",
    "OpC": "Open Cluster",
    "Or*": "Variable of Orion Type",
    "PN": "Planetary Nebula",
    "Psr": "Pulsar",
    "QSO": "Quasar",
    "RG*": "Red Giant",
    "RNe": "Reflection Nebula",
    "RR*": "RR Lyrae Variable",
    "RS*": "RS CVn Variable",
    "SB*": "Spectroscopic Binary",
    "SC*": "Semi-regular Variable",
    "Sg*": "Supergiant",
    "SN": "Supernova",
    "SNR": "Supernova Remnant",
    "SR*": "Semi-regular Variable",
    "sy*": "Symbiotic Star",
    "TT*": "T Tauri Star",
    "V*": "Variable Star",
    "WD*": "White Dwarf",
    "WR*": "Wolf-Rayet Star",
    "X": "X-ray Source",
    "XB*": "X-ray Binary",
    "YSO": "Young Stellar Object",
}


def get_object_type_name(type_code: str) -> str:
    """Convert SIMBAD object type code to readable name."""
    if not type_code:
        return "Unknown"
    return SIMBAD_OBJECT_TYPES.get(type_code, type_code)

# HiPS2FITS service for image cutouts from multiple surveys
HIPS2FITS_URL = "https://alasky.cds.unistra.fr/hips-image-services/hips2fits"

# Available HiPS surveys for image cutouts
AVAILABLE_SURVEYS = {
    # Optical wide-field surveys
    "dss2_color": "CDS/P/DSS2/color",
    "dss2_red": "CDS/P/DSS2/red",
    "dss2_blue": "CDS/P/DSS2/blue",
    "sdss9_color": "CDS/P/SDSS9/color",
    "sdss9_g": "CDS/P/SDSS9/g",
    "sdss9_r": "CDS/P/SDSS9/r",
    "panstarrs_color": "CDS/P/PanSTARRS/DR1/color-z-zg-g",
    "panstarrs_g": "CDS/P/PanSTARRS/DR1/g",
    "panstarrs_r": "CDS/P/PanSTARRS/DR1/r",
    "decaps": "CDS/P/DECaPS/DR2/color",
    "skymapper": "CDS/P/skymapper-color",
    # Hubble Legacy Archive - High Resolution Optical (0.05 arcsec/pixel)
    "hla_v": "CDS/P/HLA/V",           # V band: F555W, F547M, F569W
    "hla_widev": "CDS/P/HLA/wideV",   # Wide V: F606W, F600LP
    "hla_b": "CDS/P/HLA/B",           # Blue: F450W, F439W, F438W, F435W
    "hla_r": "CDS/P/HLA/R",           # Red: F702W, F675W
    "hla_i": "CDS/P/HLA/I",           # I band: F814W, F791W, F785LP, F775W
    "hla_sdssg": "CDS/P/HLA/SDSSg",   # SDSS g: F475W
    "hla_sdssr": "CDS/P/HLA/SDSSr",   # SDSS r: F625W, F622W
    "hla_halpha": "CDS/P/HLA/Halpha", # H-alpha: F656N, F657N
    "hla_oiii": "CDS/P/HLA/OIII",     # OIII: F502N (nebulae)
    # Infrared surveys
    "2mass_color": "CDS/P/2MASS/color",
    "2mass_j": "CDS/P/2MASS/J",
    "2mass_h": "CDS/P/2MASS/H",
    "2mass_k": "CDS/P/2MASS/K",
    "wise_color": "CDS/P/allWISE/color",
    # Hubble Infrared
    "hla_h": "CDS/P/HLA/H",           # H band: F160W
    "hla_j": "CDS/P/HLA/J",           # J band: F140W, F125W
    "hla_y": "CDS/P/HLA/Y",           # Y band: F110W, F105W
    # UV surveys
    "galex_nuv": "CDS/P/GALEXGR6_7/NUV",
    "galex_fuv": "CDS/P/GALEXGR6_7/FUV",
    "hla_uv": "CDS/P/HLA/UV",         # UV: F170W (highest res UV!)
    "hla_u": "CDS/P/HLA/U",           # U band: F336W, F330W, F300W, F275W
    "hla_wideuv": "CDS/P/HLA/wideUV", # Wide UV: F255W, F250W, F225W
    # Other
    "mellinger": "CDS/P/Mellinger/color",
    "fermi": "CDS/P/Fermi/color",
    "rosat": "CDS/P/RASS",
}


@app.route("/api/simbad/region")
def api_simbad_region():
    """
    Query SIMBAD for objects in a circular region of the sky.
    Includes magnitude data from the allfluxes table.

    Query params:
        ra: Right Ascension in degrees (required)
        dec: Declination in degrees (required)
        radius: Search radius in degrees (default: 1.0)
        limit: Max objects to return (default: 20)
    """
    ra = request.args.get("ra", type=float)
    dec = request.args.get("dec", type=float)
    radius = request.args.get("radius", default=1.0, type=float)
    limit = request.args.get("limit", default=20, type=int)

    if ra is None or dec is None:
        return jsonify({"error": "ra and dec parameters required"}), 400

    # Clamp values
    radius = max(0.01, min(5.0, radius))
    limit = max(1, min(50, limit))

    # ADQL query for basic object info
    # Note: SIMBAD's flux table stores one row per filter, not columns
    # We query basic info first, then get V magnitude with a subquery
    query = f"""
        SELECT TOP {limit}
            main_id, ra, dec, otype, sp_type,
            plx_value, rvz_radvel, galdim_majaxis, oid
        FROM basic
        WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra}, {dec}, {radius})) = 1
    """

    try:
        response = http_requests.get(
            SIMBAD_TAP_URL,
            params={
                "request": "doQuery",
                "lang": "adql",
                "format": "json",
                "query": query
            },
            timeout=20
        )
        response.raise_for_status()
        data = response.json()

        # Parse results
        objects = []
        oid_list = []  # Collect OIDs for flux lookup
        if "data" in data and data["data"]:
            for row in data["data"]:
                obj = {
                    "name": row[0],
                    "ra": row[1],
                    "dec": row[2],
                    "type": get_object_type_name(row[3]) if row[3] else "Unknown",
                    "type_code": row[3],
                    "spectral_type": row[4],
                    "parallax_mas": row[5],
                    "radial_velocity_kms": row[6],
                    "angular_size_arcmin": row[7],
                    "oid": row[8],
                    "magnitudes": {},
                    "magnitude_v": None
                }

                # Calculate distance if parallax available
                if obj["parallax_mas"] and obj["parallax_mas"] > 0:
                    obj["distance_ly"] = 3261.5 / obj["parallax_mas"]
                    obj["distance_pc"] = 1000.0 / obj["parallax_mas"]

                # Assign priority for sorting (interesting objects first)
                obj_type = (obj["type"] or "").lower()
                type_code = (obj["type_code"] or "").lower()
                if "galaxy" in obj_type or type_code in ("g", "gic", "gig", "gip", "ig"):
                    obj["priority"] = 1
                elif "nebula" in obj_type or type_code in ("neb", "pn", "hii", "rne"):
                    obj["priority"] = 2
                elif "cluster" in obj_type or type_code in ("glc", "opc", "cl*"):
                    obj["priority"] = 3
                elif "supernova" in obj_type or type_code in ("sn", "snr"):
                    obj["priority"] = 4
                elif "pulsar" in obj_type or type_code == "psr":
                    obj["priority"] = 5
                elif "quasar" in obj_type or type_code == "qso":
                    obj["priority"] = 6
                elif "agn" in type_code or "bla" in type_code:
                    obj["priority"] = 7
                else:
                    obj["priority"] = 10

                objects.append(obj)
                if obj["oid"] is not None:
                    oid_list.append(int(obj["oid"]))

        # Fetch V magnitudes for all objects in a second query
        if oid_list:
            try:
                oid_str = ",".join(str(oid) for oid in oid_list)
                flux_query = f"""
                    SELECT oidref, flux
                    FROM flux
                    WHERE oidref IN ({oid_str}) AND filter = 'V'
                """
                flux_response = http_requests.get(
                    SIMBAD_TAP_URL,
                    params={
                        "request": "doQuery",
                        "lang": "adql",
                        "format": "json",
                        "query": flux_query
                    },
                    timeout=10
                )
                if flux_response.ok:
                    flux_data = flux_response.json()
                    if "data" in flux_data:
                        # Build oid -> magnitude map
                        mag_map = {row[0]: row[1] for row in flux_data["data"]}
                        for obj in objects:
                            if obj["oid"] in mag_map:
                                obj["magnitude_v"] = mag_map[obj["oid"]]
                                obj["magnitudes"]["V"] = mag_map[obj["oid"]]
                                # Boost priority for bright stars
                                if mag_map[obj["oid"]] < 4 and obj["priority"] == 10:
                                    obj["priority"] = 8
            except Exception as e:
                print(f"Flux query failed: {e}")
                # Continue without magnitudes

            # Sort by priority, then by brightness
            objects.sort(key=lambda x: (x["priority"], x.get("magnitude_v") or 99))

        return jsonify({
            "objects": objects,
            "count": len(objects),
            "query": {
                "ra": ra,
                "dec": dec,
                "radius": radius
            }
        })

    except http_requests.exceptions.Timeout:
        return jsonify({"error": "SIMBAD query timed out", "objects": []}), 504
    except http_requests.exceptions.RequestException as e:
        return jsonify({"error": f"SIMBAD request failed: {str(e)}", "objects": []}), 502
    except Exception as e:
        print(f"SIMBAD error: {e}")
        return jsonify({"error": f"Query processing error: {str(e)}", "objects": []}), 500


@app.route("/api/simbad/resolve")
def api_simbad_resolve():
    """
    Resolve an object name to coordinates using SIMBAD.
    Also fetches detailed information about the object.

    Query params:
        name: Object name to resolve (required)
    """
    name = request.args.get("name", "").strip()

    if not name:
        return jsonify({"error": "name parameter required"}), 400

    try:
        # First resolve the name to get coordinates
        response = http_requests.get(
            SIMBAD_RESOLVE_URL,
            params={
                "ident": name,
                "output": "json"
            },
            timeout=10
        )
        response.raise_for_status()
        data = response.json()

        if not data or len(data) == 0:
            return jsonify({
                "found": False,
                "name": name,
                "error": "Object not found"
            })

        # Find the first object with coordinates (some results like moving groups don't have them)
        obj = None
        for item in data:
            if "ra" in item and "dec" in item:
                obj = item
                break

        if obj is None:
            return jsonify({
                "found": False,
                "name": name,
                "error": "No object with coordinates found"
            })
        # Get readable type name
        type_code = obj.get("otype", "")
        result = {
            "found": True,
            "name": obj.get("mainId") or obj.get("name", name),
            "ra": obj["ra"],
            "dec": obj["dec"],
            "type": get_object_type_name(type_code),
            "type_code": type_code,
            "spectral_type": obj.get("sptype"),
            "aliases": obj.get("idlist", [])[:10]  # Limit aliases
        }

        # Now query for detailed info using oid from nameresolver
        oid = obj.get("oid")
        if oid is not None:
            oid = int(oid)
        if oid:
            try:
                detail_query = f"""
                    SELECT main_id, otype, sp_type, plx_value,
                           rvz_radvel, galdim_majaxis
                    FROM basic
                    WHERE oid = {oid}
                """
                detail_response = http_requests.get(
                    SIMBAD_TAP_URL,
                    params={
                        "request": "doQuery",
                        "lang": "adql",
                        "format": "json",
                        "query": detail_query
                    },
                    timeout=10
                )
                if detail_response.ok:
                    detail_data = detail_response.json()
                    if detail_data.get("data") and len(detail_data["data"]) > 0:
                        row = detail_data["data"][0]
                        result["name"] = row[0] or result["name"]
                        result["type"] = get_object_type_name(row[1])
                        result["type_code"] = row[1]
                        result["spectral_type"] = row[2]
                        result["parallax_mas"] = row[3]
                        result["radial_velocity_kms"] = row[4]
                        result["angular_size_arcmin"] = row[5]
                        if result["parallax_mas"] and result["parallax_mas"] > 0:
                            result["distance_ly"] = 3261.5 / result["parallax_mas"]

                # Get V magnitude
                flux_query = f"SELECT flux FROM flux WHERE oidref = {oid} AND filter = 'V'"
                flux_response = http_requests.get(
                    SIMBAD_TAP_URL,
                    params={
                        "request": "doQuery",
                        "lang": "adql",
                        "format": "json",
                        "query": flux_query
                    },
                    timeout=10
                )
                if flux_response.ok:
                    flux_data = flux_response.json()
                    if flux_data.get("data") and len(flux_data["data"]) > 0:
                        result["magnitude_v"] = flux_data["data"][0][0]
                        result["magnitudes"] = {"V": flux_data["data"][0][0]}
            except Exception as e:
                print(f"Detail query failed: {e}")
                # Continue with basic info

        return jsonify(result)

    except http_requests.exceptions.Timeout:
        return jsonify({"error": "SIMBAD query timed out", "found": False}), 504
    except http_requests.exceptions.RequestException as e:
        return jsonify({"error": f"SIMBAD request failed: {str(e)}", "found": False}), 502
    except Exception as e:
        return jsonify({"error": f"Resolution error: {str(e)}", "found": False}), 500


@app.route("/api/surveys")
def api_surveys():
    """Return list of available image surveys."""
    return jsonify({
        "surveys": AVAILABLE_SURVEYS,
        "categories": {
            "optical": ["dss2_color", "dss2_red", "sdss9_color", "panstarrs_color"],
            "infrared": ["2mass_color", "2mass_j", "wise_color"],
            "ultraviolet": ["galex_nuv", "galex_fuv"],
            "hubble": ["hla_v", "hla_b", "hla_h"],
            "other": ["mellinger", "fermi", "rosat"]
        }
    })


@app.route("/api/cutout")
def api_cutout():
    """
    Get image cutout URL from HiPS2FITS service.

    Query params:
        ra: Right Ascension in degrees (required)
        dec: Declination in degrees (required)
        fov: Field of view in degrees (default: 0.1)
        survey: Survey key from AVAILABLE_SURVEYS (default: dss2_color)
        width: Image width in pixels (default: 500)
        height: Image height in pixels (default: 500)
        format: Output format - fits or jpg (default: jpg)
    """
    ra = request.args.get("ra", type=float)
    dec = request.args.get("dec", type=float)
    fov = request.args.get("fov", default=0.1, type=float)
    survey = request.args.get("survey", default="dss2_color")
    width = request.args.get("width", default=500, type=int)
    height = request.args.get("height", default=500, type=int)
    output_format = request.args.get("format", default="jpg")

    if ra is None or dec is None:
        return jsonify({"error": "ra and dec parameters required"}), 400

    # Validate survey
    hips_id = AVAILABLE_SURVEYS.get(survey)
    if not hips_id:
        return jsonify({
            "error": f"Unknown survey: {survey}",
            "available": list(AVAILABLE_SURVEYS.keys())
        }), 400

    # Clamp values
    width = max(100, min(2000, width))
    height = max(100, min(2000, height))
    fov = max(0.001, min(10.0, fov))

    # Build HiPS2FITS URL
    cutout_url = (
        f"{HIPS2FITS_URL}?"
        f"hips={hips_id}&"
        f"ra={ra}&dec={dec}&"
        f"fov={fov}&"
        f"width={width}&height={height}&"
        f"projection=TAN&"
        f"format={output_format}"
    )

    return jsonify({
        "url": cutout_url,
        "survey": survey,
        "hips_id": hips_id,
        "ra": ra,
        "dec": dec,
        "fov_deg": fov,
        "width": width,
        "height": height,
        "format": output_format
    })


@app.route("/api/cutout/multi")
def api_cutout_multi():
    """
    Get cutout URLs from multiple surveys for comparison.

    Query params:
        ra: Right Ascension in degrees (required)
        dec: Declination in degrees (required)
        fov: Field of view in degrees (default: 0.1)
        surveys: Comma-separated list of surveys (default: dss2_color,sdss9_color,2mass_color)
    """
    ra = request.args.get("ra", type=float)
    dec = request.args.get("dec", type=float)
    fov = request.args.get("fov", default=0.1, type=float)
    surveys_str = request.args.get("surveys", "dss2_color,sdss9_color,2mass_color")

    if ra is None or dec is None:
        return jsonify({"error": "ra and dec parameters required"}), 400

    surveys = [s.strip() for s in surveys_str.split(",")]

    cutouts = []
    for survey in surveys:
        hips_id = AVAILABLE_SURVEYS.get(survey)
        if hips_id:
            cutout_url = (
                f"{HIPS2FITS_URL}?"
                f"hips={hips_id}&"
                f"ra={ra}&dec={dec}&"
                f"fov={fov}&"
                f"width=400&height=400&"
                f"projection=TAN&"
                f"format=jpg"
            )
            cutouts.append({
                "survey": survey,
                "hips_id": hips_id,
                "url": cutout_url
            })

    return jsonify({
        "cutouts": cutouts,
        "ra": ra,
        "dec": dec,
        "fov_deg": fov
    })


if __name__ == "__main__":
    print("Starting JPSS Constellation Orbit API server...")
    print("Fetching initial TLE data for all satellites...")

    # Initialize all satellites on startup
    for sat_key in SATELLITE_CATALOG:
        print(f"  Loading {SATELLITE_CATALOG[sat_key]['name']}...")
        get_propagator(sat_key)

    print(f"\nAll TLEs loaded. Server starting on http://localhost:5050")
    app.run(host="0.0.0.0", port=5050, debug=False)
