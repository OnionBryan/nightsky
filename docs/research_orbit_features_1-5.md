# NOAA-21 Orbit Tracker: Feature Research Document

Research findings for 5 planned features. The existing app uses:
- **Backend**: Flask on port 5050, sgp4 + python-dateutil, OrbitPropagator class, CelesTrak TLE fetching
- **Frontend**: D3.js v7 azimuthal equidistant polar projection (`PolarProjection` class) + Globe.gl 3D view (`Globe3D` class)
- **Key modules**: `orbit-renderer.js`, `terminator.js`, `spotlight.js`, `projection.js`, `globe.js`, `app.js`

---

## Feature 1: Observer Location + Next Visible Pass Prediction

### The Three-Condition Visibility Rule

A satellite is **visible to the naked eye** when all three conditions are met simultaneously:

1. **Satellite is above the observer's horizon** (elevation > 0 degrees, practically > 10 degrees for good viewing)
2. **Satellite is sunlit** (not in Earth's shadow -- at ~824 km altitude, NOAA-21 stays sunlit longer than the ground)
3. **Observer is in darkness** (Sun below horizon, ideally below -6 degrees for civil twilight)

### Algorithm: Pass Prediction with SGP4

The existing backend already has `OrbitPropagator.propagate()` and `generate_track()`. The pass prediction algorithm builds on these.

#### Step 1: Propagate in time steps, compute topocentric coordinates

For each time step, compute the satellite's **elevation** and **azimuth** from the observer:

```
Given: observer (lat_o, lon_o, alt_o), satellite ECEF position (x_s, y_s, z_s)

1. Convert observer geodetic to ECEF: (x_o, y_o, z_o)
2. Range vector: R = (x_s - x_o, y_s - y_o, z_s - z_o)
3. Rotate R into topocentric East-North-Up (ENU) frame:
   E = -sin(lon_o)*Rx + cos(lon_o)*Ry
   N = -sin(lat_o)*cos(lon_o)*Rx - sin(lat_o)*sin(lon_o)*Ry + cos(lat_o)*Rz
   U =  cos(lat_o)*cos(lon_o)*Rx + cos(lat_o)*sin(lon_o)*Ry + sin(lat_o)*Rz
4. Elevation = arctan2(U, sqrt(E^2 + N^2))
5. Azimuth = arctan2(E, N)  (measured clockwise from North)
6. Range = sqrt(E^2 + N^2 + U^2)
```

The existing `coordinate_transforms.py` already has ECEF transforms. A `topocentric_from_ecef()` function is needed.

#### Step 2: Earth shadow test (cylindrical model)

The simplest model treats Earth's shadow as a cylinder:

```
Given: satellite position r_sat (ECEF or ECI), Sun position r_sun (ECI)

1. Unit vector from Earth to Sun: s_hat = r_sun / |r_sun|
2. Projection of satellite onto Sun direction: proj = dot(r_sat, s_hat)
3. Perpendicular distance from satellite to Sun-Earth line:
   d_perp = sqrt(|r_sat|^2 - proj^2)
4. Satellite is in shadow if:
   proj < 0  AND  d_perp < R_earth (6371 km)
```

For better accuracy, use the **umbra/penumbra conical model**:

```
R_sun = 696340 km, D_sun = |r_sun| (~1 AU)
R_earth = 6371 km

Umbra half-angle: alpha_u = arcsin((R_sun - R_earth) / D_sun) ~ 0.264 degrees
Penumbra half-angle: alpha_p = arcsin((R_sun + R_earth) / D_sun) ~ 0.269 degrees

Umbra cone length: L_u = R_earth / sin(alpha_u) ~ 1,382,000 km
```

For NOAA-21 at 824 km altitude, the cylindrical model is adequate -- the difference between cylindrical and conical shadow at LEO altitude is about 30 km, which translates to less than 5 seconds of timing error.

**Skyfield shortcut**: The `is_sunlit()` method handles all of this internally. If adding Skyfield to the backend, pass prediction becomes much simpler. The existing backend uses raw sgp4 + custom coordinate transforms, so a pure-math shadow test using the cylindrical model is the path of least resistance.

#### Step 3: Observer darkness test

Use the same solar position calculation already in `terminator.js` (backend equivalent):

```
Sun altitude < -6 degrees  (civil twilight -- satellites visible)
Sun altitude < -12 degrees (nautical twilight -- best viewing)
Sun altitude < -18 degrees (astronomical twilight -- dark sky)
```

The solar position can be computed from the subsolar point (already computed in `Terminator.getSolarPosition()`), then transformed to topocentric coordinates relative to the observer.

#### Step 4: Scan algorithm

```python
def find_visible_passes(propagator, observer_lat, observer_lon, observer_alt_m,
                        start_utc, duration_hours=72, step_seconds=30):
    """
    Scan forward in time, identify contiguous intervals where:
    - satellite elevation > 10 deg (above horizon)
    - satellite is sunlit (not in Earth shadow)
    - Sun altitude at observer < -6 deg (observer in darkness)

    Coarse scan at 30-second intervals, then refine AOS/LOS to ~1 second.
    """
    passes = []
    in_pass = False
    pass_start = None
    max_el = 0
    max_el_time = None
    max_el_az = 0

    for each time step:
        el, az = compute_topocentric(sat_pos, observer)
        sunlit = is_satellite_sunlit(sat_pos, sun_pos)
        sun_alt = compute_sun_altitude(observer, time)

        visible = (el > 10) and sunlit and (sun_alt < -6)

        if visible and not in_pass:
            # AOS (Acquisition of Signal)
            pass_start = refine_boundary(time - step, time)
            in_pass = True
            max_el = el

        if visible and in_pass:
            if el > max_el:
                max_el = el
                max_el_time = time
                max_el_az = az

        if not visible and in_pass:
            # LOS (Loss of Signal)
            pass_end = refine_boundary(time - step, time)
            passes.append({...})
            in_pass = False

    return passes
```

### Data to Return per Pass

| Field | Description | Unit |
|-------|-------------|------|
| `aos_time` | Acquisition of Signal (first visible moment) | ISO 8601 UTC |
| `los_time` | Loss of Signal (last visible moment) | ISO 8601 UTC |
| `max_el_time` | Time of maximum elevation | ISO 8601 UTC |
| `max_elevation` | Peak elevation angle | degrees |
| `aos_azimuth` | Azimuth at AOS | degrees (0=N, 90=E) |
| `los_azimuth` | Azimuth at LOS | degrees |
| `max_el_azimuth` | Azimuth at peak elevation | degrees |
| `duration_seconds` | Pass duration | seconds |
| `brightness_estimate` | Estimated magnitude (for NOAA-21) | mag |
| `is_sunlit_entire_pass` | Whether satellite stays sunlit for entire pass | boolean |
| `pass_type` | "visible" / "radio_only" / "daylight" | string |

### Brightness Estimate for NOAA-21

NOAA-21 (JPSS-2) is a large satellite (dimensions ~4.2m x 2.7m x 2.4m, mass ~2,300 kg) with large solar panels. Typical visual magnitude at zenith is approximately **+2.5 to +4.0 mag**, varying with phase angle.

Standard brightness formula for diffuse spherical reflector:
```
m = m_std - 15 + 5*log10(range_km) - 2.5*log10(sin(phase_angle) + (pi - phase_angle)*cos(phase_angle))
```
Where `m_std ~ -1.3` for a standard 1 m^2 diffuse sphere at 1000 km. For NOAA-21, adjust for effective cross-section (~10 m^2 body + ~20 m^2 solar panels).

A simpler approach: use the **McCants intrinsic magnitude** database (available from celestrak or satobs.org) which lists standard magnitude at 1000 km range, 50% illumination.

### How N2YO and Heavens-Above Present This Data

**N2YO** (n2yo.com/passes):
- Table with columns: Date, Brightness (mag), Start (time/alt/az), Highest Point (time/alt/az), End (time/alt/az)
- Color-coded by brightness (bright passes highlighted)
- Sky chart showing the pass arc
- Azimuth shown as compass directions (e.g., "NNW" not "337 deg")

**Heavens-Above** (heavens-above.com):
- Table: Date, Brightness, Start (time/alt/az), Highest Point (time/alt/az), End (time/alt/az)
- Pass detail page with ground track on map + sky chart
- Separate listings for visible vs all passes
- Indicates if pass enters Earth's shadow mid-transit

### Frontend: Geocoder Input Integration

The existing nightsky backend already has `/api/nightsky/geocode?q=<location>` using geopy + Nominatim. The orbit tracker frontend needs:

1. **Location input field** in the header or a collapsible panel
2. **Uses the existing geocoder endpoint** (nightsky server on port 5051, or add a geocode endpoint to the orbit server on port 5050)
3. **Alternatively**: Use the Nominatim API directly from the frontend:
   ```
   GET https://nominatim.openstreetmap.org/search?q=Denver,CO&format=json&limit=1
   Response: [{"lat": "39.7392", "lon": "-104.9847", "display_name": "Denver, CO, USA", ...}]
   ```
   Rate limit: 1 request/second, requires `User-Agent` header.
4. **HTML5 Geolocation API** as a "Use My Location" button:
   ```javascript
   navigator.geolocation.getCurrentPosition(pos => {
       const {latitude, longitude} = pos.coords;
       // set observer location
   });
   ```
5. **Observer marker** on the D3 map: a distinct icon (e.g., crosshair or pin) at the observer's lat/lon, rendered in the markers layer.

### Backend Endpoint Design

```
GET /api/passes?satellite=noaa21&lat=39.7392&lon=-104.9847&alt=1609&hours=72&min_elevation=10

Response:
{
    "observer": {"latitude": 39.7392, "longitude": -104.9847, "altitude_m": 1609},
    "satellite": "noaa21",
    "passes": [
        {
            "aos_time": "2026-03-27T02:15:32Z",
            "los_time": "2026-03-27T02:21:47Z",
            "max_el_time": "2026-03-27T02:18:40Z",
            "max_elevation": 54.3,
            "aos_azimuth": 315.2,
            "los_azimuth": 142.8,
            "max_el_azimuth": 45.1,
            "duration_seconds": 375,
            "brightness_estimate": 3.2,
            "type": "visible"
        },
        ...
    ],
    "count": 8,
    "search_window_hours": 72
}
```

### Dependencies

- No new Python packages needed if using pure-math shadow calculation
- If using Skyfield: add `skyfield>=1.46` to requirements (already in nightsky backend, not in orbit backend)
- Sun position: use the `de421.bsp` ephemeris file (already present in nightsky backend at `nightsky/backend/de421.bsp`)

### Gotchas and Edge Cases

- **Polar observers** (lat > 66.5): During polar summer, the Sun never sets far below the horizon, so visible passes may not occur for weeks. During polar winter, passes can occur at any time of day since it's always dark.
- **Time steps**: 30 seconds is adequate for coarse scan. NOAA-21 crosses the sky in ~10 minutes max, so a 30-second step won't miss a short pass. Refine AOS/LOS with bisection to ~1 second.
- **TLE age**: Timing accuracy degrades ~1 km/day. For passes 72 hours out, AOS/LOS times may be off by 10-30 seconds. Display a "TLE age" warning if > 3 days old.
- **Atmospheric refraction**: The atmosphere bends light, making objects appear ~0.5 degrees higher than geometric position near the horizon. For low-elevation passes, this shifts AOS/LOS by a few seconds. Can ignore for 10-degree minimum elevation.
- **NOAA-21 specific**: Sun-synchronous orbit means visible passes cluster around dawn and dusk (the ~13:30 LTAN ascending node means evening passes in the ascending direction).

---

## Feature 2: NASA GIBS Imagery Overlay

### GIBS WMTS Endpoint

**Base URL (EPSG:4326 geographic projection):**
```
https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/
```

**RESTful tile URL template:**
```
https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/{LayerIdentifier}/default/{Time}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.{format}
```

**KVP (query string) endpoint:**
```
https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/wmts.cgi?
    SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0
    &LAYER={LayerIdentifier}
    &STYLE=default
    &TIME={YYYY-MM-DD}
    &TILEMATRIXSET={TileMatrixSet}
    &TILEMATRIX={TileMatrix}
    &TILEROW={TileRow}
    &TILECOL={TileCol}
    &FORMAT={image/jpeg or image/png}
```

**GetCapabilities:**
```
https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/WMTSCapabilities.xml
```

### Available VIIRS Layers

| Layer Identifier | Description | Format | Matrix Set | Resolution |
|-----------------|-------------|--------|------------|------------|
| `VIIRS_SNPP_CorrectedReflectance_TrueColor` | True-color from Suomi NPP | JPEG | 250m | ~250m/pixel |
| `VIIRS_NOAA20_CorrectedReflectance_TrueColor` | True-color from NOAA-20 | JPEG | 250m | ~250m/pixel |
| `VIIRS_SNPP_DayNightBand_AtSensor_M15` | Day/Night Band (thermal) | PNG | 500m | ~500m/pixel |
| `VIIRS_SNPP_DayNightBand_At_Sensor_Radiance_505nm` | DNB visible radiance | PNG | 500m | ~500m/pixel |
| `VIIRS_NOAA20_CorrectedReflectance_BandsM3-I3-M11` | False-color combo | JPEG | 250m | ~250m/pixel |
| `VIIRS_NOAA21_CorrectedReflectance_TrueColor` | True-color from NOAA-21 | JPEG | 250m | ~250m/pixel |

### Tile Matrix Sets for EPSG:4326

The `250m` tile matrix set has these zoom levels:

| TileMatrix | Scale | Tile Width | Tile Height | Matrix Width | Matrix Height | Pixel Size (deg) |
|------------|-------|------------|-------------|--------------|---------------|-------------------|
| 0 | ~2km/px | 512 | 512 | 2 | 1 | 0.3515625 |
| 1 | ~1km/px | 512 | 512 | 3 | 2 | 0.17578125 |
| 2 | ~500m/px | 512 | 512 | 5 | 3 | 0.087890625 |
| 3 | ~250m/px | 512 | 512 | 10 | 5 | 0.0439453125 |
| 4 | ~125m/px | 512 | 512 | 20 | 10 | 0.02197265625 |
| 5 | ~62m/px | 512 | 512 | 40 | 20 | 0.010986328125 |
| 6 | ~31m/px | 512 | 512 | 80 | 40 | 0.0054931640625 |
| 7 | ~15m/px | 512 | 512 | 160 | 80 | 0.00274658203125 |
| 8 | ~8m/px | 512 | 512 | 320 | 160 | 0.001373291015625 |

**Key properties:**
- Tile size: **512 x 512 pixels** (not 256 like Google Maps)
- Origin: upper-left corner at (-180, 90)
- CRS: EPSG:4326 (geographic lat/lon)
- Tiles are in row-major order

The `2km` tile matrix set stops at lower zoom levels (used for data layers, not imagery).

### Date Parameter

- Format: `YYYY-MM-DD` (e.g., `2026-03-27`)
- Imagery is typically available **within 3-5 hours** of satellite overpass
- No imagery for future dates
- Some layers have gaps if no overpass covered that area on that date
- Use `/api/data_availability/` or just try the tile and handle 404s

### Example Tile URL

```
https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/2026-03-26/250m/3/2/8.jpg
```

### Overlaying WMTS Tiles on D3.js Map

D3 does not natively support raster tile layers. Two approaches:

**Approach A: d3-tile library (recommended)**

```javascript
import {tile} from 'd3-tile';

// Configure the tile layout for EPSG:4326
const tiler = tile()
    .size([width, height])
    .scale(projection.scale() * 2 * Math.PI)
    .translate(projection([0, 0]));

// Get visible tiles
const tiles = tiler();

// Render tiles as <image> elements in the SVG
const images = g.selectAll('image.gibs-tile')
    .data(tiles, d => `${d[0]}-${d[1]}-${d[2]}`);

images.enter().append('image')
    .attr('class', 'gibs-tile')
    .attr('xlink:href', d => {
        const [x, y, z] = d;
        return `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/` +
               `VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${date}/250m/${z}/${y}/${x}.jpg`;
    })
    .attr('x', d => d.x)
    .attr('y', d => d.y)
    .attr('width', d => d.width)
    .attr('height', d => d.height)
    .style('opacity', 0.7);
```

**Challenge**: The existing projection is **azimuthal equidistant**, not Mercator. WMTS tiles are in EPSG:4326 (equirectangular grid). These don't align directly. Options:

1. **Canvas reprojection**: For each visible GIBS tile, draw it onto an off-screen canvas, then sample pixels and reproject them into the azimuthal equidistant space. Expensive but correct.
2. **Use only with equirectangular projection** (see Feature 4): GIBS tiles align naturally with `d3.geoEquirectangular()`. This is the simplest and recommended approach.
3. **Single background image**: Fetch a pre-rendered GIBS snapshot image and use it as a background texture in the SVG, applying a CSS clip-path. NASA provides a "snapshot" API for this.

**Practical recommendation**: Enable GIBS imagery overlay only when the equirectangular projection is active (Feature 4). In polar azimuthal mode, the tile reprojection cost is not worth it.

### Overlaying on Globe.gl (3D)

Globe.gl supports custom globe textures via `.globeImageUrl()`. For GIBS:

```javascript
// Option 1: Single composite image from GIBS snapshot
const date = '2026-03-26';
const snapshotUrl = `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/` +
    `VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${date}/250m/0/0/0.jpg`;
// But this is just one tile (low res). Need to composite.

// Option 2: Use Worldview snapshot API for a full equirectangular image
// https://wvs.earthdata.nasa.gov/api/v1/snapshot?
//   REQUEST=GetSnapshot&LAYERS=VIIRS_SNPP_CorrectedReflectance_TrueColor
//   &CRS=EPSG:4326&BBOX=-180,-90,180,90&WIDTH=4096&HEIGHT=2048
//   &TIME=2026-03-26&FORMAT=image/jpeg

const gibsTextureUrl = `https://wvs.earthdata.nasa.gov/api/v1/snapshot?` +
    `REQUEST=GetSnapshot&LAYERS=VIIRS_SNPP_CorrectedReflectance_TrueColor` +
    `&CRS=EPSG:4326&BBOX=-180,-90,180,90&WIDTH=4096&HEIGHT=2048` +
    `&TIME=${date}&FORMAT=image/jpeg`;

globe.globeImageUrl(gibsTextureUrl);
```

**Option 2 is the best approach for Globe.gl** -- the Worldview Snapshot API returns a single equirectangular image that can be used directly as a globe texture.

### Matching Satellite Pass Time to Imagery Date

NOAA-21 is sun-synchronous with ~13:30 LTAN (ascending node). For a given location:
- **Daytime pass**: imagery available same day
- **Nighttime pass**: DNB imagery (if available) same night
- The GIBS date parameter is the UTC date of the observation
- VIIRS true-color is only from daytime overpasses (needs sunlight to reflect)
- DNB can show nighttime imagery (city lights, fires, etc.)

Match logic: use the satellite pass time, convert to UTC date, request that date from GIBS. If the imagery isn't available yet (3-5 hour processing delay), fall back to the previous day.

### Gotchas

- **CORS**: GIBS tiles do support CORS, so direct browser fetch works.
- **No API key required**: GIBS is free and open, no authentication needed.
- **512px tiles**: Unlike Google/OSM (256px), GIBS uses 512px tiles. Tile coordinate math must account for this.
- **Polar regions**: True-color VIIRS imagery has gaps at the poles (no sunlight in polar winter). The polar azimuthal projection will show these gaps prominently.
- **Date gaps**: Cloud-covered regions show as white. Days without overpass show as black/transparent tiles (404 response).

---

## Feature 3: Ascending/Descending Node Markers on Ground Track

### Existing Backend Data

The `/api/polar-crossings` endpoint already exists and returns:

```json
{
    "ascending_nodes": [
        {"time": "2026-03-27T01:23:45+00:00", "longitude": -45.123},
        {"time": "2026-03-27T03:05:12+00:00", "longitude": -67.891},
        ...
    ],
    "descending_nodes": [
        {"time": "2026-03-27T02:14:33+00:00", "longitude": -12.456},
        ...
    ]
}
```

The backend `find_polar_crossings()` method in `orbit_propagator.py` (lines 163-198) propagates at 30-second steps, detects equator crossings by checking when latitude changes sign, and returns the crossing time and longitude.

### Ascending vs Descending Node Semantics for NOAA-21

NOAA-21 is in a **sun-synchronous orbit** with:
- **Inclination**: ~98.7 degrees
- **LTAN (Local Time of Ascending Node)**: ~13:30

This means:
- **Ascending node** (northbound equator crossing): occurs at ~13:30 local solar time = **daytime pass**. The satellite moves from the southern hemisphere toward the north pole.
- **Descending node** (southbound equator crossing): occurs at ~01:30 local solar time = **nighttime pass**. The satellite moves from the northern hemisphere toward the south pole.

The ascending/descending designation is from the satellite's latitude direction, NOT whether it's going up or down in altitude.

### Rendering on the D3 Map

Add markers to the `markers` layer (or create a new `nodes` layer) at each equator crossing point:

```javascript
async function drawNodeMarkers() {
    const response = await fetch(`${API_BASE}/polar-crossings?satellite=${currentSatellite}&hours=24`);
    const data = await response.json();

    const nodesLayer = projection.getLayer('markers');  // or a dedicated layer
    nodesLayer.selectAll('.node-marker').remove();

    // Ascending nodes (northbound, daytime)
    data.ascending_nodes.forEach(node => {
        const pos = projection.project(node.longitude, 0);  // lat = 0 (equator)
        if (!pos) return;

        const group = nodesLayer.append('g')
            .attr('class', 'node-marker ascending')
            .attr('transform', `translate(${pos[0]}, ${pos[1]})`);

        // Upward triangle for ascending
        group.append('polygon')
            .attr('points', '0,-8 -6,4 6,4')
            .style('fill', '#4ade80')        // green
            .style('stroke', '#166534')
            .style('stroke-width', 1.5);

        // Label
        group.append('text')
            .attr('x', 10)
            .attr('y', 4)
            .style('fill', '#4ade80')
            .style('font-size', '9px')
            .text(`AN ${new Date(node.time).toUTCString().slice(17, 22)}`);
    });

    // Descending nodes (southbound, nighttime)
    data.descending_nodes.forEach(node => {
        const pos = projection.project(node.longitude, 0);
        if (!pos) return;

        const group = nodesLayer.append('g')
            .attr('class', 'node-marker descending')
            .attr('transform', `translate(${pos[0]}, ${pos[1]})`);

        // Downward triangle for descending
        group.append('polygon')
            .attr('points', '0,8 -6,-4 6,-4')
            .style('fill', '#f97316')        // orange
            .style('stroke', '#9a3412')
            .style('stroke-width', 1.5);

        // Label
        group.append('text')
            .attr('x', 10)
            .attr('y', 4)
            .style('fill', '#f97316')
            .style('font-size', '9px')
            .text(`DN ${new Date(node.time).toUTCString().slice(17, 22)}`);
    });
}
```

### Visual Design

| Element | Ascending (Northbound) | Descending (Southbound) |
|---------|----------------------|------------------------|
| Shape | Upward-pointing triangle | Downward-pointing triangle |
| Color | Green (#4ade80) | Orange (#f97316) |
| Label | `AN 13:30` (UTC time) | `DN 01:30` (UTC time) |
| Position | On equator at crossing longitude | On equator at crossing longitude |
| Size | 12px (triangle height) | 12px (triangle height) |
| Tooltip | "Ascending Node - Daytime pass, 13:30 LTAN" | "Descending Node - Nighttime pass, 01:30 LTAN" |

### Label Format Options

- **Minimal**: Just the triangle marker
- **Time only**: `13:32 UTC`
- **Full**: `AN 13:32 UTC (45.2W)` -- includes longitude
- **With orbit number**: `AN #15527 13:32`

Recommend: Time-only labels by default, full info on hover tooltip.

### Integration

- Call `drawNodeMarkers()` after initial track load and after each track refresh
- Add a toggle button: "Nodes" in the legend toggles panel (alongside Swath, Vector, Day/Night)
- In constellation mode, show nodes only for the selected satellite (avoid visual clutter)
- In coverage mode (24h), show all nodes -- this clearly shows the ground track spacing pattern

### Gotchas

- **Antimeridian crossings**: If a crossing happens near longitude 180/-180, the marker position is fine but the label might overlap the map edge.
- **Equator detection resolution**: At 30-second step intervals and ~7.5 km/s velocity, the detected crossing longitude could be off by ~225 km (about 2 degrees at the equator). Refine by linear interpolation between the two flanking positions: `crossing_lon = lon1 + (lon2 - lon1) * (-lat1) / (lat2 - lat1)`.
- **The backend already limits to 10 nodes per direction**. For 24-hour coverage, increase this to ~14 (NOAA-21 orbits ~14.2 times/day).

---

## Feature 4: Equirectangular Projection Toggle

### D3.js geoEquirectangular Setup

```javascript
const equirectangular = d3.geoEquirectangular()
    .scale(width / (2 * Math.PI))       // full world width
    .translate([width / 2, height / 2])  // center the map
    .precision(0.1);
```

The equirectangular (plate carree) projection maps longitude directly to x and latitude directly to y. This is the classic map projection where a sun-synchronous ground track appears as a **sinusoidal wave** oscillating between +98.7 and -98.7 degrees latitude.

### Switching Between Projections Without Rewriting the Renderer

The key insight is that `OrbitRenderer`, `Terminator`, and `Spotlight` all depend on `projection.path` and `projection.project()`. If the `PolarProjection` class is refactored to support swapping its internal D3 projection, all downstream renderers work unchanged.

**Strategy: Add a projection-swap method to `PolarProjection`**

```javascript
class PolarProjection {
    constructor(container, width, height) {
        // ... existing code ...
        this.projectionType = 'azimuthal';  // track current type
    }

    setProjectionType(type) {
        if (type === this.projectionType) return;
        this.projectionType = type;

        if (type === 'equirectangular') {
            this.projection = d3.geoEquirectangular()
                .scale(this.width / (2 * Math.PI))
                .translate([this.width / 2, this.height / 2])
                .precision(0.1);
        } else {
            // Restore azimuthal equidistant (original)
            this.projection = d3.geoAzimuthalEquidistant()
                .rotate([0, -90])
                .scale(this.width / 2.3)
                .translate([this.width / 2, this.height / 2])
                .clipAngle(180);
        }

        // Update the path generator (this is what all renderers use)
        this.path = d3.geoPath().projection(this.projection);

        // Redraw base map elements
        this.redrawBase();
        this.reloadLandmasses();
    }

    redrawBase() {
        this.layers.base.selectAll('*').remove();
        this.drawBase();  // existing method, but needs to adapt to projection type
    }
}
```

### What Changes Per Projection

| Component | Azimuthal (current) | Equirectangular |
|-----------|-------------------|-----------------|
| `drawBase()` graticule | Concentric circles from pole | Rectangular lat/lon grid |
| Sphere outline | Circle | Rectangle (-180,-90 to 180,90) |
| Clip angle | 180 (full globe) | None (or clip to bbox) |
| SVG aspect ratio | Square (1:1) | Rectangle (2:1) |
| Ground track appearance | Curved arcs | Sine-wave pattern |
| Terminator | d3.geoCircle works | d3.geoCircle works identically |
| Spotlight swath | d3.geoCircle works | d3.geoCircle works identically |
| zoom/pan | Works on g transform | Works on g transform |
| Coordinate display | invert() works | invert() works |

### The Classic Sine-Wave Ground Track

In equirectangular projection, a sun-synchronous orbit at 98.7-degree inclination traces a sinusoidal path:

```
Latitude(t) ~ 81.3 * sin(omega * t + phi)
```

Where 81.3 = 180 - 98.7 (the orbit never goes above ~81.3 degrees latitude when measured as distance from equator -- but actually for a 98.7 deg inclination retrograde orbit, the satellite reaches up to 81.3 degrees latitude).

The ground track shifts **westward by ~25.3 degrees per orbit** due to Earth's rotation:
```
Shift per orbit = 360 * (period_minutes / 1440) = 360 * (101.4 / 1440) = 25.35 degrees
```

This produces the classic pattern of parallel sine curves separated by ~25 degrees of longitude, wrapping the entire Earth in ~14 orbits.

### Handling Existing Components

**orbit-renderer.js**: No changes needed. `drawGroundTrack()` uses `this.path` (the D3 path generator), which automatically adapts to whichever projection is set. The `splitAtDiscontinuities()` method for antimeridian crossing is equally important in equirectangular (where longitude wraps at +/-180).

**terminator.js**: No changes needed. Uses `d3.geoCircle()` and `this.path`, both projection-agnostic. The terminator will render as a curved band across the equirectangular map rather than a circle on the azimuthal view.

**spotlight.js**: No changes needed. `createGeodesicCircle()` and `this.path` are projection-agnostic. The VIIRS swath will appear as an ellipse (elongated at high latitudes) in equirectangular.

**projection.js**: Needs the most changes:
1. Add `setProjectionType()` method
2. Modify `drawBase()` to draw appropriate graticule for each projection type
3. Adjust SVG aspect ratio (equirectangular is 2:1, azimuthal is 1:1)
4. `invert()` works for both projections (D3 provides invert for equirectangular)

### SVG Aspect Ratio

The equirectangular projection naturally maps to a 2:1 rectangle (360 degrees wide, 180 degrees tall). Options:

1. **Keep square SVG, scale to fit**: The map will have blank space above/below
2. **Resize SVG to 2:1**: Requires adjusting the container CSS. Cleanest result.
3. **Use `fitSize()`**: `d3.geoEquirectangular().fitSize([width, height], {type: 'Sphere'})` auto-scales

Recommend option 3 -- let D3 handle the scaling.

### UI Integration

Add a toggle in the header tab bar or controls:

```html
<button class="toggle-btn" id="btn-toggle-projection">Map View</button>
```

Or add it as a fifth tab alongside "Live Tracking", "Constellation", "24h Coverage", "3D Globe":

```html
<button class="tab-btn" data-mode="equirect">Equirect. Map</button>
```

Better: make it a projection toggle within the existing Live/Constellation/Coverage modes, not a separate mode. A small toggle button in the zoom controls panel: "Polar | Flat".

### Gotchas

- **Transition animation**: Switching projections can be animated using `d3.geoProjection.fitSize()` and transitioning the projection parameters. However, this is complex and optional.
- **Zoom behavior**: Zoom/pan via `d3.zoom()` on the `g` element works identically for both projections since it's a simple SVG transform.
- **Performance**: Redrawing all land masses on projection switch takes ~100ms (the world-110m.json is small). Not noticeable.
- **Equator emphasis**: In equirectangular mode, the equator is a horizontal line. Ascending/descending node markers (Feature 3) align perfectly along this line, making the ground track pattern very clear.
- **Antimeridian**: More visible in equirectangular. The existing `splitAtDiscontinuities()` in orbit-renderer.js already handles this correctly.

---

## Feature 5: NASA FIRMS Active Fire Overlay

### FIRMS API Endpoint

**Base URL:**
```
https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{SOURCE}/{AREA_COORDINATES}/{DAY_RANGE}
```

**With date:**
```
https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{SOURCE}/{AREA_COORDINATES}/{DAY_RANGE}/{DATE}
```

### Getting a MAP_KEY

1. Register at: https://firms.modaps.eosdis.nasa.gov/api/area/ (click "Get MAP_KEY")
2. Provide an email address
3. Key is sent immediately via email
4. Free tier: **5000 transactions per 10-minute interval**
5. Larger requests (e.g., 7 days) count as multiple transactions

The MAP_KEY should be stored server-side (in the Flask backend, not exposed to the frontend). The backend proxies FIRMS requests and caches results.

### Query Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `MAP_KEY` | API key from registration | `abc123def456` |
| `SOURCE` | Data source identifier | `VIIRS_NOAA21_NRT` |
| `AREA_COORDINATES` | Bounding box: `west,south,east,north` or `world` | `-125,24,-66,50` (CONUS) |
| `DAY_RANGE` | Number of days (1-5) | `1` |
| `DATE` | Optional start date (YYYY-MM-DD) | `2026-03-26` |

### Available Sources Relevant to This App

| Source | Satellite | Description |
|--------|-----------|-------------|
| `VIIRS_NOAA21_NRT` | NOAA-21 (JPSS-2) | Near Real-Time VIIRS active fire detections |
| `VIIRS_NOAA20_NRT` | NOAA-20 (JPSS-1) | Near Real-Time |
| `VIIRS_SNPP_NRT` | Suomi NPP | Near Real-Time |
| `MODIS_NRT` | Terra/Aqua | Near Real-Time MODIS |
| `VIIRS_NOAA21_SP` | NOAA-21 | Standard Processing (higher quality, delayed) |

Using `VIIRS_NOAA21_NRT` matches the primary satellite being tracked.

### Response Format (CSV)

```csv
latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
-17.802,25.489,310.9,0.39,0.36,2026-03-26,0130,N,VIIRS,nominal,2.0NRT,277.1,2.6,N
34.123,-118.456,345.2,0.42,0.38,2026-03-26,2115,N,VIIRS,high,2.0NRT,290.3,15.8,D
```

**Field descriptions:**

| Field | Description | Units |
|-------|-------------|-------|
| `latitude` | Fire detection latitude | degrees |
| `longitude` | Fire detection longitude | degrees |
| `bright_ti4` | Brightness temperature (I4 channel, 3.74 um) | Kelvin |
| `scan` | Along-scan pixel size | km |
| `track` | Along-track pixel size | km |
| `acq_date` | Acquisition date | YYYY-MM-DD |
| `acq_time` | Acquisition time (UTC) | HHMM |
| `satellite` | Satellite identifier | N (NOAA-21), 1 (NOAA-20), etc. |
| `instrument` | Instrument | VIIRS |
| `confidence` | Detection confidence | low / nominal / high |
| `version` | Processing version | 2.0NRT |
| `bright_ti5` | Brightness temperature (I5 channel, 11.45 um) | Kelvin |
| `frp` | Fire Radiative Power | MW |
| `daynight` | Day/Night flag | D or N |

### Backend Proxy Endpoint

```python
import csv
from io import StringIO

FIRMS_MAP_KEY = os.environ.get('FIRMS_MAP_KEY', '')
FIRMS_BASE = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv'

@app.route("/api/fires")
def api_fires():
    """
    Proxy FIRMS active fire data.

    Query params:
        satellite: satellite key (determines FIRMS source)
        bbox: west,south,east,north (default: world)
        days: day range 1-5 (default: 1)
        date: YYYY-MM-DD (optional, default: most recent)
        confidence: filter by confidence (low/nominal/high)
    """
    sat_key = request.args.get("satellite", "noaa21")
    bbox = request.args.get("bbox", "world")
    days = min(int(request.args.get("days", 1)), 5)
    date = request.args.get("date", "")
    min_confidence = request.args.get("confidence", "nominal")

    source_map = {
        "noaa21": "VIIRS_NOAA21_NRT",
        "noaa20": "VIIRS_NOAA20_NRT",
        "suominpp": "VIIRS_SNPP_NRT"
    }
    source = source_map.get(sat_key, "VIIRS_NOAA21_NRT")

    cache_key = f"fires_{source}_{bbox}_{days}_{date}"
    cached = _get_cached(cache_key, 900)  # 15-minute cache
    if cached:
        return jsonify(cached)

    url = f"{FIRMS_BASE}/{FIRMS_MAP_KEY}/{source}/{bbox}/{days}"
    if date:
        url += f"/{date}"

    resp = requests.get(url, timeout=30)
    resp.raise_for_status()

    # Parse CSV
    reader = csv.DictReader(StringIO(resp.text))
    fires = []
    confidence_order = {"low": 0, "nominal": 1, "high": 2}
    min_conf_val = confidence_order.get(min_confidence, 1)

    for row in reader:
        conf_val = confidence_order.get(row.get("confidence", ""), 0)
        if conf_val >= min_conf_val:
            fires.append({
                "lat": float(row["latitude"]),
                "lon": float(row["longitude"]),
                "brightness": float(row.get("bright_ti4", 0)),
                "frp": float(row.get("frp", 0)),
                "confidence": row.get("confidence", ""),
                "acq_date": row.get("acq_date", ""),
                "acq_time": row.get("acq_time", ""),
                "daynight": row.get("daynight", ""),
                "scan_km": float(row.get("scan", 0)),
                "track_km": float(row.get("track", 0))
            })

    result = {
        "fires": fires,
        "count": len(fires),
        "source": source,
        "bbox": bbox,
        "day_range": days
    }

    _set_cached(cache_key, result)
    return jsonify(result)
```

### Rendering Fire Points on D3 Map

```javascript
async function drawFireOverlay() {
    const response = await fetch(`${API_BASE}/fires?satellite=${currentSatellite}&days=1&confidence=nominal`);
    const data = await response.json();

    const fireLayer = projection.getLayer('coverage');  // reuse coverage layer, or create new 'fires' layer
    fireLayer.selectAll('.fire-point').remove();

    data.fires.forEach(fire => {
        const pos = projection.project(fire.lon, fire.lat);
        if (!pos) return;

        // Size based on FRP (fire radiative power)
        const radius = Math.max(2, Math.min(8, Math.sqrt(fire.frp) * 0.5));

        // Color based on confidence
        const color = fire.confidence === 'high' ? '#ff0000' :
                      fire.confidence === 'nominal' ? '#ff6600' : '#ffaa00';

        fireLayer.append('circle')
            .attr('class', 'fire-point')
            .attr('cx', pos[0])
            .attr('cy', pos[1])
            .attr('r', radius)
            .style('fill', color)
            .style('fill-opacity', 0.7)
            .style('stroke', '#ff0000')
            .style('stroke-width', 0.5)
            .style('stroke-opacity', 0.3)
            .append('title')
            .text(`Fire: ${fire.lat.toFixed(2)}, ${fire.lon.toFixed(2)}\n` +
                  `FRP: ${fire.frp} MW | Conf: ${fire.confidence}\n` +
                  `Time: ${fire.acq_date} ${fire.acq_time} UTC`);
    });
}
```

### Rendering on Globe.gl

Globe.gl has a `pointsData()` API that can overlay fire points on the 3D globe. Since it's already used for satellite markers, use a separate data channel:

```javascript
// Use the htmlElementsData layer for fires (separate from satellite pointsData)
globe
    .htmlElementsData(fires)
    .htmlLat(d => d.lat)
    .htmlLng(d => d.lon)
    .htmlElement(d => {
        const el = document.createElement('div');
        el.style.width = '4px';
        el.style.height = '4px';
        el.style.borderRadius = '50%';
        el.style.background = d.confidence === 'high' ? '#ff0000' : '#ff6600';
        el.style.boxShadow = '0 0 4px #ff0000';
        return el;
    });

// Alternative: Use the heatmapsData layer for density visualization
globe
    .heatmapsData([{points: fires.map(f => ({lat: f.lat, lng: f.lon, val: f.frp}))}])
    .heatmapPointLat('lat')
    .heatmapPointLng('lng')
    .heatmapPointWeight('val')
    .heatmapTopAltitude(0.01)
    .heatmapsTransitionDuration(0);
```

### Refresh Interval and Data Latency

| Data Type | Latency | Recommendation |
|-----------|---------|----------------|
| **URT (Ultra Real-Time)** | < 60 seconds | US/Canada only, very recent |
| **RT (Real-Time)** | < 60 minutes | Removed after 6 hours when NRT arrives |
| **NRT (Near Real-Time)** | ~3 hours | Primary data product, reliable |
| **SP (Standard Processing)** | Days to weeks | Science quality, not for live display |

**Recommended refresh interval**: Every **15 minutes** (matches the 15-minute cache TTL). NRT data updates in batches every few hours, so more frequent polling is wasteful.

### Integration with Existing Architecture

1. **Backend**: Add `/api/fires` endpoint to `server.py` (port 5050). Reuse the existing `_cache` pattern from `external_apis.py`.
2. **Frontend**: Add a "Fires" toggle button in the legend panel. When enabled, fetch and render fire data. Refresh on a 15-minute timer.
3. **MAP_KEY**: Store in environment variable `FIRMS_MAP_KEY`. The backend proxies requests so the key is never exposed to the browser.
4. **Layer**: Add a `fires` layer in `PolarProjection.layers` or reuse the `coverage` layer with distinct class names.

### Gotchas

- **Data volume**: A global 1-day query can return 50,000-200,000 fire detections. This is too many points for SVG rendering. Solutions:
  - Filter by confidence (only "nominal" and "high" removes ~40% of points)
  - Limit to a bounding box around the current map viewport
  - For the D3 map: aggregate points into a grid (heatmap) when zoomed out, show individual points when zoomed in
  - For Globe.gl: use the heatmap layer instead of individual points
- **Bounding box from viewport**: Extract the visible bounding box from the current D3 projection viewport and pass it to the FIRMS API. For the polar azimuthal projection, the visible area is always the full globe, so use `world`. For equirectangular with zoom/pan, compute the visible bbox.
- **Fire points over ocean**: FIRMS occasionally returns detections over water (ship emissions, gas flares, volcanic islands). These are real detections, not errors.
- **Date handling**: FIRMS dates are in UTC. A query for "today" returns data from UTC midnight, which may not include the most recent local-time detections yet.
- **Rate limits**: 5000 requests per 10 minutes is generous for a single-user app. If deploying publicly, implement proper caching and rate limiting on the backend.

---

## Summary: Integration Priority and Dependencies

| Feature | Backend Work | Frontend Work | Dependencies | Complexity |
|---------|-------------|---------------|-------------|------------|
| 3. Node Markers | None (endpoint exists) | Moderate (new markers) | None | Low |
| 4. Equirectangular | None | Moderate (projection swap) | None | Medium |
| 2. GIBS Imagery | None (direct URLs) | Moderate-High (tile rendering) | Feature 4 recommended | Medium-High |
| 5. FIRMS Fires | New endpoint + MAP_KEY | Moderate (point rendering) | FIRMS API key | Medium |
| 1. Pass Prediction | New endpoint + shadow calc | High (observer UI + pass table) | de421.bsp ephemeris | High |

**Recommended build order**: 3 -> 4 -> 2 -> 5 -> 1

Feature 3 requires no backend changes and can be done immediately. Feature 4 unlocks Feature 2 (GIBS tiles align naturally with equirectangular). Feature 5 needs an API key but is otherwise straightforward. Feature 1 is the most complex, requiring new backend computation and a full observer UI flow.
