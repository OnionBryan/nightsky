"""
Geometric sunlit/eclipse and ground day/night helpers.

Pure math — no network. Used by pass prediction and unit tests.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Optional, Tuple

# WGS84-ish mean radius for shadow cylinder (km)
_R_EARTH_KM = 6371.0
# Mean AU (km)
_AU_KM = 149597870.7


def solar_declination_rad(dt: datetime) -> float:
    """Approximate solar declination (radians) for UTC datetime."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    # Days since J2000.0
    jd = (
        367 * dt.year
        - (7 * (dt.year + (dt.month + 9) // 12)) // 4
        + (275 * dt.month) // 9
        + dt.day
        + 1721013.5
        + (dt.hour + dt.minute / 60.0 + dt.second / 3600.0) / 24.0
    )
    n = jd - 2451545.0
    g = math.radians((357.528 + 0.9856003 * n) % 360.0)
    lam = math.radians(
        (280.460 + 0.9856474 * n) % 360.0
        + 1.915 * math.sin(g)
        + 0.020 * math.sin(2 * g)
    )
    eps = math.radians(23.439 - 0.0000004 * n)
    return math.asin(math.sin(eps) * math.sin(lam))


def solar_longitude_deg(dt: datetime) -> float:
    """Approximate subsolar longitude (degrees, -180..180) at UTC datetime."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    jd = (
        367 * dt.year
        - (7 * (dt.year + (dt.month + 9) // 12)) // 4
        + (275 * dt.month) // 9
        + dt.day
        + 1721013.5
        + (dt.hour + dt.minute / 60.0 + dt.second / 3600.0) / 24.0
    )
    n = jd - 2451545.0
    g = math.radians((357.528 + 0.9856003 * n) % 360.0)
    L = (280.460 + 0.9856474 * n) % 360.0
    lam = math.radians(L + 1.915 * math.sin(g) + 0.020 * math.sin(2 * g))
    eps = math.radians(23.439 - 0.0000004 * n)
    ra = math.atan2(math.cos(eps) * math.sin(lam), math.cos(lam))
    ra_hours = ((math.degrees(ra) / 15.0) + 24.0) % 24.0
    gmst_hours = (18.697374558 + 24.06570982441908 * n) % 24.0
    lon = (ra_hours - gmst_hours) * 15.0
    return ((lon + 180.0) % 360.0) - 180.0


def solar_elevation_deg(lat: float, lon: float, dt: datetime) -> float:
    """Geometric solar elevation (degrees) at site; no refraction."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dec = solar_declination_rad(dt)
    # Hour angle from subsolar longitude
    sub_lon = solar_longitude_deg(dt)
    ha = math.radians(lon - sub_lon)
    lat_r = math.radians(lat)
    sin_el = math.sin(lat_r) * math.sin(dec) + math.cos(lat_r) * math.cos(dec) * math.cos(
        ha
    )
    sin_el = max(-1.0, min(1.0, sin_el))
    return math.degrees(math.asin(sin_el))


def site_is_daylight(lat: float, lon: float, dt: datetime, horizon_deg: float = 0.0) -> bool:
    """True if Sun is above horizon_deg at the site (geometric)."""
    return solar_elevation_deg(lat, lon, dt) > horizon_deg


def sun_unit_vector_teme_approx(dt: datetime) -> Tuple[float, float, float]:
    """
    Approximate unit vector toward the Sun in an Earth-centered frame.

    Uses ecliptic longitude of the Sun projected with mean obliquity into
    equatorial coordinates (TEME-like for shadow tests).
    """
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    jd = (
        367 * dt.year
        - (7 * (dt.year + (dt.month + 9) // 12)) // 4
        + (275 * dt.month) // 9
        + dt.day
        + 1721013.5
        + (dt.hour + dt.minute / 60.0 + dt.second / 3600.0) / 24.0
    )
    n = jd - 2451545.0
    g = math.radians((357.528 + 0.9856003 * n) % 360.0)
    L = (280.460 + 0.9856474 * n) % 360.0
    lam = math.radians(L + 1.915 * math.sin(g) + 0.020 * math.sin(2 * g))
    eps = math.radians(23.439 - 0.0000004 * n)
    # Equatorial unit vector
    x = math.cos(lam)
    y = math.cos(eps) * math.sin(lam)
    z = math.sin(eps) * math.sin(lam)
    norm = math.sqrt(x * x + y * y + z * z) or 1.0
    return x / norm, y / norm, z / norm


def satellite_in_eclipse(
    r_ecef_or_eci_km: list,
    dt: datetime,
    earth_radius_km: float = _R_EARTH_KM,
) -> bool:
    """
    Cylindrical Earth-shadow eclipse test.

    Satellite is in eclipse if it is on the night side of Earth (dot with
    sun direction < 0) and its perpendicular distance from the anti-sun axis
    is less than Earth radius.
    """
    sx, sy, sz = sun_unit_vector_teme_approx(dt)
    rx, ry, rz = float(r_ecef_or_eci_km[0]), float(r_ecef_or_eci_km[1]), float(
        r_ecef_or_eci_km[2]
    )
    # Projection along sun direction (positive = sunward)
    along = rx * sx + ry * sy + rz * sz
    if along >= 0:
        return False  # sunlit half-space
    # Perpendicular component
    px = rx - along * sx
    py = ry - along * sy
    pz = rz - along * sz
    r_perp = math.sqrt(px * px + py * py + pz * pz)
    return r_perp < earth_radius_km


def satellite_is_sunlit(r_km: list, dt: datetime) -> bool:
    return not satellite_in_eclipse(r_km, dt)
