"""
Location Utilities for Night Sky Viewer

Handles:
- Geocoding (city name → lat/lon)
- Timezone lookup from coordinates
- Local datetime calculation
"""

from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Optional, Tuple, Dict, Any

from timezonefinder import TimezoneFinder
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderServiceError

# Initialize geocoder with a user agent
_geolocator = Nominatim(user_agent="nightsky_viewer_v1")

# Initialize timezone finder (in_memory for better performance)
_tf = TimezoneFinder(in_memory=True)


def geocode_location(query: str) -> Optional[Dict[str, Any]]:
    """
    Convert a location string to coordinates.

    Args:
        query: Location string (e.g., "New York, NY" or "Paris, France")

    Returns:
        Dictionary with lat, lon, display_name, timezone or None if not found
    """
    try:
        location = _geolocator.geocode(query, timeout=10)

        if location is None:
            return None

        lat = location.latitude
        lon = location.longitude

        # Get timezone for the location
        tz_name = get_timezone(lat, lon)

        return {
            "latitude": lat,
            "longitude": lon,
            "display_name": location.address,
            "timezone": tz_name
        }

    except GeocoderTimedOut:
        print(f"Geocoding timed out for: {query}")
        return None
    except GeocoderServiceError as e:
        print(f"Geocoding service error for {query}: {e}")
        return None
    except Exception as e:
        print(f"Geocoding error for {query}: {e}")
        return None


def get_timezone(lat: float, lon: float) -> str:
    """
    Get timezone name from coordinates.

    Args:
        lat: Latitude in degrees
        lon: Longitude in degrees

    Returns:
        Timezone name (e.g., "America/New_York") or "UTC" if not found
    """
    try:
        tz_name = _tf.timezone_at(lng=lon, lat=lat)
        return tz_name if tz_name else "UTC"
    except Exception as e:
        print(f"Timezone lookup error for ({lat}, {lon}): {e}")
        return "UTC"


def get_local_datetime(lat: float, lon: float, dt: Optional[datetime] = None) -> datetime:
    """
    Get datetime in local timezone for given coordinates.

    Args:
        lat: Latitude in degrees
        lon: Longitude in degrees
        dt: Optional datetime to convert (defaults to now)

    Returns:
        Datetime object with local timezone
    """
    tz_name = get_timezone(lat, lon)
    tz = ZoneInfo(tz_name)

    if dt is None:
        return datetime.now(tz)

    # If dt has no timezone, assume UTC
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZoneInfo("UTC"))

    return dt.astimezone(tz)


def get_zoneinfo(lat: float, lon: float) -> ZoneInfo:
    """
    Get ZoneInfo object for coordinates.

    Args:
        lat: Latitude in degrees
        lon: Longitude in degrees

    Returns:
        ZoneInfo object for the timezone
    """
    tz_name = get_timezone(lat, lon)
    return ZoneInfo(tz_name)


def parse_coordinates(coord_string: str) -> Optional[Tuple[float, float]]:
    """
    Parse a coordinate string into lat/lon tuple.

    Accepts formats:
    - "40.7128, -74.0060"
    - "40.7128 -74.0060"
    - "40.7128N 74.0060W"

    Args:
        coord_string: String containing coordinates

    Returns:
        Tuple of (latitude, longitude) or None if parsing fails
    """
    try:
        # Clean up the string
        s = coord_string.strip().upper()

        # Try simple comma or space separated
        if ',' in s:
            parts = [p.strip() for p in s.split(',')]
        else:
            parts = s.split()

        if len(parts) >= 2:
            lat_str = parts[0]
            lon_str = parts[1]

            # Handle N/S/E/W suffixes
            lat_mult = -1 if 'S' in lat_str else 1
            lon_mult = -1 if 'W' in lon_str else 1

            # Remove letters
            lat_str = ''.join(c for c in lat_str if c.isdigit() or c in '.-')
            lon_str = ''.join(c for c in lon_str if c.isdigit() or c in '.-')

            lat = float(lat_str) * lat_mult
            lon = float(lon_str) * lon_mult

            # Validate ranges
            if -90 <= lat <= 90 and -180 <= lon <= 180:
                return (lat, lon)

        return None

    except (ValueError, IndexError):
        return None


def _solar_elevation_deg(lat: float, lon: float, dt: datetime) -> float:
    """
    Approximate geometric solar elevation (degrees) at (lat, lon, dt).

    Uses a compact solar-position model (declination + equation of time)
    accurate to ~0.3–1° for civil day/night decisions. Not a substitute for
    Skyfield twilight endpoints (see /api/nightsky/twilight).
    """
    import math

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZoneInfo("UTC"))
    utc = dt.astimezone(ZoneInfo("UTC"))

    # Days since J2000.0 (UTC noon epoch approximation)
    # Unix epoch JD = 2440587.5; J2000 = 2451545.0
    day_frac = (
        utc.hour * 3600 + utc.minute * 60 + utc.second + utc.microsecond / 1e6
    ) / 86400.0
    # Date ordinal from 2000-01-01
    y, m, d = utc.year, utc.month, utc.day
    # Meeus-style day number relative to J2000
    jd = (
        367 * y
        - (7 * (y + (m + 9) // 12)) // 4
        + (275 * m) // 9
        + d
        + 1721013.5
        + day_frac
    )
    n = jd - 2451545.0

    # Mean longitude and anomaly (deg)
    L = (280.460 + 0.9856474 * n) % 360.0
    g = math.radians((357.528 + 0.9856003 * n) % 360.0)
    # Ecliptic longitude
    lam = math.radians(L + 1.915 * math.sin(g) + 0.020 * math.sin(2 * g))
    # Obliquity
    eps = math.radians(23.439 - 0.0000004 * n)
    # Declination
    sin_dec = math.sin(eps) * math.sin(lam)
    dec = math.asin(max(-1.0, min(1.0, sin_dec)))
    # Right ascension
    ra = math.atan2(math.cos(eps) * math.sin(lam), math.cos(lam))
    # GMST (hours) then local hour angle
    gmst_hours = (18.697374558 + 24.06570982441908 * n) % 24.0
    lst_hours = (gmst_hours + lon / 15.0) % 24.0
    ha = math.radians(lst_hours * 15.0 - math.degrees(ra))

    lat_r = math.radians(lat)
    sin_el = (
        math.sin(lat_r) * math.sin(dec)
        + math.cos(lat_r) * math.cos(dec) * math.cos(ha)
    )
    return math.degrees(math.asin(max(-1.0, min(1.0, sin_el))))


def is_nighttime(lat: float, lon: float, dt: Optional[datetime] = None) -> bool:
    """
    Check if the Sun is geometrically below the horizon at the location.

    Uses approximate solar elevation (no refraction). For civil/nautical/
    astronomical twilight boundaries, use the Skyfield-backed twilight API.

    Args:
        lat: Latitude
        lon: Longitude
        dt: Optional datetime (defaults to now, interpreted in UTC if naive)

    Returns:
        True if solar elevation < 0°
    """
    if dt is None:
        dt = datetime.now(ZoneInfo("UTC"))
    return _solar_elevation_deg(lat, lon, dt) < 0.0


# Cardinal direction utilities
CARDINAL_DIRECTIONS = {
    "N": {"center": 0, "range": (-45, 45)},
    "NE": {"center": 45, "range": (0, 90)},
    "E": {"center": 90, "range": (45, 135)},
    "SE": {"center": 135, "range": (90, 180)},
    "S": {"center": 180, "range": (135, 225)},
    "SW": {"center": 225, "range": (180, 270)},
    "W": {"center": 270, "range": (225, 315)},
    "NW": {"center": 315, "range": (270, 360)},
}


def get_azimuth_range(direction: str) -> Tuple[float, float]:
    """
    Get azimuth range for a cardinal direction.

    Args:
        direction: Cardinal direction (N, NE, E, SE, S, SW, W, NW)

    Returns:
        Tuple of (min_azimuth, max_azimuth) in degrees
    """
    direction = direction.upper().strip()

    if direction in CARDINAL_DIRECTIONS:
        return CARDINAL_DIRECTIONS[direction]["range"]

    # Default to South if invalid
    return CARDINAL_DIRECTIONS["S"]["range"]


def get_direction_label(direction: str) -> str:
    """
    Get the full name of a cardinal direction.

    Args:
        direction: Short direction code (N, NE, etc.)

    Returns:
        Full name (North, Northeast, etc.)
    """
    labels = {
        "N": "North",
        "NE": "Northeast",
        "E": "East",
        "SE": "Southeast",
        "S": "South",
        "SW": "Southwest",
        "W": "West",
        "NW": "Northwest"
    }
    return labels.get(direction.upper(), direction)
