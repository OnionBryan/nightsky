# Research: Orbit Tracker Features 6-9

Implementation research for the JPSS Constellation Tracker.
Covers time tick marks, scan-line swath, coverage heatmap, and shareable URLs.

**Existing architecture summary:**
- Backend: Flask on port 5050, SGP4 propagation via `orbit_propagator.py`, coordinate transforms in `coordinate_transforms.py`, TLE fetching from CelesTrak
- Frontend: D3.js v7 azimuthal equidistant (North Pole centered) via `PolarProjection` class, Globe.gl 3D view via `Globe3D` class
- SVG layers defined in `PolarProjection.layers`: base, land, borders, coverage, track, swath, markers, labels
- Track rendering via `OrbitRenderer.drawGroundTrack()` which converts positions to GeoJSON LineString and renders with `d3.geoPath()`
- Existing `/api/track` endpoint returns `{positions: [{lat, lon, alt, time}, ...]}` with configurable step/duration
- Swath currently rendered as a geodesic circle (1530km radius) at the satellite's current position via `Spotlight.drawSwath()`

---

## Feature 6: Time Tick Marks Along Ground Track

### Goal

Place UTC time labels (HH:MM format) along the D3 ground track at regular intervals (every 5 or 10 minutes), so users can tell when the satellite will be over a given location.

### Data source

The existing `/api/track` endpoint already returns timestamps for each position:

```
GET /api/track?satellite=noaa21&duration=180&step=30

Response: {
  "positions": [
    {"lat": 42.1, "lon": -73.5, "alt": 824.1, "time": "2026-03-27T12:00:00+00:00"},
    {"lat": 43.2, "lon": -71.3, "alt": 824.0, "time": "2026-03-27T12:00:30+00:00"},
    ...
  ]
}
```

No new backend endpoint is required. The frontend simply filters positions whose timestamps fall on 5- or 10-minute boundaries.

### Algorithm: selecting tick positions

```javascript
// Given trackData array from /api/track (step=30s), pick 5-minute marks
function getTickPositions(positions, intervalMinutes = 5) {
    const ticks = [];
    for (const p of positions) {
        const dt = new Date(p.time);
        const min = dt.getUTCMinutes();
        const sec = dt.getUTCSeconds();
        // Match positions within half a step of exact 5-minute boundary
        if (min % intervalMinutes === 0 && sec < 30) {
            // Deduplicate: skip if we already have a tick for this minute
            const label = `${String(dt.getUTCHours()).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
            if (!ticks.length || ticks[ticks.length - 1].label !== label) {
                ticks.push({ lat: p.lat, lon: p.lon, time: dt, label });
            }
        }
    }
    return ticks;
}
```

### SVG rendering approach

Each tick consists of two elements appended to the `labels` layer:
1. A small perpendicular tick mark (short line) at the position
2. A text label offset from the tick

```javascript
drawTimeTicks(positions, intervalMinutes = 10) {
    const layer = this.projection.getLayer('labels');
    layer.selectAll('.time-tick').remove();

    const ticks = getTickPositions(positions, intervalMinutes);

    ticks.forEach((tick, i) => {
        const pos = this.projection.project(tick.lon, tick.lat);
        if (!pos) return;

        const group = layer.append('g')
            .attr('class', 'time-tick')
            .attr('transform', `translate(${pos[0]}, ${pos[1]})`);

        // Tick mark (small perpendicular dash)
        // Calculate bearing from previous to next position for perpendicular direction
        const bearing = this.getTrackBearing(ticks, i);
        const perpAngle = bearing + Math.PI / 2;
        const tickLen = 6;

        group.append('line')
            .attr('x1', -Math.cos(perpAngle) * tickLen)
            .attr('y1', -Math.sin(perpAngle) * tickLen)
            .attr('x2', Math.cos(perpAngle) * tickLen)
            .attr('y2', Math.sin(perpAngle) * tickLen)
            .style('stroke', '#778da9')
            .style('stroke-width', 1.5);

        // Text label, offset perpendicular to track
        group.append('text')
            .attr('x', Math.cos(perpAngle) * 12)
            .attr('y', Math.sin(perpAngle) * 12)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .style('fill', '#778da9')
            .style('font-size', '9px')
            .style('font-family', "'SF Mono', 'Fira Code', monospace")
            .text(tick.label);
    });
}
```

### Computing the perpendicular direction (track bearing in screen space)

To orient tick marks perpendicular to the track, compute the local track bearing in projected (screen) coordinates:

```javascript
getTrackBearing(ticks, index) {
    let prev, next;
    if (index > 0) prev = this.projection.project(ticks[index - 1].lon, ticks[index - 1].lat);
    if (index < ticks.length - 1) next = this.projection.project(ticks[index + 1].lon, ticks[index + 1].lat);

    if (prev && next) {
        return Math.atan2(next[1] - prev[1], next[0] - prev[0]);
    } else if (next) {
        const cur = this.projection.project(ticks[index].lon, ticks[index].lat);
        return Math.atan2(next[1] - cur[1], next[0] - cur[0]);
    } else if (prev) {
        const cur = this.projection.project(ticks[index].lon, ticks[index].lat);
        return Math.atan2(cur[1] - prev[1], cur[0] - prev[0]);
    }
    return 0;
}
```

### Label overlap avoidance

**Simple approach (recommended first):** Skip rendering a tick if its projected position is within 25 pixels of the previous rendered tick.

```javascript
let lastRenderedPos = null;
ticks.forEach((tick, i) => {
    const pos = this.projection.project(tick.lon, tick.lat);
    if (!pos) return;
    if (lastRenderedPos) {
        const dx = pos[0] - lastRenderedPos[0];
        const dy = pos[1] - lastRenderedPos[1];
        if (Math.sqrt(dx*dx + dy*dy) < 25) return; // skip, too close
    }
    // ...render tick...
    lastRenderedPos = pos;
});
```

**Advanced approach:** Use D3's `d3.forceSimulation` with `d3.forceCollide` to push labels apart, similar to how D3 force-directed label placement works. This is used in production mapping tools but is overkill for an initial implementation.

**Zoom-adaptive interval:** At default zoom, use 10-minute intervals. When zoomed in (scale > 2), switch to 5-minute intervals:

```javascript
const zoomScale = this.projection.currentTransform.k || 1;
const interval = zoomScale > 2 ? 5 : 10;
```

### How professional tools do it

- **STK (Systems Tool Kit):** Renders time ticks as small crosshairs perpendicular to the ground track, with HH:MM:SS labels. Ticks are placed at configurable intervals. Labels use leader lines to avoid overlap. STK also colors the track differently for sunlit vs eclipse segments.

- **Orbitron:** Uses simpler approach -- places HH:MM labels directly on the track line at fixed intervals, with the text rotated to follow the track direction. No perpendicular offset.

- **N2YO / SatNOGS web trackers:** Place circular dots at interval points with popup tooltips on hover showing the full timestamp.

**Recommendation for this app:** Start with the Orbitron-style approach (perpendicular tick marks with adjacent labels, minimum-distance deduplication). Add tooltip-on-hover as an enhancement.

### Integration with existing architecture

- Add a `drawTimeTicks()` method to `OrbitRenderer` class in `orbit-renderer.js`
- Call it from `App.updateSingleSatellite()` after drawing the prediction track
- Use the `labels` layer from `PolarProjection.layers`
- Add a toggle button "Ticks" in the legend-toggles div next to Swath/Vector/Day-Night
- Clear ticks in `OrbitRenderer.clear()` and `OrbitRenderer.clearTrails()`

### Gotchas

1. **Antimeridian crossings:** When the track crosses the antimeridian (lon jumps from +180 to -180), skip that tick or the projected position will be wrong. The existing `splitAtDiscontinuities()` method in `OrbitRenderer` already handles this for track segments -- use the same logic.

2. **Polar region label density:** Near the poles on the azimuthal projection, track segments are compressed. The distance-based deduplication handles this, but you may want a larger minimum distance (35px) when latitude > 75 degrees.

3. **Playback mode:** During time-machine playback, tick labels should update based on simulated time, not wall clock. The `_onPlaybackTick` method already has the sim-time track data -- pass it through to `drawTimeTicks`.

4. **Globe.gl 3D view:** Time ticks on the 3D globe require a different approach. Globe.gl's `labelsData()` API can place 3D text labels at lat/lon/alt coordinates. However, the labels will be tiny at the default camera distance. Consider only showing ticks in the 2D view initially.

---

## Feature 7: Swath as Scan-Line Strip Instead of Circle

### Goal

Replace the current geodesic circle swath visualization with a physically accurate scan-line strip that follows the ground track. The strip should show the actual VIIRS scan geometry -- a continuous ribbon +-1530km perpendicular to the velocity vector.

### VIIRS scan geometry reference

| Parameter | Value |
|-----------|-------|
| Total cross-track swath width | 3060 km |
| Half-width | 1530 km |
| Along-track scan line width | ~12 km (at nadir) |
| Scan period | 1.786 seconds |
| Orbital altitude | ~824 km |
| Ground speed | ~6.8 km/s |
| Scan mechanism | Rotating telescope assembly, whiskbroom |

The VIIRS sensor scans perpendicular to the flight direction. Each scan covers 3060 km cross-track. The satellite moves ~12 km along-track during each scan period, producing continuous contiguous coverage with no gaps at nadir.

### Algorithm: computing swath edge points

For each position along the ground track, compute two edge points at +-1530 km perpendicular to the velocity vector:

**Step 1: Compute the ground-track bearing (forward azimuth)**

Given consecutive positions (lat1, lon1) and (lat2, lon2), the forward bearing is:

```python
import math

def forward_bearing(lat1, lon1, lat2, lon2):
    """Compute initial bearing from point 1 to point 2 (radians)."""
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlon = lon2 - lon1
    y = math.sin(dlon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return math.atan2(y, x)
```

**Step 2: Compute perpendicular bearing**

```python
left_bearing = bearing - math.pi / 2   # 90 degrees left
right_bearing = bearing + math.pi / 2  # 90 degrees right
```

**Step 3: Compute destination point at given bearing and distance**

This is the Vincenty "direct" formula (great circle destination point):

```python
def destination_point(lat, lon, bearing, distance_km):
    """Compute destination from start point, bearing, and distance."""
    R = 6371.0  # Earth radius km
    d = distance_km / R  # angular distance in radians
    lat1 = math.radians(lat)
    lon1 = math.radians(lon)

    lat2 = math.asin(
        math.sin(lat1) * math.cos(d) +
        math.cos(lat1) * math.sin(d) * math.cos(bearing)
    )
    lon2 = lon1 + math.atan2(
        math.sin(bearing) * math.sin(d) * math.cos(lat1),
        math.cos(d) - math.sin(lat1) * math.sin(lat2)
    )

    return math.degrees(lat2), math.degrees(lon2)
```

**Step 4: Build the strip polygon**

For N track positions, compute left and right edges, then form a closed polygon:

```python
def compute_swath_strip(positions, half_width_km=1530):
    """
    Compute swath strip polygon from ground track positions.

    Args:
        positions: List of {lat, lon, time} dicts from /api/track
        half_width_km: Half the swath width (1530 for VIIRS)

    Returns:
        GeoJSON Polygon with coordinates [[lon, lat], ...]
    """
    left_edge = []
    right_edge = []

    for i in range(len(positions)):
        p = positions[i]

        # Compute bearing from track direction
        if i < len(positions) - 1:
            bearing = forward_bearing(
                p['lat'], p['lon'],
                positions[i+1]['lat'], positions[i+1]['lon']
            )
        else:
            # Last point: use bearing from previous segment
            bearing = forward_bearing(
                positions[i-1]['lat'], positions[i-1]['lon'],
                p['lat'], p['lon']
            )

        # Perpendicular bearings
        left_b = bearing - math.pi / 2
        right_b = bearing + math.pi / 2

        # Edge points
        left_lat, left_lon = destination_point(p['lat'], p['lon'], left_b, half_width_km)
        right_lat, right_lon = destination_point(p['lat'], p['lon'], right_b, half_width_km)

        left_edge.append([left_lon, left_lat])
        right_edge.append([right_lon, right_lat])

    # Form closed polygon: left edge forward, right edge reversed
    right_edge.reverse()
    coords = left_edge + right_edge + [left_edge[0]]  # close the polygon

    return {
        "type": "Polygon",
        "coordinates": [coords]
    }
```

### Backend endpoint

Add a new endpoint or extend the existing `/api/track` to include swath strip geometry:

```
GET /api/swath-strip?satellite=noaa21&duration=90&step=30

Response: {
    "type": "Feature",
    "geometry": {
        "type": "Polygon",
        "coordinates": [[[lon, lat], ...]]
    },
    "properties": {
        "satellite": "noaa21",
        "half_width_km": 1530,
        "duration_minutes": 90
    }
}
```

Alternatively, compute the strip client-side in JavaScript from the existing track data. This avoids a new endpoint and keeps the backend simple. The bearing and destination-point calculations are straightforward in JS.

**Recommendation:** Compute client-side. The math is trivial and avoids round-trip latency for each update.

### Frontend rendering in D3

```javascript
drawSwathStrip(positions, halfWidthKm = 1530) {
    const swathLayer = this.projection.getLayer('swath');
    swathLayer.selectAll('.swath-strip').remove();

    if (positions.length < 2) return;

    // Split at antimeridian crossings first
    const segments = this.orbitRenderer.splitAtDiscontinuities(positions);

    segments.forEach(segment => {
        if (segment.length < 2) return;

        const polygon = computeSwathStripGeoJSON(segment, halfWidthKm);

        swathLayer.append('path')
            .datum(polygon)
            .attr('class', 'swath-strip')
            .attr('d', this.path)
            .style('fill', 'rgba(0, 212, 255, 0.10)')
            .style('stroke', 'rgba(0, 212, 255, 0.4)')
            .style('stroke-width', 0.5);
    });
}
```

### The bowtie effect

VIIRS has a well-documented "bowtie effect" where pixels at the scan edges overlap between adjacent scans. At nadir, the pixel IFOV is ~375m (I-bands) or ~750m (M-bands). At the scan edge (+-56 degrees off-nadir), the pixel grows to ~800m x 1600m, and adjacent scan lines overlap by up to 2x.

**For visualization purposes:** The bowtie effect means the effective swath width at the edges is wider than 1530 km. The actual scan angle extends to +-56.28 degrees from nadir. At 824 km altitude:

```
Nadir half-angle = 56.28 degrees
Earth central angle = arcsin((R_earth + h) / R_earth * sin(56.28)) - 56.28
                    = arcsin(7195.137 / 6371 * sin(56.28)) - 56.28
                    = ~13.85 degrees
Ground distance = 13.85 * pi/180 * 6371 = ~1542 km
```

So the actual ground coverage extends to about 1542 km from nadir at the scan edges, with degraded resolution. For our strip visualization, using 1530 km is accurate enough. Do NOT try to model the pixel-level bowtie overlap -- it only matters for data processing, not for a ground track visualization.

**Optional enhancement:** Draw the strip with a subtle gradient that's more opaque at center (nadir, best resolution) and fades toward edges (degraded resolution):

```javascript
// Create a linear gradient perpendicular to the track
const gradientId = 'swath-gradient';
defs.append('linearGradient')
    .attr('id', gradientId)
    .attr('gradientUnits', 'userSpaceOnUse')
    // ... set x1,y1,x2,y2 based on strip orientation
    .selectAll('stop')
    .data([
        {offset: '0%', opacity: 0.05},
        {offset: '30%', opacity: 0.15},
        {offset: '50%', opacity: 0.20},  // nadir
        {offset: '70%', opacity: 0.15},
        {offset: '100%', opacity: 0.05}
    ])
    .enter().append('stop')
    .attr('offset', d => d.offset)
    .attr('stop-color', '#00d4ff')
    .attr('stop-opacity', d => d.opacity);
```

This is hard to do with a geoPath polygon because the gradient orientation changes along the strip. A simpler approach: render two nested polygons -- the outer one at 1530 km half-width (faint), and an inner one at ~1000 km (slightly more opaque) to suggest the higher-quality nadir region.

### JavaScript destination-point calculation

```javascript
function destinationPoint(lat, lon, bearing, distKm) {
    const R = 6371;
    const d = distKm / R;
    const lat1 = lat * Math.PI / 180;
    const lon1 = lon * Math.PI / 180;

    const lat2 = Math.asin(
        Math.sin(lat1) * Math.cos(d) +
        Math.cos(lat1) * Math.sin(d) * Math.cos(bearing)
    );
    const lon2 = lon1 + Math.atan2(
        Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
        Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );

    return {
        lat: lat2 * 180 / Math.PI,
        lon: lon2 * 180 / Math.PI
    };
}

function forwardBearing(lat1, lon1, lat2, lon2) {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const lat1r = lat1 * Math.PI / 180;
    const lat2r = lat2 * Math.PI / 180;

    const y = Math.sin(dLon) * Math.cos(lat2r);
    const x = Math.cos(lat1r) * Math.sin(lat2r) -
              Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLon);

    return Math.atan2(y, x);
}
```

### Integration with existing architecture

- Replace `Spotlight.drawSwath()` (the circle) with a strip when track data is available
- Keep the circle as a fallback for the current-position-only case (live single point)
- The strip visualization naturally replaces the circle: for the prediction track, draw the full strip; for the current position only, draw the circle
- In coverage mode (`drawCoverage()`), draw the strip over the entire 24h track to show accumulated coverage
- In Globe.gl 3D mode, use `globe.polygonsData()` with the same GeoJSON polygon

### Gotchas

1. **Antimeridian splitting:** The strip polygon must be split where the track crosses +-180 longitude. Otherwise D3's geoPath will draw incorrect connecting lines across the map. Use the same `splitAtDiscontinuities()` logic but compute edges per-segment.

2. **Polar singularity:** When the satellite passes directly over a pole (lat > 89), the bearing calculation becomes unstable. Use the velocity vector from the SGP4 output (ECEF coordinates) instead of computing bearing from consecutive lat/lon positions. The backend already provides velocity in the propagation output.

3. **Track step size:** For a smooth strip, use step=30s (the default). At step=60s, the strip edges will be noticeably jagged at the poles where the track curves sharply. At step=10s, you get a very smooth strip but 3x more points to render.

4. **Performance:** A 90-minute strip (180 points at step=30s) creates a polygon with ~360 vertices. This is trivial for D3. A 24-hour strip (2880 points) creates ~5760 vertices, still fine but consider simplifying with Douglas-Peucker for coverage mode.

5. **Polygon winding:** GeoJSON polygons must follow the right-hand rule (counterclockwise for exterior rings). If the polygon appears inverted (fills the entire globe instead of the strip), reverse the coordinate order.

---

## Feature 8: Coverage Heatmap Instead of Track-Line Spaghetti

### Goal

Replace the current 24h coverage view (which draws all track lines, creating visual clutter) with a grid-based heatmap showing how many swath passes cover each area of Earth over a time period. This immediately reveals the coverage pattern: polar regions get overlapping passes every orbit, while equatorial regions have gaps.

### Algorithm: grid-based approach

**Step 1: Define the grid**

Divide Earth into cells. Two choices:

| Grid | Cell count | Good for |
|------|-----------|----------|
| 2 x 2 degrees | 180 x 90 = 16,200 | Fast rendering, global overview |
| 1 x 1 degree | 360 x 180 = 64,800 | More detail, still manageable |

Recommendation: Start with 2-degree grid. At the equator, a 2-degree cell is ~222 x 222 km, which is well within the 3060 km swath width and gives meaningful pass counts.

**Step 2: Compute pass counts**

For each position along the 24h track, mark all grid cells within the swath (1530 km from the sub-satellite point):

```python
def compute_coverage_grid(positions, half_width_km=1530, grid_size=2):
    """
    Compute coverage heatmap grid.

    Args:
        positions: List of {lat, lon} from /api/track with duration=1440, step=60
        half_width_km: VIIRS half-swath width
        grid_size: Cell size in degrees

    Returns:
        dict: {(lat_idx, lon_idx): count} for cells with count > 0
    """
    from math import radians, cos, sin, asin, sqrt

    R = 6371.0
    grid = {}
    n_lat = int(180 / grid_size)
    n_lon = int(360 / grid_size)

    for pos in positions:
        # For each grid cell, check if its center is within half_width_km
        # Optimization: only check cells within angular_radius degrees
        angular_radius = half_width_km / R * (180 / math.pi)  # ~13.85 degrees

        lat_min = max(-90, pos['lat'] - angular_radius - grid_size)
        lat_max = min(90, pos['lat'] + angular_radius + grid_size)

        for lat_cell in range(int((lat_min + 90) / grid_size),
                              int((lat_max + 90) / grid_size) + 1):
            if lat_cell < 0 or lat_cell >= n_lat:
                continue

            cell_lat = -90 + lat_cell * grid_size + grid_size / 2

            for lon_cell in range(n_lon):
                cell_lon = -180 + lon_cell * grid_size + grid_size / 2

                # Haversine distance
                dist = haversine(pos['lat'], pos['lon'], cell_lat, cell_lon)

                if dist <= half_width_km:
                    key = (lat_cell, lon_cell)
                    grid[key] = grid.get(key, 0) + 1

    return grid
```

**Step 3: Normalize by effective area**

Grid cells at high latitudes are physically smaller (longitude degrees converge at poles). A 2-degree cell at 80 degrees latitude is ~39 km wide (vs 222 km at equator). Options:

- **Option A: Ignore it.** The raw pass count is what matters for "how many times does the satellite see this spot." This is the standard approach in satellite coverage analysis.
- **Option B: Weight by area.** Divide pass count by `cos(latitude)` to show "passes per unit area." This would de-emphasize polar regions and better show equatorial gaps.

**Recommendation:** Use raw pass count (Option A). The whole point of a sun-synchronous orbit coverage map is to show that polar regions get more passes. Normalizing would hide that truth.

### Backend endpoint

Add a dedicated endpoint to avoid computing this on the client:

```
GET /api/coverage-heatmap?satellite=noaa21&duration=1440&grid_size=2

Response: {
    "grid_size_deg": 2,
    "duration_minutes": 1440,
    "satellite": "noaa21",
    "max_count": 14,
    "cells": [
        {"lat": -89, "lon": -179, "count": 14},
        {"lat": -89, "lon": -177, "count": 14},
        ...
    ]
}
```

**Performance estimate:** 24 hours at step=60s = 1440 positions. For each position, checking cells within ~14-degree radius means roughly 7 x 14 = ~100 cells. Total: ~144,000 distance calculations. With Python/math, this takes <1 second. Response size: ~5000-8000 cells with count > 0, roughly 200-400 KB JSON.

### Alternative: distance-from-track approach (client-side)

Instead of checking every grid cell against every track point, a faster client-side approach:

1. For each grid cell center, find the minimum distance to any track point
2. If min_distance < 1530 km, count it as covered
3. Count how many track points are within 1530 km (= number of passes)

This is O(cells * positions) but can be accelerated with spatial indexing (quadtree for track points). D3 has `d3.quadtree` built in.

### Color scale

Use a sequential color scheme. For NOAA-21's sun-synchronous orbit at 824 km:
- Equatorial cells: ~2 passes per 24 hours (ascending + descending node)
- Mid-latitude cells: ~4-6 passes (some overlap between adjacent orbits)
- Polar cells (>75 degrees): ~10-14 passes (all orbits converge)

```javascript
// D3 sequential color scale
const colorScale = d3.scaleSequential()
    .domain([0, maxCount])
    .interpolator(d3.interpolateYlOrRd);  // white-yellow-orange-red

// Or a custom blue-based scheme matching the app's aesthetic:
const colorScale = d3.scaleSequential()
    .domain([0, maxCount])
    .interpolator(t => d3.interpolateRgb('#0d1b2a', '#00d4ff')(t));
```

**Recommended palette** (matching the app's dark theme with cyan accent):

| Passes | Color | Meaning |
|--------|-------|---------|
| 0 | `#0d1b2a` (ocean dark) | No coverage |
| 1 | `rgba(0, 80, 140, 0.3)` | Single pass |
| 2-3 | `rgba(0, 150, 200, 0.4)` | Typical equatorial |
| 4-6 | `rgba(0, 212, 255, 0.5)` | Mid-latitude |
| 7-10 | `rgba(0, 255, 200, 0.6)` | Sub-polar |
| 11+ | `rgba(255, 255, 100, 0.7)` | Polar maximum |

### D3 rendering

Render each grid cell as a GeoJSON polygon (rectangle):

```javascript
drawCoverageHeatmap(cells, gridSize = 2, maxCount) {
    const coverageLayer = this.projection.getLayer('coverage');
    coverageLayer.selectAll('.heatmap-cell').remove();

    const colorScale = d3.scaleSequential()
        .domain([0, maxCount])
        .interpolator(d3.interpolateBlues);

    cells.forEach(cell => {
        const lat0 = cell.lat - gridSize / 2;
        const lat1 = cell.lat + gridSize / 2;
        const lon0 = cell.lon - gridSize / 2;
        const lon1 = cell.lon + gridSize / 2;

        const cellGeoJSON = {
            type: 'Polygon',
            coordinates: [[
                [lon0, lat0], [lon1, lat0], [lon1, lat1], [lon0, lat1], [lon0, lat0]
            ]]
        };

        coverageLayer.append('path')
            .datum(cellGeoJSON)
            .attr('class', 'heatmap-cell')
            .attr('d', this.path)
            .style('fill', colorScale(cell.count))
            .style('stroke', 'none')
            .style('opacity', 0.7);
    });
}
```

### Expected coverage patterns for sun-synchronous orbits

NOAA-21 is in a sun-synchronous orbit with inclination ~98.74 degrees and period ~101 minutes. In 24 hours:
- ~14.2 orbits completed
- Each orbit's ground track is shifted ~25.3 degrees west (Earth rotation during one period)
- Ascending node crosses the equator at roughly the same local solar time each day (~1:30 PM)
- The satellite reaches maximum latitude of ~81.3 degrees N/S (90 - (180 - 98.74) = 81.26)

**Coverage pattern:**
- **Equator (0 latitude):** 2 passes per 24h (one ascending, one descending). Gap between adjacent swaths = `360/14.2 * 111 km/degree - 3060 km = ~-272 km`. So at the equator, adjacent swaths actually overlap by ~270 km, giving complete coverage with just barely no gaps.
- **45 degrees latitude:** ~4 passes. Orbital tracks are closer together at higher latitudes.
- **70 degrees latitude:** ~6-8 passes. Significant overlap.
- **80+ degrees latitude:** ~12-14 passes. Every orbit passes over the polar region.

The heatmap should clearly show this pattern: a flat-ish equatorial band with low counts, increasing toward the poles like a bathtub curve.

### Color legend

Add a color bar legend to the coverage view:

```javascript
drawCoverageLegend(maxCount) {
    const legendSvg = d3.select('#coverage-legend');
    const width = 200, height = 15;

    // Gradient bar
    const gradient = legendSvg.append('defs')
        .append('linearGradient')
        .attr('id', 'coverage-gradient')
        .attr('x1', '0%').attr('x2', '100%');

    for (let i = 0; i <= 10; i++) {
        gradient.append('stop')
            .attr('offset', `${i * 10}%`)
            .attr('stop-color', colorScale(i * maxCount / 10));
    }

    legendSvg.append('rect')
        .attr('width', width).attr('height', height)
        .style('fill', 'url(#coverage-gradient)');

    // Labels
    legendSvg.append('text').attr('x', 0).attr('y', height + 12)
        .text('0');
    legendSvg.append('text').attr('x', width).attr('y', height + 12)
        .text(`${maxCount} passes`);
}
```

### Integration with existing architecture

- The current `drawCoverage()` method in `App` fetches 24h track data and draws it as lines. Replace this with the heatmap.
- Add the backend endpoint `/api/coverage-heatmap` in `server.py` using the grid computation
- The `coverage` layer in `PolarProjection.layers` is already dedicated to this
- In Globe.gl mode, use `globe.polygonsData()` with the grid cells as GeoJSON features, coloring each by count

### Gotchas

1. **Rendering performance:** 5000+ SVG path elements can be sluggish on lower-end devices. Two mitigations:
   - Use `<canvas>` instead of SVG for the heatmap layer (D3 can render geoPath to canvas)
   - Use a coarser 3-degree grid for the initial render, then refine to 2-degree on zoom

2. **Polar convergence on azimuthal projection:** Grid cells near the poles are rendered as very thin wedges on our North-Pole-centered projection. This is correct geometrically but may look odd. The cells are small in screen space but the pass counts are high, so the color intensity is correct.

3. **Caching:** The heatmap for a given satellite changes very slowly (only when TLE updates). Cache the grid data on the backend keyed by satellite + duration + grid_size, refreshing when the TLE is updated. The existing `_last_refresh` mechanism in `server.py` can be extended for this.

4. **Constellation mode:** To show combined coverage from NOAA-21 + NOAA-20 + Suomi NPP, compute grids for all three and sum the counts. This shows how the constellation provides better temporal coverage than a single satellite.

---

## Feature 9: Shareable URLs / Deep Linking

### Goal

Encode the application state in the URL hash so users can share specific views (satellite, time, mode, projection) via copy-paste.

### URL format

```
https://example.com/orbit/#sat=noaa21&t=2026-03-27T23:00:00Z&mode=live&view=polar&lat=40.7&lon=-74.0
```

**Parameters:**

| Key | Values | Default | Description |
|-----|--------|---------|-------------|
| `sat` | `noaa21`, `noaa20`, `suominpp` | `noaa21` | Active satellite |
| `t` | ISO 8601 datetime | (now) | Simulation time or playback start |
| `mode` | `live`, `constellation`, `coverage`, `globe` | `live` | View mode |
| `view` | `polar`, `globe` | `polar` | 2D vs 3D (redundant with mode=globe, kept for clarity) |
| `lat` | -90 to 90 | (none) | Observer latitude (for future feature) |
| `lon` | -180 to 180 | (none) | Observer longitude |
| `zoom` | 0.5 to 8 | 1 | Map zoom level |
| `swath` | `0` or `1` | `1` | Show swath |
| `terminator` | `0` or `1` | `1` | Show day/night |
| `ticks` | `0` or `1` | `0` | Show time ticks |

### Implementation

**Module: `state-url.js` (new file)**

```javascript
class StateURL {
    constructor(app) {
        this.app = app;
        this.debounceTimer = null;
    }

    /**
     * Parse URL hash on page load, return state object.
     * Missing keys use defaults.
     */
    parseHash() {
        const hash = window.location.hash.slice(1); // remove '#'
        if (!hash) return null;

        const params = new URLSearchParams(hash);
        const state = {};

        if (params.has('sat')) state.satellite = params.get('sat');
        if (params.has('mode')) state.mode = params.get('mode');
        if (params.has('t')) {
            const d = new Date(params.get('t'));
            if (!isNaN(d)) state.time = d;
        }
        if (params.has('zoom')) state.zoom = parseFloat(params.get('zoom'));
        if (params.has('lat')) state.lat = parseFloat(params.get('lat'));
        if (params.has('lon')) state.lon = parseFloat(params.get('lon'));
        if (params.has('swath')) state.showSwath = params.get('swath') === '1';
        if (params.has('terminator')) state.showTerminator = params.get('terminator') === '1';
        if (params.has('ticks')) state.showTicks = params.get('ticks') === '1';

        return state;
    }

    /**
     * Encode current app state into URL hash.
     * Uses replaceState to avoid adding browser history entries on every update.
     */
    updateHash() {
        const params = new URLSearchParams();

        params.set('sat', this.app.currentSatellite);
        params.set('mode', this.app.currentMode);

        // Only include time if in playback mode
        if (this.app.playback && this.app.playback.active) {
            params.set('t', this.app.playback.currentTime.toISOString());
        }

        // Only include zoom if non-default
        const zoom = this.app.projection.currentTransform.k;
        if (zoom && Math.abs(zoom - 1) > 0.01) {
            params.set('zoom', zoom.toFixed(2));
        }

        // Toggle states (only if non-default)
        if (!this.app.spotlight.showSwath) params.set('swath', '0');
        if (!this.app.terminator.showTerminator) params.set('terminator', '0');

        const newHash = '#' + params.toString();

        // Use replaceState to update URL without creating history entries
        // This is critical: pushState would break the back button
        window.history.replaceState(null, '', newHash);
    }

    /**
     * Debounced hash update -- call this from state-changing methods.
     * Prevents hammering replaceState during animations.
     */
    scheduleUpdate() {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.updateHash(), 500);
    }

    /**
     * Apply parsed state to the app.
     */
    async applyState(state) {
        if (!state) return;

        if (state.satellite && state.satellite !== this.app.currentSatellite) {
            await this.app.selectSatellite(state.satellite);
        }

        if (state.mode && state.mode !== this.app.currentMode) {
            this.app.switchMode(state.mode);
        }

        if (state.zoom) {
            const svg = this.app.projection.svg;
            const zoom = this.app.projection.zoom;
            svg.call(zoom.transform, d3.zoomIdentity.scale(state.zoom));
        }

        if (state.showSwath === false) {
            this.app.spotlight.showSwath = false;
            document.getElementById('btn-toggle-swath')?.classList.remove('active');
        }

        if (state.showTerminator === false) {
            this.app.terminator.showTerminator = false;
            document.getElementById('btn-toggle-terminator')?.classList.remove('active');
        }

        if (state.time) {
            // Set up playback to this specific time
            // This would pre-fill the playback panel and auto-start
            const pbStart = document.getElementById('pb-start');
            if (pbStart) {
                pbStart.value = state.time.toISOString().slice(0, 16);
            }
        }
    }

    /**
     * Listen for hash changes (user navigates back/forward).
     */
    listenForHashChanges() {
        window.addEventListener('hashchange', () => {
            const state = this.parseHash();
            if (state) this.applyState(state);
        });
    }
}
```

### Browser History API considerations

**`replaceState` vs `pushState`:**
- `replaceState`: Updates the URL without adding a history entry. Use this for continuous state updates (satellite moves, zoom changes). The back button still goes to the previous page.
- `pushState`: Adds a history entry. Use this only for discrete user actions (switching satellite, changing mode). This lets the back button undo mode switches.

**Recommended approach:** Use `replaceState` for everything. The orbit tracker is a single-page app with continuous updates; creating history entries would fill the browser history and break the back button. If the user wants to return to a previous state, they can re-share the URL.

```javascript
// In switchMode(), selectSatellite(), and toggle handlers:
this.stateUrl.scheduleUpdate();  // debounced replaceState

// NOT on every animation frame or position update
```

**The `hashchange` event:**
- Fires when `window.location.hash` changes
- Does NOT fire when using `replaceState` (only with `pushState` or direct hash changes)
- This means the `hashchange` listener only fires if the user manually edits the URL or clicks a shared link

### Share button implementation

```javascript
function addShareButton() {
    const btn = document.createElement('button');
    btn.className = 'control-btn';
    btn.textContent = 'Share';
    btn.title = 'Copy shareable URL';

    btn.addEventListener('click', async () => {
        // Force a hash update first
        this.stateUrl.updateHash();

        const url = window.location.href;

        try {
            // Modern Clipboard API (requires HTTPS or localhost)
            await navigator.clipboard.writeText(url);
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = 'Share'; }, 2000);
        } catch (err) {
            // Fallback for HTTP or older browsers
            const input = document.createElement('input');
            input.value = url;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = 'Share'; }, 2000);
        }
    });

    // Insert into the time-panel controls
    const controls = document.querySelector('.control-buttons');
    if (controls) controls.appendChild(btn);
}
```

### Alternative: Web Share API

For mobile devices, the Web Share API provides native share dialogs:

```javascript
if (navigator.share) {
    await navigator.share({
        title: `JPSS Tracker - ${this.getSatelliteName(this.currentSatellite)}`,
        url: window.location.href
    });
} else {
    // Fall back to clipboard copy
}
```

The Web Share API is supported on: iOS Safari 12+, Android Chrome 61+, macOS Safari 15+. Not supported on desktop Firefox/Chrome (they implement it but only behind flags).

### Integration with existing architecture

1. Create `frontend/js/state-url.js` as a new module
2. Add `<script src="js/state-url.js"></script>` before `app.js` in `index.html`
3. In `App.init()`, create `this.stateUrl = new StateURL(this)` and call:
   ```javascript
   const initialState = this.stateUrl.parseHash();
   // ... after all initialization ...
   await this.stateUrl.applyState(initialState);
   this.stateUrl.listenForHashChanges();
   ```
4. In state-changing methods, call `this.stateUrl.scheduleUpdate()`:
   - `switchMode()`
   - `selectSatellite()`
   - Toggle button handlers (swath, terminator, velocity)
   - Zoom change handler
5. Add the Share button to the time-panel controls div

### Gotchas

1. **Race condition on load:** The hash state must be applied AFTER the initial data fetch completes. If the hash specifies `sat=noaa20`, the app must first fetch NOAA-20's TLE and orbit info before applying the mode. The `async applyState()` handles this by awaiting `selectSatellite()`.

2. **Time parameter ambiguity:** A shared URL with `t=2026-03-27T23:00:00Z` could mean "start playback at this time" or "show the live view as of this moment." Recommendation: only include `t=` when playback is active. For live mode, always use current time.

3. **Clipboard API requires secure context:** `navigator.clipboard.writeText()` only works on HTTPS or localhost. Since this app runs on `localhost:5050`, it works in development. For production deployment, ensure HTTPS. The fallback `execCommand('copy')` works everywhere but is deprecated.

4. **URL length:** Keep hash parameters compact. The current schema produces URLs like:
   ```
   #sat=noaa21&mode=live&zoom=1.50
   ```
   This is ~40 characters, well within browser limits (Chrome: 2MB, Firefox: 65536 chars).

5. **Encoding special characters:** The `URLSearchParams` class automatically handles encoding. ISO 8601 dates contain colons which are URL-safe but `+` signs in timezone offsets get encoded as `%2B`. Always use `Z` (UTC) for the time parameter to avoid this.

6. **Bookmark compatibility:** If the user bookmarks a URL with a specific satellite and mode, it should still work months later when the TLE has been updated. The app should handle stale time parameters gracefully -- if `t=` is in the past and the user opens the URL, detect that the time is >1 day old and show a "this link was for a past time, starting playback" prompt rather than silently failing.

---

## Summary: Implementation Priority

| Feature | Effort | Dependencies | Recommendation |
|---------|--------|-------------|----------------|
| F9: Shareable URLs | Small | None | Do first -- pure frontend, no backend changes, immediately useful |
| F6: Time ticks | Small | None | Do second -- pure frontend, builds on existing track data |
| F7: Swath strip | Medium | Backend endpoint or client-side math | Do third -- replaces circle swath, looks much better |
| F8: Coverage heatmap | Medium | New backend endpoint | Do fourth -- replaces spaghetti coverage, needs backend + frontend |

All four features are independent and can be developed in parallel if desired. None require new external libraries or data sources beyond what is already in use (D3.js, sgp4, CelesTrak TLEs).
