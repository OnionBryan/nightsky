"""
Night Sky Viewer - Flask API Server

Comprehensive API for generating night sky visualizations including:
- First-person horizon views with stars, planets, and deep sky objects
- Geostationary satellite positions
- Moon phase information
- Planet visibility data

Endpoints:
- POST /api/nightsky/generate - Generate sky image
- GET /api/nightsky/geocode - Convert city to coordinates
- GET /api/nightsky/options - Get available themes, directions, features
- GET /api/nightsky/planets - Get visible planets info
- GET /api/nightsky/moon - Get Moon phase and position
- GET /api/nightsky/info - Get location info (time, nighttime status)
- GET /api/nightsky/geostationary - Get visible geostationary satellites
- GET /api/nightsky/geostationary/arc - Get full geostationary arc data
"""

from datetime import datetime
from io import BytesIO
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS

from location_utils import (
    geocode_location,
    parse_coordinates,
    get_local_datetime,
    is_nighttime,
    get_timezone,
    CARDINAL_DIRECTIONS
)
from sky_generator import (
    generate_sky_image,
    get_visible_planets,
    get_moon_info,
    list_available_options,
    STYLE_THEMES,
    GRADIENT_BACKGROUNDS
)
from geostationary_utils import (
    get_visible_geo_satellites,
    get_geostationary_arc,
    calculate_geo_look_angles,
    MAJOR_GEO_SATELLITES,
    get_all_satellite_categories,
    filter_satellites_by_category
)

app = Flask(__name__)
CORS(app)  # Enable CORS for frontend access

# Handle numpy types in JSON serialization (skyfield returns numpy scalars)
import numpy as np
from flask.json.provider import DefaultJSONProvider

class NumpyJSONProvider(DefaultJSONProvider):
    def default(self, o):
        if isinstance(o, np.bool_):
            return bool(o)
        if isinstance(o, np.integer):
            return int(o)
        if isinstance(o, np.floating):
            return float(o)
        if isinstance(o, np.ndarray):
            return o.tolist()
        return super().default(o)

app.json = NumpyJSONProvider(app)

# Register external API proxy endpoints (aurora, satellites, light pollution)
from external_apis import external_apis
app.register_blueprint(external_apis)


@app.route('/api/nightsky/generate', methods=['POST'])
def generate():
    """
    Generate a night sky image.

    Request JSON:
    {
        "latitude": 40.7128,
        "longitude": -74.0060,
        "direction": "S",
        "datetime": "2025-01-25T22:00:00",  # Optional

        // Display options
        "show_stars": true,
        "show_planets": true,
        "show_moon": true,
        "show_sun": false,
        "show_constellations": true,
        "show_constellation_labels": true,
        "show_constellation_borders": false,
        "show_milky_way": true,
        "show_messier": false,
        "show_dso": false,
        "show_gridlines": false,
        "show_ecliptic": false,
        "show_celestial_equator": false,
        "show_geostationary": false,

        // Magnitude limits
        "star_magnitude_limit": 5.0,
        "star_label_limit": 2.0,
        "dso_magnitude_limit": 10.0,

        // View options
        "altitude_range": [0, 60],
        "resolution": 2400,

        // Style options
        "theme": "BLUE_DARK",
        "gradient": "TRUE_NIGHT",
        "format": "png"
    }

    Returns: PNG/SVG/JPEG image
    """
    try:
        data = request.get_json() or {}

        # Required parameters
        lat = data.get('latitude')
        lon = data.get('longitude')

        if lat is None or lon is None:
            return jsonify({'error': 'latitude and longitude are required'}), 400

        # Validate latitude and longitude
        try:
            lat = float(lat)
            lon = float(lon)
            if not (-90 <= lat <= 90):
                return jsonify({'error': 'latitude must be between -90 and 90'}), 400
            if not (-180 <= lon <= 180):
                return jsonify({'error': 'longitude must be between -180 and 180'}), 400
        except (TypeError, ValueError):
            return jsonify({'error': 'latitude and longitude must be numbers'}), 400

        # Direction
        direction = data.get('direction', 'S').upper()
        if direction not in CARDINAL_DIRECTIONS:
            return jsonify({
                'error': f'Invalid direction. Must be one of: {list(CARDINAL_DIRECTIONS.keys())}'
            }), 400

        # Parse datetime if provided
        dt = None
        if data.get('datetime'):
            try:
                dt = datetime.fromisoformat(data['datetime'].replace('Z', '+00:00'))
            except ValueError:
                return jsonify({'error': 'Invalid datetime format. Use ISO format.'}), 400

        # Altitude range
        altitude_range = data.get('altitude_range', [0, 60])
        if isinstance(altitude_range, list) and len(altitude_range) == 2:
            altitude_range = tuple(altitude_range)
        else:
            altitude_range = (0, 60)

        # Display options
        show_stars = data.get('show_stars', True)
        show_planets = data.get('show_planets', True)
        show_moon = data.get('show_moon', True)
        show_sun = data.get('show_sun', False)
        show_constellations = data.get('show_constellations', True)
        show_constellation_labels = data.get('show_constellation_labels', True)
        show_constellation_borders = data.get('show_constellation_borders', False)
        show_milky_way = data.get('show_milky_way', True)
        show_messier = data.get('show_messier', False)
        show_dso = data.get('show_dso', False)
        show_gridlines = data.get('show_gridlines', False)
        show_ecliptic = data.get('show_ecliptic', False)
        show_celestial_equator = data.get('show_celestial_equator', False)
        show_geostationary = data.get('show_geostationary', False)
        show_horizon = data.get('show_horizon', True)

        # Magnitude limits
        star_magnitude_limit = float(data.get('star_magnitude_limit', 5.0))
        star_label_limit = float(data.get('star_label_limit', 2.0))
        dso_magnitude_limit = float(data.get('dso_magnitude_limit', 10.0))

        # Style settings
        theme = data.get('theme', 'BLUE_DARK').upper()
        if theme not in STYLE_THEMES:
            theme = 'BLUE_DARK'

        gradient = data.get('gradient', 'TRUE_NIGHT')
        if gradient:
            gradient = gradient.upper()
            if gradient not in GRADIENT_BACKGROUNDS:
                gradient = 'TRUE_NIGHT'

        # Resolution and format
        resolution = min(int(data.get('resolution', 2400)), 4000)  # Cap at 4000
        output_format = data.get('format', 'png').lower()
        if output_format not in ['png', 'svg', 'jpeg', 'jpg']:
            output_format = 'png'
        if output_format == 'jpg':
            output_format = 'jpeg'

        # Generate the image
        image_data = generate_sky_image(
            lat=lat,
            lon=lon,
            direction=direction,
            dt=dt,
            output_format=output_format,
            altitude_range=altitude_range,
            show_stars=show_stars,
            show_planets=show_planets,
            show_moon=show_moon,
            show_sun=show_sun,
            show_constellations=show_constellations,
            show_constellation_labels=show_constellation_labels,
            show_constellation_borders=show_constellation_borders,
            show_milky_way=show_milky_way,
            show_messier=show_messier,
            show_dso=show_dso,
            show_gridlines=show_gridlines,
            show_ecliptic=show_ecliptic,
            show_celestial_equator=show_celestial_equator,
            show_geostationary=show_geostationary,
            show_horizon=show_horizon,
            star_magnitude_limit=star_magnitude_limit,
            star_label_limit=star_label_limit,
            dso_magnitude_limit=dso_magnitude_limit,
            theme=theme,
            gradient=gradient,
            resolution=resolution,
        )

        # Return the image
        mimetype = f'image/{output_format}'
        if output_format == 'svg':
            mimetype = 'image/svg+xml'

        return send_file(
            BytesIO(image_data),
            mimetype=mimetype,
            download_name=f'nightsky_{direction.lower()}.{output_format}'
        )

    except Exception as e:
        print(f"Error generating sky image: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/nightsky/geocode', methods=['GET'])
def geocode():
    """
    Geocode a location string to coordinates.

    Query params:
    - q: Location query (city name, address, etc.)

    Returns:
    {
        "latitude": 40.7128,
        "longitude": -74.0060,
        "display_name": "New York City, NY, USA",
        "timezone": "America/New_York"
    }
    """
    query = request.args.get('q', '').strip()

    if not query:
        return jsonify({'error': 'Query parameter q is required'}), 400

    # First try to parse as coordinates
    coords = parse_coordinates(query)
    if coords:
        lat, lon = coords
        return jsonify({
            'latitude': lat,
            'longitude': lon,
            'display_name': f'{lat:.4f}, {lon:.4f}',
            'timezone': get_timezone(lat, lon)
        })

    # Try geocoding
    result = geocode_location(query)

    if result is None:
        return jsonify({'error': f'Location not found: {query}'}), 404

    return jsonify(result)


@app.route('/api/nightsky/options', methods=['GET'])
def options():
    """
    Get available configuration options.

    Returns comprehensive list of all available themes, gradients,
    directions, features, and default values.
    """
    return jsonify(list_available_options())


@app.route('/api/nightsky/planets', methods=['GET'])
def planets():
    """
    Get visible planets for a location.

    Query params:
    - lat: Latitude
    - lon: Longitude

    Returns planet visibility information with altitude and azimuth.
    """
    try:
        lat = float(request.args.get('lat', 0))
        lon = float(request.args.get('lon', 0))
    except ValueError:
        return jsonify({'error': 'lat and lon must be numbers'}), 400

    result = get_visible_planets(lat, lon)
    return jsonify(result)


@app.route('/api/nightsky/moon', methods=['GET'])
def moon():
    """
    Get Moon information including phase.

    Query params:
    - lat: Latitude
    - lon: Longitude

    Returns:
    {
        "altitude": 45.2,
        "azimuth": 180.5,
        "distance_km": 384400,
        "visible": true,
        "phase": {
            "angle": 135.2,
            "name": "Waxing Gibbous",
            "illumination": 75.1
        }
    }
    """
    try:
        lat = float(request.args.get('lat', 0))
        lon = float(request.args.get('lon', 0))
    except ValueError:
        return jsonify({'error': 'lat and lon must be numbers'}), 400

    result = get_moon_info(lat, lon)
    return jsonify(result)


@app.route('/api/nightsky/info', methods=['GET'])
def location_info():
    """
    Get information about a location including local time and whether it's night.

    Query params:
    - lat: Latitude
    - lon: Longitude

    Returns:
    {
        "latitude": 40.7128,
        "longitude": -74.0060,
        "local_time": "2025-01-25T22:30:00-05:00",
        "is_night": true,
        "timezone": "America/New_York"
    }
    """
    try:
        lat = float(request.args.get('lat', 0))
        lon = float(request.args.get('lon', 0))
    except ValueError:
        return jsonify({'error': 'lat and lon must be numbers'}), 400

    local_dt = get_local_datetime(lat, lon)
    night = is_nighttime(lat, lon)
    tz = get_timezone(lat, lon)

    return jsonify({
        'latitude': lat,
        'longitude': lon,
        'local_time': local_dt.isoformat(),
        'is_night': night,
        'timezone': tz
    })


@app.route('/api/nightsky/geostationary', methods=['GET'])
def geostationary():
    """
    Get visible geostationary satellites for a location.

    Query params:
    - lat: Latitude
    - lon: Longitude
    - category: Optional filter (weather, communications)
    - min_elevation: Minimum elevation angle (default 5)

    Returns:
    {
        "observer": {"latitude": 40.7, "longitude": -74.0},
        "visible_satellites": [
            {
                "name": "GOES-18",
                "norad_id": 54743,
                "orbital_longitude": -137.0,
                "category": "weather",
                "azimuth": 245.3,
                "elevation": 32.5,
                "slant_range_km": 38456.2
            },
            ...
        ],
        "count": 8
    }
    """
    try:
        lat = float(request.args.get('lat', 0))
        lon = float(request.args.get('lon', 0))
        min_elevation = float(request.args.get('min_elevation', 5))
    except ValueError:
        return jsonify({'error': 'lat, lon, and min_elevation must be numbers'}), 400

    # Optional category filter
    category = request.args.get('category')

    if category:
        satellites = filter_satellites_by_category(category)
    else:
        satellites = None  # Use all

    visible = get_visible_geo_satellites(lat, lon, satellites, min_elevation)

    return jsonify({
        'observer': {
            'latitude': lat,
            'longitude': lon
        },
        'visible_satellites': visible,
        'count': len(visible),
        'categories': get_all_satellite_categories()
    })


@app.route('/api/nightsky/geostationary/arc', methods=['GET'])
def geostationary_arc():
    """
    Get the full geostationary arc as seen from observer.

    Returns points along the arc for visualization, plus metadata
    about how the arc appears in the sky.

    Query params:
    - lat: Latitude
    - lon: Longitude
    - points: Number of points (default 72 = every 5 degrees)

    Returns:
    {
        "observer": {"latitude": 40.7, "longitude": -74.0},
        "arc_points": [
            {"longitude": -180, "azimuth": 90.5, "elevation": 12.3},
            ...
        ],
        "apparent_declination": -20.35,
        "max_elevation": 34.2,
        "visible_range": {
            "min_azimuth": 120.5,
            "max_azimuth": 240.3
        }
    }
    """
    try:
        lat = float(request.args.get('lat', 0))
        lon = float(request.args.get('lon', 0))
        num_points = int(request.args.get('points', 72))
    except ValueError:
        return jsonify({'error': 'lat, lon must be numbers, points must be integer'}), 400

    arc_data = get_geostationary_arc(lat, lon, num_points)
    return jsonify(arc_data)


@app.route('/api/nightsky/geostationary/lookup', methods=['GET'])
def geostationary_lookup():
    """
    Calculate look angles for a specific geostationary satellite longitude.

    Query params:
    - lat: Observer latitude
    - lon: Observer longitude
    - sat_lon: Satellite orbital longitude

    Returns:
    {
        "azimuth": 180.5,
        "elevation": 45.2,
        "slant_range_km": 38456.2,
        "visible": true
    }
    """
    try:
        lat = float(request.args.get('lat', 0))
        lon = float(request.args.get('lon', 0))
        sat_lon = float(request.args.get('sat_lon', 0))
    except ValueError:
        return jsonify({'error': 'lat, lon, and sat_lon must be numbers'}), 400

    result = calculate_geo_look_angles(lat, lon, sat_lon)
    return jsonify(result)


@app.route('/api/nightsky/geostationary/satellites', methods=['GET'])
def list_geo_satellites():
    """
    List all known geostationary satellites.

    Query params:
    - category: Optional filter (weather, communications)

    Returns list of all tracked geostationary satellites with their
    orbital positions and metadata.
    """
    category = request.args.get('category')

    if category:
        satellites = filter_satellites_by_category(category)
    else:
        satellites = MAJOR_GEO_SATELLITES

    return jsonify({
        'satellites': [
            {
                'name': s.name,
                'norad_id': s.norad_id,
                'orbital_longitude': s.longitude,
                'category': s.category,
                'operator': s.operator
            }
            for s in satellites
        ],
        'count': len(satellites),
        'categories': get_all_satellite_categories()
    })


@app.route('/api/nightsky/twilight', methods=['GET'])
def twilight():
    """
    Get twilight/darkness segments for a 24-hour window centered on local midnight.

    Uses Skyfield's almanac.dark_twilight_day() with find_discrete() to compute
    transition times between day, civil twilight, nautical twilight, astronomical
    twilight, and full night.

    Query params:
    - lat: Latitude
    - lon: Longitude

    Returns:
    {
        "date": "2026-03-27",
        "timezone": "America/New_York",
        "segments": [
            {"start": "2026-03-27T12:00:00-04:00", "end": "...", "type": "day", "code": 4},
            ...
        ],
        "moon": {
            "rise": "...",
            "set": "...",
            "illumination": 42.3,
            "phase_name": "Waxing Crescent",
            "periods": [{"rise": "...", "set": "..."}]
        },
        "darkness_window": { "start": "...", "end": "...", "duration_hours": 8.55 },
        "moonless_darkness": { "start": "...", "end": "...", "duration_hours": 1.88 },
        "window": { "start": "...", "end": "..." }
    }
    """
    import math
    from datetime import timedelta
    from zoneinfo import ZoneInfo
    from skyfield import almanac
    from skyfield.api import wgs84
    from sky_generator import _get_ephemeris
    from location_utils import get_timezone

    try:
        lat = float(request.args.get('lat', 0))
        lon = float(request.args.get('lon', 0))
    except ValueError:
        return jsonify({'error': 'lat and lon must be numbers'}), 400

    try:
        eph, ts = _get_ephemeris()
        tz_name = get_timezone(lat, lon)
        tz = ZoneInfo(tz_name)

        # Current local time -> find today's local midnight
        from datetime import datetime as dt_cls
        now_local = dt_cls.now(tz)
        local_midnight = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
        if now_local.hour < 12:
            # Before noon -> use last midnight (already correct)
            pass
        else:
            # After noon -> use next midnight
            local_midnight = local_midnight + timedelta(days=1)

        # 24-hour window: noon before midnight to noon after midnight
        window_start = local_midnight - timedelta(hours=12)
        window_end = local_midnight + timedelta(hours=12)

        t0 = ts.from_datetime(window_start.astimezone(ZoneInfo("UTC")))
        t1 = ts.from_datetime(window_end.astimezone(ZoneInfo("UTC")))

        location = wgs84.latlon(lat, lon)

        # --- Twilight segments ---
        f = almanac.dark_twilight_day(eph, location)
        times, events = almanac.find_discrete(t0, t1, f)

        # Type mapping from Skyfield codes
        TYPE_NAMES = {
            0: 'night',
            1: 'astronomical_twilight',
            2: 'nautical_twilight',
            3: 'civil_twilight',
            4: 'day'
        }

        segments = []

        # Build segments from transitions
        # First segment: from window_start to first transition
        all_times = [window_start]
        all_codes = [int(f(t0))]  # state at window start

        for t, e in zip(times, events):
            utc_dt = t.utc_datetime().replace(tzinfo=ZoneInfo("UTC"))
            local_dt = utc_dt.astimezone(tz)
            all_times.append(local_dt)
            all_codes.append(int(e))

        all_times.append(window_end)

        for i in range(len(all_codes)):
            seg_start = all_times[i]
            seg_end = all_times[i + 1]
            code = all_codes[i]

            if seg_start >= seg_end:
                continue

            segments.append({
                'start': seg_start.isoformat(),
                'end': seg_end.isoformat(),
                'type': TYPE_NAMES.get(code, 'unknown'),
                'code': code
            })

        # --- Moon data ---
        moon = eph['moon']

        # Moonrise/moonset
        moon_periods = []
        try:
            # Use risings_and_settings which is available in all Skyfield versions
            # It returns a step function: True = rise, False = set
            f_moon = almanac.risings_and_settings(eph, moon, location)
            moon_times, moon_events = almanac.find_discrete(t0, t1, f_moon)

            rise_dts = []
            set_dts = []
            for mt, me in zip(moon_times, moon_events):
                utc_dt = mt.utc_datetime().replace(tzinfo=ZoneInfo("UTC"))
                local_dt = utc_dt.astimezone(tz)
                if bool(me):  # True = rise
                    rise_dts.append(local_dt)
                else:  # False = set
                    set_dts.append(local_dt)

            # Check if moon is up at window start
            moon_astrometric = (eph['earth'] + location).at(t0).observe(moon)
            moon_alt_start, _, _ = moon_astrometric.apparent().altaz()
            moon_is_up = bool(float(moon_alt_start.degrees) > 0)

            # Build moon periods by interleaving rises and sets
            all_moon_events = []
            for r in rise_dts:
                all_moon_events.append(('rise', r))
            for s in set_dts:
                all_moon_events.append(('set', s))
            all_moon_events.sort(key=lambda x: x[1])

            # Walk through events to build periods
            current_rise = window_start if moon_is_up else None
            for evt_type, evt_time in all_moon_events:
                if evt_type == 'rise' and current_rise is None:
                    current_rise = evt_time
                elif evt_type == 'set' and current_rise is not None:
                    moon_periods.append({
                        'rise': current_rise.isoformat(),
                        'set': evt_time.isoformat()
                    })
                    current_rise = None

            # If moon is still up at window end
            if current_rise is not None:
                moon_periods.append({
                    'rise': current_rise.isoformat(),
                    'set': window_end.isoformat()
                })

        except Exception as e:
            print(f"Moon rise/set calculation error: {e}")
            import traceback
            traceback.print_exc()

        # Moon illumination at midnight
        t_mid = ts.from_datetime(local_midnight.astimezone(ZoneInfo("UTC")))
        phase_angle = almanac.moon_phase(eph, t_mid)
        phase_degrees = float(phase_angle.degrees)
        illumination = float((1 - math.cos(math.radians(phase_degrees))) / 2 * 100)

        # Phase name
        if phase_degrees < 22.5:
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
        elif phase_degrees < 337.5:
            phase_name = "Waning Crescent"
        else:
            phase_name = "New Moon"

        # --- Darkness window ---
        darkness_window = None
        night_segments = [s for s in segments if s['code'] == 0]
        if night_segments:
            darkness_start = night_segments[0]['start']
            darkness_end = night_segments[-1]['end']
            # Parse back to compute duration
            ds = dt_cls.fromisoformat(darkness_start)
            de = dt_cls.fromisoformat(darkness_end)
            duration_hours = float((de - ds).total_seconds() / 3600)
            darkness_window = {
                'start': darkness_start,
                'end': darkness_end,
                'duration_hours': round(duration_hours, 2)
            }

        # --- Moonless darkness ---
        moonless_darkness = None
        if darkness_window and night_segments:
            # Find intervals of night that don't overlap with moon-up periods
            ds = dt_cls.fromisoformat(darkness_window['start'])
            de = dt_cls.fromisoformat(darkness_window['end'])

            moonless_intervals = [(ds, de)]
            for mp in moon_periods:
                mr = dt_cls.fromisoformat(mp['rise'])
                ms = dt_cls.fromisoformat(mp['set'])
                new_intervals = []
                for (a, b) in moonless_intervals:
                    # Subtract [mr, ms] from [a, b]
                    if ms <= a or mr >= b:
                        new_intervals.append((a, b))
                    else:
                        if mr > a:
                            new_intervals.append((a, mr))
                        if ms < b:
                            new_intervals.append((ms, b))
                moonless_intervals = new_intervals

            if moonless_intervals:
                # Find longest moonless interval
                longest = max(moonless_intervals, key=lambda x: (x[1] - x[0]).total_seconds())
                ml_hours = float((longest[1] - longest[0]).total_seconds() / 3600)
                moonless_darkness = {
                    'start': longest[0].isoformat(),
                    'end': longest[1].isoformat(),
                    'duration_hours': round(ml_hours, 2)
                }

        return jsonify({
            'date': now_local.strftime('%Y-%m-%d'),
            'timezone': tz_name,
            'segments': segments,
            'moon': {
                'illumination': round(illumination, 1),
                'phase_name': phase_name,
                'periods': moon_periods
            },
            'darkness_window': darkness_window,
            'moonless_darkness': moonless_darkness,
            'window': {
                'start': window_start.isoformat(),
                'end': window_end.isoformat()
            }
        })

    except Exception as e:
        print(f"Error computing twilight data: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/nightsky/riseset', methods=['GET'])
def riseset():
    """
    Get rise/transit/set times and altitude-over-time curve for a celestial object.

    Query params:
    - lat: Latitude
    - lon: Longitude
    - object: Object name (mars, jupiter, saturn, venus, mercury, moon, sun)

    Returns:
    {
        "object": "Mars",
        "rise": "2026-03-27T19:42:00-04:00" or null,
        "transit": "2026-03-28T01:15:00-04:00" or null,
        "set": "2026-03-28T06:48:00-04:00" or null,
        "circumpolar": false,
        "never_rises": false,
        "max_altitude": 58.3,
        "altitude_data": [{"time": "19:00", "altitude": 12.3}, ...]
    }
    """
    import math
    from datetime import timedelta
    from zoneinfo import ZoneInfo
    from skyfield import almanac
    from skyfield.api import wgs84
    from sky_generator import _get_ephemeris
    from location_utils import get_timezone

    try:
        lat = float(request.args.get('lat', 0))
        lon = float(request.args.get('lon', 0))
    except ValueError:
        return jsonify({'error': 'lat and lon must be numbers'}), 400

    obj_name = (request.args.get('object') or '').strip().lower()
    if not obj_name:
        return jsonify({'error': 'object parameter is required'}), 400

    # Map object names to Skyfield ephemeris keys
    OBJECT_MAP = {
        'sun': ('sun', 'Sun'),
        'moon': ('moon', 'Moon'),
        'mercury': ('mercury', 'Mercury'),
        'venus': ('venus', 'Venus'),
        'mars': ('mars', 'Mars'),
        'jupiter': ('jupiter barycenter', 'Jupiter'),
        'saturn': ('saturn barycenter', 'Saturn'),
    }

    if obj_name not in OBJECT_MAP:
        return jsonify({
            'error': f'Unknown object: {obj_name}. Supported: {list(OBJECT_MAP.keys())}'
        }), 400

    eph_key, display_name = OBJECT_MAP[obj_name]

    try:
        eph, ts = _get_ephemeris()
        tz_name = get_timezone(lat, lon)
        tz = ZoneInfo(tz_name)

        from datetime import datetime as dt_cls
        now_local = dt_cls.now(tz)

        # Find local midnight (nearest)
        local_midnight = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
        if now_local.hour >= 12:
            local_midnight = local_midnight + timedelta(days=1)

        # 24-hour window centered on midnight (noon to noon)
        window_start = local_midnight - timedelta(hours=12)
        window_end = local_midnight + timedelta(hours=12)

        t0 = ts.from_datetime(window_start.astimezone(ZoneInfo("UTC")))
        t1 = ts.from_datetime(window_end.astimezone(ZoneInfo("UTC")))

        location = wgs84.latlon(lat, lon)
        earth = eph['earth']
        observer = earth + location
        target = eph[eph_key]

        # Horizon adjustments
        horizon_deg = 0.0
        if obj_name == 'sun':
            horizon_deg = -0.8333
        elif obj_name == 'moon':
            horizon_deg = -0.125

        # --- Rise / Set / Transit ---
        rise_time_str = None
        set_time_str = None
        transit_time_str = None
        circumpolar = False
        never_rises = False

        try:
            rise_times, rise_real = almanac.find_risings(observer, target, t0, t1,
                                                          horizon_degrees=horizon_deg)
            if len(rise_times) > 0:
                # Find the rise closest to midnight
                best_idx = 0
                t_mid = ts.from_datetime(local_midnight.astimezone(ZoneInfo("UTC")))
                best_diff = abs(rise_times[0].tt - t_mid.tt)
                for i in range(1, len(rise_times)):
                    diff = abs(rise_times[i].tt - t_mid.tt)
                    if diff < best_diff:
                        best_diff = diff
                        best_idx = i
                utc_dt = rise_times[best_idx].utc_datetime().replace(tzinfo=ZoneInfo("UTC"))
                rise_time_str = utc_dt.astimezone(tz).isoformat()
        except Exception as e:
            print(f"Rise calculation warning: {e}")

        try:
            set_times, set_real = almanac.find_settings(observer, target, t0, t1,
                                                         horizon_degrees=horizon_deg)
            if len(set_times) > 0:
                best_idx = 0
                t_mid = ts.from_datetime(local_midnight.astimezone(ZoneInfo("UTC")))
                best_diff = abs(set_times[0].tt - t_mid.tt)
                for i in range(1, len(set_times)):
                    diff = abs(set_times[i].tt - t_mid.tt)
                    if diff < best_diff:
                        best_diff = diff
                        best_idx = i
                utc_dt = set_times[best_idx].utc_datetime().replace(tzinfo=ZoneInfo("UTC"))
                set_time_str = utc_dt.astimezone(tz).isoformat()
        except Exception as e:
            print(f"Set calculation warning: {e}")

        try:
            transit_times = almanac.find_transits(observer, target, t0, t1)
            if len(transit_times) > 0:
                best_idx = 0
                t_mid = ts.from_datetime(local_midnight.astimezone(ZoneInfo("UTC")))
                best_diff = abs(transit_times[0].tt - t_mid.tt)
                for i in range(1, len(transit_times)):
                    diff = abs(transit_times[i].tt - t_mid.tt)
                    if diff < best_diff:
                        best_diff = diff
                        best_idx = i
                utc_dt = transit_times[best_idx].utc_datetime().replace(tzinfo=ZoneInfo("UTC"))
                transit_time_str = utc_dt.astimezone(tz).isoformat()
        except Exception as e:
            print(f"Transit calculation warning: {e}")

        # --- Altitude curve: 12-hour window centered on midnight, every 15 min ---
        curve_start = local_midnight - timedelta(hours=6)
        curve_end = local_midnight + timedelta(hours=6)

        import numpy as np_riseset
        curve_start_utc = curve_start.astimezone(ZoneInfo("UTC"))
        minutes = np_riseset.arange(0, 12 * 60 + 1, 15)  # 0 to 720 inclusive, step 15
        time_array = ts.utc(
            curve_start_utc.year, curve_start_utc.month, curve_start_utc.day,
            curve_start_utc.hour, curve_start_utc.minute + minutes
        )

        astrometric = observer.at(time_array).observe(target)
        alt, az, dist = astrometric.apparent().altaz()
        altitudes = alt.degrees  # numpy array

        # Determine circumpolar / never-rises from altitude curve
        max_alt = float(np_riseset.max(altitudes))
        min_alt = float(np_riseset.min(altitudes))
        if min_alt > 0:
            circumpolar = True
        if max_alt < 0:
            never_rises = True

        # Build altitude_data list with explicit float conversion
        altitude_data = []
        for i in range(len(minutes)):
            t_local = curve_start + timedelta(minutes=int(minutes[i]))
            time_label = t_local.strftime('%H:%M')
            altitude_data.append({
                'time': time_label,
                'altitude': round(float(altitudes[i]), 2)
            })

        return jsonify({
            'object': display_name,
            'rise': rise_time_str,
            'transit': transit_time_str,
            'set': set_time_str,
            'circumpolar': circumpolar,
            'never_rises': never_rises,
            'max_altitude': round(max_alt, 2),
            'altitude_data': altitude_data
        })

    except Exception as e:
        print(f"Error computing rise/set data: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/nightsky/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({'status': 'ok', 'service': 'nightsky'})


if __name__ == '__main__':
    print("=" * 60)
    print("Night Sky Viewer API Server")
    print("=" * 60)
    print()
    print("Available endpoints:")
    print()
    print("  Sky Generation:")
    print("    POST /api/nightsky/generate - Generate sky image")
    print()
    print("  Location:")
    print("    GET  /api/nightsky/geocode?q=<location> - Geocode location")
    print("    GET  /api/nightsky/info?lat=<lat>&lon=<lon> - Location info")
    print()
    print("  Celestial Objects:")
    print("    GET  /api/nightsky/planets?lat=<lat>&lon=<lon> - Planet positions")
    print("    GET  /api/nightsky/moon?lat=<lat>&lon=<lon> - Moon info & phase")
    print("    GET  /api/nightsky/twilight?lat=<lat>&lon=<lon> - Twilight windows")
    print("    GET  /api/nightsky/riseset?lat=<lat>&lon=<lon>&object=<name> - Rise/transit/set")
    print()
    print("  Geostationary Satellites:")
    print("    GET  /api/nightsky/geostationary?lat=<lat>&lon=<lon> - Visible sats")
    print("    GET  /api/nightsky/geostationary/arc?lat=<lat>&lon=<lon> - Full arc")
    print("    GET  /api/nightsky/geostationary/lookup?lat=<lat>&lon=<lon>&sat_lon=<lon>")
    print("    GET  /api/nightsky/geostationary/satellites - List all GEO sats")
    print()
    print("  Configuration:")
    print("    GET  /api/nightsky/options - Available options")
    print("    GET  /api/nightsky/health - Health check")
    print()
    print("=" * 60)
    app.run(host='127.0.0.1', port=5051, debug=False)
