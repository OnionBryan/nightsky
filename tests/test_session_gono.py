"""Session go/no-go pure composition — drives shipped services.session_go_no_go."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "nightsky" / "backend"))

from backend.nightsky_science import services  # noqa: E402


class TestSessionGoNoGo(unittest.TestCase):
    def test_favorable_when_dark_new_moon_clear(self):
        # Patch network-backed helpers with fixed payloads
        tw = {
            "timezone": "UTC",
            "darkness_window": {
                "start": "2024-01-01T00:00:00+00:00",
                "end": "2024-01-01T10:00:00+00:00",
                "duration_hours": 10.0,
            },
            "moonless_darkness": None,
            "moon": {"illumination": 5.0, "phase_name": "New Moon"},
        }
        moon = {"phase": {"illumination": 5.0, "name": "New Moon"}, "altitude": 20.0}
        wx = {
            "hourly": [{"time": "t", "astronomy_score": 90, "cloud_cover": 5}] * 12,
            "summary": {"overall": "Excellent", "best_window": None},
        }
        with mock.patch.object(services, "twilight", return_value=(tw, 200)), mock.patch.object(
            services, "moon", return_value=(moon, 200)
        ), mock.patch.object(services, "weather", return_value=(wx, 200)):
            data, status = services.session_go_no_go(40.0, -75.0)
        self.assertEqual(status, 200)
        self.assertEqual(data["recommendation"], "favorable")
        self.assertGreaterEqual(data["score"], 65)
        self.assertIn("darkness_hours", data["factors"])
        self.assertIn("moon_illumination", data["factors"])
        self.assertIn("weather_score", data["factors"])

    def test_poor_when_bright_and_cloudy(self):
        tw = {
            "darkness_window": {"duration_hours": 1.0},
            "moon": {"illumination": 95.0},
        }
        moon = {"phase": {"illumination": 95.0, "name": "Full Moon"}}
        wx = {
            "hourly": [{"astronomy_score": 10, "cloud_cover": 90}] * 12,
            "summary": {"overall": "Bad"},
        }
        with mock.patch.object(services, "twilight", return_value=(tw, 200)), mock.patch.object(
            services, "moon", return_value=(moon, 200)
        ), mock.patch.object(services, "weather", return_value=(wx, 200)):
            data, status = services.session_go_no_go(40.0, -75.0)
        self.assertEqual(status, 200)
        self.assertEqual(data["recommendation"], "poor")
        self.assertLess(data["score"], 40)

    def test_weather_uses_darkness_hours_not_daytime_mean(self):
        """Daytime-high scores must not override poor overnight weather."""
        # Shortish dark + half moon: weather term decides favorable vs not
        tw = {
            "timezone": "America/New_York",
            "darkness_window": {
                "start": "2026-07-20T22:00:00-04:00",
                "end": "2026-07-21T04:00:00-04:00",
                "duration_hours": 5.0,  # 25 darkness pts
            },
            "moon": {"illumination": 50.0},
        }
        moon = {"phase": {"illumination": 50.0, "name": "First Quarter"}}  # 15 moon pts
        # Daytime excellent (~90); night poor (~25)
        hourly = []
        for day, hour, score in [
            ("2026-07-20", 9, 95),
            ("2026-07-20", 12, 90),
            ("2026-07-20", 15, 88),
            ("2026-07-20", 18, 85),
            ("2026-07-20", 21, 80),
            ("2026-07-20", 22, 30),
            ("2026-07-20", 23, 28),
            ("2026-07-21", 0, 26),
            ("2026-07-21", 1, 24),
            ("2026-07-21", 2, 22),
            ("2026-07-21", 3, 20),
            ("2026-07-21", 4, 35),
        ]:
            hourly.append(
                {
                    "time": f"{day}T{hour:02d}:00",
                    "astronomy_score": score,
                    "cloud_cover": 10 if score > 50 else 85,
                }
            )
        wx = {"hourly": hourly, "summary": {"overall": "Fair"}}
        with mock.patch.object(services, "twilight", return_value=(tw, 200)), mock.patch.object(
            services, "moon", return_value=(moon, 200)
        ), mock.patch.object(services, "weather", return_value=(wx, 200)):
            data, status = services.session_go_no_go(40.7, -74.0)
        self.assertEqual(status, 200)
        # Night scores ~20-35 → weather_score should be low, not ~90 daytime mean
        self.assertIsNotNone(data["factors"]["weather_score"])
        self.assertLess(
            data["factors"]["weather_score"],
            50.0,
            msg=f"weather_score={data['factors']['weather_score']} (expected night mean)",
        )
        # Daytime-mean path would be ~25+15+27≈67 favorable; night path ~25+15+8≈48 not favorable
        self.assertNotEqual(data["recommendation"], "favorable")


if __name__ == "__main__":
    unittest.main()
