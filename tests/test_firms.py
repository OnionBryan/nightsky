"""
FIRMS CSV parse + confidence filter tests.

Drives the shipped ``backend.orbit_science.firms.parse_firms_csv`` on a
real-shape FIRMS CSV fixture (not a network mock for the parser).
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "backend"))

from backend.orbit_science.firms import (  # noqa: E402
    get_firms_source,
    hours_to_day_range,
    parse_firms_csv,
)

# Minimal FIRMS-shaped CSV (VIIRS NRT area export columns)
FIXTURE_CSV = """latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight
-15.123,25.456,330.5,0.4,0.4,2024-06-01,0312,N,low,2.0NRT,290.1,1.2,N
-14.500,24.100,340.2,0.4,0.4,2024-06-01,0315,N,nominal,2.0NRT,291.0,12.5,N
10.250,-55.750,350.0,0.5,0.5,2024-06-01,1200,N,high,2.0NRT,295.0,45.0,D
bad,row,x,0,0,2024-06-01,0000,N,nominal,2.0NRT,0,0,N
"""


class TestFirmsParse(unittest.TestCase):
    def test_drops_low_confidence(self):
        fires = parse_firms_csv(FIXTURE_CSV)
        confs = {f["confidence"] for f in fires}
        self.assertNotIn("low", confs)
        self.assertEqual(len(fires), 2)

    def test_maps_required_fields(self):
        fires = parse_firms_csv(FIXTURE_CSV)
        high = next(f for f in fires if f["confidence"] == "high")
        self.assertAlmostEqual(high["lat"], 10.250)
        self.assertAlmostEqual(high["lon"], -55.750)
        self.assertAlmostEqual(high["frp"], 45.0)
        self.assertAlmostEqual(high["brightness"], 350.0)
        self.assertEqual(high["acq_date"], "2024-06-01")
        self.assertEqual(high["acq_time"], "1200")
        self.assertEqual(high["daynight"], "D")

    def test_nominal_kept(self):
        fires = parse_firms_csv(FIXTURE_CSV)
        nominal = next(f for f in fires if f["confidence"] == "nominal")
        self.assertAlmostEqual(nominal["lat"], -14.5)
        self.assertAlmostEqual(nominal["frp"], 12.5)

    def test_empty_and_header_only(self):
        self.assertEqual(parse_firms_csv(""), [])
        self.assertEqual(
            parse_firms_csv("latitude,longitude,bright_ti4,frp,confidence\n"),
            [],
        )

    def test_max_points(self):
        # Build many nominal rows
        header = "latitude,longitude,bright_ti4,frp,confidence,acq_date,acq_time,daynight\n"
        rows = "".join(
            f"{i}.0,{i}.0,300.0,{i}.0,nominal,2024-01-01,0000,N\n" for i in range(100)
        )
        fires = parse_firms_csv(header + rows, max_points=10)
        self.assertEqual(len(fires), 10)

    def test_source_and_day_range(self):
        self.assertEqual(get_firms_source("noaa21"), "VIIRS_NOAA21_NRT")
        self.assertEqual(get_firms_source("suominpp"), "VIIRS_SNPP_NRT")
        self.assertEqual(get_firms_source("unknown"), "VIIRS_NOAA21_NRT")
        self.assertEqual(hours_to_day_range(24), 1)
        self.assertEqual(hours_to_day_range(48), 2)
        self.assertEqual(hours_to_day_range(0), 1)


if __name__ == "__main__":
    unittest.main()
