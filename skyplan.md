# NOAA-21 Orbital Visualization - Complete Technical Plan

## Project Overview

Build a polar-centered azimuthal equidistant projection (UN flag style) showing NOAA-21's orbit with real TLE data, accurate SGP4 propagation, and two visualization modes.

**Architecture:** Python Backend + D3.js Frontend

---

## Why This Architecture Split

### Python Backend Rationale
- **SGP4 orbital mechanics is computationally serious** - Python's `sgp4` library is compiled from David Vallado's official C++ implementation (AIAA 2006-6753)
- **TLE epoch accuracy** - Need proper time handling and coordinate transforms (TEME → geodetic)
- **Validated libraries** - `sgp4` and `skyfield` are battle-tested for satellite tracking

### D3.js Frontend Rationale
- **Projection excellence** - `geoAzimuthalEquidistant()` with `.rotate([0,-90])` for North Pole center
- **Animation capabilities** - Smooth interpolation and time-based rendering
- **Vector graphics** - Clean scaling at any resolution

---

## Folder Structure

```
noaa21_orbit/
├── backend/
│   ├── requirements.txt          # sgp4, skyfield, flask, numpy
│   ├── orbit_propagator.py       # SGP4 propagation engine
│   ├── tle_fetcher.py            # Fetch current TLE from CelesTrak
│   ├── coordinate_transforms.py  # TEME → ECEF → Geodetic (lat/lon)
│   └── server.py                 # Flask API serving positions
├── frontend/
│   ├── index.html                # Main tabbed interface
│   ├── css/
│   │   └── styles.css            # Deep rich colors, dark theme
│   ├── js/
│   │   ├── projection.js         # D3 azimuthal equidistant setup
│   │   ├── orbit-renderer.js     # Ground track drawing
│   │   ├── spotlight.js          # VIIRS swath visualization (3060km width)
│   │   ├── animation.js          # Time controls, playback
│   │   └── app.js                # Tab switching, state management
│   └── data/
│       └── world-110m.json       # TopoJSON for landmasses
├── skyplan.md                    # This documentation file
└── README.md                     # Quick start guide
```

---

## NOAA-21 Satellite Technical Specifications

### Identification
- **NORAD Catalog ID:** 54234
- **International Designator:** 2022-150A
- **Common Name:** NOAA-21 (also known as JPSS-2)
- **Launch Date:** November 10, 2022

### Current TLE Data (Reference)
```
NOAA 21
1 54234U 22150A   25312.76922524  .00000200  00000-0  11573-3 0  9990
2 54234  98.7406 249.5105 0002692  99.1419 261.0062 14.19509228155270
```

### TLE Line 1 Breakdown
| Field | Value | Meaning |
|-------|-------|---------|
| Catalog Number | 54234 | NORAD ID |
| Classification | U | Unclassified |
| Int'l Designator | 22150A | 2022, launch 150, piece A |
| Epoch | 25312.76922524 | Day 312 of 2025, fractional day |
| First Derivative | .00000200 | Mean motion change (rev/day²) |
| Second Derivative | 00000-0 | Mean motion acceleration |
| BSTAR | 11573-3 | Drag term (0.00011573) |
| Element Set | 999 | Set number |
| Checksum | 0 | Line checksum |

### TLE Line 2 Breakdown
| Field | Value | Meaning |
|-------|-------|---------|
| Inclination | 98.7406° | Sun-synchronous polar orbit |
| RAAN | 249.5105° | Right Ascension of Ascending Node |
| Eccentricity | 0.0002692 | Nearly circular |
| Arg of Perigee | 99.1419° | Orientation in orbital plane |
| Mean Anomaly | 261.0062° | Position along orbit |
| Mean Motion | 14.19509228 | Revolutions per day |
| Revolution Number | 15527 | Orbits since launch |

### Derived Orbital Parameters
- **Semi-major axis:** ~7,209 km (Earth radius + altitude)
- **Altitude:** ~833 km above Earth's surface
- **Orbital Period:** ~101.39 minutes (1440 / 14.195 rev/day)
- **Ground Track Repeat:** ~16 days
- **Equator Crossing Time:** ~13:30 local time (afternoon)

---

## VIIRS Instrument Specifications

### Visible Infrared Imaging Radiometer Suite (VIIRS)
- **Swath Width:** 3,060 km
- **Field of Regard:** 112.56°
- **Nadir Spatial Resolution:** 375m (I-bands), 750m (M-bands)
- **Spectral Range:** 0.412 μm to 12.01 μm (22 bands)

### Swath Visualization Parameters
- **Half-swath (spotlight radius):** 1,530 km from nadir
- **Angular half-width:** 56.28° from nadir
- **At equator:** Swath spans ~27.5° of longitude
- **At poles:** Overlapping coverage (complete polar coverage)

---

## Coordinate Transformation Pipeline

```
TLE → SGP4 → TEME (ECI) → ECEF → Geodetic (lat/lon/alt)
```

### Reference Frames Explained

#### TEME (True Equator Mean Equinox)
- What SGP4 directly outputs
- Earth-Centered Inertial (ECI) frame
- X-axis points toward mean vernal equinox
- Z-axis aligned with true celestial pole
- Does NOT rotate with Earth

#### ECEF (Earth-Centered Earth-Fixed)
- Rotates with Earth
- X-axis through prime meridian (0° longitude)
- Z-axis through geographic North Pole
- Required for ground track calculation

#### Geodetic Coordinates
- Latitude: -90° to +90°
- Longitude: -180° to +180°
- Altitude: km above WGS84 ellipsoid

### Transformation Mathematics

#### TEME to ECEF
```python
# Greenwich Mean Sidereal Time (GMST) calculation
def gmst_from_jd(jd):
    """Calculate GMST in radians from Julian Date"""
    T = (jd - 2451545.0) / 36525.0  # Julian centuries from J2000
    gmst_sec = 67310.54841 + (876600*3600 + 8640184.812866)*T + 0.093104*T**2 - 6.2e-6*T**3
    gmst_rad = (gmst_sec % 86400) / 86400 * 2 * pi
    return gmst_rad

# Rotation matrix
def teme_to_ecef(r_teme, gmst):
    """Rotate TEME position to ECEF"""
    cos_g = cos(gmst)
    sin_g = sin(gmst)
    x_ecef = cos_g * r_teme[0] + sin_g * r_teme[1]
    y_ecef = -sin_g * r_teme[0] + cos_g * r_teme[1]
    z_ecef = r_teme[2]
    return [x_ecef, y_ecef, z_ecef]
```

#### ECEF to Geodetic (Iterative Method)
```python
def ecef_to_geodetic(x, y, z):
    """Convert ECEF (km) to geodetic (lat, lon, alt)"""
    a = 6378.137  # WGS84 semi-major axis (km)
    e2 = 0.00669437999014  # WGS84 eccentricity squared

    lon = atan2(y, x)
    p = sqrt(x**2 + y**2)

    # Iterative latitude calculation
    lat = atan2(z, p * (1 - e2))  # Initial guess
    for _ in range(10):
        N = a / sqrt(1 - e2 * sin(lat)**2)
        lat = atan2(z + e2 * N * sin(lat), p)

    N = a / sqrt(1 - e2 * sin(lat)**2)
    alt = p / cos(lat) - N

    return degrees(lat), degrees(lon), alt
```

---

## SGP4 Propagation Details

### Library: `sgp4` (Python)
- Compiled from David Vallado's C++ reference implementation
- AIAA 2006-6753 standard
- Handles deep space and near-Earth modes automatically

### Usage Pattern
```python
from sgp4.api import Satrec, jday

# Parse TLE
satellite = Satrec.twoline2rv(tle_line1, tle_line2)

# Propagate to specific time (Julian Date)
jd, fr = jday(year, month, day, hour, minute, second)
e, r, v = satellite.sgp4(jd, fr)

# r = position in TEME (km): [x, y, z]
# v = velocity in TEME (km/s): [vx, vy, vz]
# e = error code (0 = success)
```

### Time Handling
- TLE epoch is in UTC
- SGP4 expects Julian Date (fractional days since Jan 1, 4713 BC)
- Always propagate in UTC, convert to local time only for display

---

## D3.js Projection Configuration

### Azimuthal Equidistant (UN Flag Style)
```javascript
const projection = d3.geoAzimuthalEquidistant()
    .rotate([0, -90])           // North Pole at center
    .scale(width / 2.5)         // Fill viewport appropriately
    .translate([width/2, height/2])
    .clipAngle(180);            // Show entire Earth disc
```

### Properties of This Projection
- **Center:** North Pole (lat 90°, lon 0°)
- **Distances from center:** Preserved (equidistant)
- **Directions from center:** Preserved (azimuthal)
- **Shape/Area:** Increasingly distorted away from center
- **Perfect for:** Polar-orbiting satellite tracks

### Swath Circle Rendering
The VIIRS swath must be rendered as a **geodesic circle**, not a screen-space circle:

```javascript
function geodesicCircle(center, radiusKm) {
    const earthRadius = 6371; // km
    const angularRadius = radiusKm / earthRadius * (180 / Math.PI);

    return d3.geoCircle()
        .center(center)      // [lon, lat]
        .radius(angularRadius)
        .precision(1)();
}
```

---

## API Endpoints Specification

### GET /api/tle
Returns current TLE data and metadata.
```json
{
    "tle_line1": "1 54234U 22150A...",
    "tle_line2": "2 54234  98.7406...",
    "epoch": "2025-11-08T18:27:41Z",
    "age_hours": 12.5,
    "source": "celestrak"
}
```

### GET /api/current
Returns current satellite position.
```json
{
    "latitude": 45.234,
    "longitude": -122.456,
    "altitude_km": 833.2,
    "velocity_km_s": 7.45,
    "timestamp": "2025-01-25T14:30:00Z",
    "orbit_number": 15542,
    "is_sunlit": true
}
```

### GET /api/track?start={ISO}&end={ISO}&step={seconds}
Returns array of positions for ground track rendering.
```json
{
    "positions": [
        {"lat": 45.234, "lon": -122.456, "alt": 833.2, "time": "2025-01-25T14:30:00Z"},
        {"lat": 45.567, "lon": -121.789, "alt": 833.1, "time": "2025-01-25T14:31:00Z"}
    ],
    "step_seconds": 60,
    "total_points": 90
}
```

### GET /api/coverage?duration={minutes}
Returns coverage data for accumulated view.
```json
{
    "swath_polygons": [
        {"coordinates": [...], "time_start": "...", "time_end": "..."}
    ],
    "duration_minutes": 1440,
    "coverage_percent": 94.2
}
```

---

## Two Visualization Modes

### Mode 1: Live Spotlight
- **Satellite marker:** Pulsing dot at current position
- **VIIRS swath:** Semi-transparent circle (1530km radius)
- **Ground track trail:** Last N minutes with fade effect
- **Update frequency:** Every 1 second
- **Velocity vector:** Optional arrow showing direction

### Mode 2: Accumulated Coverage
- **Coverage painting:** Swath stripes accumulate over time
- **Heatmap:** Intensity shows overlap (polar regions brighter)
- **Time scrubber:** Slider to see coverage build up
- **Statistics:** % of Earth covered, overlap regions

---

## Color Scheme (Deep Rich Dark Theme)

```css
:root {
    /* Backgrounds */
    --bg-primary: #0a0a12;        /* Near black with blue tint */
    --bg-secondary: #12121f;      /* Slightly lighter */
    --bg-card: #1a1a2e;           /* Card backgrounds */

    /* Map Colors */
    --ocean: #0d1b2a;             /* Deep navy */
    --land: #1b263b;              /* Slate blue-gray */
    --land-stroke: #415a77;       /* Land borders */
    --graticule: rgba(65, 90, 119, 0.3);  /* Grid lines */

    /* Orbit Visualization */
    --orbit-track: #00d4ff;       /* Cyan ground track */
    --orbit-track-fade: rgba(0, 212, 255, 0.3);  /* Faded trail */
    --swath-fill: rgba(0, 212, 255, 0.15);       /* Transparent swath */
    --swath-stroke: rgba(0, 212, 255, 0.5);      /* Swath border */
    --satellite: #ff6b6b;         /* Coral red satellite dot */
    --satellite-pulse: rgba(255, 107, 107, 0.4); /* Pulse ring */

    /* Coverage Heatmap */
    --coverage-low: #7209b7;      /* Purple - single pass */
    --coverage-mid: #3a0ca3;      /* Blue-purple - overlap */
    --coverage-high: #4361ee;     /* Blue - high overlap */

    /* UI Elements */
    --text-primary: #e0e1dd;
    --text-secondary: #778da9;
    --accent: #00d4ff;
    --accent-hover: #00a8cc;

    /* Tab Colors */
    --tab-active: #00d4ff;
    --tab-inactive: #415a77;
}
```

---

## Implementation Phases

### Phase 1: Backend Foundation
1. **tle_fetcher.py** - Download and parse TLE from CelesTrak
2. **coordinate_transforms.py** - TEME→Geodetic math with WGS84
3. **orbit_propagator.py** - Wrap sgp4, generate position time series
4. **server.py** - Flask endpoints with CORS

### Phase 2: Frontend Projection
1. Set up D3 azimuthal equidistant centered on North Pole
2. Load and render world TopoJSON landmasses
3. Apply dark theme styling
4. Add graticule (lat/lon grid)

### Phase 3: Orbit Rendering
1. Fetch and plot ground track from backend
2. Animate satellite marker along track
3. Draw VIIRS swath as geodesic circle
4. Handle orbital discontinuities (wrap-around)

### Phase 4: Dual Mode + Polish
1. Tab switching between Live/Accumulated modes
2. Accumulated mode with coverage painting
3. Legend panel with orbit statistics
4. Smooth animations and transitions
5. Time controls (pause, speed up, scrub)

---

## Data Sources and References

### TLE Data
- **Primary:** CelesTrak (https://celestrak.org/NORAD/elements/)
  - No authentication required
  - Updates multiple times daily
  - Endpoint: `https://celestrak.org/NORAD/elements/gp.php?CATNR=54234&FORMAT=TLE`

- **Backup:** Space-Track.org (https://space-track.org)
  - Requires free account
  - Official NORAD source
  - More historical data available

### Map Data
- **World boundaries:** Natural Earth (https://www.naturalearthdata.com/)
- **TopoJSON:** world-110m.json from topojson/world-atlas
- **Resolution:** 110m scale (good balance of detail vs file size)

### Verification Resources
- **N2YO:** https://www.n2yo.com/satellite/?s=54234 (real-time comparison)
- **Heavens-Above:** https://heavens-above.com (pass predictions)
- **CelesTrak:** https://celestrak.org/cesium/orbit-viz.php (3D visualization)

---

## Technical Notes and Gotchas

### Orbital Mechanics
1. **TLE epoch decay:** TLEs become less accurate over time (use TLE < 7 days old)
2. **Propagation limits:** SGP4 accurate for ~1-2 weeks from epoch
3. **Polar crossing:** Satellite alternates ascending (N-bound) and descending (S-bound) passes

### Coordinate Systems
1. **Longitude wrapping:** Handle -180/+180 discontinuity in ground track
2. **Polar singularity:** Longitude undefined at poles (use small epsilon)
3. **Altitude variation:** Slight variation due to eccentricity (~2.7km peak-to-peak)

### Visualization
1. **Swath at poles:** Appears larger in azimuthal projection (correct behavior)
2. **Ground track crossings:** Lines may overlap near poles
3. **Animation smoothness:** Interpolate between positions for smooth motion

---

## Dependencies

### Python Backend (requirements.txt)
```
sgp4>=2.22
skyfield>=1.46
flask>=2.3
flask-cors>=4.0
numpy>=1.24
requests>=2.31
python-dateutil>=2.8
```

### Frontend (CDN)
```html
<script src="https://d3js.org/d3.v7.min.js"></script>
<script src="https://unpkg.com/topojson-client@3"></script>
```

---

## SQLite Database Schema (Optional Caching)

```sql
-- TLE cache to reduce API calls
CREATE TABLE tle_cache (
    id INTEGER PRIMARY KEY,
    norad_id INTEGER NOT NULL,
    tle_line1 TEXT NOT NULL,
    tle_line2 TEXT NOT NULL,
    epoch DATETIME NOT NULL,
    fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    source TEXT DEFAULT 'celestrak'
);

-- Position cache for frequently requested tracks
CREATE TABLE position_cache (
    id INTEGER PRIMARY KEY,
    norad_id INTEGER NOT NULL,
    timestamp DATETIME NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    altitude_km REAL NOT NULL,
    velocity_km_s REAL,
    UNIQUE(norad_id, timestamp)
);

CREATE INDEX idx_position_time ON position_cache(norad_id, timestamp);
```

---

## Testing Checklist

### Backend Tests
- [ ] TLE fetcher retrieves valid data from CelesTrak
- [ ] Coordinate transforms match reference values
- [ ] Position at TLE epoch matches TLE mean anomaly
- [ ] API returns valid JSON with correct structure

### Frontend Tests
- [ ] Map renders correctly centered on North Pole
- [ ] Ground track displays without gaps
- [ ] Swath circle scales correctly at different latitudes
- [ ] Tab switching works smoothly
- [ ] Time controls function correctly

### Integration Tests
- [ ] Live position matches N2YO within ~10km
- [ ] Orbital period calculated correctly (~101 min)
- [ ] 14+ ground tracks visible per day
- [ ] Swath covers ~3060km at equator

---

## Future Enhancements

### ✅ Completed: Multiple Satellites
Track NOAA-21, NOAA-20, and Suomi NPP (JPSS constellation) with color-coded markers.

### ✅ Completed: Day/Night Terminator
Show sunlit vs dark side of Earth with solar terminator line.

#### Solar Position Calculation
```javascript
// Calculate subsolar point from UTC time
function getSolarPosition(date) {
    const now = date || new Date();
    const currentTime = now.getTime();

    // Days since J2000.0 epoch (Jan 1, 2000 12:00 UTC)
    const days = (currentTime / 86400000) + 2440587.5 - 2451545;

    // Solar declination (latitude where sun is directly overhead)
    // Ranges from -23.44° (winter solstice) to +23.44° (summer solstice)
    const declination = 23.44 * Math.sin((2 * Math.PI / 365.25) * (days - 81));

    // Hour angle (longitude where sun is directly overhead)
    // Based on UTC time - sun is at 0° longitude at 12:00 UTC
    const millisecondsInDay = 86400000;
    const solarTime = (now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds()) * 1000;
    const hourAngle = 180 - (solarTime / millisecondsInDay) * 360;

    return {
        longitude: hourAngle,      // Subsolar longitude
        latitude: declination      // Subsolar latitude
    };
}
```

#### Terminator Circle
The day/night boundary is a great circle 90° from the subsolar point:
```javascript
// Dark side is a circle centered on the ANTI-solar point with radius 90°
const terminatorPath = d3.geoCircle()
    .center([sunPosition.longitude + 180, -sunPosition.latitude])
    .radius(90)
    .precision(0.1)();
```

#### Visual Styling
```css
.terminator-night {
    fill: rgba(0, 0, 30, 0.4);      /* Dark overlay for night side */
    stroke: rgba(255, 200, 100, 0.6); /* Golden terminator line */
    stroke-width: 1.5;
    pointer-events: none;
}

.sun-marker {
    fill: #ffdd44;
    filter: drop-shadow(0 0 10px rgba(255, 220, 0, 0.8));
}
```

### Pending Features
3. **Pass predictions:** When satellite visible from specific location
4. **Historical playback:** Load past TLEs for historical tracks
5. **3D visualization:** Optional WebGL globe view
