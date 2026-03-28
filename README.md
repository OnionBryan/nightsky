# Night Sky Viewer & JPSS Constellation Tracker

A dual-application platform for exploring the night sky and tracking NOAA polar-orbiting satellites in real time. The Night Sky Viewer is an interactive planetarium powered by VirtualSky with an integrated telescope mode that streams real photographic imagery from 30+ sky surveys (DSS2, Hubble, PanSTARRS, 2MASS, GALEX, Fermi, and more) via Aladin Lite. The JPSS Constellation Tracker follows NOAA-21, NOAA-20, and Suomi NPP as they orbit the Earth every 101 minutes, using SGP4-propagated orbital mechanics computed from current Two-Line Element sets. It includes an observation planner with Messier/Caldwell checklists, weather forecasts, twilight calculations, and rise/set ephemeris -- everything needed to plan and execute a real observing session.

## Screenshots

<!-- TODO: Add screenshots -->
![Night Sky Viewer](docs/screenshots/nightsky-viewer.png)
![Telescope View](docs/screenshots/telescope-view.png)
![Orbit Tracker](docs/screenshots/orbit-tracker.png)
![3D Globe](docs/screenshots/globe-view.png)
![Observation Planner](docs/screenshots/observation-planner.png)

## Features

### Night Sky Viewer

- **VirtualSky planetarium** -- interactive sky rendering with drag-to-pan and scroll-to-zoom, 7 projection modes (stereographic, fisheye, polar, Lambert, orthographic, Mollweide, free look)
- **Aladin Lite telescope view** -- streams real sky survey imagery from 30+ surveys including DSS2, SDSS, PanSTARRS, Hubble (optical + emission line), 2MASS, AllWISE, GALEX UV, Fermi gamma-ray, ROSAT X-ray
- **SIMBAD integration** -- right-click any star to resolve it through the CDS SIMBAD database; displays spectral type, magnitude, distance, radial velocity, angular size, and nearby objects
- **Catalog overlays** -- Messier (110 objects), NGC, and named bright stars plotted on the telescope view
- **Observation planner** -- Tonight's Best ranking, Messier and Caldwell checklists with progress tracking, ephemeris calculator, angular distance tool, weather forecast, constellation stories
- **Twilight bar** -- 24-hour timeline showing daylight, civil/nautical/astronomical twilight, and full night with Moon overlay and observing window summary
- **Rise/set calculator** -- altitude-over-time charts for Sun, Moon, and planets with transit times
- **Red-light mode** -- full interface shift to deep red tones to preserve dark-adapted night vision
- **Geostationary satellites** -- visible GEO satellite positions and full arc overlay
- **Time controls** -- live real-time mode, +/-1h and +/-1d jumps, manual datetime entry
- **Geocoding** -- city name search, direct coordinate entry, or browser GPS with reverse geocoding
- **Advanced controls** -- star magnitude limit (1-8), field of view (20-120 degrees), star size scaling, normal/negative color schemes

### JPSS Constellation Tracker

- **JPSS constellation** -- tracks NOAA-21 (JPSS-2), NOAA-20 (JPSS-1), and Suomi NPP with per-satellite color coding
- **SGP4 propagation** -- real-time orbital mechanics from CelesTrak TLE data, auto-refreshed every 6 hours
- **Dual 2D projections** -- D3-powered polar azimuthal equidistant and equirectangular map projections, toggled with M key
- **3D Globe** -- WebGL Earth rendering via globe.gl with satellite position, trail, prediction arc, and VIIRS swath projected on the surface
- **VIIRS swath visualization** -- 3,060 km instrument swath drawn along the ground track
- **Constellation mode** -- simultaneous view of all three JPSS satellites with phasing visualization
- **24-hour coverage** -- full-day ground track showing the sinusoidal polar orbit pattern and westward drift
- **Time Machine** -- historical/future playback with configurable start time, duration (1-24h), speed (10x-3600x), and scrub bar
- **Day/night terminator** -- real-time solar terminator overlay on all 2D map views
- **SIMBAD region queries** -- search astronomical objects in a sky region from the orbit backend
- **HiPS2FITS cutout service** -- retrieve sky survey image cutouts for any coordinates
- **Orbital parameters** -- live display of inclination, altitude, period, orbit number, velocity, and geographic position
- **Keyboard shortcuts** -- Space (play/pause), +/- (zoom), 0 (reset), R (refresh), M (toggle projection)

## Quick Start

```bash
git clone https://github.com/OnionBryan/nightsky.git
cd nightsky
./install.sh
./start.sh
```

The start script launches all four services and opens both frontends in your browser.

## Requirements

- Python 3.10+
- Modern web browser (Chrome, Firefox, Safari, Edge)
- Internet connection (for TLE data, sky survey tiles, geocoding, and SIMBAD queries)

## Architecture

The platform runs four services managed by a single startup script:

| Service | Port | Description |
|---|---|---|
| Orbit API | :5050 | Flask backend for SGP4 propagation, TLE management, SIMBAD proxying, and HiPS2FITS cutouts |
| Night Sky API | :5051 | Flask backend for sky image generation, geocoding, planet/Moon/twilight calculations, geostationary satellites, aurora Kp index, and light pollution data |
| Orbit Frontend | :8080 | D3 + globe.gl satellite tracker UI |
| Night Sky Frontend | :8081 | VirtualSky + Aladin Lite planetarium and observation planner UI |

Both backends use virtual environments with dependencies installed from their respective `requirements.txt` files. The frontends are served as static files via Python's built-in HTTP server.

## API Reference

### Orbit API (port 5050)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/satellites` | List available satellites and default selection |
| GET | `/api/tle` | Current TLE data and orbital metadata for a satellite |
| GET | `/api/current` | Current or historical satellite position (lat, lon, alt, velocity) |
| GET | `/api/track` | Ground track positions over a time range with configurable step |
| GET | `/api/orbit-info` | Orbital parameters (inclination, period, altitude, eccentricity) |
| GET | `/api/swath` | Current VIIRS swath polygon |
| GET | `/api/polar-crossings` | Polar crossing times and locations |
| GET | `/api/coverage` | Coverage analysis over a time window |
| GET | `/api/constellation/current` | Current positions of all JPSS satellites simultaneously |
| GET | `/api/simbad/region` | Query SIMBAD for astronomical objects in a sky region |
| GET | `/api/simbad/resolve` | Resolve an object name to coordinates via SIMBAD |
| GET | `/api/surveys` | List available HiPS sky surveys |
| GET | `/api/cutout` | Retrieve a sky survey image cutout for given coordinates |
| GET | `/api/cutout/multi` | Retrieve cutouts from multiple surveys simultaneously |

All satellite endpoints accept a `?satellite=` query parameter (`noaa21`, `noaa20`, or `suomi`).

### Night Sky API (port 5051)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/nightsky/generate` | Generate a sky image (PNG/SVG/JPEG) for given location, direction, and options |
| GET | `/api/nightsky/geocode` | Convert city name to coordinates via Nominatim |
| GET | `/api/nightsky/options` | List available themes, directions, and feature toggles |
| GET | `/api/nightsky/planets` | Visible planets with current positions and magnitudes |
| GET | `/api/nightsky/moon` | Moon phase, illumination, position, and rise/set times |
| GET | `/api/nightsky/info` | Location info including local time and nighttime status |
| GET | `/api/nightsky/geostationary` | Visible geostationary satellites for a location |
| GET | `/api/nightsky/geostationary/arc` | Full geostationary arc data |
| GET | `/api/nightsky/geostationary/lookup` | Look angles for a specific geostationary satellite |
| GET | `/api/nightsky/geostationary/satellites` | Geostationary satellite catalog with categories |
| GET | `/api/nightsky/twilight` | Twilight times and darkness windows for a location |
| GET | `/api/nightsky/riseset` | Rise, transit, and set times with altitude curves |
| GET | `/api/nightsky/health` | Backend health check |
| GET | `/api/satellites/tle` | Proxy for satellite TLE data |
| GET | `/api/aurora/kp` | Current aurora Kp index from NOAA SWPC |
| GET | `/api/lightpollution` | Light pollution / Bortle class estimate for a location |

## Python Dependencies

### Orbit Backend

- sgp4 -- SGP4/SDP4 orbital propagation (Vallado implementation)
- skyfield -- high-precision astronomical computations
- flask, flask-cors -- API server
- numpy -- numerical computing
- requests -- HTTP client for TLE fetching and SIMBAD queries
- python-dateutil -- datetime parsing

### Night Sky Backend

- flask, flask-cors -- API server
- skyfield -- astronomical computations for planets, Moon, twilight
- starplot -- sky chart generation
- timezonefinder -- timezone lookup from coordinates
- geopy -- geocoding
- numpy -- numerical computing
- requests -- HTTP client for external API proxying

## Credits and Acknowledgments

This project depends on the work of many people and institutions:

- **VirtualSky** by Stuart Lowe, Las Cumbres Observatory -- interactive planetarium engine (GPL v3)
- **Aladin Lite** by the Centre de Donnees astronomiques de Strasbourg (CDS) -- HiPS sky survey viewer (GPL v3)
- **Skyfield** by Brandon Rhodes -- astronomical computation library (MIT)
- **SGP4** based on the work of David Vallado -- orbital propagation algorithm (MIT)
- **CelesTrak** maintained by Dr. T.S. Kelso -- Two-Line Element set data source
- **SIMBAD** by CDS, Strasbourg -- astronomical object database
- **NASA GIBS** -- satellite imagery tiles
- **HiPS2FITS** by CDS -- sky survey cutout service
- **Sky survey data** from NASA (Hubble, Fermi, GALEX), ESA, Sloan Digital Sky Survey, PanSTARRS (University of Hawaii), 2MASS (UMass/IPAC), ROSAT, the Digitized Sky Survey (STScI/AAO/UK-PPARC), WISE/NEOWISE
- **D3.js** -- map projections and data visualization
- **globe.gl** -- WebGL 3D Earth rendering
- **Chart.js** -- rise/set altitude plots and weather charts
- **Open-Meteo** -- weather forecast data
- **OpenStreetMap Nominatim** -- geocoding service

## License

This project is licensed under the **GNU General Public License v3.0** (GPL-3.0), as required by the VirtualSky and Aladin Lite dependencies.

See [LICENSE](LICENSE) for the full text.
