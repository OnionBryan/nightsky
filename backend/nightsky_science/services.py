"""
Pure nightsky API surface for the gRPC worker (no Flask).

Calls nightsky/backend modules and returns (dict|bytes, status, content_type).
"""

from __future__ import annotations

import json
import math
import time
from datetime import datetime, timedelta, timezone
from io import BytesIO
from typing import Any, Dict, Optional, Tuple
from zoneinfo import ZoneInfo

import requests

from location_utils import (
    CARDINAL_DIRECTIONS,
    geocode_location,
    get_local_datetime,
    get_timezone,
    is_nighttime,
    parse_coordinates,
)
from sky_generator import (
    GRADIENT_BACKGROUNDS,
    STYLE_THEMES,
    _get_ephemeris,
    generate_sky_image,
    get_moon_info,
    get_visible_planets,
    list_available_options,
)
from geostationary_utils import (
    MAJOR_GEO_SATELLITES,
    calculate_geo_look_angles,
    filter_satellites_by_category,
    get_all_satellite_categories,
    get_geostationary_arc,
    get_visible_geo_satellites,
)

JsonResult = Tuple[dict, int]

_weather_cache: dict = {}
_ext_cache: dict = {}


def _cache_get(key: str, max_age: float):
    if key in _ext_cache:
        data, ts = _ext_cache[key]
        if time.time() - ts < max_age:
            return data
    return None


def _cache_set(key: str, data) -> None:
    _ext_cache[key] = (data, time.time())


def health() -> JsonResult:
    return {"status": "ok", "service": "nightsky-science"}, 200


def geocode(q: str) -> JsonResult:
    query = (q or "").strip()
    if not query:
        return {"error": "Query parameter q is required"}, 400
    coords = parse_coordinates(query)
    if coords:
        lat, lon = coords
        return {
            "latitude": lat,
            "longitude": lon,
            "display_name": f"{lat:.4f}, {lon:.4f}",
            "timezone": get_timezone(lat, lon),
        }, 200
    result = geocode_location(query)
    if result is None:
        return {"error": f"Location not found: {query}"}, 404
    return result, 200


def options() -> JsonResult:
    return list_available_options(), 200


def planets(lat: float, lon: float) -> JsonResult:
    return get_visible_planets(lat, lon), 200


def moon(lat: float, lon: float) -> JsonResult:
    return get_moon_info(lat, lon), 200


def location_info(lat: float, lon: float) -> JsonResult:
    local_dt = get_local_datetime(lat, lon)
    return {
        "latitude": lat,
        "longitude": lon,
        "local_time": local_dt.isoformat(),
        "is_night": is_nighttime(lat, lon),
        "timezone": get_timezone(lat, lon),
    }, 200


def geostationary_visible(
    lat: float, lon: float, category: str = "", min_elevation: float = 5.0
) -> JsonResult:
    if min_elevation <= 0:
        min_elevation = 5.0
    satellites = filter_satellites_by_category(category) if category else None
    visible = get_visible_geo_satellites(lat, lon, satellites, min_elevation)
    return {
        "observer": {"latitude": lat, "longitude": lon},
        "visible_satellites": visible,
        "count": len(visible),
        "categories": get_all_satellite_categories(),
    }, 200


def geostationary_arc(lat: float, lon: float, points: int = 72) -> JsonResult:
    if points <= 0:
        points = 72
    return get_geostationary_arc(lat, lon, points), 200


def geostationary_lookup(lat: float, lon: float, sat_lon: float) -> JsonResult:
    return calculate_geo_look_angles(lat, lon, sat_lon), 200


def geostationary_list(category: str = "") -> JsonResult:
    if category:
        satellites = filter_satellites_by_category(category)
    else:
        satellites = MAJOR_GEO_SATELLITES
    return {
        "satellites": [
            {
                "name": s.name,
                "norad_id": s.norad_id,
                "orbital_longitude": s.longitude,
                "category": s.category,
                "operator": s.operator,
            }
            for s in satellites
        ],
        "count": len(satellites),
        "categories": get_all_satellite_categories(),
    }, 200


def twilight(lat: float, lon: float) -> JsonResult:
    """Twilight / darkness window (Skyfield almanac) — Flask-compatible shape."""
    from skyfield import almanac
    from skyfield.api import wgs84

    try:
        eph, ts = _get_ephemeris()
        tz_name = get_timezone(lat, lon)
        tz = ZoneInfo(tz_name)
        now_local = datetime.now(tz)
        local_midnight = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
        if now_local.hour >= 12:
            local_midnight = local_midnight + timedelta(days=1)
        window_start = local_midnight - timedelta(hours=12)
        window_end = local_midnight + timedelta(hours=12)
        t0 = ts.from_datetime(window_start.astimezone(ZoneInfo("UTC")))
        t1 = ts.from_datetime(window_end.astimezone(ZoneInfo("UTC")))
        location = wgs84.latlon(lat, lon)

        f = almanac.dark_twilight_day(eph, location)
        times, events = almanac.find_discrete(t0, t1, f)
        type_names = {
            0: "night",
            1: "astronomical_twilight",
            2: "nautical_twilight",
            3: "civil_twilight",
            4: "day",
        }
        all_times = [window_start]
        all_codes = [int(f(t0))]
        for t, e in zip(times, events):
            utc_dt = t.utc_datetime().replace(tzinfo=ZoneInfo("UTC"))
            all_times.append(utc_dt.astimezone(tz))
            all_codes.append(int(e))
        all_times.append(window_end)
        segments = []
        for i in range(len(all_codes)):
            seg_start, seg_end = all_times[i], all_times[i + 1]
            if seg_start >= seg_end:
                continue
            code = all_codes[i]
            segments.append(
                {
                    "start": seg_start.isoformat(),
                    "end": seg_end.isoformat(),
                    "type": type_names.get(code, "unknown"),
                    "code": code,
                }
            )

        moon_body = eph["moon"]
        moon_periods = []
        try:
            f_moon = almanac.risings_and_settings(eph, moon_body, location)
            moon_times, moon_events = almanac.find_discrete(t0, t1, f_moon)
            rise_dts, set_dts = [], []
            for mt, me in zip(moon_times, moon_events):
                local_dt = mt.utc_datetime().replace(tzinfo=ZoneInfo("UTC")).astimezone(tz)
                (rise_dts if bool(me) else set_dts).append(local_dt)
            moon_astrometric = (eph["earth"] + location).at(t0).observe(moon_body)
            moon_alt_start, _, _ = moon_astrometric.apparent().altaz()
            moon_is_up = bool(float(moon_alt_start.degrees) > 0)
            all_moon = sorted(
                [("rise", r) for r in rise_dts] + [("set", s) for s in set_dts],
                key=lambda x: x[1],
            )
            current_rise = window_start if moon_is_up else None
            for evt_type, evt_time in all_moon:
                if evt_type == "rise" and current_rise is None:
                    current_rise = evt_time
                elif evt_type == "set" and current_rise is not None:
                    moon_periods.append(
                        {"rise": current_rise.isoformat(), "set": evt_time.isoformat()}
                    )
                    current_rise = None
            if current_rise is not None:
                moon_periods.append(
                    {"rise": current_rise.isoformat(), "set": window_end.isoformat()}
                )
        except Exception:
            pass

        t_mid = ts.from_datetime(local_midnight.astimezone(ZoneInfo("UTC")))
        phase_degrees = float(almanac.moon_phase(eph, t_mid).degrees)
        illumination = float((1 - math.cos(math.radians(phase_degrees))) / 2 * 100)
        if phase_degrees < 22.5 or phase_degrees >= 337.5:
            phase_name = "New Moon"
        elif phase_degrees < 67.5:
            phase_name = "Waxing Crescent"
        elif phase_degrees < 112.5:
            phase_name = "First Quarter"
        elif phase_degrees < 157.5:
            phase_name = "Waxing Gibbous"
        elif phase_degrees < 202.5:
            phase_name = "Full Moon"
        elif phase_degrees < 247.5:
            phase_name = "Waning Gibbous"
        elif phase_degrees < 292.5:
            phase_name = "Last Quarter"
        else:
            phase_name = "Waning Crescent"

        darkness_window = None
        night_segments = [s for s in segments if s["code"] == 0]
        if night_segments:
            ds = datetime.fromisoformat(night_segments[0]["start"])
            de = datetime.fromisoformat(night_segments[-1]["end"])
            darkness_window = {
                "start": night_segments[0]["start"],
                "end": night_segments[-1]["end"],
                "duration_hours": round((de - ds).total_seconds() / 3600, 2),
            }

        moonless_darkness = None
        if darkness_window and night_segments:
            ds = datetime.fromisoformat(darkness_window["start"])
            de = datetime.fromisoformat(darkness_window["end"])
            intervals = [(ds, de)]
            for mp in moon_periods:
                mr = datetime.fromisoformat(mp["rise"])
                ms = datetime.fromisoformat(mp["set"])
                new_iv = []
                for a, b in intervals:
                    if ms <= a or mr >= b:
                        new_iv.append((a, b))
                    else:
                        if mr > a:
                            new_iv.append((a, mr))
                        if ms < b:
                            new_iv.append((ms, b))
                intervals = new_iv
            if intervals:
                longest = max(intervals, key=lambda x: (x[1] - x[0]).total_seconds())
                moonless_darkness = {
                    "start": longest[0].isoformat(),
                    "end": longest[1].isoformat(),
                    "duration_hours": round(
                        (longest[1] - longest[0]).total_seconds() / 3600, 2
                    ),
                }

        return {
            "date": now_local.strftime("%Y-%m-%d"),
            "timezone": tz_name,
            "segments": segments,
            "moon": {
                "illumination": round(illumination, 1),
                "phase_name": phase_name,
                "periods": moon_periods,
            },
            "darkness_window": darkness_window,
            "moonless_darkness": moonless_darkness,
            "window": {
                "start": window_start.isoformat(),
                "end": window_end.isoformat(),
            },
        }, 200
    except Exception as e:
        return {"error": str(e)}, 500


def riseset(lat: float, lon: float, object_name: str) -> JsonResult:
    from skyfield import almanac
    from skyfield.api import wgs84
    import numpy as np

    obj_name = (object_name or "").strip().lower()
    object_map = {
        "sun": ("sun", "Sun"),
        "moon": ("moon", "Moon"),
        "mercury": ("mercury", "Mercury"),
        "venus": ("venus", "Venus"),
        "mars": ("mars", "Mars"),
        "jupiter": ("jupiter barycenter", "Jupiter"),
        "saturn": ("saturn barycenter", "Saturn"),
    }
    if not obj_name:
        return {"error": "object parameter is required"}, 400
    if obj_name not in object_map:
        return {
            "error": f"Unknown object: {obj_name}. Supported: {list(object_map.keys())}"
        }, 400
    eph_key, display_name = object_map[obj_name]
    try:
        eph, ts = _get_ephemeris()
        tz_name = get_timezone(lat, lon)
        tz = ZoneInfo(tz_name)
        now_local = datetime.now(tz)
        local_midnight = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
        if now_local.hour >= 12:
            local_midnight = local_midnight + timedelta(days=1)
        window_start = local_midnight - timedelta(hours=12)
        window_end = local_midnight + timedelta(hours=12)
        t0 = ts.from_datetime(window_start.astimezone(ZoneInfo("UTC")))
        t1 = ts.from_datetime(window_end.astimezone(ZoneInfo("UTC")))
        location = wgs84.latlon(lat, lon)
        earth = eph["earth"]
        observer = earth + location
        target = eph[eph_key]
        horizon_deg = 0.0
        if obj_name == "sun":
            horizon_deg = -0.8333
        elif obj_name == "moon":
            horizon_deg = -0.125

        f_rs = almanac.risings_and_settings(
            eph, target, location, horizon_degrees=horizon_deg
        )
        times, events = almanac.find_discrete(t0, t1, f_rs)
        rise_t = set_t = transit_t = None
        for t, e in zip(times, events):
            local = t.utc_datetime().replace(tzinfo=ZoneInfo("UTC")).astimezone(tz)
            if bool(e) and rise_t is None:
                rise_t = local
            elif not bool(e) and set_t is None:
                set_t = local

        # Altitude curve
        steps = 48
        altitude_data = []
        max_alt = -90.0
        for i in range(steps + 1):
            frac = i / steps
            dt = window_start + (window_end - window_start) * frac
            t = ts.from_datetime(dt.astimezone(ZoneInfo("UTC")))
            alt, az, _ = observer.at(t).observe(target).apparent().altaz()
            ad = float(alt.degrees)
            max_alt = max(max_alt, ad)
            altitude_data.append(
                {"time": dt.astimezone(tz).strftime("%H:%M"), "altitude": round(ad, 2)}
            )

        # Transit ≈ max altitude time
        if altitude_data:
            best = max(altitude_data, key=lambda x: x["altitude"])
            # reconstruct approx transit iso from window
            for i, pt in enumerate(altitude_data):
                if pt is best:
                    frac = i / steps
                    transit_t = window_start + (window_end - window_start) * frac
                    break

        alts = [p["altitude"] for p in altitude_data]
        circumpolar = min(alts) > 0 if alts else False
        never_rises = max(alts) < 0 if alts else False

        return {
            "object": display_name,
            "rise": rise_t.isoformat() if rise_t else None,
            "transit": transit_t.isoformat() if transit_t else None,
            "set": set_t.isoformat() if set_t else None,
            "circumpolar": circumpolar,
            "never_rises": never_rises,
            "max_altitude": round(max_alt, 2),
            "altitude_data": altitude_data,
        }, 200
    except Exception as e:
        return {"error": str(e)}, 500


def _astronomy_score(cloud, seeing, transparency, humidity, wind):
    if cloud is None:
        return None
    cloud_score = max(0, 100 - float(cloud))
    if seeing is not None and 1 <= seeing <= 8:
        seeing_score = max(0.0, (8 - float(seeing)) / 7.0 * 100.0)
    else:
        seeing_score = 50.0
    if transparency is not None and 1 <= transparency <= 8:
        transp_score = max(0.0, (8 - float(transparency)) / 7.0 * 100.0)
    else:
        transp_score = 50.0
    hum_score = max(0.0, 100.0 - float(humidity)) if humidity is not None else 50.0
    wind_score = (
        max(0.0, 100.0 - (float(wind) / 30.0) * 100.0) if wind is not None else 50.0
    )
    composite = (
        cloud_score * 0.40
        + seeing_score * 0.25
        + transp_score * 0.20
        + hum_score * 0.10
        + wind_score * 0.05
    )
    return int(round(max(0, min(100, composite))))


def weather(lat: float, lon: float) -> JsonResult:
    cache_key = f"weather_{round(lat, 2)}_{round(lon, 2)}"
    now = time.time()
    if cache_key in _weather_cache:
        cached_data, cached_ts = _weather_cache[cache_key]
        if now - cached_ts < 1800:
            return cached_data, 200
    try:
        om_url = (
            "https://api.open-meteo.com/v1/forecast"
            f"?latitude={lat}&longitude={lon}"
            "&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,"
            "visibility,relative_humidity_2m,dew_point_2m,temperature_2m,"
            "wind_speed_10m,wind_direction_10m,wind_gusts_10m"
            "&timezone=auto&forecast_days=2"
        )
        om_resp = requests.get(om_url, timeout=10)
        om_resp.raise_for_status()
        open_meteo_data = om_resp.json()
    except Exception as e:
        return {"error": f"Failed to fetch weather data from Open-Meteo: {e}"}, 502
    if not open_meteo_data or "hourly" not in open_meteo_data:
        return {"error": "Failed to fetch weather data from Open-Meteo"}, 502

    seven_timer_data = None
    try:
        st_url = (
            f"https://www.7timer.info/bin/astro.php"
            f"?lon={lon}&lat={lat}&ac=0&unit=metric&output=json&tzshift=0"
        )
        st_resp = requests.get(st_url, timeout=8)
        st_resp.raise_for_status()
        seven_timer_data = st_resp.json()
    except Exception:
        pass

    seeing_labels = {
        1: "Superb",
        2: "Excellent",
        3: "Good",
        4: "Average",
        5: "Below avg",
        6: "Poor",
        7: "Bad",
        8: "Terrible",
    }
    transparency_labels = {
        1: "Excellent",
        2: "Above avg",
        3: "Average",
        4: "Below avg",
        5: "Poor",
        6: "Bad",
        7: "Very bad",
        8: "Terrible",
    }
    st_lookup = {}
    if seven_timer_data and "dataseries" in seven_timer_data:
        init_str = seven_timer_data.get("init", "")
        if len(init_str) >= 10:
            try:
                init_dt = datetime.strptime(init_str[:10], "%Y%m%d%H")
                for dp in seven_timer_data["dataseries"]:
                    tp = int(dp.get("timepoint", 0))
                    forecast_dt = init_dt + timedelta(hours=tp)
                    key = forecast_dt.strftime("%Y-%m-%dT%H:00")
                    st_lookup[key] = {
                        "seeing": int(dp.get("seeing", 0)),
                        "transparency": int(dp.get("transparency", 0)),
                    }
            except Exception:
                pass

    om_hourly = open_meteo_data["hourly"]
    times = om_hourly.get("time", [])
    hourly_out = []
    for i, t in enumerate(times):
        def g(name):
            arr = om_hourly.get(name, [])
            return arr[i] if i < len(arr) else None

        cloud, hum, wind = g("cloud_cover"), g("relative_humidity_2m"), g("wind_speed_10m")
        seeing_label = transparency_label = None
        seeing_val = transparency_val = None
        try:
            hour_dt = datetime.strptime(t, "%Y-%m-%dT%H:%M")
            rounded_h = (hour_dt.hour // 3) * 3
            rounded_key = hour_dt.strftime("%Y-%m-%d") + f"T{rounded_h:02d}:00"
            st_entry = st_lookup.get(rounded_key)
            if st_entry:
                seeing_val = st_entry["seeing"]
                transparency_val = st_entry["transparency"]
                seeing_label = seeing_labels.get(seeing_val)
                transparency_label = transparency_labels.get(transparency_val)
        except Exception:
            pass
        score = _astronomy_score(cloud, seeing_val, transparency_val, hum, wind)
        hourly_out.append(
            {
                "time": t,
                "cloud_cover": int(cloud) if cloud is not None else None,
                "cloud_cover_low": int(g("cloud_cover_low")) if g("cloud_cover_low") is not None else None,
                "cloud_cover_mid": int(g("cloud_cover_mid")) if g("cloud_cover_mid") is not None else None,
                "cloud_cover_high": int(g("cloud_cover_high")) if g("cloud_cover_high") is not None else None,
                "visibility_m": float(g("visibility")) if g("visibility") is not None else None,
                "humidity": int(hum) if hum is not None else None,
                "dew_point_c": float(g("dew_point_2m")) if g("dew_point_2m") is not None else None,
                "temp_c": float(g("temperature_2m")) if g("temperature_2m") is not None else None,
                "wind_kmh": float(wind) if wind is not None else None,
                "wind_dir": int(g("wind_direction_10m")) if g("wind_direction_10m") is not None else None,
                "wind_gusts_kmh": float(g("wind_gusts_10m")) if g("wind_gusts_10m") is not None else None,
                "seeing_label": seeing_label,
                "transparency_label": transparency_label,
                "astronomy_score": score,
            }
        )

    best_start = best_end = None
    best_score = 0
    for i in range(len(hourly_out)):
        if hourly_out[i]["astronomy_score"] is not None and hourly_out[i]["astronomy_score"] >= 50:
            window_scores = []
            j = i
            while (
                j < len(hourly_out)
                and hourly_out[j]["astronomy_score"] is not None
                and hourly_out[j]["astronomy_score"] >= 50
            ):
                window_scores.append(hourly_out[j]["astronomy_score"])
                j += 1
            if len(window_scores) >= 2:
                avg = sum(window_scores) / len(window_scores)
                if avg > best_score:
                    best_score = int(round(avg))
                    best_start = hourly_out[i]["time"]
                    best_end = hourly_out[j - 1]["time"]

    night_scores = [h["astronomy_score"] for h in hourly_out if h["astronomy_score"] is not None]
    if night_scores:
        avg_all = sum(night_scores) / len(night_scores)
        overall = (
            "Excellent"
            if avg_all >= 75
            else "Good"
            if avg_all >= 60
            else "Fair"
            if avg_all >= 40
            else "Poor"
            if avg_all >= 20
            else "Bad"
        )
    else:
        overall = "Unknown"

    result = {
        "hourly": hourly_out,
        "summary": {
            "best_window": {
                "start": best_start,
                "end": best_end,
                "score": best_score,
            }
            if best_start
            else None,
            "overall": overall,
        },
        "timezone": open_meteo_data.get("timezone", ""),
        "fetched_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S") + "Z",
    }
    _weather_cache[cache_key] = (result, now)
    return result, 200


def generate_sky(payload: dict) -> Tuple[Optional[bytes], int, str, str]:
    """Returns (image_bytes, status, content_type, error)."""
    lat = payload.get("latitude")
    lon = payload.get("longitude")
    if lat is None or lon is None:
        return None, 400, "", "latitude and longitude are required"
    try:
        lat, lon = float(lat), float(lon)
    except (TypeError, ValueError):
        return None, 400, "", "latitude and longitude must be numbers"
    if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
        return None, 400, "", "latitude/longitude out of range"
    direction = str(payload.get("direction", "S")).upper()
    if direction not in CARDINAL_DIRECTIONS:
        return None, 400, "", f"Invalid direction. Must be one of: {list(CARDINAL_DIRECTIONS.keys())}"
    dt = None
    if payload.get("datetime"):
        try:
            dt = datetime.fromisoformat(str(payload["datetime"]).replace("Z", "+00:00"))
        except ValueError:
            return None, 400, "", "Invalid datetime format. Use ISO format."
    altitude_range = payload.get("altitude_range", [0, 60])
    if isinstance(altitude_range, list) and len(altitude_range) == 2:
        altitude_range = tuple(altitude_range)
    else:
        altitude_range = (0, 60)
    theme = str(payload.get("theme", "BLUE_DARK")).upper()
    if theme not in STYLE_THEMES:
        theme = "BLUE_DARK"
    gradient = payload.get("gradient", "TRUE_NIGHT")
    if gradient:
        gradient = str(gradient).upper()
        if gradient not in GRADIENT_BACKGROUNDS:
            gradient = "TRUE_NIGHT"
    resolution = min(int(payload.get("resolution", 2400)), 4000)
    output_format = str(payload.get("format", "png")).lower()
    if output_format not in ["png", "svg", "jpeg", "jpg"]:
        output_format = "png"
    if output_format == "jpg":
        output_format = "jpeg"
    try:
        image_data = generate_sky_image(
            lat=lat,
            lon=lon,
            direction=direction,
            dt=dt,
            output_format=output_format,
            altitude_range=altitude_range,
            show_stars=payload.get("show_stars", True),
            show_planets=payload.get("show_planets", True),
            show_moon=payload.get("show_moon", True),
            show_sun=payload.get("show_sun", False),
            show_constellations=payload.get("show_constellations", True),
            show_constellation_labels=payload.get("show_constellation_labels", True),
            show_constellation_borders=payload.get("show_constellation_borders", False),
            show_milky_way=payload.get("show_milky_way", True),
            show_messier=payload.get("show_messier", False),
            show_dso=payload.get("show_dso", False),
            show_gridlines=payload.get("show_gridlines", False),
            show_ecliptic=payload.get("show_ecliptic", False),
            show_celestial_equator=payload.get("show_celestial_equator", False),
            show_geostationary=payload.get("show_geostationary", False),
            show_horizon=payload.get("show_horizon", True),
            star_magnitude_limit=float(payload.get("star_magnitude_limit", 5.0)),
            star_label_limit=float(payload.get("star_label_limit", 2.0)),
            dso_magnitude_limit=float(payload.get("dso_magnitude_limit", 10.0)),
            theme=theme,
            gradient=gradient,
            resolution=resolution,
        )
        mimetype = f"image/{output_format}"
        if output_format == "svg":
            mimetype = "image/svg+xml"
        return image_data, 200, mimetype, ""
    except Exception as e:
        return None, 500, "", str(e)


def _estimate_aurora_visibility(abs_lat, kp):
    oval_lat = 67 - (kp * 2.5)
    if abs_lat >= oval_lat - 3:
        if kp >= 7:
            return {
                "level": "high",
                "description": "Aurora likely visible overhead",
                "color": "#00ff88",
            }
        if kp >= 5:
            return {
                "level": "moderate",
                "description": "Aurora possible on northern horizon",
                "color": "#f59e0b",
            }
        if abs_lat >= 60:
            return {
                "level": "low",
                "description": "Faint aurora possible at high latitudes",
                "color": "#6b7280",
            }
    if abs_lat >= 45 and kp >= 7:
        return {
            "level": "moderate",
            "description": "Strong storm - aurora may be visible",
            "color": "#f59e0b",
        }
    if abs_lat >= 35 and kp >= 8:
        return {
            "level": "low",
            "description": "Extreme storm - check northern horizon",
            "color": "#6b7280",
        }
    return {
        "level": "unlikely",
        "description": "Aurora unlikely at your latitude",
        "color": "#374151",
    }


def aurora_kp(lat: float) -> JsonResult:
    cached = _cache_get("aurora_kp", 900)
    if not cached:
        try:
            kp_resp = requests.get(
                "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",
                timeout=10,
            )
            kp_resp.raise_for_status()
            kp_data = kp_resp.json()
            forecast_resp = requests.get(
                "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json",
                timeout=10,
            )
            forecast_resp.raise_for_status()
            forecast_data = forecast_resp.json()
            kp_rows = kp_data[1:] if len(kp_data) > 1 else []
            forecast_rows = forecast_data[1:] if len(forecast_data) > 1 else []
            cached = {
                "kp_recent": kp_rows[-6:] if len(kp_rows) > 6 else kp_rows,
                "kp_forecast": forecast_rows[:12]
                if len(forecast_rows) > 12
                else forecast_rows,
            }
            _cache_set("aurora_kp", cached)
        except requests.RequestException as e:
            return {"error": f"Failed to fetch Kp data: {e}"}, 502
    current_kp = 0
    if cached.get("kp_recent") and len(cached["kp_recent"]) > 1:
        try:
            current_kp = float(cached["kp_recent"][-1][1])
        except (IndexError, ValueError, TypeError):
            current_kp = 0
    return {
        "current_kp": current_kp,
        "kp_recent": cached.get("kp_recent", []),
        "kp_forecast": cached.get("kp_forecast", []),
        "visibility": _estimate_aurora_visibility(abs(lat), current_kp),
    }, 200


def _estimate_bortle(address, place_type, abs_lat):
    city = address.get("city", "")
    town = address.get("town", "")
    village = address.get("village", "")
    major = [
        "new york",
        "los angeles",
        "chicago",
        "houston",
        "phoenix",
        "london",
        "paris",
        "tokyo",
        "beijing",
        "mumbai",
        "shanghai",
        "mexico city",
        "sao paulo",
        "cairo",
        "delhi",
        "moscow",
        "seoul",
        "jakarta",
        "bangkok",
        "istanbul",
    ]
    location_lower = (city + " " + town).lower()
    if any(mc in location_lower for mc in major):
        return 8
    if city and len(city) > 3:
        return 7
    if town:
        return 6
    if village:
        return 4
    if abs_lat > 55:
        return 3
    return 5


def light_pollution(lat: float, lon: float) -> JsonResult:
    rlat, rlon = round(lat, 1), round(lon, 1)
    cache_key = f"bortle_{rlat}_{rlon}"
    cached = _cache_get(cache_key, 3600)
    if cached:
        return cached, 200
    try:
        url = (
            f"https://nominatim.openstreetmap.org/reverse?"
            f"format=json&lat={lat}&lon={lon}&zoom=10"
        )
        resp = requests.get(
            url, timeout=10, headers={"User-Agent": "NightSkyViewer/1.0"}
        )
        resp.raise_for_status()
        data = resp.json()
        address = data.get("address", {})
        place_type = data.get("type", "")
        place_name = data.get("display_name", "")
        bortle = _estimate_bortle(address, place_type, abs(lat))
        result = {
            "bortle_class": bortle,
            "place_name": place_name.split(",")[0] if place_name else "",
            "latitude": lat,
            "longitude": lon,
        }
        _cache_set(cache_key, result)
        return result, 200
    except requests.RequestException:
        return {
            "bortle_class": 5,
            "place_name": "",
            "latitude": lat,
            "longitude": lon,
            "note": "Estimated (geocode failed)",
        }, 200


def ephemeris(name: str, lat: float, lon: float) -> JsonResult:
    """
    Planner ephemeris: map common names to riseset objects, else SIMBAD-free
    planet/moon/sun riseset. Returns rise/transit/set + altitude curve.
    """
    raw = (name or "").strip()
    if not raw:
        return {"found": False, "error": "name parameter required"}, 400

    key = raw.lower()
    # Normalize common catalog aliases to solar-system keys when possible
    aliases = {
        "sol": "sun",
        "luna": "moon",
        "jove": "jupiter",
        "terra": "earth",
    }
    key = aliases.get(key, key)

    solar = {"sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn"}
    if key in solar:
        data, status = riseset(lat, lon, key)
        if status >= 400:
            return {**data, "found": False}, status
        data["found"] = True
        data["name"] = data.get("object", raw)
        data["query"] = raw
        return data, 200

    # Unknown deep-sky: return found false with hint (SIMBAD is orbit edge)
    return {
        "found": False,
        "name": raw,
        "error": (
            f"No solar-system ephemeris for '{raw}'. "
            "Use sun/moon/mercury/venus/mars/jupiter/saturn, "
            "or /api/simbad/resolve for deep-sky names."
        ),
        "supported": sorted(solar),
    }, 200


def _parse_hour_key(t: str):
    """Parse Open-Meteo-style hourly time to aware datetime if possible."""
    if not t:
        return None
    try:
        # "2026-07-20T22:00" or ISO with offset
        if "T" in t and len(t) <= 16:
            return datetime.fromisoformat(t)
        return datetime.fromisoformat(t.replace("Z", "+00:00"))
    except Exception:
        return None


def _night_window_weather_scores(wx: dict, tw: Optional[dict]) -> list:
    """
    Astronomy scores for hours relevant to observing tonight.

    Prefer overlap with twilight darkness_window when parseable; else hours
    from the forecast whose local hour is 20–05 (rough night); else all
    remaining hours from the first slot whose time is >= now if labeled.
    """
    hourly = wx.get("hourly") or []
    if not hourly:
        return []

    scored = []
    dw = (tw or {}).get("darkness_window") if tw else None
    d_start = d_end = None
    if dw:
        try:
            d_start = datetime.fromisoformat(str(dw["start"]))
            d_end = datetime.fromisoformat(str(dw["end"]))
        except Exception:
            d_start = d_end = None

    for h in hourly:
        sc = h.get("astronomy_score")
        if sc is None:
            continue
        ht = _parse_hour_key(str(h.get("time", "")))
        if d_start is not None and d_end is not None and ht is not None:
            # Compare in same awareness if possible
            try:
                if ht.tzinfo is None and d_start.tzinfo is not None:
                    # treat forecast times as local naive; compare wall-clock components
                    hs = ht.replace(tzinfo=d_start.tzinfo)
                else:
                    hs = ht
                if d_start <= hs <= d_end:
                    scored.append(float(sc))
            except Exception:
                pass
        elif ht is not None:
            # Fallback: local night hours
            if ht.hour >= 20 or ht.hour <= 5:
                scored.append(float(sc))
        else:
            scored.append(float(sc))

    if scored:
        return scored

    # Last resort: mean of all available scores (better than silent None)
    return [float(h["astronomy_score"]) for h in hourly if h.get("astronomy_score") is not None]


def session_go_no_go(lat: float, lon: float) -> JsonResult:
    """
    Combine twilight darkness, moon illumination, and weather astronomy score
    into a single recommendation: favorable | marginal | poor.
    """
    tw, tw_st = twilight(lat, lon)
    moon_info, moon_st = moon(lat, lon)
    wx, wx_st = weather(lat, lon)

    factors = {
        "twilight_ok": tw_st < 400 and not tw.get("error"),
        "moon_ok": moon_st < 400 and not moon_info.get("error"),
        "weather_ok": wx_st < 400 and not wx.get("error"),
    }

    # Darkness hours from night segments
    darkness_hours = 0.0
    if factors["twilight_ok"] and tw.get("darkness_window"):
        darkness_hours = float(tw["darkness_window"].get("duration_hours") or 0)
    moon_illum = None
    if factors["moon_ok"] and moon_info.get("phase"):
        moon_illum = float(moon_info["phase"].get("illumination") or 0)
    elif factors["twilight_ok"] and tw.get("moon"):
        moon_illum = float(tw["moon"].get("illumination") or 0)

    weather_score = None
    if factors["weather_ok"] and wx.get("hourly"):
        # Prefer hours overlapping tonight's darkness window (or local night
        # hours from "now"), not the first 12 forecast slots (often daytime).
        scores = _night_window_weather_scores(wx, tw if factors["twilight_ok"] else None)
        if scores:
            weather_score = sum(scores) / len(scores)

    # Scoring rubric (explicit, simple)
    # darkness: 0–40 pts  (0h→0, 8h+→40)
    # moon: 0–30 pts      (0% illum→30, 100%→0)
    # weather: 0–30 pts   (astronomy_score 0–100 → 0–30)
    pts = 0.0
    detail = {}
    d_pts = min(40.0, max(0.0, darkness_hours / 8.0 * 40.0))
    pts += d_pts
    detail["darkness_hours"] = round(darkness_hours, 2)
    detail["darkness_points"] = round(d_pts, 1)

    if moon_illum is not None:
        m_pts = max(0.0, 30.0 * (1.0 - moon_illum / 100.0))
        pts += m_pts
        detail["moon_illumination"] = round(moon_illum, 1)
        detail["moon_points"] = round(m_pts, 1)
    else:
        detail["moon_illumination"] = None
        detail["moon_points"] = 0

    if weather_score is not None:
        w_pts = max(0.0, min(30.0, weather_score / 100.0 * 30.0))
        pts += w_pts
        detail["weather_score"] = round(weather_score, 1)
        detail["weather_points"] = round(w_pts, 1)
        detail["weather_overall"] = (wx.get("summary") or {}).get("overall")
    else:
        detail["weather_score"] = None
        detail["weather_points"] = 0
        detail["weather_error"] = wx.get("error") if not factors["weather_ok"] else None

    if pts >= 65:
        recommendation = "favorable"
    elif pts >= 40:
        recommendation = "marginal"
    else:
        recommendation = "poor"

    return {
        "recommendation": recommendation,
        "score": round(pts, 1),
        "max_score": 100,
        "factors": detail,
        "twilight": {
            "timezone": tw.get("timezone") if factors["twilight_ok"] else None,
            "darkness_window": tw.get("darkness_window") if factors["twilight_ok"] else None,
            "moonless_darkness": tw.get("moonless_darkness") if factors["twilight_ok"] else None,
            "error": tw.get("error") if not factors["twilight_ok"] else None,
        },
        "moon": {
            "phase": moon_info.get("phase") if factors["moon_ok"] else None,
            "altitude": moon_info.get("altitude") if factors["moon_ok"] else None,
            "error": moon_info.get("error") if not factors["moon_ok"] else None,
        },
        "weather": {
            "summary": wx.get("summary") if factors["weather_ok"] else None,
            "error": wx.get("error") if not factors["weather_ok"] else None,
        },
    }, 200


def satellite_tle(group: str = "", norad_id: str = "") -> JsonResult:
    group = group or "stations"
    cache_key = f"tle_{group}_{norad_id or 'all'}"
    cached = _cache_get(cache_key, 86400)
    if cached:
        return cached, 200
    try:
        if norad_id:
            url = f"https://celestrak.org/NORAD/elements/gp.php?CATNR={norad_id}&FORMAT=tle"
        else:
            url = f"https://celestrak.org/NORAD/elements/gp.php?GROUP={group}&FORMAT=tle"
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        lines = resp.text.strip().split("\n")
        satellites = []
        i = 0
        while i < len(lines) - 2:
            name = lines[i].strip()
            if name and not name.startswith("1 ") and not name.startswith("2 "):
                tle1 = lines[i + 1].strip()
                tle2 = lines[i + 2].strip()
                if tle1.startswith("1 ") and tle2.startswith("2 "):
                    satellites.append({"name": name, "tle1": tle1, "tle2": tle2})
                    i += 3
                    continue
            i += 1
        result = {"satellites": satellites, "count": len(satellites)}
        _cache_set(cache_key, result)
        return result, 200
    except requests.RequestException as e:
        return {"error": f"Failed to fetch TLE data: {e}"}, 502
