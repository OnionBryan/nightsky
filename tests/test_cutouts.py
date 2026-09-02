"""HiPS cutout URL builder tests (no network)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.orbit_science.cutouts import (  # noqa: E402
    AVAILABLE_SURVEYS,
    build_cutout,
    build_cutout_multi,
    list_surveys,
)


class TestCutouts(unittest.TestCase):
    def test_list_surveys(self):
        data = list_surveys()
        self.assertIn("dss2_color", data["surveys"])
        self.assertIn("optical", data["categories"])

    def test_build_cutout(self):
        result, status = build_cutout(83.63, 22.01, fov=0.2, survey="dss2_color")
        self.assertEqual(status, 200)
        self.assertIn("hips=", result["url"])
        self.assertIn("ra=83.63", result["url"])
        self.assertEqual(result["hips_id"], AVAILABLE_SURVEYS["dss2_color"])

    def test_unknown_survey(self):
        result, status = build_cutout(0, 0, survey="not_a_survey")
        self.assertEqual(status, 400)
        self.assertIn("available", result)

    def test_multi(self):
        result = build_cutout_multi(10, 20, surveys=["dss2_color", "2mass_color", "nope"])
        self.assertEqual(result["count"], 2)
        self.assertEqual(len(result["cutouts"]), 2)


if __name__ == "__main__":
    unittest.main()
