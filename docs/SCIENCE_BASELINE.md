# Science Baseline

**Date:** 2026-07-20  
**Purpose:** Freeze what is scientifically correct, what is approximate, and what was fixed before further feature work.  
**Gate:** `backend/venv/bin/python -m unittest tests.test_science_baseline -v`

---

## Executive summary

| Subsystem | Status | Accuracy class |
|-----------|--------|----------------|
| SGP4 propagation (sgp4 lib) | **Baselined** | Library-grade |
| TEME → ECEF → WGS84 geodetic | **Baselined** | ≤ **50 m** vs Skyfield (measured ~5–20 m) |
| TLE epoch / orbital element parse | **Baselined** | Exact (format-defined) |
| Mean altitude from mean motion | **Approximate** | ~5–15 km (Kepler + equatorial R) |
| VIIRS swath *strip* (frontend) | **Acceptable viz** | Great-circle half-width along track |
| VIIRS swath *disk* (API `/api/swath`) | **Approximate** | Nadir disk ≠ scan strip |
| Day/night terminator (frontend) | **Improved** | ~0.2–0.5° subsolar (was ~1–4°) |
| GEO look angles | **Fixed + baselined** | Matches ENU vector geometry |
| Night sky planets / Moon / twilight | **Baselined** | Skyfield + DE421 |
| `is_nighttime()` | **Fixed** | Solar elevation &lt; 0° (was fixed clock hours) |
| “Polar crossings” API | **Corrected naming** | Always was **equator nodes** |

You are **safe to build on** the orbital pipeline and Skyfield-backed night-sky ephemeris. Treat swath disks, Kepler mean altitude, and terminator as **visualization-grade**, not flight-dynamics products.

---

## 1. Orbital mechanics (Orbit API)

### 1.1 Pipeline

```
TLE (CelesTrak) → sgp4.Satrec → TEME (r, v)
                              → Rz(GMST) → ECEF
                              → iterative WGS84 → lat, lon, alt
```

- **SGP4:** Vallado implementation via `sgp4` package — correct choice for TLE work.
- **Frame:** TEME → PEF/ECEF via **GMST only** (no polar motion, no UT1–UTC). Expected residual vs full ITRF is order **tens of meters** for LEO — consistent with measurements.
- **WGS84 constants:** `a = 6378.137 km`, `f = 1/298.257223563`, `e² = 0.00669437999014` — standard.
- **GMST:** IAU 1982 polynomial; at J2000.0 yields **280.460618°** (pass).

### 1.2 Measured error vs Skyfield

Using the catalog fallback NOAA-21 TLE and Skyfield `EarthSatellite` + `wgs84.geographic_position_of` at 0–48 h from epoch:

| Quantity | Typical error | Baseline limit in tests |
|----------|---------------|-------------------------|
| Horizontal (lat/lon) | **5–21 m** | **50 m** |
| Geodetic altitude | **&lt; 0.5 m** | **5 m** |
| ECEF position \|Δr\| | **~20 m** | — |

**Verdict:** Ground-track science is solid for visualization, coverage heatmaps, and education. Not claimed as precision orbit determination.

### 1.3 Velocity

| Field | Meaning |
|-------|---------|
| `velocity_km_s` | **Inertial (TEME) speed** — classical orbital velocity (~7.4 km/s for JPSS) |
| `velocity_ecef_km_s` | ECEF-frame speed (includes Earth rotation) |

Previously only ECEF magnitude was returned under `velocity_km_s`, which inflated “orbital velocity” by ~0.1–0.5 km/s.

### 1.4 Mean altitude from mean motion

`calculate_altitude` / `get_orbit_info` use Kepler’s law with `GM = 398600.4418` and `a − R_eq`. Issues (accepted for display):

1. SGP4 mean motion is **Kozai-adjusted**, not pure Keplerian `n`.
2. SGP72 constants inside SGP4 ≠ WGS84 GM exactly.
3. Subtracting **equatorial** radius understates mean altitude vs mean-Earth-radius conventions (~824 km often cited for JPSS → we get ~827 km with this TLE).

**Do not** use this for precise altitude products; use instantaneous geodetic altitude from the propagator.

### 1.5 Equator / node crossings

`find_equator_crossings` (alias `find_polar_crossings`) detects **latitude zero-crossings** (ascending/descending nodes), with linear time/longitude interpolation inside the 30 s sample.

- API: prefer **`/api/equator-crossings`**; `/api/polar-crossings` kept for compatibility.
- Not polar passages (those would be max |lat| or 80°N/S events).

### 1.6 Swath geometry

| Representation | Where | Physics |
|----------------|-------|---------|
| Cross-track **strip** | `frontend/js/orbit-renderer.js` `drawSwathStrip` | Half-width perpendicular to ground-track bearing — correct *class* of model for VIIRS |
| Nadir **disk** | `generate_swath_polygon`, spotlight, globe | Circle of radius half-swath — **rough “now” footprint only** |

True VIIRS is a pushbroom/scan **strip** ~3060 km wide; edges are not a geodesic circle about nadir. Catalog `swath_km` values are nominal instrument widths.

---

## 2. Night sky (Night Sky API)

### 2.1 High confidence (Skyfield + DE421)

- **Twilight segments:** `almanac.dark_twilight_day` — civil / nautical / astronomical standards.
- **Moon phase angle:** Skyfield `almanac.moon_phase` — 0° new, 90° first quarter, 180° full, 270° last.
- **Illumination:** `(1 − cos φ) / 2` — correct fraction of lunar disk illuminated for phase angle φ.
- **Planet alt/az:** Topocentric apparent place via Skyfield.
- **Rise/set curves:** Skyfield-based (see `/api/nightsky/riseset`).

### 2.2 GEO look angles — **fixed 2026-07-20**

**Bug:** Prior spherical-trig azimuth adjustments failed in the southern hemisphere and for large Δlongitude (errors of **30–150°**). Elevation was already correct.

**Fix:** ECEF line-of-sight → local **ENU** azimuth/elevation on spherical Earth (`R_EARTH`, `R_GEO = 42164.17 km`).

**Residual model limits (accepted):**

- Spherical Earth (no WGS84 ellipsoid / observer geoid height).
- Ideal GEO (lat = 0, circular radius `R_GEO`); no inclination/eccentricity from real TLE.
- Catalog longitudes can go stale (e.g. Himawari operational slot history).

### 2.3 `is_nighttime()` — **fixed 2026-07-20**

**Bug:** Hard-coded local hours 18:00–06:00 — wrong for polar night/day and seasons.

**Fix:** Approximate solar elevation &lt; 0°. For precision twilight, use `/api/nightsky/twilight`.

### 2.4 Light pollution / Bortle

Heuristic from reverse-geocode place type — **not** a scientific Bortle measurement. Label as estimate only.

---

## 3. Frontend terminator

**Before:** Sinusoidal declination + subsolar lon = 180° − 15°×UTC hours (no equation of time). Errors up to **~4° longitude** and **~1° declination** vs Skyfield near EoT extrema.

**After:** Low-order solar longitude (mean anomaly + equation of center) + GMST → RA/Dec → subsolar lon. Expected error **~0.2–0.5°**.

Still visualization-grade (no refraction, no nutation, no UT1).

---

## 4. Constants checklist

| Constant | Value | Role |
|----------|-------|------|
| WGS84 `a` | 6378.137 km | Geodetic / mean altitude display |
| WGS84 `f` | 1/298.257223563 | Geodetic |
| Earth ω | 7.292115×10⁻⁵ rad/s | TEME→ECEF velocity |
| GM (Kepler display) | 398600.4418 km³/s² | Mean altitude only |
| Mean R (haversine/swath) | 6371 km | Great-circle helpers |
| GEO radius | 42164.17 km | GEO look angles |
| VIIRS swath | 3060 km (half 1530) | JPSS catalog default |
| TLE Y2K years | 00–56 → 2000s; 57–99 → 1900s | NORAD convention |

---

## 5. Explicit non-goals (do not claim)

1. Precision orbit determination / conjunction assessment  
2. Sensor boresight / scan-angle level VIIRS geolocation  
3. Full IAU SOFA / EOP (polar motion, UT1) transforms  
4. Photometric “visible” planets (magnitude, extinction, sky brightness)  
5. Authoritative GEO station-keeping longitudes without live TLE  

---

## 6. Regression gate

```bash
# From repo root, with backend venv (sgp4, skyfield, numpy, …)
backend/venv/bin/python -m unittest tests.test_science_baseline -v
```

All tests must pass before new science features land. If a tolerance must change, update this document and the test comment in the same PR.

---

## 7. Fixes applied in this baseline

1. **GEO azimuth** rewritten (ENU vector method)  
2. **`velocity_km_s`** = inertial; added `velocity_ecef_km_s`  
3. **Equator crossings** renamed + interpolated; polar path alias documented  
4. **Swath disk** docstring clarifies non-strip geometry  
5. **`is_nighttime`** uses solar elevation  
6. **Terminator** includes equation-of-time class solar model  
7. **`tests/test_science_baseline.py`** locks the above  

---

## 8. Recommended next science work (after gate is green)

1. Optional: feed `/api/swath` a strip polygon from track (match frontend).  
2. Optional: GEO positions from live TLE instead of static longitudes.  
3. Optional: planet apparent magnitude for “Tonight’s Best.”  
4. Keep mean-altitude display labeled “approx.” in UI if shown to users.  
