# Night Sky Viewer - Technical Documentation

## Overview
Comprehensive first-person night sky visualization tool featuring:
- Location-based sky rendering (geocoding or coordinates)
- 8 cardinal directions (N, NE, E, SE, S, SW, W, NW)
- Stars, planets, Moon, and deep sky objects
- Geostationary satellite overlay
- Reference lines (ecliptic, celestial equator, gridlines)
- Multiple visual themes and gradient backgrounds

---

## Architecture

```
nightsky/
├── backend/
│   ├── sky_generator.py       # Starplot wrapper for generating sky images
│   ├── location_utils.py      # Timezone and geocoding utilities
│   ├── geostationary_utils.py # Geostationary satellite calculations
│   └── server.py              # Flask API server (port 5051)
├── frontend/
│   ├── index.html             # Main UI
│   ├── css/styles.css         # Dark theme styling
│   └── js/app.js              # Frontend application logic
└── NIGHTSKY_PLAN.md           # This document
```

---

## Features

### Celestial Objects
| Feature | Description | Default |
|---------|-------------|---------|
| Stars | 2.5M+ stars from Big Sky Catalog | On |
| Planets | Mercury through Pluto | On |
| Moon | With phase rendering | On |
| Sun | Position marker | Off |
| Constellations | Stick figure lines | On |
| Constellation Labels | Names | On |
| Constellation Borders | IAU official boundaries | Off |
| Milky Way | Galactic band from NASA data | On |
| Messier Objects | 110 classical objects | Off |
| Deep Sky Objects | Full NGC/IC catalog | Off |

### Reference Lines
| Feature | Description |
|---------|-------------|
| Horizon | With cardinal direction labels |
| Gridlines | Altitude/azimuth coordinate grid |
| Ecliptic | Earth's orbital plane |
| Celestial Equator | Sky's equator projection |

### Geostationary Satellites
- 15+ tracked satellites (GOES, Himawari, Meteosat, communications)
- Look angle calculation from observer position
- Visibility filtering based on elevation
- Full geostationary arc visualization

---

## API Endpoints

### Sky Generation
```
POST /api/nightsky/generate
```
Generate a night sky image.

**Request Body:**
```json
{
    "latitude": 40.7128,
    "longitude": -74.0060,
    "direction": "S",
    "datetime": "2025-01-25T22:00:00",

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
    "show_horizon": true,

    "star_magnitude_limit": 5.0,
    "star_label_limit": 2.0,
    "dso_magnitude_limit": 10.0,

    "altitude_range": [0, 60],
    "resolution": 2400,

    "theme": "BLUE_DARK",
    "gradient": "TRUE_NIGHT",
    "format": "png"
}
```

**Response:** PNG/SVG/JPEG image

### Location Services
```
GET /api/nightsky/geocode?q=<location>
```
Convert city name or coordinates to location data.

```
GET /api/nightsky/info?lat=<lat>&lon=<lon>
```
Get local time and nighttime status.

### Celestial Information
```
GET /api/nightsky/planets?lat=<lat>&lon=<lon>
```
Get visible planets with altitude/azimuth.

```
GET /api/nightsky/moon?lat=<lat>&lon=<lon>
```
Get Moon phase and position.

### Geostationary Satellites
```
GET /api/nightsky/geostationary?lat=<lat>&lon=<lon>
```
Get visible geostationary satellites.

```
GET /api/nightsky/geostationary/arc?lat=<lat>&lon=<lon>
```
Get full geostationary arc for visualization.

```
GET /api/nightsky/geostationary/lookup?lat=<lat>&lon=<lon>&sat_lon=<sat_lon>
```
Calculate look angles for specific satellite.

```
GET /api/nightsky/geostationary/satellites
```
List all tracked geostationary satellites.

### Configuration
```
GET /api/nightsky/options
```
Get all available themes, gradients, and features.

---

## Starplot Library Reference

### HorizonPlot Methods
| Method | Description |
|--------|-------------|
| `stars()` | Plot stars with magnitude filtering |
| `planets()` | Display planetary positions |
| `moon()` | Plot Moon with phase |
| `sun()` | Plot Sun position |
| `constellations()` | Constellation stick figures |
| `constellation_borders()` | IAU boundaries |
| `constellation_labels()` | Constellation names |
| `milky_way()` | Galactic band |
| `messier()` | Messier catalog objects |
| `dsos()` | Full NGC/IC catalog |
| `gridlines()` | Alt/az coordinate grid |
| `ecliptic()` | Ecliptic plane |
| `celestial_equator()` | Celestial equator |
| `horizon()` | Horizon with labels |
| `marker()` | Custom markers (for satellites) |

### Style Themes
**Dark Themes:**
- BLUE_DARK, BLUE_NIGHT, BLUE_MEDIUM, BLUE_GOLD
- GRAYSCALE_DARK, NORD

**Light Themes:**
- BLUE_LIGHT, GRAYSCALE, ANTIQUE

### Gradient Backgrounds
- TRUE_NIGHT, PRE_DAWN
- ASTRONOMICAL_TWILIGHT, NAUTICAL_TWILIGHT, CIVIL_TWILIGHT
- DAYLIGHT, BOLD_SUNSET
- OPTIC_FALLOFF, OPTIC_FALL_IN

---

## Geostationary Satellite System

### Tracked Satellites
**Weather:**
- GOES-18 (137°W), GOES-16 (75.2°W) - NOAA
- Himawari-8, Himawari-9 (140.7°E) - JMA
- Meteosat-10, Meteosat-11 (0°-9.5°E) - EUMETSAT
- INSAT-3D (82°E), INSAT-3DR (74°E) - ISRO
- FY-4A (104.7°E) - CMA
- GK-2A (128.2°E) - KMA

**Communications:**
- Intelsat 901 (27.5°E)
- SES-1 (101°W)
- Galaxy 19 (97°W)
- Eutelsat 36B (36°E)
- AsiaSat 5 (100.5°E)

### Look Angle Calculation
Geostationary satellites orbit at ~35,786 km altitude above the equator. Visibility depends on observer latitude:
- Maximum visible latitude: ±81.3°
- Higher latitudes see lower elevation angles
- Arc appears across southern sky (Northern Hemisphere)

### Elevation by Latitude
| Latitude | Max Elevation |
|----------|---------------|
| 0° (Equator) | ~81° |
| 30° | ~51° |
| 45° | ~34° |
| 60° | ~12° |
| 81° | ~0° |

---

## Dependencies

### Python Backend
```
starplot>=0.10
skyfield>=1.46
flask>=2.3
flask-cors>=4.0
timezonefinder>=6.2
geopy>=2.4
numpy>=1.24
requests>=2.31
```

### Frontend (CDN-free)
- Vanilla JavaScript
- CSS Grid/Flexbox

---

## Running the Application

### Backend Server
```bash
cd nightsky/backend
python server.py
```
Server runs on port 5051.

### Frontend
Serve the frontend directory on any HTTP server (port 8080 recommended).

```bash
cd nightsky/frontend
python -m http.server 8080
```

Open `http://localhost:8080` in browser.

---

## Data Sources

- **Star Data:** Big Sky Catalog (Hipparcos + Tycho-2)
- **Constellation Lines:** Stellarium Sky & Telescope data
- **Constellation Borders:** IAU official definitions
- **Milky Way:** NASA Deep Star Maps
- **DSO Data:** OpenNGC database
- **Planetary Data:** NASA ephemeris (de421.bsp)
- **Satellite TLE:** CelesTrak

---

## Sources & References

- [Starplot Documentation](https://starplot.dev/)
- [HorizonPlot Reference](https://starplot.dev/reference-horizonplot/)
- [Starplot GitHub](https://github.com/steveberardi/starplot)
- [Skyfield Earth Satellites](https://rhodesmill.org/skyfield/earth-satellites.html)
- [CelesTrak TLE Data](https://celestrak.org/NORAD/elements/)
- [Geostationary Satellite Position Calculation - NOAA](https://geodesy.noaa.gov/CORS/Articles/SolerEisemannJSE.pdf)
- [timezonefinder PyPI](https://pypi.org/project/timezonefinder/)
- [geopy Documentation](https://geopy.readthedocs.io/)
