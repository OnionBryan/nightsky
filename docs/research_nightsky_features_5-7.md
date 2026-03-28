# Night Sky Viewer -- Research: Features 5, 6, 7

Research findings for three planned features. Each section documents APIs, data sources,
algorithms, integration points, and edge cases for the existing Flask + Skyfield/starplot
backend and VirtualSky + Aladin Lite frontend.

---

## Table of Contents

1. [Feature 5: Observation Log with Catalog Progress Tracking](#feature-5-observation-log-with-catalog-progress-tracking)
2. [Feature 6: Optimized Session Planner](#feature-6-optimized-session-planner)
3. [Feature 7: Bortle-Aware Target Recommendations](#feature-7-bortle-aware-target-recommendations)

---

## Feature 5: Observation Log with Catalog Progress Tracking

### 5.1 Data Model

Each observation record should store:

```json
{
  "id": "uuid-v4",
  "objectId": "M31",
  "objectName": "Andromeda Galaxy",
  "catalog": "messier",
  "ra": 10.6847,
  "dec": 41.2689,
  "dateTime": "2026-03-27T22:15:00-05:00",
  "location": {
    "lat": 35.2271,
    "lon": -80.8431,
    "name": "Charlotte, NC",
    "elevation": 229
  },
  "conditions": {
    "bortle": 6,
    "sqm": 19.5,
    "seeing": 3,
    "transparency": 3,
    "temperature": 12.5,
    "humidity": 65,
    "windSpeed": 8,
    "cloudCover": 10,
    "moonPhase": "Waxing Crescent",
    "moonIllumination": 18
  },
  "equipment": {
    "telescope": "8\" Dobsonian",
    "aperture": 203,
    "focalLength": 1200,
    "eyepiece": "25mm Plossl",
    "magnification": 48,
    "filter": "None",
    "mount": "Alt-Az",
    "camera": null
  },
  "observation": {
    "rating": 4,
    "difficulty": "Easy",
    "notes": "Clearly visible oval glow, dark dust lane visible with averted vision",
    "sketch": null,
    "photo": null
  }
}
```

**Conditions fields explained:**
- `seeing` -- 1 (terrible) to 5 (excellent), Antoniadi scale: I = perfect, V = very bad.
  Standard in amateur astronomy. SkySafari uses 1-5.
- `transparency` -- 1 (very poor) to 5 (excellent). How clear the atmosphere is,
  affecting faint object visibility. Distinct from seeing.
- `moonPhase` and `moonIllumination` -- auto-populated from `Astronomy.calculateMoonPhase(date)`,
  which already exists in the codebase (`astronomy.js`).
- `bortle` -- auto-populated from the existing `/api/lightpollution` endpoint or manual override.

**Rating scale:** 1-5 stars is the most common in SkySafari and Deep-Sky Planner.
Some apps use 1-10. Recommend 1-5 for simplicity with half-star support (so effectively 1-10
in 0.5 increments stored as a float).

### 5.2 Storage Approach

**Primary: IndexedDB (offline-first)**

localStorage is limited to ~5 MB of string data and blocks the UI thread synchronously.
For an observation log that may grow to thousands of entries with potential sketch/photo
attachments, IndexedDB is the correct choice:

- Asynchronous, non-blocking API
- Stores structured objects natively (no JSON serialization needed)
- Supports indexes for fast queries (by date, catalog, object ID, rating)
- Typical quota: hundreds of MB (Chrome allows up to 60% of disk; Firefox up to 50%)
- Supports binary blobs for sketches/photos

**Recommended library:** [localForage](https://github.com/localForage/localForage) --
wraps IndexedDB with a simple localStorage-like API. Falls back to localStorage in
environments without IndexedDB support. 12 KB gzipped, zero dependencies.

**Database schema (IndexedDB stores):**

```
Store: observations
  keyPath: "id"
  indexes: objectId, catalog, dateTime, rating

Store: syncQueue
  keyPath: "id"
  indexes: timestamp, status
```

**Optional backend persistence:**

Add a Flask endpoint pair for sync:

```
POST /api/observations/sync   -- upload local observations (batch)
GET  /api/observations         -- download all observations for user
```

Sync strategy: timestamp-based last-write-wins. Each observation has a `updatedAt`
field. On sync, client sends observations modified since last sync; server responds
with any server-side changes. For a single-user app this is sufficient. Multi-device
sync would need conflict resolution (but is out of scope for v1).

**Migration path:** The existing planner.js already stores observed Messier/Caldwell
sets in localStorage as `nightsky-observed-messier` and `nightsky-observed-caldwell`
(arrays of integer IDs). The new system should:
1. On first load, check for these legacy keys
2. Import them as minimal observation records (object ID + estimated date)
3. Remove the legacy keys after successful migration

### 5.3 Catalog Progress Tracking

**Catalogs and their sizes:**

| Catalog | Count | Source |
|---------|-------|--------|
| Messier | 110 | Already loaded from `data/messier.json` |
| Caldwell | 109 | Already loaded from `data/caldwell.json` |
| Herschel 400 | 400 | Need new `data/herschel400.json` |

**Herschel 400 data source:**

The Herschel 400 is a subset of William Herschel's original catalog, curated by the
Ancient City Astronomy Club (1980). All 400 objects have NGC designations. The
authoritative source is the Astronomical League's Herschel 400 Observing Program.

The data can be cross-referenced with OpenNGC (https://github.com/mattiaverga/OpenNGC)
which contains all NGC/IC objects with full positional and photometric data under
CC-BY-SA-4.0 license. Build the Herschel 400 JSON by filtering OpenNGC's `NGC.csv`
for the known 400 NGC numbers.

**JSON format for Herschel 400 (match existing catalog format):**

```json
{
  "catalog": "Herschel 400",
  "count": 400,
  "objects": [
    {
      "id": "H1",
      "ngc": "NGC 40",
      "name": "Bow-Tie Nebula",
      "type": "Planetary Nebula",
      "constellation": "Cepheus",
      "ra": 3.2250,
      "dec": 72.5253,
      "magnitude": 11.4,
      "size": 0.6,
      "surfaceBrightness": null,
      "description": "..."
    }
  ]
}
```

**Progress computation:**

```javascript
function getCatalogProgress(catalogName) {
    // Query IndexedDB for distinct objectIds in this catalog
    const observed = await db.observations
        .where('catalog').equals(catalogName)
        .uniqueKeys();  // distinct objectIds

    const total = catalogs[catalogName].length;
    const count = observed.length;
    return {
        count,
        total,
        percentage: ((count / total) * 100).toFixed(1),
        remaining: total - count,
        objects: observed  // for coloring the sky map
    };
}
```

**Existing code to extend:** `renderCatalogList()` in planner.js (line ~1068) already
renders progress bars with `progress-fill` CSS. The Herschel 400 catalog just needs to
be added to `PlannerState.catalogs` and `PlannerState.observed` alongside messier and
caldwell.

### 5.4 Export Formats

**CSV Export:**

Generate client-side using the Blob API. No library needed.

```javascript
function exportCSV(observations) {
    const headers = ['Date', 'Object', 'Catalog', 'Type', 'Constellation',
                     'RA', 'Dec', 'Magnitude', 'Bortle', 'Seeing',
                     'Transparency', 'Equipment', 'Rating', 'Notes'];
    const rows = observations.map(obs => [
        obs.dateTime,
        obs.objectId,
        obs.catalog,
        obs.objectName,
        // ... remaining fields, properly escaped
    ]);
    const csv = [headers, ...rows].map(r => r.map(
        v => `"${String(v ?? '').replace(/"/g, '""')}"`
    ).join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    // trigger download via URL.createObjectURL + <a> click
}
```

**JSON Export:**

Straightforward -- serialize the IndexedDB observations array to JSON with
`JSON.stringify(observations, null, 2)` and download as `.json`.

**PDF Export:**

Use [html2pdf.js](https://ekoopmans.github.io/html2pdf.js/) (wraps jsPDF + html2canvas).
~14 KB gzipped. Render an observation summary as a hidden DOM element, then convert:

```javascript
import html2pdf from 'html2pdf.js';

function exportPDF(observations) {
    const element = buildPDFTemplate(observations);  // returns DOM node
    html2pdf().set({
        margin: 10,
        filename: 'observation_log.pdf',
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(element).save();
}
```

The PDF template should include: header with observer info, date range, location;
summary statistics (total observations, catalog completion %); then a table of
observations sorted by date.

**OAL (OpenAstronomyLog) Export:**

OAL is the international standard XML format for astronomical observation exchange
(https://github.com/openastronomylog/openastronomylog). Supported by KStars,
Deep-Sky Planner, Observation Manager, and others. Including OAL export makes the
log interoperable with desktop planetarium software. The schema defines elements for
observer, site, session, scope, eyepiece, filter, target, and observation with all
the fields in our data model.

### 5.5 UI Patterns from Existing Apps

**SkySafari approach:**
- Observation list sorted by date (newest first)
- Each entry shows: object name, date, equipment, 1-5 star rating
- Tap to expand and see full notes
- Filter by catalog, date range, rating
- "Tonight's Best" list dims objects you've already observed
- Syncs via LiveSky.com cloud service

**Stellarium approach:**
- Simpler observing list (not a log)
- No built-in observation recording
- Focus is on "what to observe" not "what I observed"

**Deep-Sky Planner approach:**
- Most comprehensive logging
- Full equipment profiles (save telescope/eyepiece combos)
- Reports exportable as HTML, plain text, CSV
- Supports OpenAstronomyLog 2.1 import/export
- Log entries linked to session (date + location + conditions) to avoid redundancy

**Recommended UI for Night Sky Viewer:**

1. **Log entry form** -- slide-in panel from right side. Auto-populate: date/time,
   location, Bortle, moon phase. User fills in: equipment (dropdown from saved profiles),
   seeing/transparency (1-5 slider), rating (star picker), notes (textarea).

2. **Log list view** -- table/card list with sort (date, catalog, rating) and filter
   (catalog, type, constellation). Each card shows object name, date, rating stars,
   and thumbnail icon for object type.

3. **Catalog progress dashboard** -- three progress rings (Messier, Caldwell, H400)
   with percentage. Click to expand into the full checklist (already partially built
   in planner.js).

4. **Quick log from sky map** -- click an object on VirtualSky, hit "Log Observation"
   in the info popup. This is the most frictionless path.

### 5.6 Color-Coding Observed vs Unobserved on the Sky Map

**VirtualSky integration:**

VirtualSky's `drawStars()` and `drawPlanets()` methods can be extended by hooking into
the `poststars` callback. The planetarium exposes a callback system:

```javascript
state.planetarium.bind('poststars', function() {
    // After stars are drawn, overlay observed status markers
    const ctx = this.ctx;  // canvas 2D context
    const observed = getObservedSet();

    PlannerState.catalogs.messier.forEach(obj => {
        const pos = this.radec2xy(obj.ra * Math.PI / 180, obj.dec * Math.PI / 180);
        if (pos.x < 0 || pos.y < 0) return;  // off screen

        if (observed.has(obj.id)) {
            // Green circle for observed
            ctx.strokeStyle = '#22c55e';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 8, 0, 2 * Math.PI);
            ctx.stroke();
        } else {
            // Dim orange circle for unobserved
            ctx.strokeStyle = 'rgba(251, 146, 60, 0.4)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 6, 0, 2 * Math.PI);
            ctx.stroke();
        }
    });
});
```

**Starplot (backend) integration:**

For the static image generation via the `/api/nightsky/generate` endpoint, the starplot
library's `marker()` method can overlay colored markers. Add an optional request field
`observed_objects: ["M31", "M42", ...]` and use green vs orange markers in
`sky_generator.py`.

### 5.7 Gotchas and Edge Cases

- **Duplicate observations:** Same object can be observed multiple times. The log stores
  every observation; progress tracking counts unique object IDs.
- **ID format inconsistency:** Existing messier.json uses `"id": "M1"` (string) while
  the observed sets in planner.js store integers (`PlannerState.observed.messier.add(id)`
  where `id = parseInt(item.dataset.id)`). The migration must normalize this.
- **IndexedDB quota:** Safari has historically been aggressive with storage limits
  (~1 GB but can prompt for permission). Test on iOS Safari specifically.
- **Time zones:** All observation timestamps should be stored in ISO 8601 with timezone
  offset (e.g., `2026-03-27T22:15:00-05:00`). The existing `get_local_datetime()` in
  `location_utils.py` already handles timezone conversion.
- **Photo/sketch storage:** Base64-encoded images in IndexedDB are fine for small
  sketches (<1 MB each). For photos, store a reference to a file or use the File System
  Access API where available, falling back to download prompts.
- **Herschel 400 overlap:** 11 Caldwell objects and 0 Messier objects overlap with
  the Herschel 400 (since the H400 is exclusively NGC objects not in Messier). Track
  progress per-catalog independently; an NGC object observed counts toward every catalog
  it belongs to.

---

## Feature 6: Optimized Session Planner

### 6.1 The Optimization Problem

**Given:**
- N target objects (from a user's wish list, catalog subset, or "Tonight's Best")
- Observer location (lat, lon)
- Observation date
- Darkness window: from astronomical dusk to astronomical dawn (sun < -18 degrees)
  -- already computed by `Astronomy.calculateTwilightTimes()` in `astronomy.js`
- Minimum altitude threshold (default: 15 degrees above horizon, configurable)

**Find:** An ordered schedule of observations that:
1. Only schedules objects when above minimum altitude
2. Prefers objects near their transit time (maximum altitude = best seeing)
3. Minimizes total slew distance between consecutive targets
4. Accounts for objects that are only available during part of the night
   (e.g., sets early or rises late)

This is a variant of the **Traveling Salesman Problem with Time Windows (TSPTW)** --
an NP-hard optimization problem. For amateur observation planning with 10-50 targets,
heuristic solutions are entirely adequate.

### 6.2 Computing "Best Observation Time" for Each Object

**Transit time** is when an object crosses the observer's meridian (hour angle = 0),
reaching its maximum altitude. This is the single most important time for each object.

**Formula (already implemented in astronomy.js):**

An object transits when: `LST = RA` (Local Sidereal Time equals Right Ascension)

The transit time in civil time:

```
Hour Angle = LST - RA (in degrees)
If HA < 0, object hasn't transited yet (rising)
If HA > 0, object is past transit (setting)

Transit LST = RA_degrees
Transit_JD = JD where LST(JD, lon) = RA_degrees
```

The existing `Astronomy.lst(jd, lon)` function computes LST. To find the civil time
of transit, solve for the JD where `LST = RA_object`. Since LST advances ~361 degrees
per solar day, the transit time shifts ~3m56s earlier each night.

**Maximum altitude at transit:**

```
alt_max = 90 - |lat - dec|

If (lat - dec) > 0: object culminates south of zenith
If (lat - dec) < 0: object culminates north of zenith
If |lat - dec| > 90: object never rises (circumpolar below horizon)
```

For `lat = 35, dec = +41.27` (M31): `alt_max = 90 - |35 - 41.27| = 90 - 6.27 = 83.7 degrees`

**Visibility window for each object:**

Using `Astronomy.calculateRiseTransitSet()` (which the codebase already references in
the ephemeris panel), compute rise and set times. The observation window is the
intersection of:
- [object_rise, object_set] (when object is above min altitude)
- [astro_dusk, astro_dawn] (when sky is dark enough)

Objects that never rise at the observer's latitude are excluded.

### 6.3 Algorithm Options

#### Option A: Greedy Nearest-Neighbor with Time-Priority (Recommended for v1)

This is what SkySafari's "Tonight's Best" effectively does: sort by transit time,
then observe in that order. Simple, intuitive, and produces good results.

**Algorithm:**

```
1. Compute transit time for each target within the darkness window
2. Sort targets by transit time
3. Walk through sorted list:
   a. For each target, check if it's above min_alt at its scheduled time
   b. If not, defer to next available time or skip
   c. Estimate observation duration (default: 10-15 min per object)
4. Output: ordered list with scheduled times
```

**Advantages:** O(n log n), deterministic, easy to understand, matches how
experienced observers naturally plan sessions.

**Disadvantage:** Doesn't minimize slew distance. Two objects transiting at similar
times but in opposite parts of the sky will be scheduled back-to-back.

#### Option B: Greedy Nearest-Neighbor with Slew Minimization

After establishing time windows, apply nearest-neighbor TSP within each time slot.

**Algorithm:**

```
1. Compute visibility windows for all targets
2. Divide the night into time slots (e.g., 30-minute bins)
3. For each slot, identify all visible targets
4. Within each slot, order by angular distance from previous target (greedy NN)
5. Stitch slots together

Angular separation:
  theta = arccos(sin(dec1)*sin(dec2) + cos(dec1)*cos(dec2)*cos(ra1-ra2))
```

The angular separation formula is already implemented in `astronomy.js` as
`Astronomy.angularDistance(ra1, dec1, ra2, dec2)`.

**This is what AstroPlanner does** with its "minimum slewing order" sort.

#### Option C: Weighted Score Optimization (Recommended for v2)

Combine multiple factors into a single score, then use a greedy or beam-search
approach.

```
score(object, time) =
    w1 * altitude_factor(alt(object, time))     // higher is better
  + w2 * transit_proximity(object, time)          // closer to transit = better
  - w3 * slew_distance(object, previous_object)   // less slew = better
  + w4 * setting_urgency(object, time)            // about to set = observe now
  + w5 * brightness_factor(object.magnitude)      // brighter objects easier
```

**Altitude factor:** Peak at 45-60 degrees (best seeing, least atmospheric extinction),
penalty below 25 degrees (high airmass) and above 80 degrees (neck strain at eyepiece).

**Transit proximity:** Gaussian centered on transit time with sigma of ~1 hour.

**Setting urgency:** Objects approaching their set time get a bonus -- observe them
before they're gone. This is critical for objects in the western sky early in the
session.

**Greedy forward search:**

```
schedule = []
remaining = all_targets
current_time = astro_dusk
current_position = (zenith or first target)

while remaining is not empty AND current_time < astro_dawn:
    for each target in remaining:
        compute score(target, current_time)
    best = argmax(scores)
    if best.score > threshold:
        schedule.append((best, current_time))
        current_time += observation_duration
        current_position = best.position
        remaining.remove(best)
    else:
        current_time += 10_minutes  // advance time, re-check
```

### 6.4 How Professional Planners Solve This

**SkySafari "Tonight's Best":**
- Sorts by transit time within the darkness window
- Filters by magnitude (adjusted for equipment in Pro version)
- Dims already-observed objects
- Does NOT optimize slew distance

**AstroPlanner:**
- Explicit "minimum slewing order" sort option
- User manually selects targets, then the software reorders them
- No time-window constraints in the reordering -- purely spatial TSP

**Deep-Sky Planner:**
- Sorts observing lists by transit time, rise time, or set time
- Session planning view shows a timeline with visibility arcs
- Does not optimize for slew distance

**Academic telescope scheduling** (Gomez de Castro & Yanez, 2003):
- Full TSPTW formulation with genetic algorithms
- Considers exposure times, filter changes, calibration needs
- Overkill for amateur visual observation but useful for astrophotography sessions

**The unique differentiator** for Night Sky Viewer would be combining transit-time
priority with slew minimization and setting urgency -- something none of the consumer
apps currently do as an automated optimization.

### 6.5 Presenting the Plan

**Timeline View (primary):**

A horizontal timeline from dusk to dawn showing:
- Darkness bar (astronomical twilight boundaries)
- Moon rise/set overlay
- Each scheduled object as a colored block on the timeline
- Current time indicator (red line)
- Hover/tap for details

```
Dusk ─────────────────────────────────────────────────── Dawn
  ▓▓ M13  ▓▓ M57  ▓▓ M27  ▓▓▓ NGC891  ▓▓ M31  ▓▓ M1  ▓▓
  9:15    9:35    9:55    10:20      10:55   11:20
```

**Ordered List View:**

Table format suitable for use at the telescope:

| # | Object | Type | Const | Mag | Best Time | Alt | Slew |
|---|--------|------|-------|-----|-----------|-----|------|
| 1 | M13 | Glob Cluster | Her | 5.8 | 21:15 | 68 | -- |
| 2 | M57 | Plan Nebula | Lyr | 8.8 | 21:35 | 72 | 14.2 |
| 3 | M27 | Plan Nebula | Vul | 7.5 | 21:55 | 65 | 18.7 |

**Printable Schedule:**

Use the PDF export system (html2pdf.js) to generate a single-page printable sheet:
- Header: date, location, equipment, darkness window, moon info
- Ordered table of targets with finder chart thumbnails (optional)
- Sky map overview showing observation path (numbered dots)

### 6.6 Integration with Existing Architecture

**Frontend (`planner.js`):**

The planner already has:
- Location and date state (`PlannerState`)
- Catalog data loaded (`PlannerState.catalogs.messier`, `.caldwell`)
- Astronomical calculations (`Astronomy.raDecToAltAz`, `.lst`, `.angularDistance`)
- Twilight time computation
- "Tonight's Best" list with visibility scoring

Add a new tab "Session Planner" to the planner page with:
- Target selection (checkbox from Tonight's Best or catalog lists)
- "Optimize" button that runs the algorithm
- Timeline and list views for results

**Backend (optional, for heavy computation):**

If the optimization is too slow client-side for >50 targets, add:

```
POST /api/nightsky/plan
{
  "targets": ["M13", "M57", "M27", ...],
  "latitude": 35.22,
  "longitude": -80.84,
  "date": "2026-03-27",
  "min_altitude": 15,
  "observation_duration": 15
}

Response:
{
  "darkness_window": {
    "dusk": "2026-03-27T20:45:00-04:00",
    "dawn": "2026-03-28T05:30:00-04:00"
  },
  "schedule": [
    {
      "object": "M13",
      "start_time": "2026-03-27T21:15:00-04:00",
      "altitude": 68.2,
      "azimuth": 195.4,
      "transit_time": "2026-03-27T21:42:00-04:00",
      "slew_from_previous": null
    },
    ...
  ],
  "total_slew_distance": 142.7,
  "objects_skipped": ["M55"],
  "skip_reasons": {"M55": "never above 15 degrees at this latitude"}
}
```

### 6.7 Gotchas and Edge Cases

- **Circumpolar objects** have no rise/set -- they're always above the horizon (at
  high-latitude sites). Their "best time" is still their transit, but they can be
  scheduled flexibly as gap-fillers.
- **Objects transiting during twilight** should be flagged but not excluded -- bright
  objects (planets, M45) can be observed in twilight.
- **Moon interference:** Objects within ~30 degrees of the Moon suffer glare. Add a
  penalty to the scoring function when the Moon is above the horizon.
- **Observation duration varies:** A bright globular cluster needs 5 minutes; a faint
  galaxy might need 20+ minutes with averted vision. Allow per-object duration overrides.
- **Weather interruptions:** The plan should be easy to re-optimize mid-session
  ("I lost an hour to clouds, replan from now").
- **Extreme latitudes:** At lat > 60 degrees, summer nights may have no astronomical
  darkness at all. The planner should detect this and warn the user.
- **Empty schedule:** If no targets are above the minimum altitude during the darkness
  window, display a clear message rather than an empty timeline.

---

## Feature 7: Bortle-Aware Target Recommendations

### 7.1 Bortle Scale Classes -- Detailed Reference

The app already has Bortle data in both `astronomy.js` (BORTLE_SCALE constant) and
`lightpollution.js` (BORTLE array). Here is the complete reference including the
critical visibility thresholds:

| Bortle | Name | NELM | SQM (mag/arcsec^2) | Sky Brightness (mcd/m^2) | Notes |
|--------|------|------|-------|------|-------|
| 1 | Excellent Dark | 7.6-8.0 | 21.99 | 0.171 | Zodiacal band, gegenschein visible. M33 easy naked eye. |
| 2 | Typical Dark | 7.1-7.5 | 21.89 | 0.190 | Summer Milky Way highly structured. Clouds = dark holes. |
| 3 | Rural | 6.6-7.0 | 21.69 | 0.230 | Some light domes on horizon. M15, M4, M5 naked eye. |
| 4 | Rural/Suburban | 6.1-6.5 | 21.25 | 0.360 | Light domes in several directions. M31 obvious naked eye. |
| 5 | Suburban | 5.6-6.0 | 20.49 | 0.700 | Milky Way very weak near horizon. M31 visible but not obvious. |
| 6 | Bright Suburban | 5.1-5.5 | 19.50 | 1.740 | Milky Way only at zenith. M33 not visible. M31 difficult. |
| 7 | Suburban/Urban | 4.6-5.0 | 18.94 | 3.050 | Entire sky grayish. Milky Way invisible. |
| 8 | City | 4.1-4.5 | 18.38 | 5.370 | Sky glows white/orange. Only bright constellations. |
| 9 | Inner City | 3.5-4.0 | 17.80 | 9.570 | Only Moon, planets, few stars visible. |

**NELM** = Naked-Eye Limiting Magnitude. Stars fainter than this are invisible.
**SQM** = Sky Quality Meter reading. This is the sky background brightness.
**mcd/m^2** = millicandelas per square meter. Linear brightness unit.

### 7.2 Getting Bortle/SQM Data for Any Location

#### Source 1: lightpollutionmap.info QueryRaster API (Primary)

**Endpoint:** `https://www.lightpollutionmap.info/QueryRaster/`

**Parameters:**
- `ql` -- Query Layer. Options:
  - `wa_2015` -- World Atlas 2015 (Falchi et al.). Returns artificial sky brightness in mcd/m^2
  - `viirs_2024` -- VIIRS satellite radiance. Returns nW/cm^2/sr
  - `viirs_2023`, `viirs_2022`, etc. for historical data
- `qt` -- Query Type: `point` or `area`
- `qd` -- Query Data: `longitude,latitude` for point queries (note: longitude first!)
- `key` -- API key (required; apply to starej@t-2.net)

**Example:**
```
GET https://www.lightpollutionmap.info/QueryRaster/?ql=wa_2015&qt=point&qd=-80.843,35.227&key=YOUR_KEY
```

**Response:** Returns the artificial sky brightness in mcd/m^2 for `wa_2015` layer.

**Rate limit:** 500 requests/day per key. Cache aggressively -- light pollution data
changes slowly (annually at most).

**Conversion from World Atlas value to SQM:**

```
natural_sky_brightness = 0.171168465  // mcd/m^2 (corresponds to 22.0 mag/arcsec^2)
total_brightness = artificial_brightness + natural_sky_brightness
SQM = log10(total_brightness / 108000000) / -0.4
```

Then use the existing `Astronomy.sqmToBortle(sqm)` function to convert to Bortle class.

#### Source 2: Existing Backend Heuristic (Fallback)

The current `/api/lightpollution` endpoint in `external_apis.py` uses reverse geocoding
to estimate Bortle class from address components (city/town/village). This is rough
but works without an API key. Keep it as a fallback.

#### Source 3: VIIRS Tile Data (Advanced/Future)

The Earth Observation Group at Colorado School of Mines provides VIIRS nighttime
light composite tiles. These are GeoTIFF rasters that could be served as map tiles
overlaid on the VirtualSky view. This would be a future enhancement for a light
pollution overlay on the sky map itself.

**Data source:** NASA Black Marble VIIRS VNP46A4 / VJ146A4 yearly composites.

#### Source 4: User Override

Always allow the user to manually set their Bortle class or SQM reading (if they own
an SQM device). The manual value should override any API result.

### 7.3 Object Surface Brightness Data

**The critical field:** For extended objects (galaxies, nebulae, clusters), the total
integrated magnitude is misleading. A mag 8.4 galaxy spread over 11 arcminutes
(M51, the Whirlpool) is much harder to see than a mag 8.8 planetary nebula that's
only 1.4 arcminutes across (M57, the Ring Nebula). Surface brightness is what matters.

#### Computing Surface Brightness

For an object with integrated magnitude `m` and angular area `A` (in arcsec^2):

```
SB = m + 2.5 * log10(A)
```

Where A is the apparent area. For an elliptical object with semi-major axis `a` and
semi-minor axis `b` (both in arcminutes):

```
A = pi * a * b * 3600  // convert arcmin^2 to arcsec^2
  = pi * (a * 60) * (b * 60)
  = 3600 * pi * a * b

SB = m + 2.5 * log10(3600 * pi * a * b)
```

For a circular object with diameter `d` arcminutes:

```
A = pi * (d/2)^2 * 3600 = 900 * pi * d^2
SB = m + 2.5 * log10(900 * pi * d^2)
```

#### OpenNGC Database (Primary Source)

https://github.com/mattiaverga/OpenNGC -- CC-BY-SA-4.0 license.

The `NGC.csv` file contains these relevant columns:

| Column | Description |
|--------|-------------|
| `Name` | NGC/IC identifier |
| `Type` | Object type (G=Galaxy, PN=Planetary Nebula, OC=Open Cluster, etc.) |
| `RA` | Right Ascension (HH:MM:SS.SS) |
| `Dec` | Declination (DD:MM:SS.S) |
| `Const` | Constellation abbreviation |
| `MajAx` | Major axis (arcmin) |
| `MinAx` | Minor axis (arcmin) |
| `V-Mag` | Visual magnitude |
| `B-Mag` | Blue magnitude |
| `SurfBr` | **Surface brightness** (mag/arcsec^2, B-band, galaxies only) |
| `Hubble` | Hubble morphological type (galaxies only) |
| `Messier` | Messier catalog number (if applicable) |

**Critical note:** The `SurfBr` column is only populated for galaxies (from HyperLEDA).
For nebulae and clusters, surface brightness must be computed from magnitude and size
using the formula above.

**Additional file:** `NGC_addendum.csv` contains M40 and M45 (which lack NGC numbers).

#### PyOngc Python Library

https://github.com/mattiaverga/PyOngc -- Python interface for OpenNGC.

```python
import pyongc

obj = pyongc.Dso("NGC5194")  # M51
print(obj.getSurfaceBrightness())  # Returns SB in mag/arcsec^2 (galaxies)
print(obj.getMagnitudes())          # Returns (B-mag, V-mag, J-mag, H-mag, K-mag)
print(obj.getDimensions())          # Returns (major_axis, minor_axis, pa)
```

This library can be used in the Flask backend to serve surface brightness data via API.

#### Enriching Existing Catalog Data

The current `messier.json` and `caldwell.json` files contain `magnitude` and `size`
(diameter in arcminutes) but NOT surface brightness. Two approaches:

**Approach A (recommended):** Pre-compute surface brightness and add it to the JSON files.
For each object, compute `SB = mag + 2.5 * log10(pi * (size/2)^2 * 3600)` and store
as a new `surfaceBrightness` field. For galaxies, use the more accurate OpenNGC `SurfBr`
value instead.

**Approach B:** Compute surface brightness on-the-fly in `astronomy.js` or the backend
when needed.

### 7.4 The Visibility Formula

**Core question:** Can object X be seen from Bortle class Y?

**Simple model (recommended for v1):**

```
Object is visible if:
  1. object.magnitude < NELM(bortle)  // point sources (stars, compact clusters)

  OR (for extended objects):

  2. object.surfaceBrightness < sky_background_SQM + contrast_threshold
```

The **contrast threshold** is the minimum difference between object surface brightness
and sky background needed for detection. This depends on object angular size:

- Large objects (> 10'): need ~0.5 mag/arcsec^2 contrast advantage (low contrast needed
  because the eye integrates over a large area)
- Medium objects (2-10'): need ~1.5 mag/arcsec^2 contrast advantage
- Small objects (< 2'): need ~2.5 mag/arcsec^2 contrast advantage (essentially treated
  as point sources, so integrated magnitude matters more)

**Simplified visibility test:**

```javascript
function isObjectVisible(obj, bortleClass) {
    const bortle = Astronomy.getBortleInfo(bortleClass);
    const skyBrightness = bortle.sqm;  // mag/arcsec^2 (higher = darker)

    // Point source test (stars, compact planetaries, compact globulars)
    if (obj.magnitude <= bortle.limitingMag) {
        return { visible: true, difficulty: 'easy', reason: 'Bright enough as point source' };
    }

    // Extended object surface brightness test
    const sb = obj.surfaceBrightness;
    if (!sb) {
        // Compute from magnitude and size
        const areaArcsec2 = Math.PI * Math.pow(obj.size * 60 / 2, 2);
        sb = obj.magnitude + 2.5 * Math.log10(areaArcsec2);
    }

    // Object SB must be brighter (lower number) than sky background
    // Plus a contrast threshold that depends on size
    const sizeArcmin = obj.size || 1;
    let threshold;
    if (sizeArcmin > 10) threshold = 0.5;
    else if (sizeArcmin > 2) threshold = 1.5;
    else threshold = 2.5;

    const contrast = skyBrightness - sb;  // positive = object brighter than sky

    if (contrast > threshold) {
        return { visible: true, difficulty: 'easy', reason: `SB ${sb.toFixed(1)} vs sky ${skyBrightness}` };
    } else if (contrast > 0) {
        return { visible: true, difficulty: 'challenging', reason: 'Low contrast, use averted vision' };
    } else {
        return { visible: false, difficulty: 'impossible', reason: `Object SB ${sb.toFixed(1)} fainter than sky ${skyBrightness}` };
    }
}
```

**Advanced model (Clark, 1990 / Torres / Crumey, 2014):**

The academic literature provides more sophisticated models. Andrew Crumey's 2014 paper
"Human contrast threshold and astronomical visibility" (MNRAS, 442, 2600-2619) provides
a physics-based model accounting for:
- Telescope aperture and magnification
- Exit pupil size
- Scotopic vs photopic vision
- Ricco's law (spatial summation at small angles)
- Weber-Fechner law (contrast detection)

Jose R. Torres's model (https://www.uv.es/jrtorres/visib.html) is another well-regarded
approach that predicts whether a DSO is visible through a specific telescope/eyepiece
combination at a given sky brightness.

These are overkill for v1 but would be excellent v2 additions for equipment-aware
recommendations.

### 7.5 Presenting Recommendations

**Recommendation categories:**

```
EXCELLENT  -- Object is bright and high-contrast. Easy target for this Bortle class.
GOOD       -- Visible with modest effort. Good telescope target.
CHALLENGING -- Detectable but difficult. Needs good seeing, averted vision, or larger aperture.
SKIP       -- Not visible from this Bortle class. Don't waste time.
BORDERLINE -- Right at the limit. Might work on an exceptional night.
```

**UI presentation:**

1. **Inline badges on Tonight's Best list:**
   Each object card in `updateTonightList()` gets a colored badge:
   - Green: "Easy from Bortle 6"
   - Yellow: "Challenging from Bortle 6"
   - Red: "Skip -- too faint for Bortle 6"

2. **Separate Recommendations panel:**
   ```
   Your Sky: Bortle 6 (Bright Suburban) | NELM: 5.1 | SQM: 19.5

   TONIGHT'S TARGETS (sorted by visibility score):

   [GREEN]  M13 (Hercules Globular) -- mag 5.8, SB 20.4 -- Easy
   [GREEN]  M57 (Ring Nebula) -- mag 8.8, SB 21.1 -- Compact, visible
   [YELLOW] M51 (Whirlpool Galaxy) -- mag 8.4, SB 22.8 -- Challenging, low contrast
   [RED]    M101 (Pinwheel Galaxy) -- mag 7.9, SB 23.5 -- Skip, too diffuse
   [RED]    M33 (Triangulum Galaxy) -- mag 5.7, SB 23.0 -- Skip, large + faint
   ```

3. **Smart suggestions:**
   ```
   "M33 is magnitude 5.7 but has a surface brightness of 23.0 mag/arcsec^2.
   You would need Bortle 3 (Rural Sky) or darker to see it visually.
   The nearest Bortle 3 site is Cherry Springs State Park (180 miles NW)."
   ```

4. **Equipment awareness (v2):**
   ```
   "M51 is challenging naked-eye from Bortle 6, but visible with 8"+ aperture
   at 50-80x magnification (darkens the sky background, improving contrast)."
   ```

### 7.6 Specific Object Visibility by Bortle Class

Pre-computed reference table for common targets (useful for testing):

| Object | Type | Mag | SB (mag/arcsec^2) | B1-2 | B3-4 | B5 | B6 | B7 | B8-9 |
|--------|------|-----|---------|------|------|------|------|------|------|
| M13 | Glob Cluster | 5.8 | ~20.4 | Easy | Easy | Easy | Easy | Vis | Hard |
| M42 | Em Nebula | 4.0 | ~20.1 | Easy | Easy | Easy | Easy | Easy | Vis |
| M31 | Sp Galaxy | 3.4 | ~22.2 | Easy | Easy | Vis | Hard | Hard | Skip |
| M51 | Sp Galaxy | 8.4 | ~22.7 | Easy | Vis | Hard | Hard | Skip | Skip |
| M101 | Sp Galaxy | 7.9 | ~23.5 | Vis | Hard | Skip | Skip | Skip | Skip |
| M33 | Sp Galaxy | 5.7 | ~23.0 | Easy | Vis | Hard | Skip | Skip | Skip |
| M57 | Plan Neb | 8.8 | ~21.1 | Easy | Easy | Easy | Vis | Vis | Hard |
| M27 | Plan Neb | 7.5 | ~20.6 | Easy | Easy | Easy | Easy | Vis | Hard |
| M1 | SN Rem | 8.4 | ~21.5 | Easy | Easy | Vis | Vis | Hard | Skip |
| M45 | Open Cl | 1.6 | N/A | Easy | Easy | Easy | Easy | Easy | Easy |

Note: Open clusters and asterisms don't have meaningful surface brightness values --
they're collections of individual stars. Their visibility is determined by the
brightness of their component stars vs. NELM.

### 7.7 Integration with Existing Architecture

**Backend changes:**

1. **Add surface brightness to catalog data:**
   Enrich `messier.json` and `caldwell.json` with a `surfaceBrightness` field.
   Use OpenNGC's `SurfBr` for galaxies; compute from magnitude + size for others.

2. **Upgrade light pollution endpoint:**
   Modify `/api/lightpollution` in `external_apis.py` to optionally query the
   lightpollutionmap.info QueryRaster API (when API key is configured), falling
   back to the reverse-geocoding heuristic.

   ```python
   @external_apis.route('/api/lightpollution', methods=['GET'])
   def light_pollution():
       lat = request.args.get('lat', 0, type=float)
       lon = request.args.get('lon', 0, type=float)

       # Try QueryRaster API first (if key configured)
       api_key = os.environ.get('LIGHTPOLLUTION_API_KEY')
       if api_key:
           result = query_lightpollution_api(lon, lat, api_key)
           if result:
               return jsonify(result)

       # Fallback to heuristic
       # ... existing code ...
   ```

3. **New recommendation endpoint:**

   ```
   GET /api/nightsky/recommendations?lat=35.22&lon=-80.84&bortle=6

   Response:
   {
     "bortle_class": 6,
     "sqm": 19.50,
     "nelm": 5.1,
     "recommendations": [
       {
         "id": "M13",
         "name": "Hercules Globular",
         "magnitude": 5.8,
         "surface_brightness": 20.4,
         "visibility": "easy",
         "reason": "Bright globular cluster, well above detection threshold"
       },
       {
         "id": "M101",
         "name": "Pinwheel Galaxy",
         "magnitude": 7.9,
         "surface_brightness": 23.5,
         "visibility": "skip",
         "reason": "Surface brightness 23.5 exceeds sky background 19.5 by 4.0 mag"
       }
     ]
   }
   ```

**Frontend changes:**

1. Extend `calculateVisibilityScore()` in `astronomy.js` to incorporate surface
   brightness awareness. Currently it only uses integrated magnitude (line ~1787):
   `const magDiff = limitingMag - obj.magnitude;`. This should be enhanced to use
   surface brightness for extended objects.

2. Add colored badges to the object cards in `updateTonightList()` (planner.js,
   line ~647).

3. Update the Bortle panel in `lightpollution.js` to show a summary of how many
   catalog objects are visible/challenging/impossible at the current Bortle class.

### 7.8 Gotchas and Edge Cases

- **Surface brightness is only meaningful for extended objects.** Stars, double stars,
  and very compact objects (< 10 arcsec) are point sources -- use integrated magnitude
  and NELM comparison instead.
- **Open clusters are tricky.** Their visibility depends on the brightness of individual
  member stars, not the cluster's integrated magnitude. M44 (Beehive, mag 3.1) is visible
  from Bortle 7 because its brightest stars are mag 6-7. Treat open clusters as
  "visible if integrated_magnitude < NELM + 2" as a rough heuristic.
- **Nebulae with high-contrast features.** M42 (Orion Nebula) has a very bright core
  that's visible even from Bortle 8-9, even though its overall surface brightness
  is moderate. The brightest knot (the Trapezium region) is much brighter than the
  average SB. Consider using "peak surface brightness" where available.
- **Emission nebulae vs. reflection nebulae.** Emission nebulae can be enhanced with
  narrowband filters (O-III, UHC, H-alpha) that block light pollution. From Bortle 7,
  M42 through an O-III filter looks dramatically better. The recommendations should
  note when a filter could help.
- **Galaxies viewed edge-on vs. face-on.** Edge-on galaxies (NGC 891, NGC 4565) have
  higher surface brightness along their thin profile than face-on galaxies of similar
  integrated magnitude. The OpenNGC data captures this through the major/minor axis
  ratio.
- **Atmospheric extinction at low altitude.** Objects near the horizon suffer additional
  extinction of ~0.5 mag at 10 degrees altitude, ~0.3 mag at 20 degrees. This should
  be added to the effective magnitude when computing visibility at low altitudes.
  Formula: extinction = 0.2 / sin(altitude_radians) (Rozenberg approximation).
- **SQM variability.** The Bortle class is an average condition. Actual sky brightness
  varies with: moon phase/position, season, weather, atmospheric transparency, time
  of night (sky darkens as city lights turn off after midnight). The recommendations
  should note that borderline objects may be visible on "good nights."
- **Color sensitivity.** The human eye's dark-adapted sensitivity peaks at 507 nm
  (scotopic vision). Emission nebulae emitting at 496/501 nm (O-III) are easier to
  detect than their magnitude suggests. This is why M42 and M8 are more visible than
  predicted by simple magnitude/SB calculations.

---

## Summary of External Data Dependencies

| Data Source | Purpose | License | Rate Limit | Notes |
|-------------|---------|---------|------------|-------|
| OpenNGC (GitHub) | Surface brightness, object dimensions | CC-BY-SA-4.0 | N/A (static download) | Primary catalog database |
| PyOngc (pip) | Python interface to OpenNGC | MIT | N/A | Backend catalog queries |
| lightpollutionmap.info QueryRaster | SQM/Bortle for any location | Requires API key | 500/day | Apply to starej@t-2.net |
| VIIRS/NASA Black Marble | Nighttime light data (raw) | Public domain | N/A | GeoTIFF tiles, advanced use |
| Astronomical League H400 list | Herschel 400 object list | Public | N/A | Cross-reference with OpenNGC |
| localForage (npm/CDN) | IndexedDB abstraction | Apache-2.0 | N/A | 12 KB gzipped |
| html2pdf.js (npm/CDN) | Client-side PDF generation | MIT | N/A | ~14 KB gzipped |

## Summary of New Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `POST /api/observations/sync` | POST | Upload observation log entries |
| `GET /api/observations` | GET | Download observation log entries |
| `POST /api/nightsky/plan` | POST | Generate optimized observation schedule |
| `GET /api/nightsky/recommendations` | GET | Bortle-aware object recommendations |

## Priority Ordering for Implementation

1. **Feature 7 (Bortle recommendations)** -- Highest impact, builds on existing Bortle
   panel and visibility scoring. Mainly requires enriching catalog data with surface
   brightness values and modifying `calculateVisibilityScore()`.

2. **Feature 5 (Observation log)** -- Medium effort. Core storage with IndexedDB,
   migrate from existing localStorage observed sets, add log entry form.

3. **Feature 6 (Session planner)** -- Most complex. Start with Option A (transit-time
   sort), then iterate to Option C (weighted score optimization). The timeline UI is
   the most significant frontend work.
