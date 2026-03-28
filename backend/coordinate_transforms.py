"""
Coordinate Transforms - TEME to ECEF to Geodetic

Pipeline: TLE → SGP4 → TEME (ECI) → ECEF → Geodetic (lat/lon/alt)

Reference frames:
- TEME: True Equator Mean Equinox (SGP4 output frame)
- ECEF: Earth-Centered Earth-Fixed (rotates with Earth)
- Geodetic: latitude, longitude, altitude on WGS84 ellipsoid
"""

import math
from datetime import datetime, timezone

# WGS84 ellipsoid parameters
WGS84_A = 6378.137  # Semi-major axis (equatorial radius) in km
WGS84_B = 6356.752314245  # Semi-minor axis (polar radius) in km
WGS84_F = 1 / 298.257223563  # Flattening
WGS84_E2 = 0.00669437999014  # Eccentricity squared


def julian_date(dt: datetime) -> tuple:
    """
    Convert datetime to Julian Date (JD, fraction).

    Returns tuple (jd, fr) where jd is integer day and fr is fractional day.
    This format is required by sgp4.
    """
    year = dt.year
    month = dt.month
    day = dt.day
    hour = dt.hour
    minute = dt.minute
    second = dt.second + dt.microsecond / 1e6

    # Julian date calculation
    jd = (367.0 * year -
          math.floor(7.0 * (year + math.floor((month + 9.0) / 12.0)) / 4.0) +
          math.floor(275.0 * month / 9.0) +
          day + 1721013.5)

    fr = (hour + minute / 60.0 + second / 3600.0) / 24.0

    return jd, fr


def gmst_from_jd(jd: float, fr: float = 0.0) -> float:
    """
    Calculate Greenwich Mean Sidereal Time from Julian Date.

    Returns GMST in radians.

    Based on: IAU 1982 expression
    """
    # Julian centuries from J2000.0
    T = ((jd - 2451545.0) + fr) / 36525.0

    # GMST in seconds
    gmst_sec = (67310.54841 +
                (876600.0 * 3600 + 8640184.812866) * T +
                0.093104 * T**2 -
                6.2e-6 * T**3)

    # Convert to radians (86400 seconds = 2*pi radians)
    gmst_rad = (gmst_sec % 86400) / 86400.0 * 2.0 * math.pi

    # Ensure positive
    if gmst_rad < 0:
        gmst_rad += 2 * math.pi

    return gmst_rad


def teme_to_ecef(r_teme: list, v_teme: list, jd: float, fr: float = 0.0) -> tuple:
    """
    Transform position and velocity from TEME to ECEF frame.

    Args:
        r_teme: Position vector [x, y, z] in km (TEME frame)
        v_teme: Velocity vector [vx, vy, vz] in km/s (TEME frame)
        jd: Julian date (integer part)
        fr: Julian date (fractional part)

    Returns:
        (r_ecef, v_ecef): Position and velocity in ECEF frame
    """
    gmst = gmst_from_jd(jd, fr)

    cos_g = math.cos(gmst)
    sin_g = math.sin(gmst)

    # Rotation matrix for position (TEME -> ECEF)
    # R = Rz(GMST) - rotation about z-axis
    x_ecef = cos_g * r_teme[0] + sin_g * r_teme[1]
    y_ecef = -sin_g * r_teme[0] + cos_g * r_teme[1]
    z_ecef = r_teme[2]

    r_ecef = [x_ecef, y_ecef, z_ecef]

    # Earth rotation rate (rad/s)
    omega_earth = 7.292115e-5

    # Velocity transformation includes cross product with Earth rotation
    # v_ecef = R * v_teme - omega x r_ecef
    vx_rot = cos_g * v_teme[0] + sin_g * v_teme[1]
    vy_rot = -sin_g * v_teme[0] + cos_g * v_teme[1]
    vz_rot = v_teme[2]

    # Subtract Earth rotation effect
    vx_ecef = vx_rot + omega_earth * y_ecef
    vy_ecef = vy_rot - omega_earth * x_ecef
    vz_ecef = vz_rot

    v_ecef = [vx_ecef, vy_ecef, vz_ecef]

    return r_ecef, v_ecef


def ecef_to_geodetic(r_ecef: list) -> tuple:
    """
    Convert ECEF position to geodetic coordinates (lat, lon, alt).

    Uses iterative method for latitude calculation on WGS84 ellipsoid.

    Args:
        r_ecef: Position vector [x, y, z] in km

    Returns:
        (latitude, longitude, altitude): lat/lon in degrees, alt in km
    """
    x, y, z = r_ecef

    # Longitude is straightforward
    lon_rad = math.atan2(y, x)

    # Distance from z-axis
    p = math.sqrt(x**2 + y**2)

    # Iterative latitude calculation (Bowring's method)
    lat_rad = math.atan2(z, p * (1 - WGS84_E2))  # Initial guess

    for _ in range(10):  # Usually converges in 2-3 iterations
        sin_lat = math.sin(lat_rad)
        N = WGS84_A / math.sqrt(1 - WGS84_E2 * sin_lat**2)
        lat_rad = math.atan2(z + WGS84_E2 * N * sin_lat, p)

    # Altitude
    sin_lat = math.sin(lat_rad)
    cos_lat = math.cos(lat_rad)
    N = WGS84_A / math.sqrt(1 - WGS84_E2 * sin_lat**2)

    if abs(cos_lat) > 1e-10:
        alt = p / cos_lat - N
    else:
        # Near poles, use z component
        alt = abs(z) / abs(sin_lat) - N * (1 - WGS84_E2)

    # Convert to degrees
    lat_deg = math.degrees(lat_rad)
    lon_deg = math.degrees(lon_rad)

    return lat_deg, lon_deg, alt


def teme_to_geodetic(r_teme: list, v_teme: list, dt: datetime) -> dict:
    """
    Full transform: TEME position/velocity to geodetic coordinates.

    Args:
        r_teme: Position vector [x, y, z] in km (TEME frame)
        v_teme: Velocity vector [vx, vy, vz] in km/s (TEME frame)
        dt: Datetime (UTC)

    Returns:
        dict with latitude, longitude, altitude, velocity magnitude
    """
    jd, fr = julian_date(dt)
    r_ecef, v_ecef = teme_to_ecef(r_teme, v_teme, jd, fr)
    lat, lon, alt = ecef_to_geodetic(r_ecef)

    # Velocity magnitude
    v_mag = math.sqrt(sum(v**2 for v in v_ecef))

    return {
        "latitude": round(lat, 6),
        "longitude": round(lon, 6),
        "altitude_km": round(alt, 3),
        "velocity_km_s": round(v_mag, 4)
    }


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate great-circle distance between two points.

    Args:
        lat1, lon1, lat2, lon2: Coordinates in degrees

    Returns:
        Distance in km
    """
    R = 6371.0  # Earth mean radius in km

    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)

    a = (math.sin(dlat / 2)**2 +
         math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon / 2)**2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return R * c


if __name__ == "__main__":
    # Test with known values
    from datetime import datetime, timezone

    # Test Julian Date conversion
    dt = datetime(2000, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    jd, fr = julian_date(dt)
    print(f"J2000.0 epoch JD: {jd + fr} (should be ~2451545.0)")

    # Test GMST
    gmst = gmst_from_jd(jd, fr)
    print(f"GMST at J2000.0: {math.degrees(gmst):.2f}° (should be ~280.46°)")

    # Test with a sample position (ISS-like orbit)
    r_teme = [6778.0, 0.0, 0.0]  # On x-axis, equatorial
    v_teme = [0.0, 7.7, 0.0]     # Moving in y direction

    result = teme_to_geodetic(r_teme, v_teme, datetime.now(timezone.utc))
    print(f"\nSample position: {result}")
