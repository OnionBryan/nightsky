# Night Sky Viewer & NOAA Orbit Tracker
## The Complete Guide

---

## Welcome

You are holding two instruments. The **Night Sky Viewer** is an interactive planetarium that puts the entire visible sky on your screen, then lets you punch through to real photographic imagery from the world's greatest telescopes. The **NOAA Orbit Tracker** follows the Joint Polar Satellite System constellation in real time as it circles the Earth every 101 minutes, scanning the planet with infrared eyes.

What makes these different from a typical star chart or satellite map: when you zoom in on a nebula, you are looking at actual photographic plates from the Digitized Sky Survey, or deep exposures from Hubble, or infrared light captured by 2MASS. When you track NOAA-21, you are watching real SGP4-propagated orbital mechanics computed from today's Two-Line Element sets. These are not illustrations. This is the data.

---

## Night Sky Viewer -- Getting Started

### Setting Your Location

The sky looks different from every point on Earth, so the first thing the viewer needs to know is where you are standing. You have three ways to tell it:

**Type a city name.** Enter "Chicago" or "Tokyo" or "Reykjavik" in the Location box and press Enter. The app uses OpenStreetMap's Nominatim geocoder to find your coordinates. It will display the resolved name below the input so you can confirm it got the right place.

**Type coordinates directly.** If you know your latitude and longitude, enter them as a comma-separated pair: `40.7128, -74.0060`. The app detects the coordinate format automatically -- no need to label which is which.

**Click the GPS crosshair button.** The small target icon next to the location input asks your browser for your actual position. Your browser will request permission first. Once acquired, the coordinates fill in automatically and the app reverse-geocodes them to show your city name.

When the location changes, the entire sky redraws to show what is actually above your horizon right now.

### Direction Buttons

The 3x3 compass grid below the location input points your view toward any cardinal or intercardinal direction. South is selected by default because most interesting objects transit through the southern sky (if you are in the Northern Hemisphere). Click N, NE, E, SE, SW, W, or NW to swing your view. The center dot represents zenith -- straight up.

Each click immediately re-renders the planetarium. The current direction is shown in the info bar at the bottom of the screen.

### Projections

The Projection dropdown changes how the spherical sky gets flattened onto your rectangular screen. Each one is useful for different things:

- **Stereographic (horizon)** -- The default. Shows the sky as you would see it standing outside and looking in one direction. The horizon is at the bottom, zenith is up. This is the most natural view.
- **Fisheye (wide angle)** -- A wider field of view with barrel distortion, like looking through a security camera. Good for getting a sense of the whole visible sky at once.
- **Polar (zenith up)** -- Centers on the point directly overhead. Constellations near zenith are shown undistorted; the horizon wraps around the edges.
- **Lambert (all-sky)** -- An equal-area projection of the entire hemisphere. Every constellation gets fair representation, though shapes distort near the edges.
- **Orthographic** -- The sky as seen from infinitely far away. Clean and geometric.
- **Mollweide (full map)** -- Shows the entire celestial sphere in an ellipse, like a world map projection. Both hemispheres visible at once.
- **Free Look (drag anywhere)** -- Unlocks the view from the horizon. Drag to look anywhere on the celestial sphere. Ground and cardinal points are disabled automatically since they do not apply in this mode.

---

## The Planetarium Controls

### Object Toggles

The Objects section gives you checkboxes for everything the planetarium can draw:

| Checkbox | What It Shows | Default |
|---|---|---|
| **Stars** | All stars down to the current magnitude limit | On |
| **Star Labels** | Proper names on bright stars (Sirius, Vega, etc.) | Off |
| **Planets** | Solar system planets at their current positions | On |
| **Planet Labels** | Names next to the planets | On |
| **Constellations** | Stick-figure constellation lines | On |
| **Const. Labels** | Names of the constellations | Off |
| **Boundaries** | IAU constellation boundary lines | Off |
| **Milky Way** | The diffuse band of our galaxy | Off |
| **Meteor Showers** | Active meteor shower radiants | Off |
| **Planet Orbits** | Orbital paths of the planets | Off |

### Reference Lines

These overlays help you navigate the coordinate systems astronomers use:

| Checkbox | What It Shows | Default |
|---|---|---|
| **Ground** | The horizon line and solid ground below it | On |
| **Cardinals** | N, S, E, W markers on the horizon | On |
| **Ecliptic** | The plane of the solar system -- the Sun, Moon, and planets stay near this line | Off |
| **Meridian** | The line from due North through zenith to due South | Off |
| **Alt/Az Grid** | Altitude and azimuth coordinate grid (local sky coordinates) | Off |
| **RA/Dec Grid** | Right ascension and declination grid (celestial coordinates, fixed to the stars) | Off |

### Sliders (Advanced Settings)

Click the "Advanced Settings" expander to reveal three sliders and a color scheme selector:

**Star Magnitude** (range 1-8, default 5). This controls how faint the faintest visible stars are. Magnitude 5 approximates what a dark suburban sky shows. Crank it to 8 to see thousands more stars. Drop it to 1 or 2 for a minimalist view showing only the brightest.

**Field of View** (range 20-120 degrees, default 60). How wide your view is. 60 degrees is roughly what your eyes see when you look in one direction. Go to 120 for a panoramic sweep. Narrow it to 20 for a telephoto-like zoom on one patch of sky.

**Star Size** (range 0.5x-2.0x, default 1.0). A cosmetic multiplier on how large the star dots render. Useful on high-DPI screens or if you want the planetarium to feel bolder.

**Color Scheme**. Normal gives you white stars on a dark sky. Negative inverts everything -- dark stars on a white background -- useful for printing star charts.

### Time Controls

**Live mode** (checkbox, default on). When checked, the sky updates in real time. The clock ticks, the stars drift, the planets creep along.

When you click any time button, Live mode automatically disengages:

| Button | Effect |
|---|---|
| **-1d** | Jump backward one full day |
| **-1h** | Jump backward one hour |
| **Now** | Snap back to the current moment and re-enable Live mode |
| **+1h** | Jump forward one hour |
| **+1d** | Jump forward one full day |

The current simulated date and time are displayed below the buttons. Use the time controls to preview tonight's sky before you go outside, or check what was visible last night.

### Rise / Set Times

Below the Advanced Settings, a Rise / Set Times panel lets you pick any solar system object from a dropdown -- Sun, Moon, Mercury, Venus, Mars, Jupiter, or Saturn. Select one and the app fetches its rise, transit, and set times for today, plus draws an altitude-over-time chart showing the object's arc across your sky. The horizon line is highlighted in amber at zero degrees. This is enormously helpful for planning: "When does Jupiter clear the trees tonight?"

---

## Telescope View -- THE KILLER FEATURE

This is where the app goes from "nice planetarium" to "actual observatory on your screen."

### Opening the Telescope

Two ways in:

1. **Click the Telescope button** in the header bar. This opens the deep sky viewer centered on whatever your planetarium is currently pointing at.
2. **Right-click any star** in the planetarium. The telescope opens centered exactly on those coordinates, then automatically scans the region for cataloged objects and tells you what it finds.

### What You Are Looking At

The telescope view is powered by Aladin Lite from the Centre de Donnees astronomiques de Strasbourg (CDS). It streams real sky survey imagery as tiled HiPS maps. When you see the Orion Nebula in this view, you are looking at a photographic image of the actual nebula, not a computer rendering. The data comes from the same surveys professional astronomers use.

### Searching for Objects

The search bar at the top accepts any standard astronomical name or catalog number. Type a name and press Enter or click Go. The viewer resolves the name through SIMBAD (the astronomical database), flies to those coordinates, and adjusts the zoom based on the object type.

Try these to get started:

- **M31** -- The Andromeda Galaxy, our nearest large neighbor. Switch to 2MASS infrared and watch the dust lanes vanish.
- **M42** -- The Orion Nebula. Switch to Hubble H-alpha to see the ionized hydrogen glow.
- **Sirius** -- The brightest star in the night sky. Check the spectral type (A1V -- a hot white star) in the info panel.
- **M13** -- The great globular cluster in Hercules. Zoom in to resolve individual stars.
- **NGC 7293** -- The Helix Nebula. Try GALEX ultraviolet for a completely different perspective.
- **Crab Nebula** -- The remnant of a supernova recorded by Chinese astronomers in 1054 AD.

### The Survey Guide

The Survey dropdown is one of the most powerful controls in the entire app. Each survey captured the sky in different wavelengths, at different depths, and at different resolutions. Switching surveys on the same object is like putting on different pairs of glasses.

**DSS2 Color** -- The Digitized Sky Survey, Second Generation. Scanned from photographic plates taken at Palomar and the UK Schmidt Telescope. Covers 100% of the sky. This is your starting point, the "default view." Resolution is modest but it shows everything.

**SDSS DR9** -- The Sloan Digital Sky Survey. Covers about 35% of the sky (mostly the north galactic cap) but goes much deeper than DSS2. Sharper images, better color. If your object is in SDSS coverage, switch here.

**DECaPS** -- The Dark Energy Camera Plane Survey. Focused on the galactic plane where DSS2 struggles with crowded star fields. If you are looking at something in the Milky Way band, try this.

**PanSTARRS** -- The Panoramic Survey Telescope and Rapid Response System from Haleakala, Hawaii. Covers 78% of the sky at 0.2 arcsecond resolution -- that is incredibly sharp. Available in multiple filter combinations (g, r, i, z bands). The color composites are beautiful. This is often the best general-purpose survey.

**Hubble** -- Space Telescope imagery at 0.05 arcsecond resolution. Preposterously detailed, but Hubble has only observed tiny patches of sky. If your object has Hubble coverage, you will see detail that no ground telescope can match. Available in multiple optical bands (V, B, R, I) and emission line filters (H-alpha for hydrogen gas, OIII for oxygen, H-beta). Try Hubble H-alpha on any nebula -- the structure in the gas is astonishing.

**2MASS Color** -- The Two Micron All-Sky Survey. Near-infrared (J, H, K bands). Infrared light passes through interstellar dust that blocks visible light. Point this at the Milky Way center and suddenly you can see through the dust lanes to the stars behind them. Try it on M42 -- the nebula nearly vanishes and you see the young star cluster inside.

**AllWISE** -- Mid-infrared from the Wide-field Infrared Survey Explorer satellite. Goes even deeper into the infrared than 2MASS. Warm dust glows brightly here.

**GALEX** -- The Galaxy Evolution Explorer. Ultraviolet light. Hot young stars and active galactic nuclei blaze in UV while cooler stars fade. Try GALEX on a spiral galaxy to see where new stars are forming.

**Fermi** -- The Fermi Gamma-ray Space Telescope. This is the extreme universe -- gamma rays from pulsars, blazars, and supernova remnants. The resolution is low (gamma ray telescopes cannot focus well) but the science is extraordinary. The entire sky looks completely different in gamma rays.

**ROSAT** -- X-ray imagery from the Roentgen Satellite. Another view of the high-energy universe.

**Mellinger** -- A wide-field visible light mosaic. Good for context when you want to see where your object sits relative to the Milky Way.

### Zoom Controls

Click **+ Zoom** to halve the field of view (zoom in). Click **- Zoom** to double it (zoom out). You can also scroll your mouse wheel. The current field of view is displayed as degrees, arcminutes, or arcseconds depending on how far in you are. At maximum zoom you can reach sub-arcsecond scales -- individual pixels in the survey data.

The fullscreen button (top-right of the modal) expands the telescope view to fill your entire screen. Press Escape or click the X to exit.

### Catalog Overlays

Three checkboxes above the viewer control which catalogs are plotted as markers:

- **Messier** (red circles) -- The 110 Messier objects. The greatest hits of deep sky observing.
- **NGC** (green squares) -- The New General Catalogue. Thousands more galaxies, nebulae, and clusters.
- **Star Names** (yellow crosses) -- Named bright stars from the Yale Bright Star Catalogue.

Click any marker to see its catalog data. The overlays reload when you pan to a new region.

### The Object Info Panel

When the telescope identifies an object -- either from a right-click, a search, or clicking a catalog marker -- a detailed info panel appears below the viewer. It shows:

- **Object name and type** (galaxy, nebula, star cluster, etc.)
- **Visual magnitude** with a human-readable description ("Visible to naked eye," "Binoculars needed," etc.) and all available photometric bands
- **Spectral type** for stars, with a plain-English translation ("G2V -- Yellow star, like our Sun")
- **Distance** in light years, computed from parallax when available
- **Radial velocity** -- whether the object is approaching or receding, and how fast
- **Angular size** for extended objects
- **Coordinates** in RA/Dec
- **Nearby objects** in the same field -- other cataloged items within the search radius
- **Fun facts** -- contextual notes based on object type ("Nebulae are stellar nurseries where new stars are born from clouds of gas and dust")

---

## Observation Planner

The Observation Planner is a separate page (click the Observation Planner link in the header) built for planning real observing sessions.

### Tonight's Best

The default tab ranks every Messier and Caldwell object by visibility from your location right now. Each object card shows its name, type, constellation, magnitude, and current altitude/azimuth. Objects near transit (highest point in the sky) get an "Optimal" badge. Filter buttons let you narrow the list by object type. Click any card to see full details including rise/transit/set times and a link to open it in the planetarium.

The ranking algorithm accounts for your latitude, the object's current altitude above the horizon, and the limiting magnitude for your Bortle class (light pollution level).

### Object Checklists

The Lists tab presents the complete Messier catalog (110 objects) and Caldwell catalog (109 objects) as checklists with progress bars. Check off objects as you observe them. Your progress persists in your browser's local storage, so it survives between sessions. The progress bar fills as you go -- watching it creep toward 100% is deeply satisfying.

### Ephemeris Calculator

The Ephemeris tab lets you search for any object by name or catalog number and get its current altitude, azimuth, and rise/transit/set times. A visual timeline shows the object's arc across the sky with twilight zones drawn behind it, so you can see at a glance when the object is both above the horizon and in darkness.

### Angular Distance Calculator

Enter two sets of RA/Dec coordinates and get the angular separation in degrees, arcminutes, arcseconds, and Moon widths. Useful for star-hopping: "How far is M81 from M82?" About 38 arcminutes -- they fit in the same binocular field.

### Moon Phase Widget

The sidebar shows the current Moon phase as an SVG illustration with illumination percentage, age in days, rise/set times, and the date of the next full Moon. The Moon is the number one factor in whether you will have a good deep sky night.

### Weather Forecast

The Weather tab pulls a 48-hour cloud cover forecast from Open-Meteo and renders it as a color-coded bar chart. Green means clear skies. Red means overcast. It automatically identifies good observing windows -- nighttime hours with less than 30% cloud cover.

### Constellation Stories

The Stories tab contains mythology and lore for constellations, sorted by culture and category (zodiac, northern/southern constellations, planets, stars, asterisms, meteor showers). Search or browse. This is the context that makes the sky feel alive -- every pattern up there has been named and storied by dozens of civilizations across thousands of years.

### Bortle Class Indicator

The sidebar displays your site's Bortle class (a scale from 1 to 9 measuring light pollution). Class 1 is a pristine dark site; class 9 is inner-city. The limiting magnitude adjusts accordingly, and the Tonight's Best list uses it to filter out objects you cannot realistically see.

---

## The Twilight Bar

At the bottom of the Night Sky Viewer, a horizontal timeline bar shows the darkness conditions for the next 24 hours.

### What the Colors Mean

| Color | Phase | Sun Position |
|---|---|---|
| Gold | Daylight | Above horizon |
| Warm brown | Civil twilight | 0 to -6 degrees below horizon |
| Deep blue | Nautical twilight | -6 to -12 degrees below |
| Near-black | Astronomical twilight | -12 to -18 degrees below |
| Black | Full night | More than 18 degrees below horizon |

True astronomical darkness -- when the Sun is more than 18 degrees below the horizon -- is what you need for serious deep sky observing. The bar makes it obvious how much dark time you have.

### Moon Overlay

Hatched regions on the bar indicate when the Moon is above the horizon. The tooltip shows the Moon's current illumination percentage. Even during full night, a bright Moon washes out faint objects. The ideal observing window is the gap where the bar is black and there is no hatching.

### Summary Line

Above the bar, a one-line summary reads something like: "6.2h dark / 4.1h moonless / Waxing Gibbous." That tells you everything you need to plan your night in three numbers.

### The Now Marker

A thin amber vertical line marks the current time on the bar and updates every minute. You can see at a glance where you stand in the night's timeline.

---

## Red Light Mode

### What It Is

Red light mode shifts the entire interface to deep red tones. Every element -- text, backgrounds, buttons, the planetarium itself -- goes red.

### Why Astronomers Use It

Your eyes take 20 to 30 minutes to fully adapt to darkness. White or blue light from a screen destroys that adaptation instantly. Red light, however, does not affect your rod cells (the ones responsible for night vision). Professional observatories use red lighting exclusively after dark. So do experienced amateur astronomers.

### How to Toggle It

Click the **Red Light** button in the top header bar. It has a small sun icon. Click it once to go red, click again to go back to normal. Your preference is saved in local storage, so if you enable it tonight, it will still be on when you come back tomorrow night.

The Observation Planner has its own independent night mode toggle that works the same way.

---

## NOAA Orbit Tracker

### What JPSS Satellites Are

The Joint Polar Satellite System is a constellation of three satellites -- NOAA-21 (launched 2022), NOAA-20 (launched 2017), and Suomi NPP (launched 2011) -- operated by NOAA and NASA. They fly in sun-synchronous polar orbits at about 824 km altitude, circling the Earth every 101 minutes. Each one carries the VIIRS instrument, which scans a 3,060 km wide swath below, imaging the entire planet twice per day in 22 spectral bands. This data feeds your weather forecast, tracks wildfires, monitors sea surface temperatures, and measures vegetation health. These are some of the most important Earth-observing satellites flying.

### Live Tracking View

The default tab shows a polar azimuthal projection of the Earth with the selected satellite's current position marked as a colored, pulsing dot. A fading trail shows where it has been. A dashed prediction line shows where it is going, computed from the pre-fetched 3-hour track. The VIIRS swath is drawn as a translucent band around the ground track. A velocity vector arrow shows the direction of motion.

The orbital info panel (top-left) displays the satellite's inclination, altitude, orbital period, and current orbit number. The position panel (top-right) shows latitude, longitude, altitude in km, and velocity in km/s.

Toggle buttons in the legend panel let you show or hide the swath, velocity vector, and day/night terminator independently.

### Satellite Selector

Three buttons at the top -- NOAA-21, NOAA-20, Suomi NPP -- switch between satellites. Each has a unique color (red, teal, yellow). Clicking a satellite reloads its TLE data, orbit info, and track prediction.

### Constellation Mode

Click the **Constellation** tab to see all three satellites simultaneously on the same map. Each is drawn with its own color and label. Click any satellite marker to select it. The position panel updates to show that satellite's data. This view makes visible the elegant phasing of the constellation -- the satellites are spaced to maximize global coverage.

### Coverage View

The **24h Coverage** tab draws the full 24-hour ground track for the selected satellite. This reveals the characteristic sinusoidal pattern of a polar orbit, and the progressive westward drift of each track as the Earth rotates beneath it. After 24 hours, the tracks nearly tile the globe -- that is the whole point of the JPSS orbit design.

### 3D Globe

Click the **3D Globe** tab to see the satellite on a WebGL-rendered Earth powered by globe.gl. The satellite appears as a glowing dot above the surface with its trail arcing behind it and prediction ahead. The VIIRS swath projects onto the globe surface. You can drag to rotate, scroll to zoom. This view is the best way to viscerally understand what a polar orbit looks like.

### Map Projections

In 2D modes, press **M** or click the **P/E** button to toggle between polar (azimuthal equidistant) and equirectangular (flat map) projections. Polar projection emphasizes the poles where the satellite passes every orbit. Equirectangular shows the familiar latitude/longitude grid.

### Time Machine Playback

Click the **Time Machine** button at the bottom of the screen to open the playback panel. Set a start time, duration (1, 3, 6, or 24 hours), and playback speed (10x to 3600x). Hit Play and the tracker animates the satellite along its historical track. A scrub bar lets you drag to any point in the window. The day/night terminator updates to match the simulated time. A warning notes that SGP4 accuracy degrades beyond plus or minus 7 days from the TLE epoch.

This is mesmerizing at 300x speed over a 24-hour window -- you watch the satellite weave back and forth across the poles while the Earth rotates beneath it.

### SIMBAD Integration

The Night Sky Viewer's telescope mode queries SIMBAD (operated by CDS Strasbourg) through the backend API to resolve object names, search regions, and retrieve catalog data. When you right-click a star or search for an object, SIMBAD provides the name, type, spectral class, magnitudes, parallax, radial velocity, and angular size that appear in the info panel.

### Coordinate Display

Hover your mouse over the 2D map and the bottom-right panel shows the geographic coordinates under your cursor. Near the poles, it helpfully labels "North Pole" or "South Pole" instead of showing extreme latitude values.

---

## Keyboard Shortcuts

### Night Sky Viewer

The planetarium supports mouse drag to pan and scroll wheel to zoom. Additional interaction is through the controls panel.

| Action | How |
|---|---|
| Close telescope modal | Escape |
| Search in telescope | Type name, press Enter |

### NOAA Orbit Tracker

| Key | Action |
|---|---|
| Space | Play / Pause animation |
| + or = | Zoom in |
| - | Zoom out |
| 0 | Reset zoom |
| R | Refresh satellite data |
| M | Toggle map projection (Polar / Flat) |

---

## Credits

This project stands on the shoulders of extraordinary open-source work and open data:

**VirtualSky** by Stuart Lowe, Las Cumbres Observatory. The planetarium engine that renders the interactive sky. A beautiful piece of software.

**Aladin Lite** by the Centre de Donnees astronomiques de Strasbourg (CDS). The telescope viewer that streams HiPS sky survey tiles. This is the same technology used by professional astronomers worldwide.

**Skyfield** by Brandon Rhodes. The Python library that computes satellite positions, rise/set times, and twilight calculations on the backend. Rigorous and well-documented.

**CelesTrak** maintained by Dr. T.S. Kelso. The source for current Two-Line Element sets that make satellite tracking possible. Dr. Kelso has been curating this data since the 1980s.

**SIMBAD** by CDS Strasbourg. The astronomical database that resolves object names and provides catalog data for the telescope info panel.

**HiPS Surveys** served by CDS. The hierarchical progressive survey format that makes it possible to stream terabytes of sky imagery to a web browser.

**SGP4** orbital propagation, based on the work of David Vallado. The algorithm that predicts where a satellite will be given its TLE.

**Data sources**: NASA (Hubble, Fermi, GALEX), ESA, NOAA (JPSS satellite operations), EUMETSAT, Sloan Digital Sky Survey, PanSTARRS (University of Hawaii), 2MASS (UMass/IPAC), ROSAT, the Digitized Sky Survey (STScI/AAO/UK-PPARC).

**Chart.js** for the rise/set altitude plots and weather charts. **D3.js** for the orbital map projections. **globe.gl** for the 3D Earth view.

---

*Clear skies.*
