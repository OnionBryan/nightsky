"""
TLE Fetcher - Downloads and parses Two-Line Element sets from CelesTrak

JPSS Constellation:
  - Suomi NPP: NORAD 37849 (2011)
  - NOAA-20:   NORAD 43013 (2017)
  - NOAA-21:   NORAD 54234 (2022)
"""

import requests
from datetime import datetime, timezone
from pathlib import Path
import json

CELESTRAK_BASE = "https://celestrak.org/NORAD/elements/gp.php"

# JPSS Polar Orbiting Satellite Constellation
SATELLITE_CATALOG = {
    "noaa21": {
        "norad_id": 54234,
        "name": "NOAA-21",
        "alt_name": "JPSS-2",
        "launch_year": 2022,
        "color": "#ff6b6b",  # Coral red
        "swath_km": 3060
    },
    "noaa20": {
        "norad_id": 43013,
        "name": "NOAA-20",
        "alt_name": "JPSS-1",
        "launch_year": 2017,
        "color": "#4ecdc4",  # Teal
        "swath_km": 3060
    },
    "suominpp": {
        "norad_id": 37849,
        "name": "Suomi NPP",
        "alt_name": "NPP",
        "launch_year": 2011,
        "color": "#ffe66d",  # Yellow
        "swath_km": 3060
    }
}

# Default satellite
DEFAULT_SATELLITE = "noaa21"
NOAA21_NORAD_ID = 54234

# Fallback TLEs if network unavailable
FALLBACK_TLES = {
    54234: {
        "name": "NOAA 21",
        "line1": "1 54234U 22150A   25024.50000000  .00000200  00000-0  11573-3 0  9990",
        "line2": "2 54234  98.7406 249.5105 0002692  99.1419 261.0062 14.19509228155270"
    },
    43013: {
        "name": "NOAA 20",
        "line1": "1 43013U 17073A   25024.50000000  .00000150  00000-0  95000-4 0  9990",
        "line2": "2 43013  98.7420 249.5000 0001500  90.0000 270.0000 14.19550000100000"
    },
    37849: {
        "name": "SUOMI NPP",
        "line1": "1 37849U 11061A   25024.50000000  .00000100  00000-0  80000-4 0  9990",
        "line2": "2 37849  98.7300 249.4000 0001200  85.0000 275.0000 14.19600000200000"
    }
}

# Keep original for backwards compatibility
FALLBACK_TLE = FALLBACK_TLES[54234]


def fetch_tle(norad_id: int = NOAA21_NORAD_ID) -> dict:
    """
    Fetch current TLE from CelesTrak for given NORAD ID.

    Returns dict with:
        - name: Satellite name
        - line1: TLE line 1
        - line2: TLE line 2
        - epoch: Datetime of TLE epoch
        - age_hours: Hours since TLE epoch
        - source: Data source
    """
    try:
        # CelesTrak API endpoint
        url = f"{CELESTRAK_BASE}?CATNR={norad_id}&FORMAT=TLE"
        response = requests.get(url, timeout=10)
        response.raise_for_status()

        lines = response.text.strip().split('\n')
        if len(lines) < 3:
            raise ValueError(f"Invalid TLE response: {response.text}")

        name = lines[0].strip()
        line1 = lines[1].strip()
        line2 = lines[2].strip()

        # Parse epoch from TLE line 1
        epoch = parse_tle_epoch(line1)
        age_hours = (datetime.now(timezone.utc) - epoch).total_seconds() / 3600

        return {
            "name": name,
            "line1": line1,
            "line2": line2,
            "epoch": epoch.isoformat(),
            "age_hours": round(age_hours, 2),
            "source": "celestrak"
        }

    except Exception as e:
        print(f"Failed to fetch TLE: {e}. Using fallback.")
        epoch = parse_tle_epoch(FALLBACK_TLE["line1"])
        age_hours = (datetime.now(timezone.utc) - epoch).total_seconds() / 3600

        return {
            **FALLBACK_TLE,
            "epoch": epoch.isoformat(),
            "age_hours": round(age_hours, 2),
            "source": "fallback"
        }


def parse_tle_epoch(line1: str) -> datetime:
    """
    Parse epoch datetime from TLE line 1.

    Format: positions 18-32 contain YYDDD.DDDDDDDD
    YY = 2-digit year (00-56 = 2000s, 57-99 = 1900s)
    DDD.DDDDDDDD = fractional day of year
    """
    epoch_str = line1[18:32].strip()

    year_2digit = int(epoch_str[:2])
    day_fraction = float(epoch_str[2:])

    # Y2K handling (per NORAD convention)
    if year_2digit < 57:
        year = 2000 + year_2digit
    else:
        year = 1900 + year_2digit

    # Convert fractional day to datetime
    # Day 1 = Jan 1, so subtract 1 for timedelta
    day_of_year = int(day_fraction)
    fraction = day_fraction - day_of_year

    # Start of year + days + fractional day
    epoch = datetime(year, 1, 1, tzinfo=timezone.utc)
    from datetime import timedelta
    epoch += timedelta(days=day_of_year - 1)  # -1 because Jan 1 is day 1
    epoch += timedelta(days=fraction)

    return epoch


def get_orbital_params(line2: str) -> dict:
    """
    Extract orbital parameters from TLE line 2.

    Returns dict with:
        - inclination_deg: Orbital inclination
        - raan_deg: Right Ascension of Ascending Node
        - eccentricity: Orbital eccentricity (dimensionless)
        - arg_perigee_deg: Argument of perigee
        - mean_anomaly_deg: Mean anomaly
        - mean_motion: Revolutions per day
        - orbit_number: Revolution count since launch
    """
    return {
        "inclination_deg": float(line2[8:16]),
        "raan_deg": float(line2[17:25]),
        "eccentricity": float("0." + line2[26:33]),
        "arg_perigee_deg": float(line2[34:42]),
        "mean_anomaly_deg": float(line2[43:51]),
        "mean_motion": float(line2[52:63]),
        "orbit_number": int(line2[63:68])
    }


def calculate_orbital_period(mean_motion: float) -> float:
    """Calculate orbital period in minutes from mean motion (rev/day)."""
    return 1440.0 / mean_motion


def calculate_altitude(mean_motion: float) -> float:
    """
    Calculate approximate altitude from mean motion using Kepler's 3rd law.

    a = (GM / (2*pi*n)^2)^(1/3)
    altitude = a - Earth_radius

    GM = 398600.4418 km^3/s^2 (Earth gravitational parameter)
    """
    import math

    GM = 398600.4418  # km^3/s^2
    n = mean_motion * 2 * math.pi / 86400  # Convert to rad/s

    # Semi-major axis
    a = (GM / (n ** 2)) ** (1/3)

    # Altitude above Earth surface
    earth_radius = 6378.137  # km (WGS84 equatorial)
    altitude = a - earth_radius

    return round(altitude, 2)


def get_satellite_info(sat_key: str) -> dict:
    """Get satellite metadata from catalog."""
    if sat_key not in SATELLITE_CATALOG:
        return None
    return SATELLITE_CATALOG[sat_key].copy()


def fetch_all_satellites() -> dict:
    """
    Fetch TLE data for all satellites in the constellation.

    Returns dict keyed by satellite key with TLE and metadata.
    """
    results = {}

    for sat_key, sat_info in SATELLITE_CATALOG.items():
        tle = fetch_tle(sat_info["norad_id"])
        results[sat_key] = {
            **sat_info,
            "tle": tle
        }

    return results


def get_constellation_info() -> list:
    """Return list of available satellites with basic info."""
    return [
        {
            "key": key,
            "name": info["name"],
            "norad_id": info["norad_id"],
            "color": info["color"],
            "launch_year": info["launch_year"]
        }
        for key, info in SATELLITE_CATALOG.items()
    ]


if __name__ == "__main__":
    # Test the fetcher
    tle = fetch_tle()
    print(f"Satellite: {tle['name']}")
    print(f"TLE Line 1: {tle['line1']}")
    print(f"TLE Line 2: {tle['line2']}")
    print(f"Epoch: {tle['epoch']}")
    print(f"Age: {tle['age_hours']} hours")
    print(f"Source: {tle['source']}")

    params = get_orbital_params(tle['line2'])
    print(f"\nOrbital Parameters:")
    print(f"  Inclination: {params['inclination_deg']}°")
    print(f"  Mean Motion: {params['mean_motion']} rev/day")
    print(f"  Period: {calculate_orbital_period(params['mean_motion']):.2f} minutes")
    print(f"  Altitude: {calculate_altitude(params['mean_motion'])} km")
