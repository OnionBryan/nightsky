"""Pass prediction pure logic — drives shipped pass_prediction module."""

from __future__ import annotations

import math
import sys
import unittest
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "backend"))

from backend.orbit_science.pass_prediction import (  # noqa: E402
    elevation_azimuth,
    predict_passes_from_track,
    predict_passes_for_propagator,
)
from orbit_propagator import OrbitPropagator  # noqa: E402


class TestElevation(unittest.TestCase):
    def test_overhead_high_elevation(self):
        # Satellite nearly above site
        top = elevation_azimuth(40.0, -75.0, 0.0, 40.0, -75.0, 800.0)
        self.assertGreater(top["elevation"], 80.0)

    def test_far_away_negative(self):
        top = elevation_azimuth(0.0, 0.0, 0.0, 0.0, 90.0, 800.0)
        self.assertLess(top["elevation"], 0.0)


class TestPassFromSyntheticTrack(unittest.TestCase):
    def test_single_pass_aos_los_duration(self):
        # Build a track that rises then sets for site at (0,0)
        site_lat, site_lon = 0.0, 0.0
        t0 = datetime(2025, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        track = []
        # Move sat latitude from -40 to +40 along lon=0 so elev goes up then we
        # use altitude high enough and longitudes near site.
        # Better: fix lat=site, vary lon from far to overhead to far
        for i, lon in enumerate(range(-60, 61, 5)):
            track.append(
                {
                    "latitude": site_lat,
                    "longitude": float(lon),
                    "altitude_km": 800.0,
                    "timestamp": (t0 + timedelta(seconds=i * 30)).isoformat(),
                }
            )
        passes = predict_passes_from_track(
            track, site_lat, site_lon, min_elevation_deg=10.0
        )
        self.assertGreaterEqual(len(passes), 1)
        p = passes[0]
        aos = datetime.fromisoformat(p["aos"])
        los = datetime.fromisoformat(p["los"])
        self.assertLess(aos, los)
        self.assertGreater(p["max_elevation"], 0.0)
        self.assertLessEqual(p["max_elevation"], 90.0)
        self.assertGreater(p["duration_seconds"], 0)
        self.assertIn("site_daylight_at_max", p)
        self.assertIn("sat_sunlit_at_max", p)

    def test_window_starts_mid_pass_still_emits(self):
        """If first sample is already above horizon, do not drop the pass."""
        site_lat, site_lon = 0.0, 0.0
        t0 = datetime(2025, 6, 1, 0, 0, 0, tzinfo=timezone.utc)
        # Overhead then setting westward — no rising cross in the window
        track = []
        for i, lon in enumerate([0, 5, 15, 25, 40, 55, 70]):
            track.append(
                {
                    "latitude": site_lat,
                    "longitude": float(lon),
                    "altitude_km": 800.0,
                    "timestamp": (t0 + timedelta(seconds=i * 60)).isoformat(),
                }
            )
        # Confirm first sample is high elev
        first = elevation_azimuth(site_lat, site_lon, 0.0, 0.0, 0.0, 800.0)
        self.assertGreater(first["elevation"], 10.0)

        passes = predict_passes_from_track(
            track, site_lat, site_lon, min_elevation_deg=10.0
        )
        self.assertEqual(len(passes), 1, f"expected mid-pass seed, got {passes}")
        p = passes[0]
        aos = datetime.fromisoformat(p["aos"])
        los = datetime.fromisoformat(p["los"])
        self.assertEqual(aos, t0)  # window start = first sample
        self.assertGreater(los, aos)
        self.assertGreater(p["duration_seconds"], 0)
        self.assertGreater(p["max_elevation"], 10.0)
        self.assertLessEqual(p["max_elevation"], 90.0)


class TestPassWithRealTLE(unittest.TestCase):
    def test_noaa21_like_has_passes(self):
        # Fallback-style TLE from catalog (reproducible)
        line1 = "1 54234U 22150A   25024.50000000  .00000200  00000-0  11573-3 0  9990"
        line2 = "2 54234  98.7406 249.5105 0002692  99.1419 261.0062 14.19509228155270"
        prop = OrbitPropagator(line1, line2)
        # Use TLE epoch as start so TLE is fresh
        start = prop.tle_epoch
        # Mid-latitude site
        passes = predict_passes_for_propagator(
            prop,
            40.0,
            -75.0,
            start=start,
            hours=12.0,
            step_seconds=60,
            min_elevation_deg=5.0,
        )
        self.assertIsInstance(passes, list)
        # SSO should produce at least one pass in 12h for mid-lat
        self.assertGreaterEqual(len(passes), 1)
        p = passes[0]
        self.assertLess(
            datetime.fromisoformat(p["aos"]), datetime.fromisoformat(p["los"])
        )
        self.assertGreater(p["max_elevation"], 0.0)
        self.assertLessEqual(p["max_elevation"], 90.0)
        self.assertGreater(p["duration_seconds"], 0)
        self.assertIsInstance(p["visual_pass_candidate"], bool)


if __name__ == "__main__":
    unittest.main()
