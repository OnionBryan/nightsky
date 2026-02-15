"""
Sky Generator - Starplot wrapper for generating night sky images

Uses starplot's HorizonPlot for first-person sky views with comprehensive
celestial object rendering including stars, planets, deep sky objects,
coordinate grids, and geostationary satellite overlays.
"""

import tempfile
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Optional, Tuple, Dict, Any, List

from starplot import HorizonPlot, Observer, _
from starplot.styles import PlotStyle, extensions

from location_utils import get_zoneinfo, get_azimuth_range, CARDINAL_DIRECTIONS


# Available style themes (Dark themes work best for night sky)
STYLE_THEMES = {
    # Dark themes
    "BLUE_DARK": extensions.BLUE_DARK,
    "BLUE_NIGHT": extensions.BLUE_NIGHT,
    "BLUE_MEDIUM": extensions.BLUE_MEDIUM,
    "BLUE_GOLD": extensions.BLUE_GOLD,
    "GRAYSCALE_DARK": extensions.GRAYSCALE_DARK,
    "NORD": extensions.NORD,
    # Light themes
    "BLUE_LIGHT": extensions.BLUE_LIGHT,
    "GRAYSCALE": extensions.GRAYSCALE,
    "ANTIQUE": extensions.ANTIQUE,
}

# All available gradient backgrounds (9 total)
GRADIENT_BACKGROUNDS = {
    # Night gradients
    "TRUE_NIGHT": extensions.GRADIENT_TRUE_NIGHT,
    "PRE_DAWN": extensions.GRADIENT_PRE_DAWN,
    # Twilight gradients
    "ASTRONOMICAL_TWILIGHT": extensions.GRADIENT_ASTRONOMICAL_TWILIGHT,
    "NAUTICAL_TWILIGHT": extensions.GRADIENT_NAUTICAL_TWILIGHT,
    "CIVIL_TWILIGHT": extensions.GRADIENT_CIVIL_TWILIGHT,
    # Day/Special gradients
    "DAYLIGHT": extensions.GRADIENT_DAYLIGHT,
    "BOLD_SUNSET": extensions.GRADIENT_BOLD_SUNSET,
    # Optic gradients (for telescope views)
    "OPTIC_FALLOFF": extensions.GRADIENT_OPTIC_FALLOFF,
    "OPTIC_FALL_IN": extensions.GRADIENT_OPTIC_FALL_IN,
}

# Deep sky object types
DSO_TYPES = {
    "galaxies": "Galaxy",
    "nebulae": "Nebula",
    "globular_clusters": "Globular Cluster",
    "open_clusters": "Open Cluster",
    "planetary_nebulae": "Planetary Nebula",
}


def create_observer(
    lat: float,
    lon: float,
    dt: Optional[datetime] = None
) -> Observer:
    """
    Create a starplot Observer for the given location and time.

    Args:
        lat: Latitude in degrees
        lon: Longitude in degrees
        dt: Optional datetime (defaults to now in local timezone)

    Returns:
        Observer object configured for the location
    """
    tz = get_zoneinfo(lat, lon)

    if dt is None:
        dt = datetime.now(tz)
    elif dt.tzinfo is None:
        # Assume UTC if no timezone
        from zoneinfo import ZoneInfo
        dt = dt.replace(tzinfo=ZoneInfo("UTC")).astimezone(tz)

    return Observer(lat=lat, lon=lon, dt=dt)


def create_style(
    theme: str = "BLUE_DARK",
    gradient: Optional[str] = "TRUE_NIGHT"
) -> PlotStyle:
    """
    Create a PlotStyle with the specified theme and gradient.

    Args:
        theme: Theme name from STYLE_THEMES
        gradient: Optional gradient name from GRADIENT_BACKGROUNDS

    Returns:
        Configured PlotStyle object
    """
    style = PlotStyle()

    # Apply theme
    if theme.upper() in STYLE_THEMES:
        style = style.extend(STYLE_THEMES[theme.upper()])

    # Apply MAP extension for horizon plots
    style = style.extend(extensions.MAP)

    # Apply gradient if specified
    if gradient and gradient.upper() in GRADIENT_BACKGROUNDS:
        style = style.extend(GRADIENT_BACKGROUNDS[gradient.upper()])

    return style


def generate_horizon_plot(
    lat: float,
    lon: float,
    direction: str = "S",
    dt: Optional[datetime] = None,
    altitude_range: Tuple[float, float] = (0, 60),
    # Star options
    show_stars: bool = True,
    star_magnitude_limit: float = 5.0,
    star_label_limit: float = 2.0,
    # Planet and Moon options
    show_planets: bool = True,
    show_moon: bool = True,
    show_sun: bool = False,  # Usually below horizon at night
    # Constellation options
    show_constellations: bool = True,
    show_constellation_labels: bool = True,
    show_constellation_borders: bool = False,
    # Deep sky object options
    show_milky_way: bool = True,
    show_messier: bool = False,
    show_dso: bool = False,  # Full NGC/IC catalog
    dso_magnitude_limit: float = 10.0,
    # Reference line options
    show_horizon: bool = True,
    show_gridlines: bool = False,
    show_ecliptic: bool = False,
    show_celestial_equator: bool = False,
    # Geostationary satellite options
    show_geostationary: bool = False,
    geo_satellites: Optional[List[Dict[str, Any]]] = None,
    # Style options
    theme: str = "BLUE_DARK",
    gradient: Optional[str] = "TRUE_NIGHT",
    resolution: int = 2400,
) -> HorizonPlot:
    """
    Generate a HorizonPlot showing the sky in a given direction.

    This is a comprehensive sky chart generator with support for:
    - Stars with magnitude filtering
    - Planets (Mercury through Pluto)
    - Moon with phase
    - Sun position
    - Constellation lines and labels
    - Constellation borders (IAU official)
    - Milky Way band
    - Messier catalog objects
    - Full DSO catalog (NGC/IC)
    - Coordinate gridlines (alt/az)
    - Ecliptic line
    - Celestial equator
    - Geostationary satellite positions

    Args:
        lat: Observer latitude
        lon: Observer longitude
        direction: Cardinal direction (N, NE, E, SE, S, SW, W, NW)
        dt: Observation datetime (defaults to now)
        altitude_range: Vertical field of view (min, max) in degrees

        show_stars: Whether to show stars
        star_magnitude_limit: Faintest stars to show (higher = fainter)
        star_label_limit: Faintest stars to label

        show_planets: Whether to show planets
        show_moon: Whether to show the Moon
        show_sun: Whether to show the Sun position

        show_constellations: Whether to show constellation lines
        show_constellation_labels: Whether to label constellations
        show_constellation_borders: Whether to show IAU constellation boundaries

        show_milky_way: Whether to show the Milky Way band
        show_messier: Whether to show Messier catalog objects
        show_dso: Whether to show full deep sky object catalog (NGC/IC)
        dso_magnitude_limit: Faintest DSOs to show

        show_horizon: Whether to show horizon line with cardinal labels
        show_gridlines: Whether to show altitude/azimuth grid
        show_ecliptic: Whether to show the ecliptic plane
        show_celestial_equator: Whether to show the celestial equator

        show_geostationary: Whether to overlay geostationary satellites
        geo_satellites: List of satellite dicts with azimuth/elevation

        theme: Color theme name
        gradient: Gradient background name
        resolution: Image resolution in pixels

    Returns:
        Configured HorizonPlot object (not yet exported)
    """
    # Create observer
    observer = create_observer(lat, lon, dt)

    # Get azimuth range for direction
    azimuth_range = get_azimuth_range(direction)

    # Create style
    style = create_style(theme, gradient)

    # Create the plot
    p = HorizonPlot(
        altitude=altitude_range,
        azimuth=azimuth_range,
        observer=observer,
        style=style,
        resolution=resolution,
        scale=0.9,
    )

    # Add celestial objects in order (back to front for proper layering)

    # 1. Background elements first
    if show_milky_way:
        p.milky_way()

    # 2. Reference lines (behind stars)
    if show_celestial_equator:
        try:
            p.celestial_equator()
        except Exception:
            pass

    if show_ecliptic:
        try:
            p.ecliptic()
        except Exception:
            pass

    if show_gridlines:
        try:
            p.gridlines()
        except Exception:
            pass

    # 3. Constellation elements
    if show_constellation_borders:
        try:
            p.constellation_borders()
        except Exception:
            pass

    if show_constellations:
        p.constellations()

    # 4. Stars
    if show_stars:
        p.stars(
            where=[_.magnitude < star_magnitude_limit],
            where_labels=[_.magnitude < star_label_limit],
        )

    # 5. Deep sky objects
    if show_messier:
        try:
            p.messier(
                where=[_.magnitude < dso_magnitude_limit],
                where_true_size=[False],
            )
        except Exception:
            pass

    if show_dso and not show_messier:
        # Full DSO catalog (NGC/IC) - more comprehensive than just Messier
        try:
            p.dsos(
                where=[_.magnitude < dso_magnitude_limit],
                where_true_size=[False],
            )
        except Exception:
            pass

    # 6. Solar system objects (on top)
    if show_planets:
        try:
            p.planets()
        except Exception:
            pass

    if show_moon:
        try:
            p.moon()
        except Exception:
            # Moon might not be visible or above horizon
            pass

    if show_sun:
        try:
            p.sun()
        except Exception:
            # Sun usually below horizon at night
            pass

    # 7. Labels (on top of objects)
    if show_constellation_labels:
        p.constellation_labels()

    # 8. Horizon line (foreground)
    if show_horizon:
        # Create labels for visible directions
        dir_upper = direction.upper()

        # Show labels at 45-degree intervals that are visible
        visible_labels = {}
        az_min, az_max = azimuth_range

        for d, info in CARDINAL_DIRECTIONS.items():
            az = info["center"]
            # Handle wrap-around for North
            if az_min < 0:
                if az >= 360 + az_min or az <= az_max:
                    visible_labels[az if az < 180 else az] = d
            elif az_min <= az <= az_max:
                visible_labels[az] = d

        p.horizon(labels=visible_labels)

    # 9. Geostationary satellites overlay
    if show_geostationary and geo_satellites:
        _overlay_geostationary_satellites(p, geo_satellites, azimuth_range, altitude_range)

    return p


def _overlay_geostationary_satellites(
    plot: HorizonPlot,
    satellites: List[Dict[str, Any]],
    azimuth_range: Tuple[float, float],
    altitude_range: Tuple[float, float]
) -> None:
    """
    Overlay geostationary satellite markers on the plot.

    Uses the plot's marker() method to add satellite positions.

    Args:
        plot: The HorizonPlot to add markers to
        satellites: List of satellite dicts with 'name', 'azimuth', 'elevation'
        azimuth_range: Current plot azimuth range
        altitude_range: Current plot altitude range
    """
    az_min, az_max = azimuth_range
    alt_min, alt_max = altitude_range

    for sat in satellites:
        az = sat.get("azimuth")
        el = sat.get("elevation")
        name = sat.get("name", "GEO")

        if az is None or el is None:
            continue

        # Check if satellite is within the plot bounds
        # Handle azimuth wrap-around
        in_az_range = False
        if az_min < 0:
            if az >= 360 + az_min or az <= az_max:
                in_az_range = True
        elif az_min <= az <= az_max:
            in_az_range = True

        in_alt_range = alt_min <= el <= alt_max

        if in_az_range and in_alt_range:
            try:
                # Add marker for satellite
                # Note: starplot uses altitude/azimuth in its coordinate system
                plot.marker(
                    az=az,
                    alt=el,
                    label=name,
                    style__marker__color="#ff6b6b",  # Coral red
                    style__marker__size=6,
                    style__label__font_size=8,
                )
            except Exception as e:
                print(f"Error adding satellite marker for {name}: {e}")


def generate_sky_image(
    lat: float,
    lon: float,
    direction: str = "S",
    dt: Optional[datetime] = None,
    output_format: str = "png",
    **kwargs
) -> bytes:
    """
    Generate a sky image and return as bytes.

    Args:
        lat: Observer latitude
        lon: Observer longitude
        direction: Cardinal direction
        dt: Observation datetime
        output_format: Image format (png, svg, jpeg)
        **kwargs: Additional arguments passed to generate_horizon_plot

    Returns:
        Image data as bytes
    """
    # Handle geostationary satellites if requested
    if kwargs.get('show_geostationary') and not kwargs.get('geo_satellites'):
        # Fetch visible geostationary satellites
        try:
            from geostationary_utils import get_visible_geo_satellites
            kwargs['geo_satellites'] = get_visible_geo_satellites(lat, lon)
        except Exception as e:
            print(f"Error fetching geostationary satellites: {e}")
            kwargs['geo_satellites'] = []

    # Generate the plot
    p = generate_horizon_plot(lat, lon, direction, dt, **kwargs)

    # Export to bytes using underlying matplotlib figure
    buffer = BytesIO()

    try:
        # Try to use the underlying figure directly
        p.fig.savefig(
            buffer,
            format=output_format,
            bbox_inches='tight',
            pad_inches=0.05,
            facecolor=p.fig.get_facecolor(),
            edgecolor='none',
            dpi=150,
        )
        buffer.seek(0)
        image_data = buffer.read()

    except Exception as e:
        print(f"Direct export failed, using temp file: {e}")
        # Fallback: use temp file
        with tempfile.NamedTemporaryFile(suffix=f'.{output_format}', delete=False) as f:
            temp_path = f.name

        p.export(temp_path, padding=0.05)
        with open(temp_path, 'rb') as f:
            image_data = f.read()

        # Clean up temp file
        Path(temp_path).unlink(missing_ok=True)

    finally:
        # Clean up matplotlib resources
        try:
            p.close_fig()
        except Exception:
            pass

    return image_data


def get_visible_planets(
    lat: float,
    lon: float,
    dt: Optional[datetime] = None
) -> Dict[str, Any]:
    """
    Get information about currently visible planets.

    Uses Skyfield for accurate planet position calculations.

    Args:
        lat: Observer latitude
        lon: Observer longitude
        dt: Observation datetime

    Returns:
        Dictionary with planet visibility information
    """
    try:
        from skyfield.api import load, wgs84

        # Load ephemeris data
        eph = load('de421.bsp')
        ts = load.timescale()

        observer_obj = create_observer(lat, lon, dt)

        if dt is None:
            t = ts.now()
        else:
            t = ts.from_datetime(observer_obj.dt)

        # Create observer position
        earth = eph['earth']
        observer = earth + wgs84.latlon(lat, lon)

        # Planets to check
        planet_names = ['mercury', 'venus', 'mars', 'jupiter barycenter', 'saturn barycenter']
        display_names = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn']

        visible_planets = []

        for planet_name, display_name in zip(planet_names, display_names):
            try:
                planet = eph[planet_name]
                astrometric = observer.at(t).observe(planet)
                alt, az, _ = astrometric.apparent().altaz()

                planet_info = {
                    'name': display_name,
                    'altitude': round(alt.degrees, 2),
                    'azimuth': round(az.degrees, 2),
                    'visible': alt.degrees > 0
                }
                visible_planets.append(planet_info)

            except Exception as e:
                print(f"Error calculating {display_name} position: {e}")

        return {
            "observer": {
                "latitude": lat,
                "longitude": lon,
                "datetime": observer_obj.dt.isoformat(),
            },
            "planets": visible_planets,
            "visible_count": len([p for p in visible_planets if p.get('visible')])
        }

    except Exception as e:
        # Fallback to basic info
        return {
            "observer": {
                "latitude": lat,
                "longitude": lon,
            },
            "planets": ["Mercury", "Venus", "Mars", "Jupiter", "Saturn"],
            "note": f"Detailed calculation unavailable: {e}"
        }


def get_moon_info(
    lat: float,
    lon: float,
    dt: Optional[datetime] = None
) -> Dict[str, Any]:
    """
    Get detailed Moon information including phase.

    Args:
        lat: Observer latitude
        lon: Observer longitude
        dt: Observation datetime

    Returns:
        Dictionary with Moon phase and position
    """
    try:
        from skyfield.api import load, wgs84
        from skyfield import almanac

        eph = load('de421.bsp')
        ts = load.timescale()

        observer_obj = create_observer(lat, lon, dt)

        if dt is None:
            t = ts.now()
        else:
            t = ts.from_datetime(observer_obj.dt)

        # Get Moon position
        earth = eph['earth']
        moon = eph['moon']
        sun = eph['sun']
        observer = earth + wgs84.latlon(lat, lon)

        astrometric = observer.at(t).observe(moon)
        alt, az, distance = astrometric.apparent().altaz()

        # Calculate phase
        phase_angle = almanac.moon_phase(eph, t)
        phase_degrees = phase_angle.degrees

        # Determine phase name
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

        # Illumination percentage (approximation)
        illumination = (1 - abs(phase_degrees - 180) / 180) * 100

        return {
            "altitude": round(alt.degrees, 2),
            "azimuth": round(az.degrees, 2),
            "distance_km": round(distance.km, 0),
            "visible": alt.degrees > 0,
            "phase": {
                "angle": round(phase_degrees, 1),
                "name": phase_name,
                "illumination": round(illumination, 1)
            }
        }

    except Exception as e:
        return {
            "error": str(e),
            "note": "Moon calculation requires skyfield ephemeris data"
        }


def list_available_options() -> Dict[str, Any]:
    """
    Return all available configuration options.

    Returns:
        Dictionary of available themes, gradients, directions, and features
    """
    return {
        "themes": list(STYLE_THEMES.keys()),
        "gradients": list(GRADIENT_BACKGROUNDS.keys()),
        "directions": list(CARDINAL_DIRECTIONS.keys()),
        "dso_types": list(DSO_TYPES.keys()),
        "features": {
            "stars": "Display stars with magnitude filtering",
            "planets": "Show planets (Mercury through Pluto)",
            "moon": "Show Moon with phase",
            "sun": "Show Sun position",
            "constellations": "Show constellation stick figures",
            "constellation_labels": "Label constellation names",
            "constellation_borders": "Show IAU constellation boundaries",
            "milky_way": "Render Milky Way band",
            "messier": "Show Messier catalog objects (110 objects)",
            "dso": "Show full DSO catalog (NGC/IC - thousands of objects)",
            "gridlines": "Show altitude/azimuth coordinate grid",
            "ecliptic": "Show ecliptic plane",
            "celestial_equator": "Show celestial equator",
            "geostationary": "Overlay geostationary satellite positions"
        },
        "defaults": {
            "theme": "BLUE_DARK",
            "gradient": "TRUE_NIGHT",
            "direction": "S",
            "star_magnitude_limit": 5.0,
            "star_label_limit": 2.0,
            "dso_magnitude_limit": 10.0,
            "resolution": 2400
        }
    }
