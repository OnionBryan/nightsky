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
    app.run(host='0.0.0.0', port=5051, debug=True)
