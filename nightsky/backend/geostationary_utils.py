"""
Geostationary Satellite Utilities

Handles:
- Calculate look angles (azimuth, elevation) for GEO satellites
- Fetch TLE data for major geostationary satellites
- Determine which satellites are visible from observer location
"""

import math
import requests
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from dataclasses import dataclass


# Earth constants (WGS84)
R_EARTH = 6378.137  # km (equatorial radius)
R_GEO = 42164.17    # km (geostationary orbital radius from Earth center)
H_GEO = 35786.0     # km (geostationary altitude above equator)

# Maximum latitude where GEO satellites are visible (horizon grazing)
MAX_VISIBLE_LATITUDE = 81.3


@dataclass
class GeoSatellite:
    """Geostationary satellite definition."""
    name: str
    norad_id: int
    longitude: float  # Orbital longitude in degrees
    category: str  # weather, communications, etc.
    operator: str


# Major geostationary satellites to track
MAJOR_GEO_SATELLITES = [
    # US Weather (GOES)
    GeoSatellite("GOES-18", 54743, -137.0, "weather", "NOAA"),
    GeoSatellite("GOES-16", 41866, -75.2, "weather", "NOAA"),

    # Japan Weather
    GeoSatellite("Himawari-8", 40267, 140.7, "weather", "JMA"),
    GeoSatellite("Himawari-9", 41836, 140.7, "weather", "JMA"),

    # European Weather
    GeoSatellite("Meteosat-11", 40732, 0.0, "weather", "EUMETSAT"),
    GeoSatellite("Meteosat-10", 38552, 9.5, "weather", "EUMETSAT"),

    # Indian Weather
    GeoSatellite("INSAT-3D", 39216, 82.0, "weather", "ISRO"),
    GeoSatellite("INSAT-3DR", 41752, 74.0, "weather", "ISRO"),

    # Chinese Weather
    GeoSatellite("FY-4A", 41882, 104.7, "weather", "CMA"),

    # Korean Weather
    GeoSatellite("GK-2A", 43823, 128.2, "weather", "KMA"),

    # Major Communications (sample)
    GeoSatellite("Intelsat 901", 24709, 27.5, "communications", "Intelsat"),
    GeoSatellite("SES-1", 36516, -101.0, "communications", "SES"),
    GeoSatellite("Galaxy 19", 33376, -97.0, "communications", "Intelsat"),
    GeoSatellite("Eutelsat 36B", 37816, 36.0, "communications", "Eutelsat"),
    GeoSatellite("AsiaSat 5", 35812, 100.5, "communications", "AsiaSat"),
]


def normalize_longitude(lon: float) -> float:
    """Normalize longitude to [-180, 180] range."""
    while lon > 180:
        lon -= 360
    while lon < -180:
        lon += 360
    return lon


def calculate_geo_look_angles(
    observer_lat: float,
    observer_lon: float,
    sat_longitude: float,
    observer_alt_km: float = 0.0,
) -> Dict[str, Any]:
    """
    Calculate azimuth and elevation for a geostationary satellite.

    Uses ECEF geometry on a spherical Earth of radius R_EARTH, then projects
    the observer→satellite line-of-sight into the local East-North-Up (ENU)
    frame. Azimuth is measured clockwise from true north (0–360°). Elevation
    is the angle above the local horizon.

    This replaces an earlier spherical-trig form that produced large azimuth
    errors in the southern hemisphere and for large longitude offsets.

    Args:
        observer_lat: Observer latitude in degrees (-90 to +90)
        observer_lon: Observer longitude in degrees (-180 to +180)
        sat_longitude: Satellite orbital longitude in degrees (sub-sat lon)
        observer_alt_km: Observer height above the sphere (km)

    Returns:
        dict with azimuth, elevation, slant_range, visible, delta_longitude
    """
    # Geometric horizon limit for a spherical Earth + GEO radius
    if abs(observer_lat) > MAX_VISIBLE_LATITUDE:
        return {
            "azimuth": None,
            "elevation": None,
            "slant_range_km": None,
            "visible": False,
            "reason": f"Observer latitude {observer_lat}° exceeds maximum {MAX_VISIBLE_LATITUDE}°"
        }

    delta_lon = normalize_longitude(sat_longitude - observer_lon)

    lat = math.radians(observer_lat)
    lon = math.radians(observer_lon)
    slon = math.radians(sat_longitude)

    r_obs = R_EARTH + observer_alt_km
    # Observer ECEF (spherical Earth; GEO math is already spherical)
    o_x = r_obs * math.cos(lat) * math.cos(lon)
    o_y = r_obs * math.cos(lat) * math.sin(lon)
    o_z = r_obs * math.sin(lat)

    # GEO satellite on the equatorial belt
    s_x = R_GEO * math.cos(slon)
    s_y = R_GEO * math.sin(slon)
    s_z = 0.0

    # Line-of-sight vector observer → satellite
    dx = s_x - o_x
    dy = s_y - o_y
    dz = s_z - o_z

    # Local ENU basis at observer
    sin_lat, cos_lat = math.sin(lat), math.cos(lat)
    sin_lon, cos_lon = math.sin(lon), math.cos(lon)

    east = (-sin_lon, cos_lon, 0.0)
    north = (-sin_lat * cos_lon, -sin_lat * sin_lon, cos_lat)
    up = (cos_lat * cos_lon, cos_lat * sin_lon, sin_lat)

    e = dx * east[0] + dy * east[1] + dz * east[2]
    n = dx * north[0] + dy * north[1] + dz * north[2]
    u = dx * up[0] + dy * up[1] + dz * up[2]

    slant_range = math.sqrt(dx * dx + dy * dy + dz * dz)
    horiz = math.hypot(e, n)

    if horiz < 1e-12 and abs(u) < 1e-12:
        return {
            "azimuth": None,
            "elevation": None,
            "slant_range_km": None,
            "visible": False,
            "reason": "Degenerate geometry"
        }

    # atan2(east, north): 0° = north, 90° = east (clockwise from north)
    azimuth = math.degrees(math.atan2(e, n)) % 360.0
    elevation = math.degrees(math.atan2(u, horiz)) if horiz > 1e-12 else (90.0 if u > 0 else -90.0)

    visible = elevation >= 0

    return {
        "azimuth": round(azimuth, 2),
        "elevation": round(elevation, 2),
        "slant_range_km": round(slant_range, 1),
        "visible": visible,
        "delta_longitude": round(delta_lon, 2)
    }


def get_visible_geo_satellites(
    observer_lat: float,
    observer_lon: float,
    satellites: Optional[List[GeoSatellite]] = None,
    min_elevation: float = 5.0
) -> List[Dict[str, Any]]:
    """
    Get all geostationary satellites visible from observer location.

    Args:
        observer_lat: Observer latitude
        observer_lon: Observer longitude
        satellites: Optional list of satellites (defaults to MAJOR_GEO_SATELLITES)
        min_elevation: Minimum elevation angle to consider visible

    Returns:
        List of visible satellites with look angles
    """
    if satellites is None:
        satellites = MAJOR_GEO_SATELLITES

    visible = []

    for sat in satellites:
        angles = calculate_geo_look_angles(observer_lat, observer_lon, sat.longitude)

        if angles["visible"] and angles["elevation"] >= min_elevation:
            visible.append({
                "name": sat.name,
                "norad_id": sat.norad_id,
                "orbital_longitude": sat.longitude,
                "category": sat.category,
                "operator": sat.operator,
                **angles
            })

    # Sort by azimuth for ordered display
    visible.sort(key=lambda x: x["azimuth"])

    return visible


def get_geostationary_arc(
    observer_lat: float,
    observer_lon: float,
    num_points: int = 72  # Every 5 degrees of longitude
) -> Dict[str, Any]:
    """
    Calculate the full geostationary arc as seen from observer.

    Returns points along the arc for visualization.

    Args:
        observer_lat: Observer latitude
        observer_lon: Observer longitude
        num_points: Number of points to calculate around the arc

    Returns:
        Dictionary with arc points and metadata
    """
    arc_points = []

    # Calculate points every 5 degrees around the geostationary belt
    for i in range(num_points):
        sat_lon = -180 + (i * 360 / num_points)
        angles = calculate_geo_look_angles(observer_lat, observer_lon, sat_lon)

        if angles["visible"] and angles["elevation"] is not None:
            arc_points.append({
                "longitude": sat_lon,
                "azimuth": angles["azimuth"],
                "elevation": angles["elevation"]
            })

    # Calculate apparent declination of the arc (parallax effect)
    # The geostationary belt appears shifted from celestial equator
    apparent_declination = -observer_lat * 0.5  # Rough parallax correction

    return {
        "observer": {
            "latitude": observer_lat,
            "longitude": observer_lon
        },
        "arc_points": arc_points,
        "apparent_declination": round(apparent_declination, 2),
        "max_elevation": max([p["elevation"] for p in arc_points]) if arc_points else 0,
        "visible_range": {
            "min_azimuth": min([p["azimuth"] for p in arc_points]) if arc_points else None,
            "max_azimuth": max([p["azimuth"] for p in arc_points]) if arc_points else None
        }
    }


def fetch_geo_tle(norad_id: int) -> Optional[Dict[str, str]]:
    """
    Fetch TLE for a geostationary satellite from CelesTrak.

    Args:
        norad_id: NORAD catalog number

    Returns:
        Dictionary with TLE lines or None if fetch failed
    """
    url = f"https://celestrak.org/NORAD/elements/gp.php?CATNR={norad_id}&FORMAT=TLE"

    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()

        lines = response.text.strip().split('\n')
        if len(lines) >= 3:
            return {
                "name": lines[0].strip(),
                "tle_line1": lines[1].strip(),
                "tle_line2": lines[2].strip(),
                "fetched_at": datetime.now(timezone.utc).isoformat()
            }
        elif len(lines) >= 2:
            return {
                "tle_line1": lines[0].strip(),
                "tle_line2": lines[1].strip(),
                "fetched_at": datetime.now(timezone.utc).isoformat()
            }
    except Exception as e:
        print(f"Error fetching TLE for NORAD {norad_id}: {e}")

    return None


def get_geo_satellite_info(name: str) -> Optional[GeoSatellite]:
    """Get satellite info by name."""
    for sat in MAJOR_GEO_SATELLITES:
        if sat.name.lower() == name.lower():
            return sat
    return None


def filter_satellites_by_category(category: str) -> List[GeoSatellite]:
    """Filter satellites by category (weather, communications, etc.)."""
    return [s for s in MAJOR_GEO_SATELLITES if s.category.lower() == category.lower()]


def get_all_satellite_categories() -> List[str]:
    """Get list of all satellite categories."""
    return list(set(s.category for s in MAJOR_GEO_SATELLITES))
