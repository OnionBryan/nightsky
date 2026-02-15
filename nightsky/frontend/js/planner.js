/**
 * planner.js - Night Sky Observation Planner
 *
 * Main application logic for the observation planning page.
 * Provides tools for planning observing sessions including:
 * - Tonight's best objects
 * - Object rise/set/transit times
 * - Angular distance calculator
 * - Moon phase display
 * - Weather forecast
 * - Object checklists (Messier, Caldwell)
 */

// Application state
const PlannerState = {
    location: {
        lat: null,
        lon: null,
        name: 'Unknown Location',
        bortle: 5
    },
    currentDate: new Date(),
    nightMode: false,
    catalogs: {
        messier: [],
        caldwell: []
    },
    observed: {
        messier: new Set(),
        caldwell: new Set()
    },
    activeTab: 'tonight',
    isLoading: false,
    // Constellation stories data
    constellations: null,
    storiesState: {
        selectedCulture: 'all',
        selectedCategory: 'zodiac',
        selectedObject: null
    }
};

// DOM Elements cache
const Elements = {};

/**
 * Initialize the planner application
 */
async function initPlanner() {
    cacheElements();
    loadSettings();
    setupEventListeners();
    await loadCatalogs();
    await getLocation();
    updateDisplay();
}

/**
 * Cache DOM element references
 */
function cacheElements() {
    Elements.tabs = document.querySelectorAll('.tab-btn');
    Elements.tabPanels = document.querySelectorAll('.tab-panel');
    Elements.nightModeToggle = document.getElementById('night-mode-toggle');
    Elements.locationDisplay = document.getElementById('location-display');
    Elements.dateDisplay = document.getElementById('date-display');
    Elements.timeDisplay = document.getElementById('time-display');
    Elements.locationInput = document.getElementById('location-input');
    Elements.useLocationBtn = document.getElementById('use-location-btn');

    // Tonight's Best panel
    Elements.tonightList = document.getElementById('tonight-list');
    Elements.tonightFilters = document.querySelectorAll('.filter-btn');

    // Moon widget
    Elements.moonPhaseContainer = document.getElementById('moon-phase');
    Elements.moonInfoContainer = document.getElementById('moon-info');

    // Ephemeris panel
    Elements.objectSearch = document.getElementById('object-search');
    Elements.ephemerisResult = document.getElementById('ephemeris-result');
    Elements.ephemerisTimeline = document.getElementById('ephemeris-timeline');

    // Angular distance panel
    Elements.coord1Ra = document.getElementById('coord1-ra');
    Elements.coord1Dec = document.getElementById('coord1-dec');
    Elements.coord2Ra = document.getElementById('coord2-ra');
    Elements.coord2Dec = document.getElementById('coord2-dec');
    Elements.distanceResult = document.getElementById('distance-result');

    // Object lists panel
    Elements.messierList = document.getElementById('messier-list');
    Elements.caldwellList = document.getElementById('caldwell-list');
    Elements.messierProgress = document.getElementById('messier-progress');
    Elements.caldwellProgress = document.getElementById('caldwell-progress');

    // Weather panel
    Elements.weatherContainer = document.getElementById('weather-container');

    // Bortle indicator
    Elements.bortleIndicator = document.getElementById('bortle-indicator');

    // Stories panel
    Elements.cultureSelect = document.getElementById('culture-select');
    Elements.storiesSearchInput = document.getElementById('stories-search-input');
    Elements.storiesCategories = document.querySelectorAll('.category-btn');
    Elements.storiesObjectList = document.getElementById('stories-object-list');
    Elements.storyDisplay = document.getElementById('story-display');
}

/**
 * Load saved settings from localStorage
 */
function loadSettings() {
    // Night mode preference
    const savedNightMode = localStorage.getItem('nightsky-nightmode');
    if (savedNightMode === 'true') {
        PlannerState.nightMode = true;
        document.documentElement.setAttribute('data-theme', 'night');
        if (Elements.nightModeToggle) {
            Elements.nightModeToggle.classList.add('active');
        }
    }

    // Observed objects
    try {
        const savedMessier = localStorage.getItem('nightsky-observed-messier');
        if (savedMessier) {
            PlannerState.observed.messier = new Set(JSON.parse(savedMessier));
        }

        const savedCaldwell = localStorage.getItem('nightsky-observed-caldwell');
        if (savedCaldwell) {
            PlannerState.observed.caldwell = new Set(JSON.parse(savedCaldwell));
        }
    } catch (e) {
        console.error('Error loading observed objects:', e);
    }

    // Saved location
    try {
        const savedLocation = localStorage.getItem('nightsky-location');
        if (savedLocation) {
            const loc = JSON.parse(savedLocation);
            PlannerState.location = { ...PlannerState.location, ...loc };
        }
    } catch (e) {
        console.error('Error loading saved location:', e);
    }
}

/**
 * Save current settings to localStorage
 */
function saveSettings() {
    localStorage.setItem('nightsky-nightmode', PlannerState.nightMode);
    localStorage.setItem('nightsky-observed-messier',
        JSON.stringify([...PlannerState.observed.messier]));
    localStorage.setItem('nightsky-observed-caldwell',
        JSON.stringify([...PlannerState.observed.caldwell]));
    localStorage.setItem('nightsky-location',
        JSON.stringify(PlannerState.location));
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    // Tab switching
    Elements.tabs.forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Night mode toggle
    if (Elements.nightModeToggle) {
        Elements.nightModeToggle.addEventListener('click', toggleNightMode);
    }

    // Location input
    if (Elements.locationInput) {
        Elements.locationInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                handleLocationSearch(Elements.locationInput.value);
            }
        });
    }

    // Use my location button
    if (Elements.useLocationBtn) {
        Elements.useLocationBtn.addEventListener('click', requestGeolocation);
    }

    // Object search
    if (Elements.objectSearch) {
        Elements.objectSearch.addEventListener('input', debounce(searchObject, 300));
        Elements.objectSearch.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                calculateEphemeris();
            }
        });
    }

    // Angular distance calculation
    const calcDistanceBtn = document.getElementById('calc-distance-btn');
    if (calcDistanceBtn) {
        calcDistanceBtn.addEventListener('click', calculateAngularDistance);
    }

    // Filter buttons
    Elements.tonightFilters.forEach(btn => {
        btn.addEventListener('click', () => filterTonightList(btn.dataset.filter));
    });

    // Update time every second
    setInterval(updateTime, 1000);

    // Catalog list toggles
    document.querySelectorAll('.catalog-toggle').forEach(toggle => {
        toggle.addEventListener('click', () => toggleCatalogExpand(toggle));
    });

    // Stories panel event listeners
    if (Elements.cultureSelect) {
        Elements.cultureSelect.addEventListener('change', (e) => {
            PlannerState.storiesState.selectedCulture = e.target.value;
            updateStoriesObjectList();
            // Re-render current story if one is selected
            if (PlannerState.storiesState.selectedObject) {
                displayStory(PlannerState.storiesState.selectedObject);
            }
        });
    }

    if (Elements.storiesSearchInput) {
        Elements.storiesSearchInput.addEventListener('input', debounce(() => {
            updateStoriesObjectList();
        }, 300));
    }

    Elements.storiesCategories?.forEach(btn => {
        btn.addEventListener('click', () => {
            Elements.storiesCategories.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            PlannerState.storiesState.selectedCategory = btn.dataset.category;
            updateStoriesObjectList();
        });
    });
}

/**
 * Load Messier and Caldwell catalogs
 */
async function loadCatalogs() {
    try {
        const [messierResp, caldwellResp, constellationsResp] = await Promise.all([
            fetch('data/messier.json'),
            fetch('data/caldwell.json'),
            fetch('data/constellations.json')
        ]);

        if (messierResp.ok) {
            const data = await messierResp.json();
            PlannerState.catalogs.messier = data.objects || data;
        }

        if (caldwellResp.ok) {
            const data = await caldwellResp.json();
            PlannerState.catalogs.caldwell = data.objects || data;
        }

        if (constellationsResp.ok) {
            PlannerState.constellations = await constellationsResp.json();
            console.log('Loaded constellation stories data');
        }

        console.log(`Loaded ${PlannerState.catalogs.messier.length} Messier objects`);
        console.log(`Loaded ${PlannerState.catalogs.caldwell.length} Caldwell objects`);
    } catch (e) {
        console.error('Error loading catalogs:', e);
    }
}

/**
 * Get user's location
 */
async function getLocation() {
    // Check if we have a saved location
    if (PlannerState.location.lat && PlannerState.location.lon) {
        updateLocationDisplay();
        return;
    }

    // Try geolocation
    if ('geolocation' in navigator) {
        try {
            const position = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    timeout: 10000,
                    enableHighAccuracy: false
                });
            });

            PlannerState.location.lat = position.coords.latitude;
            PlannerState.location.lon = position.coords.longitude;

            // Try to get location name via reverse geocoding
            await reverseGeocode(position.coords.latitude, position.coords.longitude);

            saveSettings();
        } catch (e) {
            console.warn('Geolocation failed, using default:', e);
            // Default to a reasonable location (San Francisco)
            PlannerState.location.lat = 37.7749;
            PlannerState.location.lon = -122.4194;
            PlannerState.location.name = 'San Francisco, CA';
        }
    } else {
        // Fallback
        PlannerState.location.lat = 37.7749;
        PlannerState.location.lon = -122.4194;
        PlannerState.location.name = 'San Francisco, CA';
    }

    updateLocationDisplay();
}

/**
 * Reverse geocode coordinates to get location name
 */
async function reverseGeocode(lat, lon) {
    try {
        // Use Open-Meteo's geocoding API (free, no key required)
        const resp = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`
        );
        if (resp.ok) {
            // The API doesn't provide location names, so we'll create one from coords
            PlannerState.location.name = `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;
        }
    } catch (e) {
        PlannerState.location.name = `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;
    }
}

/**
 * Handle location search input
 */
async function handleLocationSearch(query) {
    if (!query || query.trim() === '') return;

    query = query.trim();

    // Check if input looks like coordinates (lat, lon)
    const coordMatch = query.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
    if (coordMatch) {
        const lat = parseFloat(coordMatch[1]);
        const lon = parseFloat(coordMatch[2]);

        if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
            PlannerState.location.lat = lat;
            PlannerState.location.lon = lon;
            PlannerState.location.name = `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
            updateLocationDisplay();
            saveSettings();
            updateDisplay();
            return;
        }
    }

    // Otherwise, geocode the city name
    try {
        Elements.locationDisplay.textContent = 'Searching...';

        // Use Open-Meteo geocoding API (free, no key required)
        const resp = await fetch(
            `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`
        );

        if (resp.ok) {
            const data = await resp.json();
            if (data.results && data.results.length > 0) {
                const result = data.results[0];
                PlannerState.location.lat = result.latitude;
                PlannerState.location.lon = result.longitude;
                PlannerState.location.name = result.admin1
                    ? `${result.name}, ${result.admin1}`
                    : `${result.name}, ${result.country}`;

                updateLocationDisplay();
                saveSettings();
                updateDisplay();

                // Clear the input
                if (Elements.locationInput) {
                    Elements.locationInput.value = '';
                }
            } else {
                Elements.locationDisplay.textContent = 'Location not found';
                setTimeout(() => updateLocationDisplay(), 2000);
            }
        }
    } catch (e) {
        console.error('Geocoding error:', e);
        Elements.locationDisplay.textContent = 'Search failed';
        setTimeout(() => updateLocationDisplay(), 2000);
    }
}

/**
 * Request geolocation from browser
 */
async function requestGeolocation() {
    if (!('geolocation' in navigator)) {
        alert('Geolocation is not supported by your browser');
        return;
    }

    Elements.locationDisplay.textContent = 'Getting location...';

    try {
        const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                timeout: 10000,
                enableHighAccuracy: true
            });
        });

        PlannerState.location.lat = position.coords.latitude;
        PlannerState.location.lon = position.coords.longitude;
        PlannerState.location.name = `${position.coords.latitude.toFixed(4)}°, ${position.coords.longitude.toFixed(4)}°`;

        // Try to get a better name via reverse geocoding
        try {
            const resp = await fetch(
                `https://geocoding-api.open-meteo.com/v1/search?name=${position.coords.latitude.toFixed(2)},${position.coords.longitude.toFixed(2)}&count=1`
            );
            // Note: reverse geocoding isn't directly supported, so we keep the coords as name
        } catch (e) {
            // Keep coordinate-based name
        }

        updateLocationDisplay();
        saveSettings();
        updateDisplay();

    } catch (e) {
        console.error('Geolocation error:', e);
        Elements.locationDisplay.textContent = 'Location access denied';
        setTimeout(() => updateLocationDisplay(), 2000);
    }
}

/**
 * Update the location display in the header
 */
function updateLocationDisplay() {
    if (Elements.locationDisplay) {
        Elements.locationDisplay.textContent = PlannerState.location.name;
    }
}

/**
 * Update time display
 */
function updateTime() {
    PlannerState.currentDate = new Date();

    if (Elements.dateDisplay) {
        Elements.dateDisplay.textContent = PlannerState.currentDate.toLocaleDateString(undefined, {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }

    if (Elements.timeDisplay) {
        Elements.timeDisplay.textContent = PlannerState.currentDate.toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }
}

/**
 * Toggle night mode
 */
function toggleNightMode() {
    PlannerState.nightMode = !PlannerState.nightMode;

    if (PlannerState.nightMode) {
        document.documentElement.setAttribute('data-theme', 'night');
        Elements.nightModeToggle?.classList.add('active');
    } else {
        document.documentElement.removeAttribute('data-theme');
        Elements.nightModeToggle?.classList.remove('active');
    }

    saveSettings();
}

/**
 * Switch between tabs
 */
function switchTab(tabId) {
    PlannerState.activeTab = tabId;

    // Update tab buttons
    Elements.tabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabId);
    });

    // Update tab panels
    Elements.tabPanels.forEach(panel => {
        panel.classList.toggle('active', panel.id === `${tabId}-panel`);
    });

    // Load content for the active tab
    switch (tabId) {
        case 'tonight':
            updateTonightList();
            break;
        case 'ephemeris':
            // Focus the search input
            Elements.objectSearch?.focus();
            break;
        case 'lists':
            renderObjectLists();
            break;
        case 'weather':
            loadWeather();
            break;
        case 'stories':
            initStoriesPanel();
            break;
    }
}

/**
 * Update all displays
 */
function updateDisplay() {
    updateTime();
    updateMoonWidget();
    updateBortleIndicator();
    updateTonightList();
}

/**
 * Update moon phase widget
 */
function updateMoonWidget() {
    const moonData = Astronomy.calculateMoonPhase(PlannerState.currentDate);

    if (Elements.moonPhaseContainer) {
        Elements.moonPhaseContainer.innerHTML = Astronomy.generateMoonSVG(moonData.phase, 80);
    }

    if (Elements.moonInfoContainer) {
        const moonRiseSet = Astronomy.calculateMoonRiseTransitSet(
            PlannerState.location.lat,
            PlannerState.location.lon,
            PlannerState.currentDate
        );

        Elements.moonInfoContainer.innerHTML = `
            <div class="moon-phase-name">${moonData.name}</div>
            <div class="moon-illumination">${moonData.illumination.toFixed(0)}% illuminated</div>
            <div class="moon-age">Age: ${moonData.age.toFixed(1)} days</div>
            <div class="moon-times">
                ${moonRiseSet.rise ? `Rise: ${formatTime(moonRiseSet.rise)}` : 'No rise today'}
                ${moonRiseSet.set ? ` | Set: ${formatTime(moonRiseSet.set)}` : ''}
            </div>
            <div class="moon-next">
                Next Full: ${moonData.nextFull.toLocaleDateString()}
            </div>
        `;
    }
}

/**
 * Update Bortle class indicator
 */
function updateBortleIndicator() {
    if (!Elements.bortleIndicator) return;

    const bortleInfo = Astronomy.getBortleInfo(PlannerState.location.bortle);

    Elements.bortleIndicator.innerHTML = `
        <div class="bortle-class">Class ${PlannerState.location.bortle}</div>
        <div class="bortle-name">${bortleInfo.name}</div>
        <div class="bortle-lm">Limiting Mag: ${bortleInfo.limitingMag}</div>
    `;

    // Set color based on Bortle class
    const colors = {
        1: '#000000', 2: '#1a1a2e', 3: '#2d2d44',
        4: '#3d3d5c', 5: '#4d4d6a', 6: '#666680',
        7: '#808099', 8: '#9999aa', 9: '#ccccdd'
    };
    Elements.bortleIndicator.style.setProperty('--bortle-color', colors[PlannerState.location.bortle]);
}

/**
 * Update tonight's best objects list
 */
function updateTonightList() {
    if (!Elements.tonightList) return;

    const allObjects = [
        ...PlannerState.catalogs.messier.map(o => ({ ...o, catalog: 'M' })),
        ...PlannerState.catalogs.caldwell.map(o => ({ ...o, catalog: 'C' }))
    ];

    if (allObjects.length === 0) {
        Elements.tonightList.innerHTML = '<div class="loading">Loading catalogs...</div>';
        return;
    }

    // Calculate visibility for all objects
    const limitingMag = Astronomy.getBortleInfo(PlannerState.location.bortle).limitingMag;
    const rankedObjects = Astronomy.rankObjectsByVisibility(
        allObjects,
        PlannerState.location.lat,
        PlannerState.location.lon,
        PlannerState.currentDate,
        limitingMag
    );

    // Take top 20
    const topObjects = rankedObjects.slice(0, 20);

    if (topObjects.length === 0) {
        Elements.tonightList.innerHTML = `
            <div class="no-objects">
                No objects visible above the horizon at your location.
            </div>
        `;
        return;
    }

    Elements.tonightList.innerHTML = topObjects.map(obj => `
        <div class="object-card" data-type="${obj.type}" data-id="${obj.id}">
            <div class="object-header">
                <span class="object-name">${obj.catalog}${obj.id} - ${obj.name || ''}</span>
                <span class="object-score">${obj.visibilityScore}</span>
            </div>
            <div class="object-details">
                <span class="object-type">${obj.type}</span>
                <span class="object-constellation">${obj.constellation}</span>
                <span class="object-magnitude">Mag ${obj.magnitude}</span>
            </div>
            <div class="object-position">
                Alt: ${obj.currentAltitude.toFixed(1)}° | Az: ${obj.currentAzimuth.toFixed(1)}°
                ${obj.isOptimal ? '<span class="optimal-badge">Optimal</span>' : ''}
            </div>
        </div>
    `).join('');

    // Add click handlers
    document.querySelectorAll('.object-card').forEach(card => {
        card.addEventListener('click', () => {
            const id = card.dataset.id;
            const catalog = card.querySelector('.object-name').textContent.startsWith('M') ? 'messier' : 'caldwell';
            showObjectDetails(catalog, id);
        });
    });
}

/**
 * Filter tonight's list by object type
 */
function filterTonightList(filter) {
    Elements.tonightFilters.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
    });

    const cards = document.querySelectorAll('.object-card');
    cards.forEach(card => {
        if (filter === 'all') {
            card.style.display = '';
        } else {
            const type = card.dataset.type.toLowerCase();
            card.style.display = type.includes(filter) ? '' : 'none';
        }
    });
}

/**
 * Calculate ephemeris for an object
 */
async function calculateEphemeris() {
    const query = Elements.objectSearch?.value?.trim();
    if (!query) return;

    // First try to find in local catalogs
    let obj = findObjectInCatalogs(query);

    if (!obj) {
        // Try the backend API
        try {
            const resp = await fetch(`/api/ephemeris?name=${encodeURIComponent(query)}&lat=${PlannerState.location.lat}&lon=${PlannerState.location.lon}`);
            if (resp.ok) {
                obj = await resp.json();
            }
        } catch (e) {
            console.error('Ephemeris API error:', e);
        }
    }

    if (!obj) {
        if (Elements.ephemerisResult) {
            Elements.ephemerisResult.innerHTML = `
                <div class="error">Object "${query}" not found</div>
            `;
        }
        return;
    }

    // Calculate rise/transit/set
    let ra = obj.ra;
    let dec = obj.dec;

    // Parse RA if string
    if (typeof ra === 'string') {
        ra = Astronomy.parseCoordinate(ra, 'ra');
    } else if (ra < 24) {
        ra = ra * 15;  // Convert hours to degrees
    }

    if (typeof dec === 'string') {
        dec = Astronomy.parseCoordinate(dec, 'dec');
    }

    const rts = Astronomy.calculateRiseTransitSet(
        ra, dec,
        PlannerState.location.lat,
        PlannerState.location.lon,
        PlannerState.currentDate
    );

    // Current position
    const jd = Astronomy.dateToJulian(PlannerState.currentDate);
    const lst = Astronomy.lst(jd, PlannerState.location.lon);
    const altAz = Astronomy.raDecToAltAz(ra, dec, PlannerState.location.lat, lst);

    // Display results
    if (Elements.ephemerisResult) {
        Elements.ephemerisResult.innerHTML = `
            <div class="ephemeris-object">
                <h3>${obj.name || query}</h3>
                ${obj.type ? `<span class="object-type">${obj.type}</span>` : ''}
            </div>
            <div class="ephemeris-coords">
                <div>RA: ${Astronomy.formatRA(ra)}</div>
                <div>Dec: ${Astronomy.formatDec(dec)}</div>
            </div>
            <div class="ephemeris-current">
                <div class="current-label">Current Position:</div>
                <div>Altitude: ${altAz.altitude.toFixed(2)}°</div>
                <div>Azimuth: ${altAz.azimuth.toFixed(2)}°</div>
                <div class="visibility-status">
                    ${altAz.altitude > 0 ?
                        `<span class="visible">Above Horizon</span>` :
                        `<span class="not-visible">Below Horizon</span>`}
                </div>
            </div>
            <div class="ephemeris-times">
                ${rts.circumpolar ?
                    '<div class="circumpolar">Object is circumpolar (never sets)</div>' :
                    rts.neverRises ?
                    '<div class="never-rises">Object never rises at your latitude</div>' :
                    `
                    <div class="time-row">
                        <span class="time-label">Rise:</span>
                        <span class="time-value">${formatTime(rts.rise)}</span>
                    </div>
                    <div class="time-row">
                        <span class="time-label">Transit:</span>
                        <span class="time-value">${formatTime(rts.transit)}</span>
                    </div>
                    <div class="time-row">
                        <span class="time-label">Set:</span>
                        <span class="time-value">${formatTime(rts.set)}</span>
                    </div>
                    `
                }
            </div>
        `;
    }

    // Draw timeline
    if (Elements.ephemerisTimeline && !rts.neverRises) {
        drawEphemerisTimeline(rts, altAz.altitude > 0);
    }
}

/**
 * Search for an object as user types
 */
function searchObject() {
    const query = Elements.objectSearch?.value?.trim().toLowerCase();
    if (!query || query.length < 2) return;

    // Find matches in catalogs
    const matches = [];

    PlannerState.catalogs.messier.forEach(obj => {
        if (`m${obj.id}`.includes(query) ||
            (obj.name && obj.name.toLowerCase().includes(query))) {
            matches.push({ ...obj, catalog: 'M' });
        }
    });

    PlannerState.catalogs.caldwell.forEach(obj => {
        if (`c${obj.id}`.includes(query) ||
            (obj.name && obj.name.toLowerCase().includes(query))) {
            matches.push({ ...obj, catalog: 'C' });
        }
    });

    // Show suggestions (limit to 5)
    const suggestions = matches.slice(0, 5);
    showSearchSuggestions(suggestions);
}

/**
 * Show search suggestions dropdown
 */
function showSearchSuggestions(suggestions) {
    let dropdown = document.getElementById('search-suggestions');

    if (suggestions.length === 0) {
        if (dropdown) dropdown.remove();
        return;
    }

    if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.id = 'search-suggestions';
        dropdown.className = 'search-suggestions';
        Elements.objectSearch.parentNode.appendChild(dropdown);
    }

    dropdown.innerHTML = suggestions.map(obj => `
        <div class="suggestion" data-id="${obj.catalog}${obj.id}">
            <span class="suggestion-id">${obj.catalog}${obj.id}</span>
            <span class="suggestion-name">${obj.name || ''}</span>
            <span class="suggestion-type">${obj.type}</span>
        </div>
    `).join('');

    dropdown.querySelectorAll('.suggestion').forEach(el => {
        el.addEventListener('click', () => {
            Elements.objectSearch.value = el.dataset.id;
            dropdown.remove();
            calculateEphemeris();
        });
    });
}

/**
 * Find an object in local catalogs
 */
function findObjectInCatalogs(query) {
    query = query.toLowerCase().trim();

    // Check Messier
    let match = query.match(/^m\s*(\d+)$/i);
    if (match) {
        const id = parseInt(match[1]);
        return PlannerState.catalogs.messier.find(o => o.id === id);
    }

    // Check Caldwell
    match = query.match(/^c\s*(\d+)$/i);
    if (match) {
        const id = parseInt(match[1]);
        return PlannerState.catalogs.caldwell.find(o => o.id === id);
    }

    // Check by name
    for (const obj of PlannerState.catalogs.messier) {
        if (obj.name && obj.name.toLowerCase() === query) {
            return obj;
        }
    }

    for (const obj of PlannerState.catalogs.caldwell) {
        if (obj.name && obj.name.toLowerCase() === query) {
            return obj;
        }
    }

    return null;
}

/**
 * Draw ephemeris timeline
 */
function drawEphemerisTimeline(rts, isCurrentlyVisible) {
    const canvas = Elements.ephemerisTimeline;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width = canvas.offsetWidth * 2;
    const height = canvas.height = canvas.offsetHeight * 2;
    ctx.scale(2, 2);  // Retina scaling

    const w = width / 2;
    const h = height / 2;

    // Clear
    ctx.fillStyle = PlannerState.nightMode ? '#1a0505' : '#1a1a2e';
    ctx.fillRect(0, 0, w, h);

    // Get twilight times
    const twilight = Astronomy.calculateTwilightTimes(
        PlannerState.location.lat,
        PlannerState.location.lon,
        PlannerState.currentDate
    );

    // Draw 24-hour timeline
    const startHour = 12;  // Noon
    const hoursWidth = w - 40;
    const hourWidth = hoursWidth / 24;
    const yBase = h - 30;

    // Draw twilight zones
    const drawTimeZone = (start, end, color) => {
        if (!start || !end) return;
        const x1 = 20 + ((start.getHours() + start.getMinutes() / 60 - startHour + 24) % 24) * hourWidth;
        const x2 = 20 + ((end.getHours() + end.getMinutes() / 60 - startHour + 24) % 24) * hourWidth;
        ctx.fillStyle = color;
        ctx.fillRect(x1, 10, x2 - x1, yBase - 20);
    };

    // Night (astronomical twilight to dawn)
    if (twilight.astronomicalDusk && twilight.astronomicalDawn) {
        // Dark night zone
        ctx.fillStyle = PlannerState.nightMode ? '#0a0000' : '#0a0a12';
        const duskX = 20 + ((twilight.astronomicalDusk.getHours() + twilight.astronomicalDusk.getMinutes() / 60 - startHour + 24) % 24) * hourWidth;
        ctx.fillRect(duskX, 10, w - 20 - duskX, yBase - 20);
        ctx.fillRect(20, 10, ((twilight.astronomicalDawn.getHours() + twilight.astronomicalDawn.getMinutes() / 60 - startHour + 24) % 24) * hourWidth, yBase - 20);
    }

    // Draw object visibility arc
    if (!rts.circumpolar && rts.rise && rts.set) {
        const riseX = 20 + ((rts.rise.getHours() + rts.rise.getMinutes() / 60 - startHour + 24) % 24) * hourWidth;
        const transitX = 20 + ((rts.transit.getHours() + rts.transit.getMinutes() / 60 - startHour + 24) % 24) * hourWidth;
        const setX = 20 + ((rts.set.getHours() + rts.set.getMinutes() / 60 - startHour + 24) % 24) * hourWidth;

        ctx.strokeStyle = PlannerState.nightMode ? '#ff6666' : '#00d4ff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(riseX, yBase - 10);
        ctx.quadraticCurveTo(transitX, 20, setX, yBase - 10);
        ctx.stroke();

        // Markers
        ctx.fillStyle = PlannerState.nightMode ? '#ff4444' : '#00d4ff';
        [riseX, transitX, setX].forEach(x => {
            ctx.beginPath();
            ctx.arc(x, x === transitX ? 25 : yBase - 10, 4, 0, Math.PI * 2);
            ctx.fill();
        });
    } else if (rts.circumpolar) {
        // Draw horizontal line across entire timeline
        ctx.strokeStyle = PlannerState.nightMode ? '#ff6666' : '#00d4ff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(20, h / 2);
        ctx.lineTo(w - 20, h / 2);
        ctx.stroke();
    }

    // Current time marker
    const now = new Date();
    const nowX = 20 + ((now.getHours() + now.getMinutes() / 60 - startHour + 24) % 24) * hourWidth;
    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(nowX, 5);
    ctx.lineTo(nowX, yBase);
    ctx.stroke();

    // Hour labels
    ctx.fillStyle = PlannerState.nightMode ? '#aa6666' : '#888';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'center';
    for (let i = 0; i <= 24; i += 3) {
        const hour = (startHour + i) % 24;
        const x = 20 + i * hourWidth;
        ctx.fillText(`${hour}:00`, x, yBase + 12);
    }
}

/**
 * Calculate angular distance between two positions
 */
function calculateAngularDistance() {
    const ra1Str = Elements.coord1Ra?.value;
    const dec1Str = Elements.coord1Dec?.value;
    const ra2Str = Elements.coord2Ra?.value;
    const dec2Str = Elements.coord2Dec?.value;

    if (!ra1Str || !dec1Str || !ra2Str || !dec2Str) {
        showDistanceError('Please enter all coordinates');
        return;
    }

    // Parse coordinates
    let ra1 = Astronomy.parseCoordinate(ra1Str, 'ra');
    let dec1 = Astronomy.parseCoordinate(dec1Str, 'dec');
    let ra2 = Astronomy.parseCoordinate(ra2Str, 'ra');
    let dec2 = Astronomy.parseCoordinate(dec2Str, 'dec');

    if (ra1 === null || dec1 === null || ra2 === null || dec2 === null) {
        showDistanceError('Invalid coordinate format. Use "12h 30m 45s" or decimal degrees.');
        return;
    }

    // Calculate distance
    const distance = Astronomy.angularDistance(ra1, dec1, ra2, dec2);
    const formatted = Astronomy.formatAngularDistance(distance);

    if (Elements.distanceResult) {
        Elements.distanceResult.innerHTML = `
            <div class="distance-main">${formatted.formatted}</div>
            <div class="distance-details">
                <div>${formatted.degrees.toFixed(4)}°</div>
                <div>${formatted.arcminutes.toFixed(2)} arcminutes</div>
                <div>${formatted.arcseconds.toFixed(1)} arcseconds</div>
                <div class="moon-comparison">
                    ≈ ${formatted.moonWidths.toFixed(1)} Moon widths
                </div>
            </div>
        `;
    }
}

/**
 * Show distance calculation error
 */
function showDistanceError(message) {
    if (Elements.distanceResult) {
        Elements.distanceResult.innerHTML = `<div class="error">${message}</div>`;
    }
}

/**
 * Render object checklists (Messier/Caldwell)
 */
function renderObjectLists() {
    renderCatalogList('messier', Elements.messierList, Elements.messierProgress);
    renderCatalogList('caldwell', Elements.caldwellList, Elements.caldwellProgress);
}

/**
 * Render a single catalog list
 */
function renderCatalogList(catalogName, listElement, progressElement) {
    if (!listElement) return;

    const catalog = PlannerState.catalogs[catalogName];
    const observed = PlannerState.observed[catalogName];

    // Update progress
    if (progressElement) {
        const percent = (observed.size / catalog.length * 100).toFixed(0);
        progressElement.innerHTML = `
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${percent}%"></div>
            </div>
            <div class="progress-text">${observed.size} / ${catalog.length} (${percent}%)</div>
        `;
    }

    // Sort by ID
    const sorted = [...catalog].sort((a, b) => a.id - b.id);

    listElement.innerHTML = sorted.map(obj => {
        const isObserved = observed.has(obj.id);
        const prefix = catalogName === 'messier' ? 'M' : 'C';

        return `
            <div class="catalog-item ${isObserved ? 'observed' : ''}"
                 data-id="${obj.id}" data-catalog="${catalogName}">
                <label class="checkbox-label">
                    <input type="checkbox" ${isObserved ? 'checked' : ''}>
                    <span class="object-id">${prefix}${obj.id}</span>
                </label>
                <span class="object-name">${obj.name || ''}</span>
                <span class="object-type">${obj.type}</span>
                <span class="object-constellation">${obj.constellation}</span>
            </div>
        `;
    }).join('');

    // Add checkbox handlers
    listElement.querySelectorAll('.catalog-item input').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const item = e.target.closest('.catalog-item');
            const id = parseInt(item.dataset.id);
            const cat = item.dataset.catalog;

            if (e.target.checked) {
                PlannerState.observed[cat].add(id);
                item.classList.add('observed');
            } else {
                PlannerState.observed[cat].delete(id);
                item.classList.remove('observed');
            }

            saveSettings();
            renderCatalogList(cat, listElement, progressElement);
        });
    });
}

/**
 * Toggle catalog section expansion
 */
function toggleCatalogExpand(toggle) {
    const section = toggle.closest('.catalog-section');
    section.classList.toggle('collapsed');
}

/**
 * Load weather forecast
 */
async function loadWeather() {
    if (!Elements.weatherContainer) return;

    Elements.weatherContainer.innerHTML = '<div class="loading">Loading weather...</div>';

    try {
        // Use Open-Meteo API (free, no key required)
        const resp = await fetch(
            `https://api.open-meteo.com/v1/forecast?` +
            `latitude=${PlannerState.location.lat}&` +
            `longitude=${PlannerState.location.lon}&` +
            `hourly=cloudcover,visibility,relative_humidity_2m&` +
            `forecast_days=2&timezone=auto`
        );

        if (!resp.ok) throw new Error('Weather API error');

        const data = await resp.json();
        renderWeatherForecast(data);
    } catch (e) {
        console.error('Weather error:', e);
        Elements.weatherContainer.innerHTML = `
            <div class="error">Unable to load weather forecast</div>
        `;
    }
}

/**
 * Render weather forecast
 */
function renderWeatherForecast(data) {
    if (!Elements.weatherContainer || !data.hourly) return;

    const hours = data.hourly.time.slice(0, 48);  // Next 48 hours
    const clouds = data.hourly.cloudcover.slice(0, 48);
    const humidity = data.hourly.relative_humidity_2m.slice(0, 48);

    // Find good observing windows (low cloud cover)
    const goodWindows = [];
    let inWindow = false;
    let windowStart = null;

    hours.forEach((time, i) => {
        const hour = new Date(time).getHours();
        const isNight = hour >= 20 || hour <= 5;  // Rough night hours
        const isGood = clouds[i] < 30 && isNight;

        if (isGood && !inWindow) {
            windowStart = time;
            inWindow = true;
        } else if (!isGood && inWindow) {
            goodWindows.push({ start: windowStart, end: time });
            inWindow = false;
        }
    });

    Elements.weatherContainer.innerHTML = `
        <div class="weather-chart">
            <div class="chart-title">Cloud Cover (next 48 hours)</div>
            <div class="chart-bars">
                ${hours.map((time, i) => {
                    const cloudPct = clouds[i];
                    const color = cloudPct < 20 ? '#22c55e' :
                                  cloudPct < 50 ? '#eab308' :
                                  cloudPct < 80 ? '#f97316' : '#ef4444';
                    const hour = new Date(time).getHours();

                    return `
                        <div class="chart-bar"
                             style="height: ${cloudPct}%; background: ${color}"
                             title="${new Date(time).toLocaleString()}: ${cloudPct}% clouds">
                        </div>
                    `;
                }).join('')}
            </div>
            <div class="chart-labels">
                <span>Now</span>
                <span>+12h</span>
                <span>+24h</span>
                <span>+36h</span>
                <span>+48h</span>
            </div>
        </div>

        ${goodWindows.length > 0 ? `
            <div class="good-windows">
                <div class="windows-title">Good Observing Windows</div>
                ${goodWindows.map(w => `
                    <div class="window">
                        ${new Date(w.start).toLocaleString()} -
                        ${new Date(w.end).toLocaleTimeString()}
                    </div>
                `).join('')}
            </div>
        ` : `
            <div class="no-windows">
                No clear observing windows in the next 48 hours
            </div>
        `}

        <div class="weather-legend">
            <span class="legend-item"><span class="dot" style="background:#22c55e"></span> Clear (&lt;20%)</span>
            <span class="legend-item"><span class="dot" style="background:#eab308"></span> Partly Cloudy</span>
            <span class="legend-item"><span class="dot" style="background:#f97316"></span> Mostly Cloudy</span>
            <span class="legend-item"><span class="dot" style="background:#ef4444"></span> Overcast</span>
        </div>
    `;
}

/**
 * Show object details modal
 */
function showObjectDetails(catalog, id) {
    const obj = PlannerState.catalogs[catalog].find(o => o.id === parseInt(id));
    if (!obj) return;

    const prefix = catalog === 'messier' ? 'M' : 'C';

    // Calculate current position
    let ra = obj.ra;
    let dec = obj.dec;

    if (typeof ra === 'string') {
        ra = Astronomy.parseCoordinate(ra, 'ra');
    } else if (ra < 24) {
        ra = ra * 15;
    }

    if (typeof dec === 'string') {
        dec = Astronomy.parseCoordinate(dec, 'dec');
    }

    const jd = Astronomy.dateToJulian(PlannerState.currentDate);
    const lst = Astronomy.lst(jd, PlannerState.location.lon);
    const altAz = Astronomy.raDecToAltAz(ra, dec, PlannerState.location.lat, lst);
    const rts = Astronomy.calculateRiseTransitSet(ra, dec, PlannerState.location.lat, PlannerState.location.lon, PlannerState.currentDate);

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <button class="modal-close">&times;</button>
            <h2>${prefix}${obj.id} - ${obj.name || 'Unnamed'}</h2>

            <div class="modal-section">
                <h3>Details</h3>
                <div class="detail-grid">
                    <div><strong>Type:</strong> ${obj.type}</div>
                    <div><strong>Constellation:</strong> ${obj.constellation}</div>
                    <div><strong>Magnitude:</strong> ${obj.magnitude}</div>
                    <div><strong>Size:</strong> ${obj.size || 'N/A'}</div>
                </div>
            </div>

            <div class="modal-section">
                <h3>Coordinates</h3>
                <div class="detail-grid">
                    <div><strong>RA:</strong> ${Astronomy.formatRA(ra)}</div>
                    <div><strong>Dec:</strong> ${Astronomy.formatDec(dec)}</div>
                </div>
            </div>

            <div class="modal-section">
                <h3>Current Position</h3>
                <div class="detail-grid">
                    <div><strong>Altitude:</strong> ${altAz.altitude.toFixed(1)}°</div>
                    <div><strong>Azimuth:</strong> ${altAz.azimuth.toFixed(1)}°</div>
                    <div><strong>Status:</strong> ${altAz.altitude > 0 ? 'Above Horizon' : 'Below Horizon'}</div>
                </div>
            </div>

            <div class="modal-section">
                <h3>Rise/Transit/Set</h3>
                ${rts.circumpolar ? '<p>Circumpolar (never sets)</p>' :
                  rts.neverRises ? '<p>Never rises at your latitude</p>' :
                  `<div class="detail-grid">
                      <div><strong>Rise:</strong> ${formatTime(rts.rise)}</div>
                      <div><strong>Transit:</strong> ${formatTime(rts.transit)}</div>
                      <div><strong>Set:</strong> ${formatTime(rts.set)}</div>
                  </div>`
                }
            </div>

            ${obj.description ? `
                <div class="modal-section">
                    <h3>Description</h3>
                    <p>${obj.description}</p>
                </div>
            ` : ''}

            <div class="modal-actions">
                <button class="btn-primary" onclick="window.open('index.html?goto=${prefix}${obj.id}', '_blank')">
                    View in Planetarium
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Close handlers
    modal.querySelector('.modal-close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

// ============================================================================
// Constellation Stories Functions
// ============================================================================

/**
 * Initialize the stories panel
 */
function initStoriesPanel() {
    if (!PlannerState.constellations) {
        if (Elements.storiesObjectList) {
            Elements.storiesObjectList.innerHTML = '<div class="loading">Loading constellation data...</div>';
        }
        return;
    }
    updateStoriesObjectList();
}

/**
 * Update the stories object list based on current filters
 */
function updateStoriesObjectList() {
    if (!Elements.storiesObjectList || !PlannerState.constellations) return;

    const category = PlannerState.storiesState.selectedCategory;
    const searchTerm = Elements.storiesSearchInput?.value?.toLowerCase().trim() || '';

    let objects = [];

    // Get objects from the selected category
    switch (category) {
        case 'zodiac':
            objects = PlannerState.constellations.zodiac || [];
            break;
        case 'constellations':
            objects = PlannerState.constellations.constellations || [];
            break;
        case 'planets':
            objects = PlannerState.constellations.planets || [];
            break;
        case 'stars':
            objects = PlannerState.constellations.stars || [];
            break;
        case 'asterisms':
            objects = PlannerState.constellations.asterisms || [];
            break;
        case 'meteorShowers':
            objects = PlannerState.constellations.meteorShowers || [];
            break;
        default:
            objects = [];
    }

    // Filter by search term
    if (searchTerm) {
        objects = objects.filter(obj =>
            obj.name.toLowerCase().includes(searchTerm) ||
            (obj.id && obj.id.toLowerCase().includes(searchTerm))
        );
    }

    // Render the list
    if (objects.length === 0) {
        Elements.storiesObjectList.innerHTML = `
            <div class="no-results">
                ${searchTerm ? 'No matches found' : 'No objects in this category'}
            </div>
        `;
        return;
    }

    Elements.storiesObjectList.innerHTML = objects.map(obj => `
        <div class="story-object-item ${PlannerState.storiesState.selectedObject?.id === obj.id ? 'selected' : ''}"
             data-id="${obj.id}" data-category="${category}">
            <span class="object-name">${obj.name}</span>
            ${obj.season ? `<span class="object-season">${obj.season}</span>` : ''}
        </div>
    `).join('');

    // Add click handlers
    Elements.storiesObjectList.querySelectorAll('.story-object-item').forEach(item => {
        item.addEventListener('click', () => {
            const id = item.dataset.id;
            const cat = item.dataset.category;
            const obj = getStoryObject(cat, id);
            if (obj) {
                PlannerState.storiesState.selectedObject = obj;
                // Update selection visual
                Elements.storiesObjectList.querySelectorAll('.story-object-item').forEach(i =>
                    i.classList.remove('selected'));
                item.classList.add('selected');
                displayStory(obj);
            }
        });
    });
}

/**
 * Get a story object by category and id
 */
function getStoryObject(category, id) {
    if (!PlannerState.constellations) return null;

    const collection = PlannerState.constellations[category];
    if (!collection) return null;

    return collection.find(obj => obj.id === id);
}

/**
 * Display a constellation/object story
 */
function displayStory(obj) {
    if (!Elements.storyDisplay || !obj) return;

    const culture = PlannerState.storiesState.selectedCulture;
    const cultures = PlannerState.constellations.cultures || {};

    // Build the story HTML
    let html = `
        <div class="story-header">
            <h2>${obj.name}</h2>
            ${obj.abbreviation ? `<span class="abbreviation">(${obj.abbreviation})</span>` : ''}
        </div>
        <div class="story-meta">
            ${obj.type ? `<span class="meta-item"><strong>Type:</strong> ${obj.type}</span>` : ''}
            ${obj.season ? `<span class="meta-item"><strong>Season:</strong> ${obj.season}</span>` : ''}
            ${obj.hemisphere ? `<span class="meta-item"><strong>Hemisphere:</strong> ${obj.hemisphere}</span>` : ''}
            ${obj.brightestStar ? `<span class="meta-item"><strong>Brightest Star:</strong> ${obj.brightestStar}</span>` : ''}
            ${obj.coordinates ? `<span class="meta-item"><strong>Coordinates:</strong> RA ${obj.coordinates.ra}, Dec ${obj.coordinates.dec}</span>` : ''}
        </div>
    `;

    // Add mythology section
    if (obj.mythology) {
        html += '<div class="story-mythology">';

        const mythKeys = culture === 'all'
            ? Object.keys(obj.mythology)
            : (obj.mythology[culture] ? [culture] : []);

        if (mythKeys.length === 0) {
            html += '<p class="no-mythology">No mythology available for the selected culture.</p>';
        } else {
            mythKeys.forEach(key => {
                const myth = obj.mythology[key];
                const cultureInfo = cultures[key] || { name: key };

                html += `
                    <div class="mythology-section">
                        <h3 class="culture-name">${cultureInfo.name}</h3>
                        ${myth.name ? `<div class="myth-name">${myth.name}</div>` : ''}
                        ${myth.story ? `<div class="myth-story">${myth.story}</div>` : ''}
                        ${myth.characters ? `
                            <div class="myth-characters">
                                <strong>Characters:</strong> ${myth.characters.join(', ')}
                            </div>
                        ` : ''}
                        ${myth.moral ? `
                            <div class="myth-moral">
                                <strong>Theme:</strong> ${myth.moral}
                            </div>
                        ` : ''}
                        ${myth.sources ? `
                            <div class="myth-sources">
                                <strong>Sources:</strong> ${myth.sources.join('; ')}
                            </div>
                        ` : ''}
                        ${myth.association ? `
                            <div class="myth-association">
                                <strong>Association:</strong> ${myth.association}
                            </div>
                        ` : ''}
                        ${myth.deity ? `
                            <div class="myth-deity">
                                <strong>Deity:</strong> ${myth.deity}
                            </div>
                        ` : ''}
                        ${myth.domain ? `
                            <div class="myth-domain">
                                <strong>Domain:</strong> ${myth.domain}
                            </div>
                        ` : ''}
                    </div>
                `;
            });
        }
        html += '</div>';
    }

    // Add stars section if available
    if (obj.stars && obj.stars.length > 0) {
        html += `
            <div class="story-stars">
                <h3>Notable Stars</h3>
                <div class="stars-grid">
                    ${obj.stars.map(star => `
                        <div class="star-item">
                            <div class="star-name">${star.name}</div>
                            ${star.designation ? `<div class="star-designation">${star.designation}</div>` : ''}
                            ${star.magnitude ? `<div class="star-magnitude">Mag: ${star.magnitude}</div>` : ''}
                            ${star.arabicName ? `<div class="star-arabic">${star.arabicName}</div>` : ''}
                            ${star.etymology ? `<div class="star-etymology">${star.etymology}</div>` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    // Add deep sky objects if available
    if (obj.deepSkyObjects && obj.deepSkyObjects.length > 0) {
        html += `
            <div class="story-dso">
                <h3>Deep Sky Objects</h3>
                <ul class="dso-list">
                    ${obj.deepSkyObjects.map(dso => `<li>${dso}</li>`).join('')}
                </ul>
            </div>
        `;
    }

    // Add meteor shower info if available
    if (obj.meteorShower) {
        html += `
            <div class="story-meteor">
                <h3>Associated Meteor Shower</h3>
                <p>${obj.meteorShower}</p>
            </div>
        `;
    }

    // For meteor showers, add specific info
    if (obj.peakDate) {
        html += `
            <div class="story-meteor-details">
                <div class="meteor-detail"><strong>Peak:</strong> ${obj.peakDate}</div>
                ${obj.zhr ? `<div class="meteor-detail"><strong>ZHR:</strong> ${obj.zhr}</div>` : ''}
                ${obj.speed ? `<div class="meteor-detail"><strong>Speed:</strong> ${obj.speed}</div>` : ''}
                ${obj.parent ? `<div class="meteor-detail"><strong>Parent Body:</strong> ${obj.parent}</div>` : ''}
                ${obj.radiant ? `<div class="meteor-detail"><strong>Radiant:</strong> ${obj.radiant}</div>` : ''}
            </div>
        `;
    }

    Elements.storyDisplay.innerHTML = html;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format time for display
 */
function formatTime(date) {
    if (!date) return '--:--';
    return date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * Debounce function
 */
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// ============================================================================
// Initialize on DOM load
// ============================================================================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPlanner);
} else {
    initPlanner();
}
