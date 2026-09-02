"""
Orbit Propagator - SGP4-based satellite position prediction

Uses the official SGP4 library (Vallado's implementation) to propagate
satellite orbits from TLE data.
"""

from datetime import datetime, timezone, timedelta
from typing import List, Dict, Optional
import math

from sgp4.api import Satrec, jday
from coordinate_transforms import teme_to_geodetic, julian_date


class OrbitPropagator:
    """
    Propagate satellite orbit using SGP4 algorithm.

    Attributes:
        satellite: sgp4 Satrec object
        tle_epoch: TLE epoch datetime
    """

    def __init__(self, tle_line1: str, tle_line2: str):
        """
        Initialize propagator from TLE.

        Args:
            tle_line1: First line of TLE
            tle_line2: Second line of TLE
        """
        self.tle_line1 = tle_line1
        self.tle_line2 = tle_line2
        self.satellite = Satrec.twoline2rv(tle_line1, tle_line2)

        # Extract epoch from TLE
        self.tle_epoch = self._parse_epoch()

        # Orbital parameters
        self.mean_motion = self.satellite.no_kozai * 1440.0 / (2 * math.pi)  # rev/day
        self.period_minutes = 1440.0 / self.mean_motion
        self.inclination = math.degrees(self.satellite.inclo)
        self.eccentricity = self.satellite.ecco

    def _parse_epoch(self) -> datetime:
        """Parse TLE epoch into datetime."""
        epoch_str = self.tle_line1[18:32].strip()
        year_2digit = int(epoch_str[:2])
        day_fraction = float(epoch_str[2:])

        year = 2000 + year_2digit if year_2digit < 57 else 1900 + year_2digit

        day_of_year = int(day_fraction)
        fraction = day_fraction - day_of_year

        epoch = datetime(year, 1, 1, tzinfo=timezone.utc)
        epoch += timedelta(days=day_of_year - 1 + fraction)

        return epoch

    def propagate(self, dt: datetime) -> Optional[Dict]:
        """
        Propagate satellite to given datetime.

        Args:
            dt: Target datetime (UTC)

        Returns:
            Dict with position data or None if propagation failed
        """
        # Convert to Julian Date
        jd, fr = jday(dt.year, dt.month, dt.day,
                      dt.hour, dt.minute, dt.second + dt.microsecond/1e6)

        # SGP4 propagation
        error, r_teme, v_teme = self.satellite.sgp4(jd, fr)

        if error != 0:
            return None

        # Transform to geodetic
        result = teme_to_geodetic(list(r_teme), list(v_teme), dt)
        result["timestamp"] = dt.isoformat()
        result["error"] = error

        return result

    def get_current_position(self) -> Dict:
        """Get current satellite position."""
        return self.propagate(datetime.now(timezone.utc))

    def generate_track(self, start: datetime, end: datetime,
                       step_seconds: int = 60) -> List[Dict]:
        """
        Generate ground track positions over time range.

        Args:
            start: Start datetime (UTC)
            end: End datetime (UTC)
            step_seconds: Time step between positions

        Returns:
            List of position dicts
        """
        positions = []
        current = start

        while current <= end:
            pos = self.propagate(current)
            if pos:
                positions.append(pos)
            current += timedelta(seconds=step_seconds)

        return positions

    def generate_track_minutes(self, duration_minutes: int = 90,
                                step_seconds: int = 60) -> List[Dict]:
        """
        Generate ground track from now for specified duration.

        Args:
            duration_minutes: How far ahead to propagate
            step_seconds: Time step between positions

        Returns:
            List of position dicts
        """
        now = datetime.now(timezone.utc)
        end = now + timedelta(minutes=duration_minutes)
        return self.generate_track(now, end, step_seconds)

    def get_orbit_info(self) -> Dict:
        """Get orbital parameters and metadata."""
        now = datetime.now(timezone.utc)
        age_hours = (now - self.tle_epoch).total_seconds() / 3600

        # Calculate approximate altitude
        GM = 398600.4418  # km^3/s^2
        n = self.satellite.no_kozai  # rad/min
        n_rad_s = n / 60.0  # rad/s
        a = (GM / (n_rad_s ** 2)) ** (1/3)  # Semi-major axis
        altitude = a - 6378.137  # Above equatorial radius

        # Current orbit number (approximate)
        elapsed_orbits = (now - self.tle_epoch).total_seconds() / (self.period_minutes * 60)

        # Get orbit number from TLE line 2
        base_orbit = int(self.tle_line2[63:68])
        current_orbit = base_orbit + int(elapsed_orbits)

        return {
            "inclination_deg": round(self.inclination, 4),
            "eccentricity": round(self.eccentricity, 7),
            "mean_motion_rev_day": round(self.mean_motion, 8),
            "period_minutes": round(self.period_minutes, 2),
            "altitude_km": round(altitude, 1),
            "tle_epoch": self.tle_epoch.isoformat(),
            "tle_age_hours": round(age_hours, 2),
            "current_orbit_number": current_orbit
        }

    def find_equator_crossings(self, duration_hours: int = 24) -> Dict:
        """
        Find ascending/descending *node* crossings (equator crossings).

        - Ascending node: south → north (lat crosses 0° northbound)
        - Descending node: north → south (lat crosses 0° southbound)

        Note: Historically exposed as ``find_polar_crossings`` / ``/api/polar-crossings``,
        but the implementation has always been equator-node detection, not polar
        passage. Prefer this name; ``find_polar_crossings`` remains as an alias.
        """
        now = datetime.now(timezone.utc)
        positions = self.generate_track(
            now,
            now + timedelta(hours=duration_hours),
            step_seconds=30
        )

        ascending = []
        descending = []

        for i in range(1, len(positions)):
            prev_lat = positions[i - 1]["latitude"]
            curr_lat = positions[i]["latitude"]
            prev_lon = positions[i - 1]["longitude"]
            curr_lon = positions[i]["longitude"]

            # Linear interpolate crossing time/lon within the 30 s step
            if prev_lat < 0 <= curr_lat or prev_lat > 0 >= curr_lat:
                denom = curr_lat - prev_lat
                if abs(denom) < 1e-12:
                    continue
                frac = (0.0 - prev_lat) / denom
                # Handle antimeridian for longitude interpolation
                dlon = curr_lon - prev_lon
                if dlon > 180:
                    dlon -= 360
                elif dlon < -180:
                    dlon += 360
                cross_lon = prev_lon + frac * dlon
                if cross_lon > 180:
                    cross_lon -= 360
                elif cross_lon < -180:
                    cross_lon += 360

                t0 = datetime.fromisoformat(positions[i - 1]["timestamp"])
                t1 = datetime.fromisoformat(positions[i]["timestamp"])
                cross_t = t0 + (t1 - t0) * frac
                entry = {
                    "time": cross_t.isoformat(),
                    "longitude": round(cross_lon, 4),
                }
                if prev_lat < 0 <= curr_lat:
                    ascending.append(entry)
                else:
                    descending.append(entry)

        return {
            "ascending_nodes": ascending[:10],
            "descending_nodes": descending[:10],
            "note": "Equator (node) crossings, not polar passages",
        }

    def find_polar_crossings(self, duration_hours: int = 24) -> Dict:
        """Deprecated alias for :meth:`find_equator_crossings` (kept for API compat)."""
        return self.find_equator_crossings(duration_hours)


def generate_swath_polygon(center_lat: float, center_lon: float,
                           radius_km: float = 1530) -> List[List[float]]:
    """
    Generate a geodesic *circle* centered on the sub-satellite point.

    **Science note:** This is a nadir-centered footprint disk of radius
    ``radius_km``, *not* the true VIIRS scan-line swath. Real VIIRS imaging
    is a cross-track strip (~3060 km wide) along the ground track; the orbit
    frontend ``drawSwathStrip`` implements that geometry. Use this circle only
    for a rough "current coverage disk" visualization.

    Args:
        center_lat: Center latitude in degrees
        center_lon: Center longitude in degrees
        radius_km: Disk radius in km (default 1530 ≈ VIIRS half-swath width)

    Returns:
        List of [lon, lat] coordinate pairs forming the circle
    """
    earth_radius = 6371.0  # km mean radius (consistent with haversine / strip)

    points = []
    for i in range(37):  # 36 segments + closing point
        bearing = math.radians(i * 10)  # Every 10 degrees

        lat1 = math.radians(center_lat)
        lon1 = math.radians(center_lon)
        d = radius_km / earth_radius

        lat2 = math.asin(
            math.sin(lat1) * math.cos(d) +
            math.cos(lat1) * math.sin(d) * math.cos(bearing)
        )

        lon2 = lon1 + math.atan2(
            math.sin(bearing) * math.sin(d) * math.cos(lat1),
            math.cos(d) - math.sin(lat1) * math.sin(lat2)
        )

        points.append([math.degrees(lon2), math.degrees(lat2)])

    return points


if __name__ == "__main__":
    from tle_fetcher import fetch_tle

    # Get TLE and create propagator
    tle = fetch_tle()
    prop = OrbitPropagator(tle["line1"], tle["line2"])

    # Current position
    print("Current Position:")
    pos = prop.get_current_position()
    print(f"  Lat: {pos['latitude']}°")
    print(f"  Lon: {pos['longitude']}°")
    print(f"  Alt: {pos['altitude_km']} km")
    print(f"  Vel: {pos['velocity_km_s']} km/s")

    # Orbital info
    print("\nOrbital Parameters:")
    info = prop.get_orbit_info()
    for key, value in info.items():
        print(f"  {key}: {value}")

    # Generate short track
    print("\nGround Track (next 10 minutes):")
    track = prop.generate_track_minutes(duration_minutes=10, step_seconds=60)
    for p in track:
        print(f"  {p['timestamp']}: ({p['latitude']:.2f}, {p['longitude']:.2f})")
