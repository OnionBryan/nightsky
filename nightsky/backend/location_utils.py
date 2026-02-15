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


def is_nighttime(lat: float, lon: float, dt: Optional[datetime] = None) -> bool:
    """
    Check if it's currently nighttime at the given location.

    Simple approximation based on hour - for more accuracy,
    would need to calculate actual sunset/sunrise times.

    Args:
        lat: Latitude
        lon: Longitude
        dt: Optional datetime (defaults to now)

    Returns:
        True if approximately nighttime (between 6 PM and 6 AM local)
    """
    local_dt = get_local_datetime(lat, lon, dt)
    hour = local_dt.hour

    # Simple approximation: nighttime between 6 PM and 6 AM
    return hour >= 18 or hour < 6


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
