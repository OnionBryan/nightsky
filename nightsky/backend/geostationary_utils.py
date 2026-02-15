"""
Geostationary Satellite Utilities

Handles:
- Calculate look angles (azimuth, elevation) for GEO satellites
- Fetch TLE data for major geostationary satellites
- Determine which satellites are visible from observer location
"""

import math
import requests
from datetime import datetime
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
    sat_longitude: float
) -> Dict[str, Any]:
    """
    Calculate azimuth and elevation for a geostationary satellite.

    Args:
        observer_lat: Observer latitude in degrees (-90 to +90)
        observer_lon: Observer longitude in degrees (-180 to +180)
        sat_longitude: Satellite orbital longitude in degrees

    Returns:
        dict with azimuth, elevation, slant_range, visible
    """
    # Check if observer is too far north/south
    if abs(observer_lat) > MAX_VISIBLE_LATITUDE:
        return {
            "azimuth": None,
            "elevation": None,
            "slant_range_km": None,
            "visible": False,
            "reason": f"Observer latitude {observer_lat}° exceeds maximum {MAX_VISIBLE_LATITUDE}°"
        }

    # Calculate delta longitude
    delta_lon = normalize_longitude(sat_longitude - observer_lon)

    # Convert to radians
    lat_rad = math.radians(observer_lat)
    delta_rad = math.radians(delta_lon)

    # Calculate azimuth using spherical trigonometry
    # Azimuth measured clockwise from North
    az_num = math.sin(delta_rad)
    cos_lat = math.cos(lat_rad)
    sin_lat = math.sin(lat_rad)
    cos_delta = math.cos(delta_rad)

    # Avoid division by zero near poles
    if abs(cos_lat) < 1e-10:
        return {
            "azimuth": None,
            "elevation": None,
            "slant_range_km": None,
            "visible": False,
            "reason": "Observer too close to pole"
        }

    # Full azimuth calculation
    azimuth = math.degrees(math.atan2(
        math.tan(delta_rad),
        math.sin(lat_rad)
    ))

    # Adjust azimuth to 0-360 range
    if delta_lon < 0:
        azimuth = 180 + azimuth
    else:
        azimuth = 180 - azimuth

    azimuth = azimuth % 360

    # Calculate angular distance from observer to sub-satellite point
    cos_d = cos_lat * cos_delta

    # Calculate elevation using plane trigonometry
    # El = arctan[(cos(d) - R/r) / sin(d)]
    sin_d = math.sqrt(1 - cos_d**2)

    if sin_d < 1e-10:
        # Observer directly under satellite (equator, same longitude)
        elevation = 90.0
    else:
        el_num = cos_d - (R_EARTH / R_GEO)
        elevation = math.degrees(math.atan2(el_num, sin_d))

    # Calculate slant range
    slant_range = math.sqrt(
        R_GEO**2 + R_EARTH**2 - 2 * R_GEO * R_EARTH * cos_d
    )

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
                "fetched_at": datetime.utcnow().isoformat()
            }
        elif len(lines) >= 2:
            return {
                "tle_line1": lines[0].strip(),
                "tle_line2": lines[1].strip(),
                "fetched_at": datetime.utcnow().isoformat()
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
