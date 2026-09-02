"""
Ground-site satellite pass prediction (AOS / LOS / max elevation / duration).

Uses geodetic positions from a track (SGP4 → lat/lon/alt) and spherical
topocentric elevation relative to the observer. Horizon model is geometric
(elev >= min_elevation), not refraction-corrected ops quality.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Sequence

from backend.orbit_science.visibility import (
    satellite_is_sunlit,
    site_is_daylight,
    solar_elevation_deg,
)

_R_EARTH = 6371.0  # km mean


def _to_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def elevation_azimuth(
    site_lat: float,
    site_lon: float,
    site_alt_km: float,
    sat_lat: float,
    sat_lon: float,
    sat_alt_km: float,
) -> Dict[str, float]:
    """
    Topocentric elevation/azimuth (degrees) from site to satellite.

    Spherical Earth model with altitudes above mean radius.
    Azimuth: 0 = north, clockwise.
    """
    lat1 = math.radians(site_lat)
    lon1 = math.radians(site_lon)
    lat2 = math.radians(sat_lat)
    lon2 = math.radians(sat_lon)
    r1 = _R_EARTH + site_alt_km
    r2 = _R_EARTH + sat_alt_km

    # ECEF-like on sphere
    o = (
        r1 * math.cos(lat1) * math.cos(lon1),
        r1 * math.cos(lat1) * math.sin(lon1),
        r1 * math.sin(lat1),
    )
    s = (
        r2 * math.cos(lat2) * math.cos(lon2),
        r2 * math.cos(lat2) * math.sin(lon2),
        r2 * math.sin(lat2),
    )
    dx, dy, dz = s[0] - o[0], s[1] - o[1], s[2] - o[2]

    # ENU at site
    east = (-math.sin(lon1), math.cos(lon1), 0.0)
    north = (
        -math.sin(lat1) * math.cos(lon1),
        -math.sin(lat1) * math.sin(lon1),
        math.cos(lat1),
    )
    up = (math.cos(lat1) * math.cos(lon1), math.cos(lat1) * math.sin(lon1), math.sin(lat1))

    e = dx * east[0] + dy * east[1] + dz * east[2]
    n = dx * north[0] + dy * north[1] + dz * north[2]
    u = dx * up[0] + dy * up[1] + dz * up[2]
    horiz = math.hypot(e, n)
    elev = math.degrees(math.atan2(u, horiz)) if horiz > 1e-9 else (90.0 if u > 0 else -90.0)
    az = math.degrees(math.atan2(e, n)) % 360.0
    range_km = math.sqrt(dx * dx + dy * dy + dz * dz)
    return {"elevation": elev, "azimuth": az, "range_km": range_km}


def _parse_time(t) -> datetime:
    if isinstance(t, datetime):
        return _to_utc(t)
    return _to_utc(datetime.fromisoformat(str(t).replace("Z", "+00:00")))


def predict_passes_from_track(
    track: Sequence[Dict[str, Any]],
    site_lat: float,
    site_lon: float,
    *,
    site_alt_km: float = 0.0,
    min_elevation_deg: float = 10.0,
    r_teme_samples: Optional[Sequence[Optional[list]]] = None,
) -> List[Dict[str, Any]]:
    """
    Find passes over a site from a discrete track of geodetic positions.

    Each track point needs: latitude, longitude, altitude_km, timestamp (or time).
    Optional r_teme_samples[i] enables eclipse flags (TEME/ECI km position).

    Returns list of passes:
      aos, los, max_elevation, duration_seconds, max_elevation_time,
      sat_sunlit_at_max, site_daylight_at_max, site_solar_elevation_at_max
    """
    if not track:
        return []

    samples = []
    for i, p in enumerate(track):
        lat = p.get("latitude", p.get("lat"))
        lon = p.get("longitude", p.get("lon"))
        alt = p.get("altitude_km", p.get("alt", 0.0))
        ts = p.get("timestamp", p.get("time"))
        if lat is None or lon is None or ts is None:
            continue
        t = _parse_time(ts)
        top = elevation_azimuth(
            site_lat, site_lon, site_alt_km, float(lat), float(lon), float(alt)
        )
        r_vec = None
        if r_teme_samples is not None and i < len(r_teme_samples):
            r_vec = r_teme_samples[i]
        samples.append(
            {
                "t": t,
                "elev": top["elevation"],
                "az": top["azimuth"],
                "range_km": top["range_km"],
                "r": r_vec,
            }
        )

    if len(samples) < 2:
        return []

    passes: List[Dict[str, Any]] = []
    in_pass = False
    aos_t: Optional[datetime] = None
    max_el = -999.0
    max_t: Optional[datetime] = None
    max_r = None

    def _close_pass(los_t: datetime):
        nonlocal in_pass, aos_t, max_el, max_t, max_r
        if aos_t is None or max_t is None:
            in_pass = False
            return
        if los_t <= aos_t:
            in_pass = False
            return
        dur = (los_t - aos_t).total_seconds()
        if dur <= 0 or max_el < min_elevation_deg:
            in_pass = False
            aos_t = None
            max_el = -999.0
            return
        sunlit = None
        if max_r is not None:
            sunlit = satellite_is_sunlit(max_r, max_t)
        site_day = site_is_daylight(site_lat, site_lon, max_t)
        passes.append(
            {
                "aos": aos_t.isoformat(),
                "los": los_t.isoformat(),
                "max_elevation": round(max_el, 2),
                "max_elevation_time": max_t.isoformat(),
                "duration_seconds": int(round(dur)),
                "duration_minutes": round(dur / 60.0, 2),
                "sat_sunlit_at_max": sunlit,
                "site_daylight_at_max": site_day,
                "site_solar_elevation_at_max": round(
                    solar_elevation_deg(site_lat, site_lon, max_t), 2
                ),
                "visual_pass_candidate": bool(
                    sunlit is True and site_day is False and max_el >= min_elevation_deg
                ),
            }
        )
        in_pass = False
        aos_t = None
        max_el = -999.0
        max_t = None
        max_r = None

    # Seed in-progress pass if first sample is already above horizon
    # (window starts mid-pass / setting-only segment).
    if samples[0]["elev"] >= min_elevation_deg:
        in_pass = True
        aos_t = samples[0]["t"]
        max_el = samples[0]["elev"]
        max_t = samples[0]["t"]
        max_r = samples[0].get("r")

    for i in range(len(samples) - 1):
        a, b = samples[i], samples[i + 1]
        elev_a, elev_b = a["elev"], b["elev"]
        # Rising through horizon (new pass; ignore if already in_pass)
        if not in_pass and elev_a < min_elevation_deg <= elev_b:
            # Linear interpolate AOS
            frac = (min_elevation_deg - elev_a) / (elev_b - elev_a) if elev_b != elev_a else 0.0
            frac = max(0.0, min(1.0, frac))
            aos_t = a["t"] + (b["t"] - a["t"]) * frac
            in_pass = True
            max_el = elev_b
            max_t = b["t"]
            max_r = b.get("r")
        elif in_pass:
            if elev_b > max_el:
                max_el = elev_b
                max_t = b["t"]
                max_r = b.get("r")
            # Setting through horizon
            if elev_a >= min_elevation_deg > elev_b:
                frac = (elev_a - min_elevation_deg) / (elev_a - elev_b) if elev_a != elev_b else 1.0
                frac = max(0.0, min(1.0, frac))
                los_t = a["t"] + (b["t"] - a["t"]) * frac
                _close_pass(los_t)

    # Still in pass at end of track
    if in_pass and aos_t is not None:
        _close_pass(samples[-1]["t"])

    return passes


def predict_passes_for_propagator(
    prop,
    site_lat: float,
    site_lon: float,
    *,
    start: Optional[datetime] = None,
    hours: float = 24.0,
    step_seconds: int = 30,
    min_elevation_deg: float = 10.0,
    site_alt_km: float = 0.0,
) -> List[Dict[str, Any]]:
    """
    Propagate with OrbitPropagator-like object and return site passes.

    ``prop`` must provide ``propagate(dt) -> dict|None`` with lat/lon/alt and
    optionally expose raw TEME via prop.satellite.sgp4 for eclipse flags.
    """
    from sgp4.api import jday

    start = _to_utc(start or datetime.now(timezone.utc))
    end = start + timedelta(hours=hours)
    track = []
    r_samples = []
    t = start
    while t <= end:
        pos = prop.propagate(t)
        if pos:
            track.append(pos)
            # Raw TEME for eclipse
            try:
                err, r_teme, _v = prop.satellite.sgp4(
                    *jday(
                        t.year,
                        t.month,
                        t.day,
                        t.hour,
                        t.minute,
                        t.second + t.microsecond / 1e6,
                    )
                )
                r_samples.append(list(r_teme) if err == 0 else None)
            except Exception:
                r_samples.append(None)
        t += timedelta(seconds=step_seconds)

    return predict_passes_from_track(
        track,
        site_lat,
        site_lon,
        site_alt_km=site_alt_km,
        min_elevation_deg=min_elevation_deg,
        r_teme_samples=r_samples,
    )
