"""
NASA FIRMS active-fire fetch, CSV parse, confidence filter, and cache.

Pure units are testable without live network:
  parse_firms_csv(csv_text) -> list[dict]
"""

from __future__ import annotations

import csv
import os
from datetime import datetime, timezone
from io import StringIO
from typing import Any, Dict, List, Optional, Tuple

import requests

FIRMS_MAP_KEY = os.environ.get("FIRMS_MAP_KEY", "DEMO_KEY")
FIRMS_BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
FIRMS_SOURCE_MAP = {
    "noaa21": "VIIRS_NOAA21_NRT",
    "noaa20": "VIIRS_NOAA20_NRT",
    "suominpp": "VIIRS_SNPP_NRT",
}
FIRES_CACHE_TTL = 900  # seconds
FIRES_MAX_POINTS = 5000

_CONFIDENCE_ORDER = {"low": 0, "nominal": 1, "high": 2}

# { cache_key: (utc_timestamp, result_dict) }
_fires_cache: Dict[str, Tuple[datetime, dict]] = {}


def get_firms_source(satellite: str) -> str:
    """Map satellite catalog key to FIRMS product name."""
    if not satellite:
        satellite = "noaa21"
    return FIRMS_SOURCE_MAP.get(satellite, "VIIRS_NOAA21_NRT")


def hours_to_day_range(hours: int) -> int:
    """FIRMS world endpoint uses day bins: 1 day (≤24h) or 2 days (>24h)."""
    if hours is None or hours <= 0:
        hours = 24
    return 2 if hours > 24 else 1


def parse_firms_csv(csv_text: str, max_points: int = FIRES_MAX_POINTS) -> List[Dict[str, Any]]:
    """
    Parse a FIRMS area CSV body into fire dicts for the orbit overlay.

    Drops low-confidence rows. Required columns (case-sensitive as FIRMS ships them):
    latitude, longitude, bright_ti4, frp, confidence; optional acq_date/acq_time/daynight.
    """
    if not csv_text or not csv_text.strip():
        return []

    fires: List[Dict[str, Any]] = []
    reader = csv.DictReader(StringIO(csv_text))
    for row in reader:
        conf = (row.get("confidence") or "low").strip()
        if _CONFIDENCE_ORDER.get(conf, 0) < 1:
            continue  # skip 'low'

        try:
            lat = float(row.get("latitude", 0))
            lon = float(row.get("longitude", 0))
            brightness = float(row.get("bright_ti4", 0) or 0)
            frp = float(row.get("frp", 0) or 0)
        except (ValueError, TypeError):
            continue

        fires.append(
            {
                "lat": lat,
                "lon": lon,
                "brightness": brightness,
                "confidence": conf,
                "frp": frp,
                "acq_date": row.get("acq_date", "") or "",
                "acq_time": row.get("acq_time", "") or "",
                "daynight": row.get("daynight", "") or "",
            }
        )
        if len(fires) >= max_points:
            break

    return fires


def _cache_get(key: str) -> Optional[dict]:
    entry = _fires_cache.get(key)
    if not entry:
        return None
    ts, data = entry
    if (datetime.now(timezone.utc) - ts).total_seconds() < FIRES_CACHE_TTL:
        # Return a shallow copy with cached flag
        out = dict(data)
        out["cached"] = True
        return out
    return None


def _cache_set(key: str, data: dict) -> None:
    _fires_cache[key] = (datetime.now(timezone.utc), data)


def clear_fires_cache() -> None:
    """Test helper."""
    _fires_cache.clear()


def fetch_fires(
    satellite: str = "noaa21",
    hours: int = 24,
    *,
    session: Optional[requests.Session] = None,
    timeout: float = 30.0,
) -> dict:
    """
    Fetch (or return cached) FIRMS fires for the edge/gRPC layer.

    Always returns a dict with keys: fires (list), count (int), and on failure
    an error string. HTTP-layer status codes are left to the caller via
    optional ``http_status`` key (502/504/500) for edge mapping.
    """
    days = hours_to_day_range(hours)
    source = get_firms_source(satellite)
    cache_key = f"fires_{source}_world_{days}"

    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    url = f"{FIRMS_BASE}/{FIRMS_MAP_KEY}/{source}/world/{days}"
    http = session or requests

    try:
        resp = http.get(url, timeout=timeout)
        resp.raise_for_status()
    except requests.exceptions.Timeout:
        return {
            "error": "FIRMS API timed out",
            "fires": [],
            "count": 0,
            "source": source,
            "day_range": days,
            "cached": False,
            "http_status": 504,
        }
    except requests.exceptions.RequestException as e:
        return {
            "error": f"FIRMS request failed: {e}",
            "fires": [],
            "count": 0,
            "source": source,
            "day_range": days,
            "cached": False,
            "http_status": 502,
        }

    try:
        fires = parse_firms_csv(resp.text)
    except Exception as e:
        return {
            "error": f"Failed to parse FIRMS CSV: {e}",
            "fires": [],
            "count": 0,
            "source": source,
            "day_range": days,
            "cached": False,
            "http_status": 500,
        }

    result = {
        "fires": fires,
        "count": len(fires),
        "source": source,
        "day_range": days,
        "cached": False,
    }
    _cache_set(cache_key, result)
    return result
