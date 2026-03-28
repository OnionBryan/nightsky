# Night Sky Viewer -- Feature Research: Features 1-4

Date: 2026-03-27

Research document covering implementation details for four features to add to the Night Sky Viewer app (Flask + Skyfield/starplot backend, VirtualSky + Aladin Lite frontend).

---

## Feature 1: Rise/Transit/Set Times + Altitude vs Time Plot

### Goal

For any selected celestial object (planet, Moon, Sun, or named star), show its rise, transit, and set times for the current night, and render an altitude-vs-time curve so the user can see when it is highest and plan observation windows.

### Backend: Skyfield API

The backend already loads `de421.bsp` and caches a timescale in `sky_generator.py` via `_get_ephemeris()`. All new computation should reuse that cached ephemeris.

#### Key Skyfield Functions

**`almanac.find_risings(observer, target, t0, t1, horizon_degrees=0)`**
- Returns two arrays: `times` (Time objects) and `is_real` (bool array).
- `is_real` is True when the body genuinely crosses the horizon; False when it merely "transits" along the horizon without rising (polar edge case).
- Optional `horizon_degrees` adjusts the threshold (default 0). For the Moon, pass approximately -0.5667 to account for refraction; for the Sun, pass -0.8333 (refraction + semidiameter).

**`almanac.find_settings(observer, target, t0, t1, horizon_degrees=0)`**
- Same signature and return format as `find_risings`.

**`almanac.find_transits(observer, target, t0, t1)`**
- Returns `times` array of meridian transit moments. Unlike risings/settings there is no `is_real` array because transit always happens if the object is above the horizon at all.

**Note on reliability:** Skyfield issue #998 documents that `find_discrete` with `risings_and_settings` can be more reliable than `find_risings`/`find_settings` in certain edge cases. However, the dedicated functions are the recommended API for straightforward cases and are simpler to use. If edge-case bugs appear (high-latitude observers), fall back to:

```python
f = almanac.risings_and_settings(eph, target, observer_location)
times, events = almanac.find_discrete(t0, t1, f)
# events: True = rise, False = set
```

#### Altitude Over Time Computation

Skyfield supports vectorized time arrays natively. To compute altitude at N points over a 12-hour window:

```python
import numpy as np
from skyfield.api import wgs84, load

eph, ts = _get_ephemeris()
earth = eph['earth']
observer = earth + wgs84.latlon(lat, lon)
target = eph['mars']  # or 'moon', 'jupiter barycenter', etc.

# 12-hour window, every 10 minutes = 72 points
t0 = ts.from_datetime(start_dt)
minutes = np.arange(0, 720, 10)
times = ts.from_datetime(start_dt) + minutes / 1440.0  # days
# Or more cleanly:
times = ts.utc(start_dt.year, start_dt.month, start_dt.day,
               start_dt.hour, minutes)

astrometric = observer.at(times).observe(target)
alt, az, dist = astrometric.apparent().altaz()

altitude_data = alt.degrees.tolist()  # numpy array -> list for JSON
```

Key point: `ts.utc()` accepts arrays for any argument and cleanly handles overflow (e.g., minutes > 59 wraps into the next hour).

#### Proposed Backend Endpoint

```
GET /api/nightsky/risesetplot?lat=40.71&lon=-74.00&target=mars&hours=12
```

Response:
```json
{
  "target": "Mars",
  "rise": "2026-03-27T19:42:00-04:00",
  "transit": "2026-03-28T01:15:00-04:00",
  "set": "2026-03-28T06:48:00-04:00",
  "circumpolar": false,
  "never_rises": false,
  "altitude_curve": {
    "times": ["19:00", "19:10", "19:20", ...],
    "altitudes": [-2.3, -0.5, 1.8, ...],
    "azimuths": [95.2, 96.1, 97.0, ...]
  },
  "max_altitude": 58.3,
  "transit_altitude": 58.3
}
```

Target mapping for the endpoint:
- `sun` -> `eph['sun']`
- `moon` -> `eph['moon']`
- `mercury` -> `eph['mercury']`
- `venus` -> `eph['venus']`
- `mars` -> `eph['mars']`
- `jupiter` -> `eph['jupiter barycenter']`
- `saturn` -> `eph['saturn barycenter']`
- Named stars -> `Star(ra_hours=(...), dec_degrees=(...))` from a lookup table

#### Edge Cases

1. **Circumpolar objects:** At high latitudes, some objects never set. `find_risings` returns an empty array. The response should flag `circumpolar: true` and still provide the altitude curve (it will stay above 0 the entire time).

2. **Objects that never rise:** At the opposite extreme. Flag `never_rises: true`. The altitude curve will be entirely negative.

3. **Multiple rises/sets per day:** The Moon can rise/set more than once in a 24-hour window due to its 50-minute daily delay. Return arrays instead of single values if needed.

4. **Sun handling:** The Sun should use `horizon_degrees=-0.8333` (USNO definition accounting for refraction + semidiameter).

5. **Moon handling:** Moon should use `horizon_degrees` approximately `-0.125` (refraction minus the Moon's large semidiameter ~0.26 degrees, but the Moon's parallax is already handled by Skyfield's topocentric calculation).

### Frontend: Chart Library

**Recommendation: Chart.js v4**

Rationale:
- Already well-suited for line charts with time axes.
- ~60 KB minified + gzipped with tree-shaking; can register only the Line controller, TimeScale, etc.
- Dark theme is trivial: set `Chart.defaults.color` and `Chart.defaults.borderColor`.
- The app already loads external JS libraries (VirtualSky, Aladin Lite), so one more is consistent.
- No build step needed -- load from CDN.

CDN:
```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
```

Chart configuration sketch:
```javascript
new Chart(ctx, {
  type: 'line',
  data: {
    labels: response.altitude_curve.times,
    datasets: [{
      label: response.target + ' Altitude',
      data: response.altitude_curve.altitudes,
      borderColor: '#00d4ff',
      backgroundColor: 'rgba(0, 212, 255, 0.1)',
      fill: true,
      tension: 0.3,
      pointRadius: 0
    }]
  },
  options: {
    responsive: true,
    plugins: {
      annotation: {  // chartjs-plugin-annotation for horizon line
        annotations: {
          horizon: {
            type: 'line', yMin: 0, yMax: 0,
            borderColor: '#f59e0b', borderDash: [5, 5]
          }
        }
      }
    },
    scales: {
      y: {
        title: { display: true, text: 'Altitude (deg)' },
        min: -10, max: 90,
        grid: { color: 'rgba(255,255,255,0.1)' }
      },
      x: {
        title: { display: true, text: 'Local Time' },
        grid: { color: 'rgba(255,255,255,0.1)' }
      }
    }
  }
});
```

Alternative considered: D3.js -- far more powerful but overkill for a single line chart, and adds complexity. Chart.js is the right choice here.

### Integration

- Add a new collapsible panel in the controls sidebar (`aside.controls-panel`) or in the info panel area.
- When the user clicks a planet label in the planetarium (VirtualSky) or selects from a dropdown, fetch the endpoint and render the chart.
- The existing `window.NightSky.features.register()` pattern is the right way to add this as a feature module in `frontend/js/features/riseset.js`.
- The `onLocationChange` and `onTimeChange` callbacks should re-fetch data.

---

## Feature 2: Astronomical Twilight / Darkness Window Bar

### Goal

Show a horizontal timeline bar spanning the evening-to-morning period, color-coded to show daylight, civil twilight, nautical twilight, astronomical twilight, and full darkness, with a moon-up overlay.

### Backend: Skyfield Twilight Computation

#### `almanac.dark_twilight_day(eph, location)`

This is the primary function. It builds a step function of time that returns integer codes:

| Code | Constant Name | Meaning |
|------|--------------|---------|
| 0 | `TWILIGHTS[0]` = "Night" | Sun > 18 deg below horizon (full darkness) |
| 1 | `TWILIGHTS[1]` = "Astronomical twilight" | Sun between -18 and -12 deg |
| 2 | `TWILIGHTS[2]` = "Nautical twilight" | Sun between -12 and -6 deg |
| 3 | `TWILIGHTS[3]` = "Civil twilight" | Sun between -6 and -0.8333 deg |
| 4 | `TWILIGHTS[4]` = "Day" | Sun above horizon |

Usage:
```python
from skyfield import almanac
from skyfield.api import wgs84

eph, ts = _get_ephemeris()
location = wgs84.latlon(lat, lon)

# Cover sunset-to-sunrise (a generous 18-hour window from noon to next noon)
t0 = ts.utc(2026, 3, 27, 12)  # local noon (approximately)
t1 = ts.utc(2026, 3, 28, 12)  # next noon

f = almanac.dark_twilight_day(eph, location)
times, events = almanac.find_discrete(t0, t1, f)
```

The `times` array gives the transition moments and `events` gives the new state code at each transition.

#### Moonrise/Moonset for Overlay

```python
moon = eph['moon']
rise_times, rise_real = almanac.find_risings(location, moon, t0, t1)
set_times, set_real = almanac.find_settings(location, moon, t0, t1)
```

Also compute Moon illumination at mid-night:
```python
t_mid = ts.utc(2026, 3, 28, 0)  # midnight
phase_angle = almanac.moon_phase(eph, t_mid)
illumination = (1 - math.cos(math.radians(phase_angle.degrees))) / 2 * 100
```

#### Proposed Backend Endpoint

```
GET /api/nightsky/twilight?lat=40.71&lon=-74.00&date=2026-03-27
```

Response:
```json
{
  "date": "2026-03-27",
  "timezone": "America/New_York",
  "segments": [
    {"start": "12:00", "end": "18:45", "type": "day", "code": 4},
    {"start": "18:45", "end": "19:15", "type": "civil_twilight", "code": 3},
    {"start": "19:15", "end": "19:48", "type": "nautical_twilight", "code": 2},
    {"start": "19:48", "end": "20:22", "type": "astronomical_twilight", "code": 1},
    {"start": "20:22", "end": "04:55", "type": "night", "code": 0},
    {"start": "04:55", "end": "05:28", "type": "astronomical_twilight", "code": 1},
    {"start": "05:28", "end": "06:02", "type": "nautical_twilight", "code": 2},
    {"start": "06:02", "end": "06:32", "type": "civil_twilight", "code": 3},
    {"start": "06:32", "end": "12:00", "type": "day", "code": 4}
  ],
  "moon": {
    "rise": "22:15",
    "set": "08:45",
    "illumination": 42.3,
    "phase_name": "Waxing Crescent"
  },
  "darkness_window": {
    "start": "20:22",
    "end": "04:55",
    "duration_hours": 8.55
  },
  "moonless_darkness": {
    "start": "20:22",
    "end": "22:15",
    "duration_hours": 1.88
  }
}
```

### Frontend: Timeline Bar Rendering

#### HTML Structure

```html
<div class="twilight-bar-container">
  <div class="twilight-bar" id="twilight-bar">
    <!-- Segments injected by JS -->
  </div>
  <div class="twilight-moon-overlay" id="moon-overlay">
    <!-- Moon-up period overlay -->
  </div>
  <div class="twilight-labels">
    <span class="twilight-label" style="left: 0%">6 PM</span>
    <span class="twilight-label" style="left: 25%">9 PM</span>
    <span class="twilight-label" style="left: 50%">12 AM</span>
    <span class="twilight-label" style="left: 75%">3 AM</span>
    <span class="twilight-label" style="left: 100%">6 AM</span>
  </div>
  <div class="twilight-now-marker" id="now-marker"></div>
</div>
```

#### CSS Color Coding

```css
.twilight-segment[data-type="day"]                  { background: #2563eb; }  /* Blue */
.twilight-segment[data-type="civil_twilight"]        { background: #1e40af; }  /* Dark blue */
.twilight-segment[data-type="nautical_twilight"]     { background: #1e3a5f; }  /* Navy */
.twilight-segment[data-type="astronomical_twilight"] { background: #0f1b33; }  /* Very dark blue */
.twilight-segment[data-type="night"]                 { background: #050510; }  /* Near black */

.twilight-moon-overlay {
  position: absolute;
  top: 0;
  height: 100%;
  background: repeating-linear-gradient(
    45deg,
    rgba(255, 255, 200, 0.15),
    rgba(255, 255, 200, 0.15) 2px,
    transparent 2px,
    transparent 6px
  );
  border: 1px solid rgba(255, 255, 200, 0.3);
  pointer-events: none;
}
```

The bar is a `position: relative` container. Each segment is a `position: absolute` div, with `left` and `width` computed as percentages of the 12-hour (6 PM to 6 AM) window. The moon overlay is a hatched pattern superimposed.

#### Rendering Logic

```javascript
function renderTwilightBar(data) {
  const barStart = parseLocalTime("18:00");  // 6 PM
  const barEnd = parseLocalTime("06:00");    // 6 AM next day (18 hours later? or 12)
  const barDuration = 12 * 60;              // 12 hours in minutes

  data.segments.forEach(seg => {
    const startMin = minutesSince6PM(seg.start);
    const endMin = minutesSince6PM(seg.end);
    const leftPct = (startMin / barDuration) * 100;
    const widthPct = ((endMin - startMin) / barDuration) * 100;

    const div = document.createElement('div');
    div.className = 'twilight-segment';
    div.dataset.type = seg.type;
    div.style.left = leftPct + '%';
    div.style.width = widthPct + '%';
    bar.appendChild(div);
  });
}
```

### Edge Cases

1. **Midnight Sun (polar summer):** No darkness segment at all. The bar will be entirely blue/twilight. The endpoint should return `darkness_window: null`.

2. **Polar Night (polar winter):** No daylight segment. The bar will be entirely dark. Still useful to show twilight gradations.

3. **No moonrise/moonset:** The Moon may not rise or set during the window. Handle gracefully -- the overlay may span the entire bar or be absent.

4. **White nights at high latitude:** Only civil twilight at the darkest, no astronomical darkness. Flag this in the response.

---

## Feature 3: Weather/Cloud Forecast Panel (Open-Meteo + 7Timer)

### Goal

Show an hourly weather forecast relevant to astronomical observing: cloud cover at multiple altitudes, visibility, humidity, and wind. Display compactly in a sidebar panel.

### Data Source 1: Open-Meteo (Primary)

**Advantages:** Free, no API key required for non-commercial use, high-resolution models (HRRR for US), reliable uptime, JSON responses, CORS-enabled.

#### Endpoint

```
GET https://api.open-meteo.com/v1/forecast
```

#### Request Parameters

```
?latitude=40.71
&longitude=-74.00
&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,relative_humidity_2m,dew_point_2m,temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m
&timezone=auto
&forecast_days=2
```

Parameter details:
| Parameter | Unit | Description |
|-----------|------|-------------|
| `cloud_cover` | % | Total cloud cover (0 = clear, 100 = overcast) |
| `cloud_cover_low` | % | Low clouds (< 2 km), worst for astronomy |
| `cloud_cover_mid` | % | Mid-level clouds (2-6 km) |
| `cloud_cover_high` | % | High clouds (> 6 km), thin cirrus -- less harmful |
| `visibility` | m | Horizontal visibility in meters |
| `relative_humidity_2m` | % | Dew risk indicator (>85% = dew likely on optics) |
| `dew_point_2m` | C | Dew point; compare with temperature for dew risk |
| `temperature_2m` | C | Ambient temperature |
| `wind_speed_10m` | km/h | Wind at 10m (affects telescope stability) |
| `wind_direction_10m` | deg | Wind direction |
| `wind_gusts_10m` | km/h | Gust speed |

#### Response Format

```json
{
  "latitude": 40.71,
  "longitude": -74.0,
  "elevation": 10.0,
  "generationtime_ms": 1.2,
  "utc_offset_seconds": -14400,
  "timezone": "America/New_York",
  "timezone_abbreviation": "EDT",
  "hourly_units": {
    "time": "iso8601",
    "cloud_cover": "%",
    "cloud_cover_low": "%",
    "cloud_cover_mid": "%",
    "cloud_cover_high": "%",
    "visibility": "m",
    "relative_humidity_2m": "%",
    "temperature_2m": "\u00b0C",
    "wind_speed_10m": "km/h"
  },
  "hourly": {
    "time": ["2026-03-27T00:00", "2026-03-27T01:00", ...],
    "cloud_cover": [45, 38, 22, ...],
    "cloud_cover_low": [10, 5, 0, ...],
    "cloud_cover_mid": [20, 15, 10, ...],
    "cloud_cover_high": [30, 25, 15, ...],
    "visibility": [24140, 24140, 24140, ...],
    "relative_humidity_2m": [65, 68, 72, ...],
    "temperature_2m": [8.2, 7.5, 6.8, ...],
    "wind_speed_10m": [12, 10, 8, ...]
  }
}
```

#### Proxy Endpoint

Do NOT call Open-Meteo directly from the frontend -- route through the Flask backend for caching and CORS consistency:

```
GET /api/nightsky/weather?lat=40.71&lon=-74.00
```

Cache for 30 minutes in the existing `_cache` dict in `external_apis.py`.

### Data Source 2: 7Timer (Supplementary -- Seeing + Transparency)

**Advantages:** Specifically designed for astronomy. Provides seeing and transparency estimates that Open-Meteo does not.

#### Endpoint

```
GET https://www.7timer.info/bin/astro.php?lon=-74.00&lat=40.71&ac=0&unit=metric&output=json&tzshift=0
```

Alternative endpoint (older):
```
GET http://www.7timer.info/bin/api.pl?lon=-74.00&lat=40.71&product=astro&output=json
```

#### Response Format

```json
{
  "product": "astro",
  "init": "2026032706",
  "dataseries": [
    {
      "timepoint": 3,
      "cloudcover": 4,
      "seeing": 3,
      "transparency": 4,
      "lifted_index": 2,
      "rh2m": 10,
      "wind10m": { "direction": "NW", "speed": 2 },
      "temp2m": 8,
      "prec_type": "none"
    },
    ...
  ]
}
```

#### 7Timer Scale Definitions

**Cloud Cover** (1-9):
| Value | Meaning |
|-------|---------|
| 1 | 0-6% |
| 2 | 6-19% |
| 3 | 19-31% |
| 4 | 31-44% |
| 5 | 44-56% |
| 6 | 56-69% |
| 7 | 69-81% |
| 8 | 81-94% |
| 9 | 94-100% |

**Seeing** (1-8, arcseconds):
| Value | Arcsec | Quality |
|-------|--------|---------|
| 1 | < 0.5" | Superb |
| 2 | 0.5-0.75" | Excellent |
| 3 | 0.75-1" | Good |
| 4 | 1-1.25" | Average |
| 5 | 1.25-1.5" | Below average |
| 6 | 1.5-2" | Poor |
| 7 | 2-2.5" | Bad |
| 8 | > 2.5" | Terrible |

**Transparency** (1-8, magnitude loss):
| Value | Meaning |
|-------|---------|
| 1 | < 0.3 mag extinction -- Excellent |
| 2 | 0.3-0.4 mag -- Above average |
| 3 | 0.4-0.5 mag -- Average |
| 4 | 0.5-0.6 mag -- Below average |
| 5 | 0.6-0.7 mag -- Poor |
| 6 | 0.7-0.8 mag -- Bad |
| 7 | 0.8-0.9 mag -- Very bad |
| 8 | > 0.9 mag -- Terrible |

**Wind Speed** (1-8):
| Value | km/h |
|-------|------|
| 1 | < 0.3 (calm) |
| 2 | 0.3-3.4 |
| 3 | 3.4-8.0 |
| 4 | 8.0-10.8 |
| 5 | 10.8-17.2 |
| 6 | 17.2-24.5 |
| 7 | 24.5-32.6 |
| 8 | > 32.6 |

**Relative Humidity** (coded):
| Value | Meaning |
|-------|---------|
| -4 | 0-5% |
| -3 | 5-10% |
| -2 | 10-15% |
| -1 | 15-20% |
| 0 | 20-25% |
| ... | increments of 5% |
| 16 | 100% |

#### 7Timer Gotchas

- 3-hour resolution (vs. hourly for Open-Meteo).
- Only 3-day forecast (vs. 7+ days for Open-Meteo).
- No CORS headers -- must proxy through the Flask backend.
- The server can be slow or occasionally down.
- `init` field is the GFS model initialization time (format: YYYYMMDDHH), `timepoint` is hours offset from init.
- Response time can be 2-5 seconds; cache aggressively (1 hour minimum).

#### Proposed Backend Endpoint

Merge both sources into a single response:

```
GET /api/nightsky/weather?lat=40.71&lon=-74.00
```

Response:
```json
{
  "hourly": [
    {
      "time": "2026-03-27T20:00",
      "cloud_cover": 22,
      "cloud_cover_low": 0,
      "cloud_cover_mid": 10,
      "cloud_cover_high": 15,
      "visibility_m": 24140,
      "humidity": 72,
      "dew_point_c": 3.2,
      "temp_c": 6.8,
      "wind_kmh": 8,
      "wind_dir": 270,
      "seeing_arcsec": "0.75-1.0",
      "seeing_label": "Good",
      "transparency_label": "Average",
      "astronomy_score": 78
    },
    ...
  ],
  "summary": {
    "best_window": { "start": "22:00", "end": "03:00", "score": 85 },
    "overall": "Good"
  }
}
```

The `astronomy_score` is a composite: weighted average of cloud cover (40%), seeing (25%), transparency (20%), humidity (10%), wind (5%). Compute on the backend.

### Frontend: Compact Display

Render as a compact horizontal bar chart or icon grid inside a collapsible sidebar section.

#### Layout Option A: Stacked Bar Chart (recommended)

For each hour in the nighttime window (6 PM to 6 AM), show a vertical column:

```
         20  21  22  23  00  01  02  03  04  05
Cloud  [ |  |  |  |  |  |  |  |  |  ]  <- color-coded bars
See    [ |  |  |  |  |  |  |  |  |  ]  <- green/yellow/red
Transp [ |  |  |  |  |  |  |  |  |  ]
Wind   [ |  |  |  |  |  |  |  |  |  ]
Score  [78][82][85][88][85][80][75][70][65][50]
```

Each cell is a small colored rectangle:
- Cloud: green (0-25%), yellow (25-50%), orange (50-75%), red (75-100%)
- Seeing: green (<1.5"), yellow (1.5-2"), red (>2")
- Wind: green (<15 km/h), yellow (15-25), red (>25)

#### Layout Option B: Hourly Cards

Scrollable row of compact cards, each showing one hour with icons:
```
[22:00]
Cloud: 15%
See: Good
Temp: 5C
Wind: 8 km/h
Score: 85/100
```

#### CSS Implementation

```css
.weather-grid {
  display: grid;
  grid-template-columns: 60px repeat(12, 1fr);
  gap: 1px;
  font-size: 0.7rem;
}

.weather-cell {
  height: 20px;
  border-radius: 2px;
  transition: background 0.2s;
}

.weather-cell[data-score="5"] { background: #10b981; }  /* Excellent */
.weather-cell[data-score="4"] { background: #34d399; }  /* Good */
.weather-cell[data-score="3"] { background: #f59e0b; }  /* Fair */
.weather-cell[data-score="2"] { background: #f97316; }  /* Poor */
.weather-cell[data-score="1"] { background: #ef4444; }  /* Bad */
```

### Integration

- Register as `window.NightSky.features.register('weather', ...)`.
- Add a collapsible panel below the time controls in the sidebar.
- Fetch on location change (debounced -- 500ms after last change).
- Auto-refresh every 30 minutes via `setInterval`.
- Indicate data freshness with a "Last updated: X min ago" timestamp.

---

## Feature 4: Red-Light Full-UI Mode (CSS Only)

### Goal

A full-UI red-on-black theme that preserves the observer's dark adaptation. Toggle via a button, with persistence across sessions.

### Color Science

Human rod cells (scotopic vision) are most sensitive at ~507 nm (blue-green). Red light at 620-650 nm does not trigger rod cells, preserving rhodopsin levels. Professional astronomy apps (Stellarium, SkySafari, Cartes du Ciel) universally use deep red.

Optimal wavelength: **~630 nm** (the standard for astronomy red LEDs).

The CSS `hsl()` model maps 630 nm approximately to hue 0-5 degrees (pure red). A display pixel emitting only the red channel approximates this.

### Existing Implementation

The planner page (`planner.html` / `planner.css`) already has a working night mode that should be taken as the baseline and extended to the main viewer.

Planner's current night-mode CSS custom properties (from `planner.css` lines 45-68):

```css
[data-theme="night"] {
    --bg-primary: #0f0000;
    --bg-secondary: #1a0505;
    --bg-tertiary: #250808;
    --bg-card: #1f0606;

    --text-primary: #ff6666;
    --text-secondary: #cc4444;
    --text-muted: #993333;

    --accent-primary: #ff3333;
    --accent-secondary: #cc2222;
    --accent-glow: rgba(255, 51, 51, 0.3);

    --border-color: #3a1010;
    --border-hover: #4a1515;

    --success: #66aa66;
    --warning: #cc8833;
    --error: #ff4444;
}
```

Planner also applies a blanket SVG/image filter:
```css
[data-theme="night"] img,
[data-theme="night"] svg {
    filter: sepia(100%) saturate(300%) brightness(70%) hue-rotate(-50deg);
}
```

And the JS toggle uses `document.documentElement.setAttribute('data-theme', 'night')` with `localStorage` persistence via key `nightsky-nightmode`.

### CSS Custom Properties for styles.css (Main Viewer)

The main `styles.css` already defines all colors via `--var` custom properties on `:root`, making it perfectly set up for theming. Add these rules to `styles.css`:

```css
/* ================================================================
   RED NIGHT MODE - Preserves dark adaptation for astronomy
   Toggle: document.documentElement.setAttribute('data-theme', 'night')
   ================================================================ */

[data-theme="night"] {
    /* Backgrounds: pure dark reds, no blue channel */
    --bg-primary: #0a0000;
    --bg-secondary: #140404;
    --bg-tertiary: #1e0606;
    --bg-card: #180505;

    /* Text: dim red tones */
    --text-primary: #cc5555;
    --text-secondary: #993333;
    --text-muted: #662222;

    /* Accents: bright red replaces cyan */
    --accent-primary: #dd3333;
    --accent-secondary: #aa2222;
    --accent-glow: rgba(200, 50, 50, 0.25);

    /* Borders */
    --border-color: #331010;
    --border-hover: #441515;

    /* Semantic colors */
    --success: #558833;
    --warning: #996633;
    --error: #cc3333;
}

/* Kill blue channel from all images/SVGs */
[data-theme="night"] img:not(.night-exempt),
[data-theme="night"] svg:not(.night-exempt) {
    filter: sepia(100%) saturate(300%) brightness(70%) hue-rotate(-50deg);
}

/* Gradient text in header needs override */
[data-theme="night"] .header h1 {
    background: none;
    -webkit-text-fill-color: var(--accent-primary);
    color: var(--accent-primary);
}
```

### Handling VirtualSky

VirtualSky renders to a `<canvas>` element, so CSS filters can be applied to the canvas directly:

```css
[data-theme="night"] #starmap canvas {
    filter: sepia(100%) saturate(500%) brightness(60%) hue-rotate(-50deg);
}
```

However, this is imprecise. VirtualSky also supports color customization via its initialization options:

```javascript
// VirtualSky configurable color properties:
{
    negative: false,          // Invert colors (white sky)
    colour: {
        "sky": "rgb(0,0,0)",             // Background color
        "cardinal": "rgb(163,105,80)",   // Cardinal direction labels
        "constellations": "rgb(180,180,255)", // Constellation lines
        "constellationlabels": "rgb(200,200,255)",
        "gridlines_az": "rgb(100,100,100)",
        "gridlines_eq": "rgb(100,100,100)",
        "stars": "rgb(255,255,255)",
        "sun": "rgb(255,255,0)"
    }
}
```

**Recommended approach for VirtualSky:**

On night mode toggle, dynamically update the planetarium's color settings:

```javascript
function applyNightModeToVirtualSky(planetarium, enabled) {
    if (!planetarium) return;

    if (enabled) {
        planetarium.colour = {
            sky: "rgb(10,0,0)",
            cardinal: "rgb(150,60,60)",
            constellations: "rgb(100,40,40)",
            constellationlabels: "rgb(130,50,50)",
            gridlines_az: "rgb(60,20,20)",
            gridlines_eq: "rgb(60,20,20)",
            stars: "rgb(200,80,80)",
            sun: "rgb(200,80,0)"
        };
    } else {
        // Restore defaults
        planetarium.colour = { /* original colors */ };
    }
    planetarium.draw();  // Force redraw
}
```

If VirtualSky does not expose `colour` for runtime changes (it may only accept them at init time), the CSS canvas filter is the fallback. Test both approaches.

### Handling Aladin Lite

Aladin Lite v3 renders via WebGL to a canvas. There is no built-in red/night mode. Options:

1. **CSS filter on the container** (preferred):
```css
[data-theme="night"] #aladin-container canvas {
    filter: sepia(100%) saturate(500%) brightness(50%) hue-rotate(-50deg);
}
```

2. **Aladin Lite API color options**: The `backgroundColor` property can be set in the Aladin Lite configuration, but this only affects the background, not the rendered sky imagery. Grid color can be set via `gridColor` and `gridOpacity`.

3. **WebGL post-processing**: Not practical without modifying Aladin Lite source.

The CSS filter approach is the pragmatic solution. It will shift the sky survey imagery to red tones. The quality is not perfect (some color information is lost), but it is functionally correct for dark adaptation preservation.

Aladin Lite's own UI overlays (zoom controls, layer controls) have CSS classes that can be targeted:
```css
[data-theme="night"] .aladin-fullscreen,
[data-theme="night"] .aladin-zoomControl,
[data-theme="night"] .aladin-gotoControl,
[data-theme="night"] .aladin-layersControl {
    filter: sepia(100%) saturate(300%) brightness(70%) hue-rotate(-50deg);
}
```

### Toggle Implementation

Add a toggle button to the main viewer header (matching the planner's existing pattern):

```html
<button id="night-mode-toggle" class="icon-btn" title="Toggle Red Night Mode">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="5"/>
        <line x1="12" y1="1" x2="12" y2="3"/>
        <line x1="12" y1="21" x2="12" y2="23"/>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
        <line x1="1" y1="12" x2="3" y2="12"/>
        <line x1="21" y1="12" x2="23" y2="12"/>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
</button>
```

JavaScript (share localStorage key with planner for consistency):

```javascript
function initNightMode() {
    const btn = document.getElementById('night-mode-toggle');
    const saved = localStorage.getItem('nightsky-nightmode');

    if (saved === 'true') {
        document.documentElement.setAttribute('data-theme', 'night');
        btn?.classList.add('active');
        applyNightModeToVirtualSky(state.planetarium, true);
    }

    btn?.addEventListener('click', () => {
        const isNight = document.documentElement.getAttribute('data-theme') === 'night';

        if (isNight) {
            document.documentElement.removeAttribute('data-theme');
            btn.classList.remove('active');
            applyNightModeToVirtualSky(state.planetarium, false);
        } else {
            document.documentElement.setAttribute('data-theme', 'night');
            btn.classList.add('active');
            applyNightModeToVirtualSky(state.planetarium, true);
        }

        localStorage.setItem('nightsky-nightmode', !isNight);
    });
}
```

### Gotchas

1. **VirtualSky re-init:** If VirtualSky is re-initialized (e.g., on projection change), the color override must be reapplied. Hook into the existing projection-change handler.

2. **Chart.js in night mode:** If Feature 1 uses Chart.js, its colors also need to switch. Use the same CSS custom properties:
```javascript
Chart.defaults.color = getComputedStyle(document.documentElement)
    .getPropertyValue('--text-secondary').trim();
```

3. **Aladin Lite canvas stacking:** Aladin Lite creates multiple canvas layers. The CSS filter needs to target the container, not individual canvases, to catch them all.

4. **Print/screenshot:** Users may want to screenshot in normal colors. Consider adding a "disable for screenshot" note or keyboard shortcut.

5. **Brightness:** Even in red mode, a 100% brightness display can be too bright. Consider adding an optional CSS `brightness()` filter at 60-80% on the entire body for extreme dark sites:
```css
body[data-brightness="low"] {
    filter: brightness(0.6);
}
```

6. **Color contrast:** Ensure the red-on-dark-red text passes WCAG contrast minimums. The planner's values (#ff6666 on #0f0000) yield a contrast ratio of approximately 6.5:1 (passes AA). The slightly dimmer values proposed here (#cc5555 on #0a0000) yield approximately 5.8:1 (still passes AA).

---

## Architecture Summary

### New Backend Files / Changes

| File | Change |
|------|--------|
| `server.py` | Add routes: `/api/nightsky/riseset`, `/api/nightsky/twilight`, `/api/nightsky/weather` |
| `external_apis.py` | Add Open-Meteo proxy and 7Timer proxy with caching |
| `almanac_utils.py` (new) | Rise/set/transit computation, twilight computation, altitude curve generation |

### New Frontend Files / Changes

| File | Change |
|------|--------|
| `css/styles.css` | Add `[data-theme="night"]` custom properties block |
| `js/features/riseset.js` | Feature module: fetch + Chart.js altitude plot |
| `js/features/twilight.js` | Feature module: fetch + render timeline bar |
| `js/features/weather.js` | Feature module: fetch + render forecast grid |
| `js/app.js` | Add night mode toggle init, hook VirtualSky color overrides |
| `index.html` | Add Chart.js CDN, night mode button, panel containers |

### Dependency Additions

| Dependency | Where | Purpose |
|-----------|-------|---------|
| Chart.js v4 | Frontend CDN | Altitude plot |
| chartjs-adapter-date-fns | Frontend CDN | Time axis for Chart.js |
| (none) | Backend | All computation uses existing skyfield + numpy |
