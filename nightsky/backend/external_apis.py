"""
External API proxy endpoints for Night Sky Viewer.

Provides cached proxies for:
- CelesTrak TLE data (satellite tracking)
- NOAA SWPC Kp index (aurora forecasting)
- Light pollution heuristic (Bortle scale estimation)
"""

import time
import requests
from flask import Blueprint, request, jsonify

external_apis = Blueprint('external_apis', __name__)

# Simple in-memory cache: { key: (data, timestamp) }
_cache = {}


def _get_cached(key, max_age_seconds):
    """Return cached data if fresh enough, else None."""
    if key in _cache:
        data, ts = _cache[key]
        if time.time() - ts < max_age_seconds:
            return data
    return None


def _set_cached(key, data):
    _cache[key] = (data, time.time())


# ── Satellite TLE Proxy ──────────────────────────────────────────────

@external_apis.route('/api/satellites/tle', methods=['GET'])
def satellite_tle():
    """
    Fetch TLE data from CelesTrak.

    Query params:
    - group: TLE group name (default: 'stations' for ISS)
    - norad_id: specific NORAD catalog ID (optional)

    Cached for 24 hours.
    """
    group = request.args.get('group', 'stations')
    norad_id = request.args.get('norad_id')

    cache_key = f'tle_{group}_{norad_id or "all"}'
    cached = _get_cached(cache_key, 86400)  # 24hr cache
    if cached:
        return jsonify(cached)

    try:
        if norad_id:
            url = f'https://celestrak.org/NORAD/elements/gp.php?CATNR={norad_id}&FORMAT=tle'
        else:
            url = f'https://celestrak.org/NORAD/elements/gp.php?GROUP={group}&FORMAT=tle'

        resp = requests.get(url, timeout=10)
        resp.raise_for_status()

        # Parse TLE text into structured data
        lines = resp.text.strip().split('\n')
        satellites = []
        i = 0
        while i < len(lines) - 2:
            name = lines[i].strip()
            if name and not name.startswith('1 ') and not name.startswith('2 '):
                tle1 = lines[i + 1].strip()
                tle2 = lines[i + 2].strip()
                if tle1.startswith('1 ') and tle2.startswith('2 '):
                    satellites.append({
                        'name': name,
                        'tle1': tle1,
                        'tle2': tle2
                    })
                    i += 3
                    continue
            i += 1

        result = {'satellites': satellites, 'count': len(satellites)}
        _set_cached(cache_key, result)
        return jsonify(result)

    except requests.RequestException as e:
        return jsonify({'error': f'Failed to fetch TLE data: {str(e)}'}), 502


# ── Aurora / Kp Index Proxy ──────────────────────────────────────────

@external_apis.route('/api/aurora/kp', methods=['GET'])
def aurora_kp():
    """
    Fetch current and forecast Kp index from NOAA SWPC.

    Returns current Kp, 3-day forecast, and aurora visibility estimate
    for the given latitude.

    Query params:
    - lat: Observer latitude (for visibility estimate)

    Cached for 15 minutes.
    """
    lat = request.args.get('lat', 0, type=float)

    cache_key = 'aurora_kp'
    cached = _get_cached(cache_key, 900)  # 15min cache

    if not cached:
        try:
            # Current Kp - planetary K-index (nowcast)
            kp_url = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json'
            kp_resp = requests.get(kp_url, timeout=10)
            kp_resp.raise_for_status()
            kp_data = kp_resp.json()

            # 3-day forecast
            forecast_url = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json'
            forecast_resp = requests.get(forecast_url, timeout=10)
            forecast_resp.raise_for_status()
            forecast_data = forecast_resp.json()

            # Skip header row (index 0) in both datasets
            kp_rows = kp_data[1:] if len(kp_data) > 1 else []
            forecast_rows = forecast_data[1:] if len(forecast_data) > 1 else []
            cached = {
                'kp_recent': kp_rows[-6:] if len(kp_rows) > 6 else kp_rows,
                'kp_forecast': forecast_rows[:12] if len(forecast_rows) > 12 else forecast_rows
            }
            _set_cached(cache_key, cached)

        except requests.RequestException as e:
            return jsonify({'error': f'Failed to fetch Kp data: {str(e)}'}), 502

    # Compute current Kp value from most recent entry
    current_kp = 0
    if cached.get('kp_recent') and len(cached['kp_recent']) > 1:
        try:
            # Format: [time_tag, Kp, a_running, station_count]
            last_entry = cached['kp_recent'][-1]
            current_kp = float(last_entry[1])
        except (IndexError, ValueError, TypeError):
            current_kp = 0

    # Estimate aurora visibility based on latitude and Kp
    abs_lat = abs(lat)
    visibility = _estimate_aurora_visibility(abs_lat, current_kp)

    return jsonify({
        'current_kp': current_kp,
        'kp_recent': cached.get('kp_recent', []),
        'kp_forecast': cached.get('kp_forecast', []),
        'visibility': visibility
    })


def _estimate_aurora_visibility(abs_lat, kp):
    """Estimate aurora visibility likelihood based on latitude and Kp."""
    # Approximate auroral oval latitude for given Kp
    # Higher Kp pushes the oval further from the poles
    oval_lat = 67 - (kp * 2.5)

    if abs_lat >= oval_lat - 3:
        if kp >= 7:
            return {'level': 'high', 'description': 'Aurora likely visible overhead', 'color': '#00ff88'}
        elif kp >= 5:
            return {'level': 'moderate', 'description': 'Aurora possible on northern horizon', 'color': '#f59e0b'}
        elif abs_lat >= 60:
            return {'level': 'low', 'description': 'Faint aurora possible at high latitudes', 'color': '#6b7280'}

    if abs_lat >= 45 and kp >= 7:
        return {'level': 'moderate', 'description': 'Strong storm - aurora may be visible', 'color': '#f59e0b'}
    elif abs_lat >= 35 and kp >= 8:
        return {'level': 'low', 'description': 'Extreme storm - check northern horizon', 'color': '#6b7280'}

    return {'level': 'unlikely', 'description': 'Aurora unlikely at your latitude', 'color': '#374151'}


# ── Light Pollution Heuristic ────────────────────────────────────────

@external_apis.route('/api/lightpollution', methods=['GET'])
def light_pollution():
    """
    Estimate Bortle class for a location using reverse geocode heuristic.

    Query params:
    - lat: Latitude
    - lon: Longitude

    Returns estimated Bortle class based on population density heuristic.
    Cached for 1 hour per location (rounded to 0.1 degree).
    """
    lat = request.args.get('lat', 0, type=float)
    lon = request.args.get('lon', 0, type=float)

    # Round for cache key (0.1 degree ~ 11km resolution)
    rlat = round(lat, 1)
    rlon = round(lon, 1)
    cache_key = f'bortle_{rlat}_{rlon}'

    cached = _get_cached(cache_key, 3600)  # 1hr cache
    if cached:
        return jsonify(cached)

    try:
        # Reverse geocode to get place type
        url = (
            f'https://nominatim.openstreetmap.org/reverse?'
            f'format=json&lat={lat}&lon={lon}&zoom=10'
        )
        resp = requests.get(url, timeout=10, headers={
            'User-Agent': 'NightSkyViewer/1.0'
        })
        resp.raise_for_status()
        data = resp.json()

        address = data.get('address', {})
        place_type = data.get('type', '')
        place_name = data.get('display_name', '')

        bortle = _estimate_bortle(address, place_type, abs(lat))

        result = {
            'bortle_class': bortle,
            'place_name': place_name.split(',')[0] if place_name else '',
            'latitude': lat,
            'longitude': lon
        }
        _set_cached(cache_key, result)
        return jsonify(result)

    except requests.RequestException:
        # Fallback: estimate from latitude alone (rural areas tend to be darker)
        bortle = 5  # Suburban default
        return jsonify({
            'bortle_class': bortle,
            'place_name': '',
            'latitude': lat,
            'longitude': lon,
            'note': 'Estimated (geocode failed)'
        })


def _estimate_bortle(address, place_type, abs_lat):
    """Heuristic Bortle estimation from address components."""
    city = address.get('city', '')
    town = address.get('town', '')
    village = address.get('village', '')
    county = address.get('county', '')
    state = address.get('state', '')

    # Major cities
    major_cities = [
        'new york', 'los angeles', 'chicago', 'houston', 'phoenix',
        'london', 'paris', 'tokyo', 'beijing', 'mumbai', 'shanghai',
        'mexico city', 'sao paulo', 'cairo', 'delhi', 'moscow',
        'seoul', 'jakarta', 'bangkok', 'istanbul'
    ]

    location_lower = (city + ' ' + town).lower()

    if any(mc in location_lower for mc in major_cities):
        return 8  # City sky
    elif city and len(city) > 3:
        return 7  # Moderate city
    elif town:
        return 6  # Bright suburban
    elif village:
        return 4  # Rural/suburban transition
    elif county and not city and not town:
        return 3  # Rural
    elif not city and not town and not village:
        if abs_lat > 60:
            return 2  # Remote high latitude
        return 3  # Rural

    return 5  # Suburban default
