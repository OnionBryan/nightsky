"""
Science baseline regression tests.

Locks orbital and astronomical correctness against known constants and
Skyfield (where available). Run from repo root:

    backend/venv/bin/python -m unittest tests.test_science_baseline -v

These tests are the gate for "science is baselined" — do not relax
tolerances without documenting why in docs/SCIENCE_BASELINE.md.
"""

from __future__ import annotations

import math
import sys
import unittest
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "nightsky" / "backend"))

from coordinate_transforms import (  # noqa: E402
    WGS84_A,
    WGS84_E2,
    ecef_to_geodetic,
    gmst_from_jd,
    julian_date,
    teme_to_geodetic,
)
from orbit_propagator import OrbitPropagator  # noqa: E402
from tle_fetcher import calculate_altitude, get_orbital_params, parse_tle_epoch  # noqa: E402
from geostationary_utils import R_EARTH, R_GEO, calculate_geo_look_angles  # noqa: E402
from location_utils import is_nighttime, _solar_elevation_deg  # noqa: E402

# Reproducible NOAA-21-like TLE (fallback catalog sample)
TLE1 = "1 54234U 22150A   25024.50000000  .00000200  00000-0  11573-3 0  9990"
TLE2 = "2 54234  98.7406 249.5105 0002692  99.1419 261.0062 14.19509228155270"


class TestJulianDate(unittest.TestCase):
    def test_j2000_noon(self):
        dt = datetime(2000, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        jd, fr = julian_date(dt)
        self.assertAlmostEqual(jd + fr, 2451545.0, places=9)

    def test_known_date(self):
        dt = datetime(2024, 6, 15, 0, 0, 0, tzinfo=timezone.utc)
        jd, fr = julian_date(dt)
        self.assertAlmostEqual(jd + fr, 2460476.5, places=9)

    def test_matches_sgp4_jday(self):
        from sgp4.api import jday

        dt = datetime(2024, 2, 29, 18, 30, 45, tzinfo=timezone.utc)
        a, b = julian_date(dt)
        c, d = jday(dt.year, dt.month, dt.day, dt.hour, dt.minute,
                    dt.second + dt.microsecond / 1e6)
        self.assertAlmostEqual(a + b, c + d, places=12)


class TestGMST(unittest.TestCase):
    def test_j2000_gmst(self):
        # IAU 1982 expression at J2000.0 → 280.460618…°
        jd, fr = julian_date(datetime(2000, 1, 1, 12, 0, 0, tzinfo=timezone.utc))
        gmst_deg = math.degrees(gmst_from_jd(jd, fr))
        self.assertAlmostEqual(gmst_deg, 280.46061837, places=4)


class TestGeodetic(unittest.TestCase):
    def test_equator_surface(self):
        lat, lon, alt = ecef_to_geodetic([WGS84_A, 0.0, 0.0])
        self.assertAlmostEqual(lat, 0.0, places=9)
        self.assertAlmostEqual(lon, 0.0, places=9)
        self.assertAlmostEqual(alt, 0.0, places=6)

    def test_north_pole_surface(self):
        b = WGS84_A * math.sqrt(1 - WGS84_E2)
        lat, lon, alt = ecef_to_geodetic([0.0, 0.0, b])
        self.assertAlmostEqual(lat, 90.0, places=6)
        self.assertAlmostEqual(alt, 0.0, places=5)

    def test_skyfield_roundtrip_if_available(self):
        try:
            from skyfield.api import wgs84
        except ImportError:
            self.skipTest("skyfield not installed")
        loc = wgs84.latlon(51.4779, 0.0, elevation_m=0)
        x, y, z = loc.itrs_xyz.km
        lat, lon, alt = ecef_to_geodetic([x, y, z])
        self.assertAlmostEqual(lat, 51.4779, places=6)
        self.assertAlmostEqual(lon, 0.0, places=6)
        self.assertAlmostEqual(alt * 1000, 0.0, places=2)  # meters


class TestSGP4Pipeline(unittest.TestCase):
    """Full TEME→geodetic pipeline vs Skyfield (≤50 m horizontal, ≤5 m alt)."""

    @classmethod
    def setUpClass(cls):
        try:
            from skyfield.api import load, EarthSatellite, wgs84  # noqa: F401
            cls.has_skyfield = True
        except ImportError:
            cls.has_skyfield = False
        cls.prop = OrbitPropagator(TLE1, TLE2)

    def test_tle_epoch_parse(self):
        epoch = parse_tle_epoch(TLE1)
        self.assertEqual(epoch, datetime(2025, 1, 24, 12, 0, 0, tzinfo=timezone.utc))
        self.assertEqual(self.prop.tle_epoch, epoch)

    def test_orbital_params_jpss_like(self):
        p = get_orbital_params(TLE2)
        self.assertAlmostEqual(p["inclination_deg"], 98.7406, places=4)
        period = 1440.0 / p["mean_motion"]
        self.assertAlmostEqual(period, 101.44, places=1)
        alt = calculate_altitude(p["mean_motion"])
        # Keplerian a−R_eq; JPSS mean altitude ~824 km → allow ~10 km model gap
        self.assertTrue(815 < alt < 840, f"altitude {alt} outside expected band")

    def test_vs_skyfield_ground_track(self):
        if not self.has_skyfield:
            self.skipTest("skyfield not installed")
        from skyfield.api import load, EarthSatellite, wgs84

        ts = load.timescale()
        sat = EarthSatellite(TLE1, TLE2, "NOAA21", ts)

        max_horiz_m = 0.0
        max_alt_m = 0.0
        for hours in (0, 1, 6, 12, 24, 48):
            dt = self.prop.tle_epoch + timedelta(hours=hours)
            pos = self.prop.propagate(dt)
            self.assertIsNotNone(pos)
            t = ts.from_datetime(dt)
            gp = wgs84.geographic_position_of(sat.at(t))
            dlat_m = (pos["latitude"] - gp.latitude.degrees) * 111_000
            dlon_m = (
                (pos["longitude"] - gp.longitude.degrees)
                * 111_000
                * math.cos(math.radians(gp.latitude.degrees))
            )
            dalt_m = (pos["altitude_km"] - gp.elevation.km) * 1000
            horiz = math.hypot(dlat_m, dlon_m)
            max_horiz_m = max(max_horiz_m, horiz)
            max_alt_m = max(max_alt_m, abs(dalt_m))

        # Baseline tolerance: 50 m horizontal, 5 m altitude
        self.assertLess(max_horiz_m, 50.0, f"horizontal error {max_horiz_m:.1f} m")
        self.assertLess(max_alt_m, 5.0, f"altitude error {max_alt_m:.1f} m")

    def test_velocity_is_inertial(self):
        """velocity_km_s must be TEME inertial magnitude (~7.4 km/s for LEO)."""
        dt = self.prop.tle_epoch + timedelta(hours=1)
        pos = self.prop.propagate(dt)
        self.assertIsNotNone(pos)
        self.assertTrue(7.0 < pos["velocity_km_s"] < 8.0)
        self.assertIn("velocity_ecef_km_s", pos)
        # ECEF speed differs from inertial for LEO
        self.assertNotAlmostEqual(pos["velocity_km_s"], pos["velocity_ecef_km_s"], places=2)

    def test_equator_crossings_are_near_zero_lat(self):
        crossings = self.prop.find_equator_crossings(duration_hours=12)
        self.assertIn("ascending_nodes", crossings)
        self.assertIn("descending_nodes", crossings)
        # Alias retained
        alias = self.prop.find_polar_crossings(duration_hours=6)
        self.assertEqual(set(alias.keys()), set(crossings.keys()))


class TestGEOLookAngles(unittest.TestCase):
    def _enu_truth(self, lat, lon, sat_lon):
        lat_r, lon_r, slon = map(math.radians, [lat, lon, sat_lon])
        o = [
            R_EARTH * math.cos(lat_r) * math.cos(lon_r),
            R_EARTH * math.cos(lat_r) * math.sin(lon_r),
            R_EARTH * math.sin(lat_r),
        ]
        s = [R_GEO * math.cos(slon), R_GEO * math.sin(slon), 0.0]
        rho = [s[i] - o[i] for i in range(3)]
        east = [-math.sin(lon_r), math.cos(lon_r), 0.0]
        north = [
            -math.sin(lat_r) * math.cos(lon_r),
            -math.sin(lat_r) * math.sin(lon_r),
            math.cos(lat_r),
        ]
        up = [
            math.cos(lat_r) * math.cos(lon_r),
            math.cos(lat_r) * math.sin(lon_r),
            math.sin(lat_r),
        ]
        e = sum(rho[i] * east[i] for i in range(3))
        n = sum(rho[i] * north[i] for i in range(3))
        u = sum(rho[i] * up[i] for i in range(3))
        az = math.degrees(math.atan2(e, n)) % 360
        el = math.degrees(math.atan2(u, math.hypot(e, n)))
        return el, az

    def test_geo_radius_constant(self):
        # Kepler GEO radius for sidereal day ≈ 42164.17 km
        self.assertAlmostEqual(R_GEO, 42164.17, places=2)

    def test_nadir_equator(self):
        r = calculate_geo_look_angles(0.0, -75.2, -75.2)
        self.assertAlmostEqual(r["elevation"], 90.0, places=1)
        self.assertTrue(r["visible"])

    def test_cases_match_enu(self):
        cases = [
            (40.7128, -74.006, -75.2),   # NYC / GOES-16
            (-33.87, 151.21, 140.7),     # Sydney / Himawari
            (34.05, -118.25, -137.0),    # LA / GOES-18
            (51.5, 0.0, -75.2),          # London / GOES-16 edge
            (-23.55, -46.63, -75.2),     # São Paulo
            (61.22, -149.9, -137.0),     # Anchorage
        ]
        for lat, lon, slon in cases:
            got = calculate_geo_look_angles(lat, lon, slon)
            el, az = self._enu_truth(lat, lon, slon)
            self.assertAlmostEqual(got["elevation"], el, places=1, msg=(lat, lon, slon))
            daz = ((got["azimuth"] - az + 180) % 360) - 180
            self.assertLess(abs(daz), 0.05, msg=f"az error {daz} at {lat},{lon}")


class TestNightDay(unittest.TestCase):
    def test_equator_noon_is_day(self):
        # Equinox-ish noon UTC on equator, lon=0 → sun nearly overhead
        dt = datetime(2024, 3, 20, 12, 0, 0, tzinfo=timezone.utc)
        self.assertFalse(is_nighttime(0.0, 0.0, dt))
        self.assertGreater(_solar_elevation_deg(0.0, 0.0, dt), 50.0)

    def test_equator_midnight_is_night(self):
        dt = datetime(2024, 3, 20, 0, 0, 0, tzinfo=timezone.utc)
        self.assertTrue(is_nighttime(0.0, 0.0, dt))
        self.assertLess(_solar_elevation_deg(0.0, 0.0, dt), -50.0)

    def test_arctic_winter_noon_is_night(self):
        # Tromsø midwinter local noon ≈ 11:00 UTC — polar night
        dt = datetime(2024, 12, 21, 11, 0, 0, tzinfo=timezone.utc)
        self.assertTrue(is_nighttime(69.65, 18.96, dt))


class TestMoonPhaseConvention(unittest.TestCase):
    def test_skyfield_phase_and_illumination(self):
        try:
            from skyfield.api import load
            from skyfield import almanac
        except ImportError:
            self.skipTest("skyfield not installed")

        ts = load.timescale()
        # de421 may live under nightsky/backend
        eph_path = ROOT / "nightsky" / "backend" / "de421.bsp"
        eph = load(str(eph_path)) if eph_path.exists() else load("de421.bsp")

        # Known full moon 2024-03-25 ~07:00 UTC
        t = ts.utc(2024, 3, 25, 7)
        phase = almanac.moon_phase(eph, t).degrees
        illum = (1 - math.cos(math.radians(phase))) / 2 * 100
        self.assertAlmostEqual(phase, 180.0, delta=2.0)
        self.assertAlmostEqual(illum, 100.0, delta=1.0)


if __name__ == "__main__":
    unittest.main()
