"""Visibility helpers — site day/night and satellite eclipse."""

from __future__ import annotations

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.orbit_science.visibility import (  # noqa: E402
    satellite_in_eclipse,
    satellite_is_sunlit,
    site_is_daylight,
    solar_elevation_deg,
)


class TestSiteDayNight(unittest.TestCase):
    def test_equator_noon_is_day(self):
        # Local noon near lon=0 at equinox-ish
        dt = datetime(2024, 3, 20, 12, 0, 0, tzinfo=timezone.utc)
        el = solar_elevation_deg(0.0, 0.0, dt)
        self.assertGreater(el, 50.0)
        self.assertTrue(site_is_daylight(0.0, 0.0, dt))

    def test_equator_midnight_is_night(self):
        dt = datetime(2024, 3, 20, 0, 0, 0, tzinfo=timezone.utc)
        el = solar_elevation_deg(0.0, 0.0, dt)
        self.assertLess(el, -50.0)
        self.assertFalse(site_is_daylight(0.0, 0.0, dt))


class TestEclipse(unittest.TestCase):
    def test_sunward_vector_not_eclipse(self):
        dt = datetime(2024, 6, 21, 12, 0, 0, tzinfo=timezone.utc)
        # Position far in +X (sunward approx at this model) — use large sunward
        # component by placing sat "outside" on sun side: positive along sun
        from backend.orbit_science.visibility import sun_unit_vector_teme_approx

        sx, sy, sz = sun_unit_vector_teme_approx(dt)
        r = [sx * 7000.0, sy * 7000.0, sz * 7000.0]
        self.assertFalse(satellite_in_eclipse(r, dt))
        self.assertTrue(satellite_is_sunlit(r, dt))

    def test_anti_sun_in_cylinder_is_eclipse(self):
        dt = datetime(2024, 6, 21, 12, 0, 0, tzinfo=timezone.utc)
        from backend.orbit_science.visibility import sun_unit_vector_teme_approx

        sx, sy, sz = sun_unit_vector_teme_approx(dt)
        # Anti-sun, close to axis, beyond Earth radius
        r = [-sx * 8000.0, -sy * 8000.0, -sz * 8000.0]
        self.assertTrue(satellite_in_eclipse(r, dt))
        self.assertFalse(satellite_is_sunlit(r, dt))


if __name__ == "__main__":
    unittest.main()
