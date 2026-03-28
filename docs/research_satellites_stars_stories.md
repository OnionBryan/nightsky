# Satellite Expansion & Star Stories Research

**Date:** 2026-03-27
**Purpose:** Research for expanding the NOAA orbit tracker and Night Sky Viewer
**Current state:** Orbit tracker has 3 JPSS satellites (NOAA-21, NOAA-20, Suomi NPP). Night Sky Viewer uses VirtualSky with right-click telescope view via Aladin Lite.

---

## 1. Related Earth Observation Satellites (Polar / Sun-Synchronous)

All satellites below use CelesTrak TLE data via the same `CELESTRAK_BASE` URL pattern already in `tle_fetcher.py`. The existing SGP4 propagator works for all LEO/SSO orbits without modification.

### 1.1 MetOp Series (EUMETSAT) -- JPSS Partner Constellation

The MetOp satellites are the European half of the Initial Joint Polar System (IJPS) with NOAA. They fly the same ~817 km sun-synchronous orbit as JPSS but with a 09:30 local solar time descending node (morning orbit), complementing JPSS's ~13:30 ascending node (afternoon orbit). Together they provide 4x daily global coverage.

| Satellite | NORAD ID | Launch | Alt (km) | Incl | LTAN | Status |
|-----------|----------|--------|----------|------|------|--------|
| MetOp-A | 29499 | 2006-10-19 | 817 | 98.7 | 09:30 | Decommissioned 2021-11 |
| MetOp-B | 38771 | 2012-09-17 | 817 | 98.7 | 09:30 | Operational |
| MetOp-C | 43689 | 2018-11-07 | 817 | 98.7 | 09:30 | Operational (primary) |

**Key instruments:** IASI (Infrared Atmospheric Sounding Interferometer -- high-res atmospheric profiles), AVHRR/3 (imaging radiometer, sea surface temp, vegetation), AMSU-A/MHS (microwave sounding), ASCAT (scatterometer for ocean surface wind), GOME-2 (ozone/trace gas monitoring), GRAS (GPS radio occultation for atmospheric profiles).

**Why interesting alongside JPSS:** Direct partner constellation. MetOp carries AVHRR (heritage NOAA instrument) while JPSS carries VIIRS (its successor). Showing both constellations reveals the full global weather observation system -- morning and afternoon orbits interleaving for maximum temporal coverage. MetOp's IASI and JPSS's CrIS are functionally equivalent atmospheric sounders from different agencies.

**Recommendation:** Add MetOp-B and MetOp-C. MetOp-A is decommissioned. Use color #7c8cf8 (blue-purple) to distinguish from JPSS coral/teal/yellow.

### 1.2 NASA Earth Observing System (EOS)

These are the original sun-synchronous science platforms. Terra and Aqua pioneered the MODIS instrument that VIIRS on JPSS replaced. All are in the "A-Train" or related orbital corridors.

| Satellite | NORAD ID | Launch | Alt (km) | Incl | LTAN | Status |
|-----------|----------|--------|----------|------|------|--------|
| Terra (EOS AM-1) | 25994 | 1999-12-18 | 705 | 98.2 | 10:30 descending | Operational (drifting orbit since 2020) |
| Aqua (EOS PM-1) | 27424 | 2002-05-04 | 705 | 98.2 | 13:30 ascending | Operational (drifting orbit since 2022) |
| Aura (EOS Chem-1) | 28376 | 2004-07-15 | 705 | 98.2 | 13:45 ascending | Operational (limited instruments) |

**Key instruments:**
- **Terra:** MODIS (36-band imager, 250m-1km), ASTER (thermal/VNIR imaging, 15-90m), CERES (Earth radiation budget), MISR (multi-angle imaging), MOPITT (CO mapping)
- **Aqua:** MODIS, CERES, AIRS (infrared sounder, 2378 channels -- the most precise atmospheric sounder ever flown), AMSU-A
- **Aura:** OMI (ozone monitoring), MLS (microwave limb sounder), TES (tropospheric emission spectrometer -- now inactive), HIRDLS (inactive)

**Why interesting alongside JPSS:** Terra and Aqua carry MODIS, the direct predecessor to VIIRS. Showing all four (Terra, Aqua, NOAA-20, NOAA-21) reveals the generational transition of the same measurement capability. Terra's orbit has been drifting since 2020 when NASA stopped maneuvers, so its ground track is no longer repeating -- visually interesting to compare against the precisely maintained JPSS orbits. Aqua flies in the same orbital plane as Suomi NPP and NOAA-20 (the "afternoon constellation" or A-Train).

**Recommendation:** Add all three. Color suggestions: Terra #e67e22 (orange), Aqua #3498db (blue), Aura #9b59b6 (purple). Note these are ~705 km altitude vs. JPSS at ~824 km, so swath width configuration differs.

### 1.3 Landsat Series

| Satellite | NORAD ID | Launch | Alt (km) | Incl | Revisit | Status |
|-----------|----------|--------|----------|------|---------|--------|
| Landsat 8 | 39084 | 2013-02-11 | 705 | 98.2 | 16 days | Operational |
| Landsat 9 | 49260 | 2021-09-27 | 705 | 98.2 | 16 days | Operational |

**Key instruments:**
- **OLI-2** (Operational Land Imager): 9 spectral bands, 15m pan / 30m multispectral
- **TIRS-2** (Thermal Infrared Sensor): 2 thermal bands, 100m resolution

**Why interesting alongside JPSS:** Landsat is the longest-running Earth imaging program (since 1972). Landsat 8 and 9 fly in the same orbit phased 8 days apart for 8-day combined revisit. At 705 km they share the same orbital altitude as the EOS satellites. Their narrow swath (185 km vs VIIRS 3060 km) makes a dramatic visual comparison -- Landsat is a precision scalpel while VIIRS is a wide brush.

**Recommendation:** Add both. Color #27ae60 (green) for the "land" theme.

### 1.4 Sentinel Series (ESA Copernicus)

| Satellite | NORAD ID | Launch | Alt (km) | Incl | Mission | Status |
|-----------|----------|--------|----------|------|---------|--------|
| Sentinel-1A | 39634 | 2014-04-03 | 693 | 98.2 | SAR imaging | Operational |
| Sentinel-2A | 40697 | 2015-06-23 | 786 | 98.6 | Optical imaging | Operational |
| Sentinel-2B | 42063 | 2017-03-07 | 786 | 98.6 | Optical imaging | Operational |
| Sentinel-3A | 41335 | 2016-02-16 | 807 | 98.65 | Ocean/land monitoring | Operational |
| Sentinel-3B | 43437 | 2018-04-25 | 807 | 98.65 | Ocean/land monitoring | Operational |

**Key instruments:**
- **Sentinel-1:** C-band SAR (all-weather, day/night imaging, 5-40m resolution)
- **Sentinel-2:** MSI (Multispectral Instrument, 13 bands, 10-60m resolution, 290km swath)
- **Sentinel-3:** OLCI (ocean/land colour, 21 bands, 300m, 1270km swath), SLSTR (sea/land surface temperature, 1km), SRAL (radar altimeter for sea level and ice)

**Why interesting alongside JPSS:** Sentinel-3 is the most JPSS-like in the Sentinel family -- similar altitude, similar wide-swath ocean/land monitoring mission, carries instruments functionally comparable to VIIRS. Sentinel-3A/B fly 180 degrees apart for <4 day revisit. Sentinel-2 provides Landsat-class multispectral imaging at higher spatial resolution. Sentinel-1's SAR works through clouds, complementing all optical sensors.

**Recommendation:** Add Sentinel-3A and Sentinel-3B as priority (closest to JPSS mission). Optionally add Sentinel-2A/B. Color #e74c3c (red) for Sentinel-3, #c0392b (darker red) for others.

### 1.5 FY-3 Series (China Meteorological Administration)

| Satellite | NORAD ID | Launch | Alt (km) | Incl | LTAN | Status |
|-----------|----------|--------|----------|------|------|--------|
| FY-3D | 43010 | 2017-11-15 | 836 | 98.75 | 14:00 | Operational |
| FY-3E | 49008 | 2021-07-05 | 836 | 98.75 | 05:30 | Operational (early morning orbit) |
| FY-3F | TBD* | 2023-08-04 | 836 | 98.75 | 10:00 | Operational (morning orbit) |
| FY-3G | TBD* | 2023-04-16 | 407 | 50.0 | -- | Precipitation measurement (non-SSO) |

*FY-3F and FY-3G NORAD IDs need verification via CelesTrak lookup at runtime.

**Key instruments:** MERSI-II (25-band medium resolution spectral imager -- Chinese VIIRS equivalent), HIRAS (hyperspectral infrared sounder), MWTS/MWHS (microwave sounders), WindRAD (wind scatterometer on FY-3E), PMR (precipitation measurement radar on FY-3G).

**Why interesting alongside JPSS:** FY-3D flies a near-identical orbit to NOAA-20/21 (afternoon SSO at ~836 km). China now operates four polar orbiting meteorological satellites covering early morning, morning, and afternoon orbits -- the only country to do so. FY-3E is uniquely positioned in the early-morning (dawn/dusk) orbit that no Western satellite currently occupies. FY-3G is notable for being a non-sun-synchronous precipitation satellite at only 407 km altitude and 50 degree inclination.

**Recommendation:** Add FY-3D and FY-3E. FY-3G is interesting but requires different handling (non-SSO orbit). Color #f1c40f (gold).

### 1.6 DMSP Series (US Military Weather)

| Satellite | NORAD ID | Launch | Alt (km) | Incl | Status |
|-----------|----------|--------|----------|------|--------|
| DMSP-F16 | 28054 | 2003-10-18 | 830 | 99.0 | Being decommissioned (data cutoff July 2025) |
| DMSP-F17 | 29522 | 2006-11-04 | 830 | 99.0 | Expected EOL Sept 2026 |
| DMSP-F18 | 35951 | 2009-10-18 | 830 | 99.0 | Expected EOL Dec 2025 |

**Key instruments:** OLS (Operational Linescan System -- visible/IR imager), SSMIS (Special Sensor Microwave Imager/Sounder), SSULI (UV limb sounder), SSJ5 (particle detectors), SSM (magnetometer).

**Why interesting alongside JPSS:** DMSP has been the US military's polar weather satellite since the 1960s. These fly very similar orbits to JPSS (~830 km SSO). DMSP is being phased out, with WSF-M (Weather System Follow-on Microwave) launched in 2024 as the successor. Showing DMSP alongside JPSS demonstrates the parallel military and civilian weather satellite programs. The DMSP OLS is a legacy predecessor to VIIRS for nighttime visible imaging (city lights).

**Recommendation:** Add DMSP-F17 and DMSP-F18 as "legacy" satellites. F16 is being decommissioned. Color #95a5a6 (gray) to indicate sunset status. Note: DMSP TLEs may have delayed availability on CelesTrak due to military sensitivity.

### Summary: Priority Additions for Orbit Tracker

**Tier 1 (add first -- direct JPSS partners):**
- MetOp-B (38771), MetOp-C (43689)
- Sentinel-3A (41335), Sentinel-3B (43437)

**Tier 2 (add next -- complementary science):**
- Terra (25994), Aqua (27424), Aura (28376)
- Landsat 8 (39084), Landsat 9 (49260)
- FY-3D (43010), FY-3E (49008)

**Tier 3 (optional -- legacy/niche):**
- DMSP-F17 (29522), DMSP-F18 (35951)
- Sentinel-2A (40697), Sentinel-2B (42063)

---

## 2. Geostationary Weather Satellites

### Current State

The nightsky backend (`geostationary_utils.py`) already has a comprehensive GEO satellite catalog with look-angle calculations. The orbit tracker (`frontend/`) does not currently show GEO satellites.

### Should GEO Satellites Be Added to the Orbit Tracker?

**Yes, but differently.** GEO satellites do not produce ground tracks -- they hover over a fixed longitude at 0 degrees latitude. They should appear as:
- **Static markers on the equator** at their assigned longitude
- A **geostationary arc** line at 0 degrees latitude, ~35,786 km altitude
- **Clickable for info** (operator, instruments, coverage area)
- **On the 3D globe:** rendered at correct altitude (much higher than the LEO satellites)

### GEO Satellite Catalog for Orbit Tracker

The following are already in `geostationary_utils.py` and should be surfaced in the orbit tracker:

| Satellite | NORAD ID | Longitude | Operator | Coverage |
|-----------|----------|-----------|----------|----------|
| **GOES-19** | **60133** | **-75.2 W** | **NOAA** | **Americas East (replaced GOES-16 Apr 2025)** |
| GOES-18 | 54743 | -137.0 W | NOAA | Americas West |
| GOES-16 | 41866 | -75.2 W (standby) | NOAA | On-orbit backup (since Apr 2025) |
| Himawari-8 | 40267 | 140.7 E | JMA (Japan) | Asia-Pacific |
| Himawari-9 | 41836 | 140.7 E | JMA (Japan) | Asia-Pacific (operational since Nov 2022) |
| Meteosat-11 | 40732 | 0.0 | EUMETSAT | Europe/Africa/Atlantic |
| Meteosat-10 | 38552 | 9.5 E | EUMETSAT | Indian Ocean |
| FY-4A | 41882 | 104.7 E | CMA (China) | East Asia |
| FY-4B | 48808 | 133.0 E | CMA (China) | West Pacific |
| INSAT-3D | 39216 | 82.0 E | ISRO (India) | Indian subcontinent |
| INSAT-3DR | 41752 | 74.0 E | ISRO (India) | Indian subcontinent |
| GK-2A (GEO-KOMPSAT) | 43823 | 128.2 E | KMA (Korea) | East Asia |

**Note on GOES-19:** This satellite (NORAD 60133) replaced GOES-16 as the operational GOES-East on April 7, 2025. The `geostationary_utils.py` file should be updated to reflect GOES-19 at -75.2W as the primary, with GOES-16 moved to on-orbit standby.

**Implementation approach:**
- Add a "GEO Belt" toggle in the orbit tracker constellation mode
- Render GEO satellites as diamonds (not circles) on the equator
- Show coverage footprint cones (visible from ~81 degrees latitude to equator)
- In 3D globe mode, render them at correct 35,786 km altitude with visible cones

### Key instruments on GEO weather satellites:
- **GOES-18/19:** ABI (Advanced Baseline Imager, 16 bands, 0.5-2km), GLM (Geostationary Lightning Mapper)
- **Himawari-9:** AHI (Advanced Himawari Imager, 16 bands -- similar to ABI)
- **Meteosat-11:** SEVIRI (Spinning Enhanced Visible and InfraRed Imager, 12 channels, 3km)
- **FY-4A/B:** AGRI (Advanced Geostationary Radiation Imager, 14 bands)
- **INSAT-3D/3DR:** 6-channel imager + 19-channel atmospheric sounder

---

## 3. Famous/Visible Satellites

### 3.1 ISS (International Space Station)

| Property | Value |
|----------|-------|
| NORAD ID | 25544 |
| Altitude | 408-420 km |
| Inclination | 51.6 degrees |
| Period | ~92 minutes |
| Brightness | Up to magnitude -6 (brighter than Venus) |
| Size | 109m x 73m (football field) |

**Already partially implemented** in the nightsky satellite tracker feature (`nightsky/frontend/js/features/satellites.js`). The feature tracks ISS position and computes overhead passes. Could be extended to the orbit tracker as a "Famous Satellites" layer.

### 3.2 Hubble Space Telescope

| Property | Value |
|----------|-------|
| NORAD ID | 20580 |
| Altitude | ~535 km |
| Inclination | 28.5 degrees |
| Period | ~95 minutes |
| Brightness | Up to magnitude +2 (visible to naked eye in good conditions) |
| Size | 13.2m x 4.2m |

**Why interesting:** Iconic -- most famous telescope ever. Low inclination means it only passes over tropical/subtropical latitudes, so users in higher latitudes never see it overhead. Good educational contrast with the polar-orbiting weather satellites. Currently expected to remain operational into the early 2030s.

### 3.3 Tiangong (Chinese Space Station)

| Property | Value |
|----------|-------|
| NORAD ID | 48274 (Tianhe core module) |
| Altitude | 340-450 km |
| Inclination | 41.5 degrees |
| Period | ~92 minutes |
| Brightness | Up to magnitude -3 (very bright) |
| Size | ~60m along main axis (T-shape) |

**Why interesting:** Second permanently crewed space station. Lower inclination than ISS means different visibility patterns -- visible from latitudes up to about 52 degrees. Launched starting April 2021 (Tianhe), with Wentian and Mengtian lab modules added in 2022.

### 3.4 Starlink Trains

**Challenge:** There are 6000+ active Starlink satellites. Tracking all of them is impractical and would overwhelm the CelesTrak API.

**Approach for the orbit tracker:**
1. **Recently launched batches:** CelesTrak has a `SUPPLEMENTAL/starlink` group. Track only the most recently launched batch (typically 20-60 satellites) which are still in their "train" formation at lower altitude (~350 km) before they disperse to ~550 km.
2. **Bright/notable ones:** After a launch, the train is visible for 1-2 weeks before satellites raise orbits and become dimmer.
3. **Implementation:** Add a "Starlink Train" option that fetches the latest Starlink launch TLEs from CelesTrak's supplemental data. Show them as a cluster of dots in constellation mode.

**Resources:**
- `https://celestrak.org/NORAD/elements/supplemental/sup-gp.php?FILE=starlink&FORMAT=json` -- Latest Starlink TLEs
- `https://findstarlink.com/` -- Good reference for upcoming visible passes
- `https://satellitemap.space/` -- Shows all Starlinks in 3D

**Recommendation:** This is a Tier 3 feature. The orbit tracker is focused on Earth observation/science, and Starlink is communications infrastructure. But it would be a crowd-pleasing "wow" feature in constellation mode to show the train moving together.

---

## 4. Star Stories for the Night Sky Viewer

The app already has a comprehensive `constellations.json` (Greek, Chinese, Arabic, Hebrew, Mesopotamian, Hindu mythology) for zodiac constellations. The following adds **star-specific** popup stories for the 20 brightest stars, suitable for click/hover display.

### 4.1 The 20 Brightest Stars -- Popup Stories

Each entry is designed for a 2-3 sentence popup. Format: Star name, Bayer designation, apparent magnitude, spectral type, distance, then cultural stories.

---

**1. Sirius (Alpha Canis Majoris) -- mag -1.46, A1V, 8.6 ly**

*Greek/Roman:* The "Dog Star" of Orion's faithful hunting hound. Ancient Greeks believed its rising with the Sun brought the scorching "dog days" of summer, and its name means "scorching" or "glowing" in Greek.

*Arabic:* Called ash-Shi'ra al-'Abur ("the Shi'ra who crossed over"), referring to a legend where Sirius crossed the Milky Way to be near Orion. The companion star Procyon is "the Shi'ra who wept" -- crying for the separation.

*Egyptian:* The heliacal rising of Sirius (called Sopdet) marked the annual flooding of the Nile, the most important event in the Egyptian calendar. The star was identified with the goddess Isis.

*Polynesian:* Known as Rehua in Maori tradition, one of the highest chiefs in the heavens. In Hawaiian navigation, Sirius (A'a) is a key directional star in the star compass.

*Science:* Brightest star in the night sky. A binary system -- Sirius B is a white dwarf, the first ever discovered (1862), once a larger star that has already completed its stellar evolution.

---

**2. Canopus (Alpha Carinae) -- mag -0.74, F0II, 310 ly**

*Greek/Roman:* Named for the pilot of Menelaus's ship returning from the Trojan War. When Canopus died on the Egyptian coast, the bright star that appeared low on the southern horizon was named in his honor.

*Arabic:* Called Suhail, a name still widely used. In pre-Islamic Arab star lore, Suhail was a man who married a woman from the north (the star Sirius) but was banished to the south when his bride's family objected to the match.

*Polynesian:* Called Atutahi in Maori tradition -- a high-ranking chief star that stands alone, never joining the Milky Way. Used as a key navigation reference throughout Polynesia for its low southern position.

*Science:* Second brightest star in the sky but invisible from most of Europe and northern North America. A yellow-white supergiant 10,000 times more luminous than the Sun, used as a calibration reference for spacecraft (including JPSS satellites).

---

**3. Rigil Kentaurus / Alpha Centauri (Alpha Centauri A) -- mag -0.27, G2V, 4.37 ly**

*Greek/Roman:* Part of the centaur Chiron (or sometimes Centaurus), the wise teacher of heroes including Achilles, Heracles, and Asclepius. The name means "foot of the centaur."

*Aboriginal Australian:* Along with Beta Centauri, these two "pointer" stars direct the eye to the Southern Cross. Aboriginal peoples saw the two pointers as the eyes of the great Emu in the Sky, whose dark body stretches along the Milky Way.

*Science:* The closest star system to Earth. Alpha Centauri is actually a triple system: A (Sun-like G2V), B (K1V orange dwarf), and Proxima Centauri (M5.5V red dwarf, the actual nearest star at 4.24 ly). Proxima hosts at least one confirmed exoplanet (Proxima b) in the habitable zone.

---

**4. Arcturus (Alpha Bootis) -- mag -0.05, K1.5III, 36.7 ly**

*Greek/Roman:* The "Bear Guardian" (Arktouros) who watches over the Great Bear (Ursa Major). Some myths identify him as Arcas, son of Callisto, whom Zeus placed in the sky to forever guard his mother after she was transformed into a bear by Hera's jealousy.

*Arabic:* Called as-Simak ar-Ramih ("the uplifted one of the lancer"), one of the two Simak stars (the other being Spica). Arab astronomers used Arcturus and Spica as key reference points for measuring stellar positions.

*Chinese/Japanese:* Called Da Jiao ("Great Horn") in Chinese astronomy, the principal star of the eastern palace of the Azure Dragon. In Japan, it was called Mugi-boshi ("wheat star") because its appearance signaled the wheat harvest.

*Science:* Brightest star in the northern celestial hemisphere. An orange giant about 25 times the Sun's diameter, representing what our Sun may look like in ~5 billion years. Moving rapidly through the galaxy at 122 km/s -- it is just passing through the solar neighborhood and will be gone in about half a million years.

---

**5. Vega (Alpha Lyrae) -- mag +0.03, A0V, 25.0 ly**

*Greek/Roman:* The lyre of Orpheus, whose music could charm all living things and even move stones. After Orpheus was killed by the Maenads, Zeus placed his lyre among the stars.

*Arabic:* From an-Nasr al-Waqi' meaning "the falling eagle" or "swooping vulture." The Arabs saw Vega and its surrounding stars as a vulture with folded wings, contrasting with Altair, the "flying eagle."

*Chinese/Japanese:* Zhi Nu, the Weaver Girl -- one of the most beloved star stories in East Asia. She and the Cowherd (Altair) are separated lovers allowed to meet once a year on the 7th day of the 7th lunar month, when magpies form a bridge across the Milky Way. This story is celebrated as Qixi (China), Tanabata (Japan), and Chilseok (Korea).

*Science:* Was the northern pole star around 12,000 BCE and will be again around 13,700 CE. The original "zero magnitude" calibration star for the brightness scale. One of the first stars found to have a debris disk (possible planet formation), discovered by IRAS in 1983. Spins so fast it bulges 23% wider at the equator.

---

**6. Capella (Alpha Aurigae) -- mag +0.08, G8III + G1III, 42.9 ly**

*Greek/Roman:* The "Little She-Goat" -- identified with Amalthea, the goat who nursed the infant Zeus on Crete. One of Amalthea's horns broke off and became the cornucopia, the horn of plenty.

*Arabic:* Called al-'Ayyuq, possibly meaning "the goat." Arabic astronomers recognized it as one of the brightest stars and included it in their precise star catalogs.

*Science:* Actually a system of four stars in two binary pairs. The primary pair are two yellow giants orbiting each other every 104 days, each about 10x the Sun's diameter. The sixth brightest star in the sky. Circumpolar (never sets) from latitudes above 44 degrees N.

---

**7. Rigel (Beta Orionis) -- mag +0.13, B8Ia, 863 ly**

*Greek/Roman:* The left foot of Orion the Hunter. Despite being "Beta" Orionis, Rigel is brighter than Alpha (Betelgeuse) most of the time.

*Arabic:* From Rijl Jauzah al-Yusra meaning "the left foot of the central one" (Orion). The name we use is a shortened Arabic term.

*Science:* A blue-white supergiant about 120,000 times more luminous than the Sun. If placed at Sirius's distance, it would be as bright as the full Moon. Will likely end as a supernova within a few million years. At 863 light-years, it is the most distant first-magnitude star commonly tracked.

---

**8. Procyon (Alpha Canis Minoris) -- mag +0.34, F5IV-V, 11.5 ly**

*Greek/Roman:* The name means "before the dog" (pro-kyon) because it rises just before Sirius, the Dog Star. Associated with the lesser of Orion's two hunting dogs.

*Arabic:* Called ash-Shi'ra ash-Shamiyyah ("the Syrian Shi'ra"), the sister of Sirius who stayed on the near side of the Milky Way and wept for the separation, hence appearing dimmer with "bleary eyes."

*Science:* Part of the Winter Triangle (with Sirius and Betelgeuse). A binary system with a white dwarf companion (Procyon B). One of our nearest stellar neighbors at 11.5 light-years.

---

**9. Achernar (Alpha Eridani) -- mag +0.46, B6Vep, 139 ly**

*Arabic:* From Akhir an-Nahr meaning "the end of the river" -- it marks the southern terminus of the constellation Eridanus, the great celestial river.

*Aboriginal Australian:* Eridanus was seen by some Aboriginal groups as a great river in the sky, and Achernar marked its source.

*Science:* The flattest star known -- it spins so rapidly (250 km/s at the equator) that its equatorial diameter is 56% larger than its polar diameter. Invisible from most of the Northern Hemisphere (declination -57 degrees).

---

**10. Betelgeuse (Alpha Orionis) -- mag +0.50 (variable 0.0-1.6), M1-2Ia-Iab, 700 ly**

*Arabic:* From Yad al-Jawza' meaning "the hand of the central one" (Orion). The corruption through medieval Latin produced the familiar name.

*Greek/Roman:* The right shoulder of Orion, the great hunter. Orion was killed by a scorpion sent by Gaia (or Artemis), and placed among the stars opposite Scorpius so they never appear together.

*Indigenous:* Many Indigenous Australian groups associate Betelgeuse's reddish color with fire. The Boorong people of Victoria called it Collowgullouric War, the wife of War (Canopus).

*Science:* A red supergiant so large that if placed at the center of our solar system, its surface would extend past Jupiter's orbit. It dimmed dramatically in late 2019 ("the Great Dimming"), caused by a surface mass ejection creating a dust cloud. Expected to explode as a supernova sometime in the next 100,000 years, when it will briefly outshine the full Moon.

---

**11. Hadar / Beta Centauri -- mag +0.61, B1III, 390 ly**

*Arabic:* Hadar may derive from an Arabic word meaning "ground" or "presence."

*Aboriginal Australian:* Alongside Alpha Centauri, these are the Southern Pointers. For the Boorong people, Hadar and Alpha Centauri are Berm-berm-gle, two brothers known for bravery.

*Science:* A triple star system. The primary is a blue giant 12,000 times more luminous than the Sun. One of the pointer stars that helps locate the Southern Cross.

---

**12. Altair (Alpha Aquilae) -- mag +0.76, A7V, 16.7 ly**

*Arabic:* From an-Nasr at-Ta'ir meaning "the flying eagle," in contrast to Vega ("the swooping eagle"). The eagle constellation Aquila was recognized across many cultures.

*Chinese/Japanese:* Niu Lang, the Cowherd -- the other half of the great love story with the Weaver Girl (Vega). The two flanking stars (Beta and Gamma Aquilae) are his two children. This is the most celebrated star myth in East Asia, central to the Tanabata/Qixi festivals.

*Science:* One of the closest visible stars at 16.7 light-years. Rotates in only 8.9 hours (the Sun takes 25 days), making it visibly oblate. One of the vertices of the Summer Triangle (with Vega and Deneb). First star ever imaged as a resolved disk (by interferometry in 2007).

---

**13. Acrux (Alpha Crucis) -- mag +0.77, B0.5IV + B1V, 320 ly**

*Modern name:* A contraction of "Alpha Crucis" -- the constellation was not separated from Centaurus until the 16th century by European navigators.

*Polynesian:* The Southern Cross (Te Punga in Maori, "the anchor") was the single most important navigation constellation in Polynesian wayfinding. Its orientation relative to the horizon indicates latitude. The bottom star's altitude above the horizon directly corresponds to the observer's southerly latitude.

*Aboriginal Australian:* The head of the Emu in the Sky. The Coalsack Nebula next to the Cross forms the emu's head, and the dark rift of the Milky Way extends into its body and legs. When the Emu is fully visible and "standing upright" (April-May), it signals emu breeding season and time to gather eggs.

*Science:* A multiple star system at the base of the Southern Cross. Appears on the flags of Australia, New Zealand, Brazil, Samoa, and Papua New Guinea.

---

**14. Aldebaran (Alpha Tauri) -- mag +0.86, K5III, 65.3 ly**

*Arabic:* al-Dabaran means "the follower" -- it follows the Pleiades cluster across the sky, as if herding them.

*Persian:* One of the four Royal Stars of ancient Persia (with Regulus, Antares, and Fomalhaut), known as Tascheter, the Watcher of the East, guarding the vernal equinox around 3000 BCE.

*Hindu:* The star of the Rohini nakshatra (lunar mansion), associated with the red goddess who was the Moon god Chandra's favorite wife. The name means "the red one."

*Science:* The angry red eye of Taurus the Bull. An orange giant 44 times the Sun's diameter, with a confirmed exoplanet (Aldebaran b, ~6 Jupiter masses). Appears to be part of the Hyades cluster but is actually a foreground star at half the distance.

---

**15. Antares (Alpha Scorpii) -- mag +1.06, M1.5Iab, 600 ly**

*Greek/Roman:* The name means "rival of Ares (Mars)" because its reddish color resembles the planet Mars. The heart of Scorpius -- placed in the sky opposite Orion so the two enemies never meet.

*Persian:* Called Satevis, the Watcher of the West and one of the four Royal Stars.

*Chinese:* Called Xin, one of the four great constellations marking the seasons. The appearance of Antares at dusk in late spring signaled the approach of summer.

*Science:* A red supergiant about 700 times the Sun's diameter. If placed at the center of the Solar System, it would engulf the orbit of Mars (hence why the Greeks compared them). Has a hot blue companion star (Antares B) visible in telescopes.

---

**16. Spica (Alpha Virginis) -- mag +0.97, B1III-IV + B2V, 260 ly**

*Latin/Greek:* "Ear of grain" -- the spike of wheat held by Virgo, the harvest maiden. Associated with Demeter/Ceres and the bounty of agriculture.

*Arabic:* Called as-Simak al-A'zal ("the unarmed Simak"), one of two Simak stars paired with Arcturus. The distinction: Arcturus carries a lance, but Spica is unarmed.

*Science:* A close binary system where two blue giants orbit each other every 4 days, so close they distort each other into egg shapes. Hipparchus's observation that Spica's position had shifted relative to the equinox led to the discovery of the precession of the equinoxes around 130 BCE.

---

**17. Pollux (Beta Geminorum) -- mag +1.14, K0IIIb, 33.8 ly**

*Greek/Roman:* The immortal twin, son of Zeus. When his mortal brother Castor was killed, Pollux begged Zeus to let them share immortality, alternating between Olympus and Hades. Their eternal bond is one of the most touching stories in Greek mythology.

*Arabic:* Part of a much larger lion figure. Castor and Pollux formed one of the lion's paws in pre-Islamic Arab sky lore.

*Science:* The closest giant star to Earth. Confirmed host of an exoplanet (Pollux b, ~2.3 Jupiter masses, discovered 2006). The 18th brightest star overall.

---

**18. Fomalhaut (Alpha Piscis Austrini) -- mag +1.16, A3V, 25.1 ly**

*Arabic:* From Fam al-Hut meaning "the mouth of the [Southern] Fish." One of the very few first-magnitude stars with a purely Arabic name still in common use.

*Persian:* Called Hastorang, the Watcher of the South and one of the four Royal Stars, guarding the winter solstice around 2500 BCE.

*Science:* Famous for its prominent debris disk (imaged by Hubble in 2004), which suggested planet formation. "Fomalhaut b" was announced in 2008 as one of the first directly imaged exoplanets, but was later reclassified as an expanding dust cloud from a collision between two planetesimals -- still scientifically important as a real-time observation of planetary system dynamics.

---

**19. Deneb (Alpha Cygni) -- mag +1.25, A2Iae, ~2,600 ly**

*Arabic:* From Dhanab ad-Dajajah meaning "the tail of the hen" (Cygnus the Swan).

*Greek/Roman:* The tail of the Swan, which in myth is Zeus in disguise visiting Leda, queen of Sparta. This union produced the twins Castor and Pollux, and Helen of Troy.

*Chinese:* Part of the celestial bridge where the Weaver Girl and Cowherd meet. Deneb and the nearby stars of Cygnus represent the magpie bridge spanning the Milky Way.

*Science:* By far the most luminous star visible to the naked eye from northern latitudes -- about 196,000 times the Sun's luminosity. If placed at Sirius's distance (8.6 ly), it would be as bright as a half Moon. At ~2,600 light-years, it is the most distant commonly visible star. One vertex of the Summer Triangle (with Vega and Altair).

---

**20. Regulus (Alpha Leonis) -- mag +1.40, B8IVn, 79.3 ly**

*Latin:* "Little King" or "Prince." The heart of Leo the Lion, the king of beasts.

*Persian:* Called Venant, the Watcher of the North and one of the four Royal Stars, guarding the summer solstice around 2500 BCE. The four Royal Stars (Aldebaran, Regulus, Antares, Fomalhaut) divided the sky into four quarters.

*Arabic:* Called Qalb al-Asad ("heart of the lion").

*Babylonian:* Known as LUGAL ("the king") -- one of the earliest recorded star names, found on MUL.APIN tablets dating to ~1200 BCE.

*Science:* Spins so fast (once every 15.9 hours) that it is 32% wider at the equator than the poles. If it rotated just 16% faster, it would tear itself apart. Located very close to the ecliptic, so it is frequently occulted (hidden) by the Moon.

---

### 4.2 Implementation Notes for Star Story Popups

The existing `constellations.json` already has rich constellation-level mythology. The star stories above should be stored in a new `star_stories.json` keyed by Hipparcos ID or star name, with fields:

```json
{
  "sirius": {
    "name": "Sirius",
    "bayer": "Alpha Canis Majoris",
    "hip": 32349,
    "magnitude": -1.46,
    "spectral": "A1V",
    "distance_ly": 8.6,
    "stories": {
      "greek": "The 'Dog Star' of Orion's faithful hound. Its rising with the Sun brought the scorching 'dog days' of summer.",
      "arabic": "Ash-Shi'ra al-'Abur -- the star that crossed the Milky Way. Her weeping sister Procyon stayed behind.",
      "egyptian": "Sopdet -- its heliacal rising marked the annual Nile flood, the most important event in the Egyptian year.",
      "polynesian": "Called Rehua (Maori) and A'a (Hawaiian), a high chief of the heavens and key navigation star.",
      "science": "Brightest night star. Binary with a white dwarf companion (Sirius B), the first white dwarf ever discovered."
    }
  }
}
```

---

## 5. Raycaster Star Labels / VirtualSky Click Events

### 5.1 How VirtualSky Handles Star Interaction

Based on analysis of the VirtualSky source code (v0.7.4) and documentation:

**Star data model:**
Stars are stored internally as arrays of `[Hipparcos_ID, magnitude, RA_radians, Dec_radians]`. Star names are in a separate `starnames` object indexed by Hipparcos number. A `lookup.star` array is built for efficient searching, containing `{ra, dec, label, mag}` objects.

**Built-in click/hover support:**
VirtualSky has a **pointer-based interaction system**, not native star clicking. Key findings:

1. **`callback.contextmenu`** (already used by the app): Fires on right-click/long-press. Returns `{ra, dec}` in the `skyPos` property. This is what currently opens the Aladin telescope view.

2. **`callback.click`** (available but unused): Fires on left-click. Returns `{x, y, ra, dec, matched}` where `matched` is an index into the pointers array, or -1 if no pointer was hit.

3. **`whichPointer(x, y)`**: Hit-tests canvas coordinates against registered pointers within 5 pixels.

4. **`addPointer({ra, dec, label, html, ...})`**: Registers a clickable point on the sky. When clicked, `toggleInfoBox()` displays the `html` content as a popup.

5. **`radec2xy(ra, dec)`**: Converts sky coordinates to canvas pixel coordinates (and vice versa). This is the core function for any overlay drawing.

**VirtualSky does NOT natively support:**
- Hover/click detection on stars directly
- Star tooltip popups
- "Nearest star to click point" lookup
- Star name display on hover

### 5.2 Approach to Add Star Clicking

Since VirtualSky does not have built-in star click detection, there are three approaches:

#### Approach A: Use `addPointer()` for Bright Stars (Simplest)

Register the 20-100 brightest stars as pointers with HTML popup content:

```javascript
// After VirtualSky init, add pointers for brightest stars
const brightStars = [
  { ra: 101.287, dec: -16.716, label: 'Sirius', html: '<div>...</div>' },
  { ra: 95.987, dec: -52.696, label: 'Canopus', html: '<div>...</div>' },
  // ...
];
brightStars.forEach(s => {
  state.planetarium.addPointer({
    ra: s.ra * Math.PI / 180,  // VirtualSky uses radians
    dec: s.dec * Math.PI / 180,
    label: s.label,
    html: s.html
  });
});
```

**Pros:** Uses VirtualSky's own system. Pointers get proper coordinate transforms across all projections. Built-in 5px hit detection. Built-in info box toggle.
**Cons:** Limited to registered pointers. Can not dynamically match every star. The `addPointer` approach would add visible markers (dots/labels) unless carefully styled.

#### Approach B: Canvas Hit Detection with Star Catalog Lookup (Most Flexible)

Intercept canvas clicks, convert pixel coordinates to RA/Dec using `radec2xy` inverse, then search the star catalog for the nearest match:

```javascript
// Add click handler to the canvas
const canvas = document.querySelector('#starmap canvas');
canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  // Use VirtualSky's xy2radec if available, or compute inverse
  // Then search star catalog for nearest star within threshold
  const nearest = findNearestStar(ra, dec, state.planetarium.stars);
  if (nearest && nearest.distance < threshold) {
    showStarPopup(nearest, x, y);
  }
});
```

**Key issue:** VirtualSky does not expose a public `xy2radec()` method in all projections. The `radec2xy()` forward transform exists, but the inverse must be computed. For stereographic projection:

```javascript
// Inverse stereographic: pixel -> RA/Dec
function canvasToRaDec(x, y, planetarium) {
  // This requires knowledge of the projection center, scale, and rotation
  // VirtualSky internally stores these but does not have a clean public API
}
```

**Workaround:** Pre-compute canvas positions of all visible stars each frame using `radec2xy()`, store in a spatial index (simple array sorted by x), and do nearest-neighbor lookup on click.

**Pros:** Works for all stars, not just pre-registered ones. Can show magnitude, Hipparcos ID, constellation, etc.
**Cons:** Must rebuild spatial index after every pan/zoom/time change. More code to maintain.

#### Approach C: Overlay Canvas with Separate Hit Detection (Current Architecture)

The app already has a `sky-overlay` canvas (`<canvas id="sky-overlay">`) positioned over the VirtualSky canvas. This is used by the ISS satellite tracker. Extend this approach:

1. After each VirtualSky `draw()`, iterate the star catalog
2. For each star brighter than a threshold (e.g., magnitude 3), call `radec2xy()` to get canvas position
3. Store positions in a lookup array
4. On click/hover of the overlay canvas, find the nearest stored star position
5. Display a popup with the star story from `star_stories.json`

```javascript
// Build star position cache after each draw
function buildStarCache() {
  const p = state.planetarium;
  if (!p || !p.stars) return;

  starCache = [];
  p.stars.forEach(star => {
    if (star[1] > 3.0) return;  // Skip dim stars
    const xy = p.radec2xy(star[2], star[3]);  // RA, Dec in radians
    if (xy && isFinite(xy.x) && isFinite(xy.y)) {
      starCache.push({
        x: xy.x, y: xy.y,
        hip: star[0],
        mag: star[1],
        ra: star[2],
        dec: star[3],
        name: p.starnames[star[0]] || null
      });
    }
  });
}
```

**Pros:** Cleanest separation of concerns. Does not modify VirtualSky internals. Works with the existing overlay architecture. Can add hover highlights (glow circle) on the overlay canvas.
**Cons:** Need to hook into VirtualSky's draw cycle to rebuild cache. Performance consideration with many stars (mitigated by magnitude cutoff).

### 5.3 Recommendation

**Use Approach C (overlay canvas) as the primary method, supplemented by Approach A for the brightest 20 stars.**

Rationale:
- The overlay canvas architecture already exists and works
- `addPointer()` for the 20 brightest stars gives reliable interaction with VirtualSky's built-in popup system
- The overlay-based approach enables hover detection (glow effect) and works for all visible stars
- Star stories from `star_stories.json` can be loaded asynchronously and injected into either system

### 5.4 VirtualSky Internal Data Available for Star Labels

When a star is identified via any of the approaches above, the following data is available:

| Data | Source | Notes |
|------|--------|-------|
| Hipparcos ID | `star[0]` in the stars array | Unique identifier |
| Apparent magnitude | `star[1]` | Brightness |
| RA (radians) | `star[2]` | Right ascension |
| Dec (radians) | `star[3]` | Declination |
| Common name | `planetarium.starnames[hip]` | English name for ~150 brightest |
| Bayer designation | Not in VirtualSky | Must be added from external catalog |
| Constellation | Not in VirtualSky | Can be computed from RA/Dec using IAU boundaries |
| Spectral type | Not in VirtualSky | Must be added from external catalog |
| Distance | Not in VirtualSky | Must be added from external catalog |

For the popup stories, the `star_stories.json` file would supplement VirtualSky's limited star data with the cultural/scientific content.

---

## Appendix: CelesTrak API URLs for All Proposed Satellites

All URLs follow the pattern already used in `tle_fetcher.py`:

```
https://celestrak.org/NORAD/elements/gp.php?CATNR={norad_id}&FORMAT=TLE
```

### Quick Reference: All NORAD IDs

**Currently tracked:**
- NOAA-21: 54234
- NOAA-20: 43013
- Suomi NPP: 37849

**Proposed LEO additions:**
- MetOp-B: 38771
- MetOp-C: 43689
- Terra: 25994
- Aqua: 27424
- Aura: 28376
- Landsat 8: 39084
- Landsat 9: 49260
- Sentinel-3A: 41335
- Sentinel-3B: 43437
- Sentinel-2A: 40697
- Sentinel-2B: 42063
- Sentinel-1A: 39634
- FY-3D: 43010
- FY-3E: 49008
- DMSP-F17: 29522
- DMSP-F18: 35951

**Famous satellites:**
- ISS: 25544
- Hubble: 20580
- Tiangong: 48274

**GEO satellites (already in nightsky backend):**
- GOES-19: 60133 (NEW -- update geostationary_utils.py)
- GOES-18: 54743
- GOES-16: 41866
- Himawari-8: 40267
- Himawari-9: 41836
- Meteosat-11: 40732
- Meteosat-10: 38552
- FY-4A: 41882
- FY-4B: 48808
- INSAT-3D: 39216
- INSAT-3DR: 41752
- GK-2A: 43823
