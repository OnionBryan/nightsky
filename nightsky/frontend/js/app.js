/**
 * Night Sky Viewer - Interactive Planetarium
 * Using VirtualSky library for real-time sky visualization
 */

// Application state
const state = {
    latitude: 40.7128,   // Default: New York
    longitude: -74.0060,
    displayName: 'New York, NY',
    azimuth: 180,        // South
    currentTime: new Date(),
    planetarium: null,
    aladin: null,
    currentFov: 0.5      // Aladin field of view in degrees
};

// Backend API URL
const API_URL = 'http://localhost:5050';

// Direction names for display
const DIRECTION_NAMES = {
    0: 'North',
    45: 'Northeast',
    90: 'East',
    135: 'Southeast',
    180: 'South',
    225: 'Southwest',
    270: 'West',
    315: 'Northwest'
};

// Initialization moved to bottom of file after all functions are defined

// Initialize VirtualSky planetarium
function initPlanetarium() {
    const container = document.getElementById('starmap');
    const width = container.offsetWidth || 800;
    const height = container.offsetHeight || 600;

    state.planetarium = S.virtualsky({
        id: 'starmap',
        projection: 'stereo',
        latitude: state.latitude,
        longitude: state.longitude,
        az: state.azimuth,
        live: true,

        // Display settings
        width: width,
        height: height,

        // Objects
        showstars: true,
        showstarlabels: false,
        showplanets: true,
        showplanetlabels: true,
        constellations: true,
        constellationlabels: false,
        constellationboundaries: false,
        showgalaxy: false,
        meteorshowers: false,
        showorbits: false,

        // Reference lines
        ground: true,
        cardinalpoints: true,
        ecliptic: false,
        meridian: false,
        gridlines_az: false,
        gridlines_eq: false,

        // Visual settings
        magnitude: 5,
        fov: 60,
        scalestars: 1.0,
        negative: false,
        gradient: true,

        // Interactivity
        mouse: true,
        keyboard: true,
        showdate: false,
        showposition: false,

        // Right-click callback for telescope view
        callback: {
            contextmenu: function(e) {
                if (e.ra !== undefined && e.dec !== undefined) {
                    openTelescopeView(e.ra, e.dec);
                }
            }
        }
    });
}

// Reinitialize VirtualSky with all current settings from the DOM
// Used by projection, direction, and location changes which all require full reinit
function reinitPlanetarium() {
    const currentClock = state.planetarium ? state.planetarium.clock : new Date();
    const isLive = state.planetarium ? state.planetarium.live : document.getElementById('opt-live').checked;

    document.getElementById('starmap').innerHTML = '';

    const container = document.getElementById('starmap');
    const width = container.offsetWidth || 800;
    const height = container.offsetHeight || 600;

    state.planetarium = S.virtualsky({
        id: 'starmap',
        projection: document.getElementById('projection-select').value,
        latitude: state.latitude,
        longitude: state.longitude,
        az: state.azimuth,
        live: isLive,
        clock: currentClock,

        width: width,
        height: height,

        showstars: document.getElementById('opt-stars').checked,
        showstarlabels: document.getElementById('opt-starlabels').checked,
        showplanets: document.getElementById('opt-planets').checked,
        showplanetlabels: document.getElementById('opt-planetlabels').checked,
        constellations: document.getElementById('opt-constellations').checked,
        constellationlabels: document.getElementById('opt-constellationlabels').checked,
        constellationboundaries: document.getElementById('opt-boundaries').checked,
        showgalaxy: document.getElementById('opt-galaxy').checked,
        meteorshowers: document.getElementById('opt-meteorshowers').checked,
        showorbits: document.getElementById('opt-orbits').checked,

        ground: document.getElementById('opt-ground').checked,
        cardinalpoints: document.getElementById('opt-cardinals').checked,
        ecliptic: document.getElementById('opt-ecliptic').checked,
        meridian: document.getElementById('opt-meridian').checked,
        gridlines_az: document.getElementById('opt-gridaz').checked,
        gridlines_eq: document.getElementById('opt-grideq').checked,

        magnitude: parseFloat(document.getElementById('magnitude').value),
        fov: parseFloat(document.getElementById('fov').value),
        scalestars: parseFloat(document.getElementById('scalestars').value),
        negative: document.getElementById('color-scheme').value === 'negative',
        gradient: true,

        mouse: true,
        keyboard: true,
        showdate: false,
        showposition: false,

        callback: {
            contextmenu: function(e) {
                if (e.ra !== undefined && e.dec !== undefined) {
                    openTelescopeView(e.ra, e.dec);
                }
            }
        }
    });
}

// Set up all event listeners
function setupEventListeners() {
    // Location input
    document.getElementById('location-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            geocodeLocation();
        }
    });

    document.getElementById('location-input').addEventListener('blur', () => {
        const value = document.getElementById('location-input').value.trim();
        if (value) {
            geocodeLocation();
        }
    });

    // Use my location button
    document.getElementById('use-location-btn').addEventListener('click', useCurrentLocation);

    // Direction buttons
    document.querySelectorAll('.direction-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.direction-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            state.azimuth = parseInt(btn.dataset.az);
            updatePlanetariumDirection();
            updateInfoPanel();
        });
    });

    // Projection select - requires full reinit (property change alone doesn't work)
    document.getElementById('projection-select').addEventListener('change', () => {
        reinitPlanetarium();
        updateInfoPanel();
    });

    // Object checkboxes
    setupCheckbox('opt-stars', 'showstars');
    setupCheckbox('opt-starlabels', 'showstarlabels');
    setupCheckbox('opt-planets', 'showplanets');
    setupCheckbox('opt-planetlabels', 'showplanetlabels');
    setupCheckbox('opt-constellations', 'constellations');
    setupCheckbox('opt-constellationlabels', 'constellationlabels');
    setupCheckbox('opt-boundaries', 'constellationboundaries');
    setupCheckbox('opt-galaxy', 'showgalaxy');
    setupCheckbox('opt-meteorshowers', 'meteorshowers');
    setupCheckbox('opt-orbits', 'showorbits');

    // Reference line checkboxes
    setupCheckbox('opt-ground', 'ground');
    setupCheckbox('opt-cardinals', 'cardinalpoints');
    setupCheckbox('opt-ecliptic', 'ecliptic');
    setupCheckbox('opt-meridian', 'meridian');
    setupCheckbox('opt-gridaz', 'gridlines_az');
    setupCheckbox('opt-grideq', 'gridlines_eq');

    // Live checkbox
    document.getElementById('opt-live').addEventListener('change', (e) => {
        if (!state.planetarium) return;

        state.planetarium.live = e.target.checked;
        if (e.target.checked) {
            const now = new Date();
            state.planetarium.clock = now;
            state.currentTime = now;
        }
        state.planetarium.trigger('change');
        updateTimeDisplay();
    });

    // Time buttons
    document.getElementById('time-back-day').addEventListener('click', () => adjustTime(-24 * 60));
    document.getElementById('time-back-hour').addEventListener('click', () => adjustTime(-60));
    document.getElementById('time-now').addEventListener('click', () => {
        if (!state.planetarium) return;

        const now = new Date();
        state.planetarium.clock = now;
        state.currentTime = now;
        state.planetarium.live = true;
        document.getElementById('opt-live').checked = true;

        // Force redraw
        state.planetarium.trigger('change');

        // Update display immediately
        updateTimeDisplay();
    });
    document.getElementById('time-fwd-hour').addEventListener('click', () => adjustTime(60));
    document.getElementById('time-fwd-day').addEventListener('click', () => adjustTime(24 * 60));

    // Sliders
    setupSlider('magnitude', 'mag-value', 'magnitude');
    setupSlider('fov', 'fov-value', 'fov');
    setupSlider('scalestars', 'scale-value', 'scalestars');

    // Color scheme - reinit to apply cleanly
    document.getElementById('color-scheme').addEventListener('change', () => {
        reinitPlanetarium();
    });

    // Handle window resize
    window.addEventListener('resize', debounce(() => {
        const container = document.getElementById('starmap');
        state.planetarium.width = container.offsetWidth;
        state.planetarium.height = container.offsetHeight;
        state.planetarium.resize();
    }, 250));
}

// Helper to set up checkbox listeners
function setupCheckbox(elementId, property) {
    const element = document.getElementById(elementId);
    if (!element) return;

    element.addEventListener('change', (e) => {
        if (!state.planetarium) return;
        state.planetarium[property] = e.target.checked;
        state.planetarium.trigger('change');
    });
}

// Helper to set up slider listeners
function setupSlider(sliderId, displayId, property) {
    const slider = document.getElementById(sliderId);
    const display = document.getElementById(displayId);
    if (!slider || !display) return;

    slider.addEventListener('input', () => {
        if (!state.planetarium) return;
        display.textContent = slider.value;
        state.planetarium[property] = parseFloat(slider.value);
        state.planetarium.trigger('change');
    });
}

// Adjust time by minutes
function adjustTime(minutes) {
    if (!state.planetarium) return;

    // Disable live mode when manually adjusting time
    document.getElementById('opt-live').checked = false;
    state.planetarium.live = false;

    // Get current time from planetarium or use now
    const current = state.planetarium.clock instanceof Date
        ? state.planetarium.clock
        : new Date();

    const newTime = new Date(current.getTime() + minutes * 60000);

    // Set the new time
    state.planetarium.clock = newTime;
    state.currentTime = newTime;

    // Force redraw
    state.planetarium.trigger('change');

    // Update display immediately
    updateTimeDisplay();
}

// Geocode location from input
async function geocodeLocation() {
    const input = document.getElementById('location-input').value.trim();
    const info = document.getElementById('location-info');

    if (!input) return;

    // Check if it's coordinates (lat, lon)
    const coordMatch = input.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
    if (coordMatch) {
        state.latitude = parseFloat(coordMatch[1]);
        state.longitude = parseFloat(coordMatch[2]);
        state.displayName = `${state.latitude.toFixed(4)}, ${state.longitude.toFixed(4)}`;
        info.textContent = 'Coordinates set';
        info.classList.remove('error');
        updatePlanetariumLocation();
        return;
    }

    // Use Nominatim for geocoding
    info.textContent = 'Looking up location...';
    info.classList.remove('error');

    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(input)}&limit=1`
        );
        const data = await response.json();

        if (data && data.length > 0) {
            state.latitude = parseFloat(data[0].lat);
            state.longitude = parseFloat(data[0].lon);
            state.displayName = data[0].display_name.split(',').slice(0, 2).join(',');
            info.textContent = state.displayName;
            info.classList.remove('error');
            updatePlanetariumLocation();
        } else {
            info.textContent = 'Location not found';
            info.classList.add('error');
        }
    } catch (error) {
        info.textContent = 'Error looking up location';
        info.classList.add('error');
    }
}

// Use browser geolocation
function useCurrentLocation() {
    const info = document.getElementById('location-info');

    if (!navigator.geolocation) {
        info.textContent = 'Geolocation not supported';
        info.classList.add('error');
        return;
    }

    info.textContent = 'Getting your location...';
    info.classList.remove('error');

    navigator.geolocation.getCurrentPosition(
        (position) => {
            state.latitude = position.coords.latitude;
            state.longitude = position.coords.longitude;
            state.displayName = 'Current Location';

            document.getElementById('location-input').value =
                `${state.latitude.toFixed(4)}, ${state.longitude.toFixed(4)}`;
            info.textContent = 'Location acquired';
            info.classList.remove('error');

            updatePlanetariumLocation();

            // Try to reverse geocode for display name
            reverseGeocode();
        },
        (error) => {
            info.textContent = `Error: ${error.message}`;
            info.classList.add('error');
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

// Reverse geocode to get place name
async function reverseGeocode() {
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${state.latitude}&lon=${state.longitude}`
        );
        const data = await response.json();

        if (data && data.display_name) {
            state.displayName = data.display_name.split(',').slice(0, 2).join(',');
            document.getElementById('location-info').textContent = state.displayName;
            updateInfoPanel();
        }
    } catch (error) {
        // Silently fail - we already have coordinates
    }
}

// Update planetarium with new location
function updatePlanetariumLocation() {
    reinitPlanetarium();
    updateInfoPanel();
}

// Update planetarium direction (azimuth)
function updatePlanetariumDirection() {
    if (!state.planetarium) return;
    reinitPlanetarium();
}

// Update the info panel
function updateInfoPanel() {
    document.getElementById('info-location').textContent = state.displayName;
    document.getElementById('info-coords').textContent =
        `${state.latitude.toFixed(2)}°, ${state.longitude.toFixed(2)}°`;
    document.getElementById('info-direction').textContent =
        DIRECTION_NAMES[state.azimuth] || 'Custom';
}

// Update time display
function updateTimeDisplay() {
    let time;

    // Determine the time to display
    if (state.planetarium) {
        if (state.planetarium.live) {
            // In live mode, use current time
            time = new Date();
        } else if (state.planetarium.clock instanceof Date) {
            // In manual mode, use the planetarium's clock
            time = state.planetarium.clock;
        } else {
            time = new Date();
        }
    } else {
        time = new Date();
    }

    // Update both time displays
    const infoTime = document.getElementById('info-time');
    const currentTime = document.getElementById('current-time');

    if (infoTime) {
        infoTime.textContent = time.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    }

    if (currentTime) {
        currentTime.textContent = time.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    }
}

// Debounce helper
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// ============================================
// Telescope View (Aladin Lite) Functions
// ============================================

// Open telescope view modal at given RA/Dec
function openTelescopeView(ra, dec) {
    const modal = document.getElementById('telescope-modal');
    modal.classList.add('active');

    // Convert RA from degrees to hours for display
    const raHours = ra / 15;
    const raH = Math.floor(raHours);
    const raM = Math.floor((raHours - raH) * 60);
    const raS = ((raHours - raH) * 60 - raM) * 60;

    const decSign = dec >= 0 ? '+' : '';
    const decAbs = Math.abs(dec);
    const decD = Math.floor(decAbs);
    const decM = Math.floor((decAbs - decD) * 60);
    const decS = ((decAbs - decD) * 60 - decM) * 60;

    document.getElementById('coord-ra').textContent =
        `RA: ${raH}h ${raM}m ${raS.toFixed(1)}s`;
    document.getElementById('coord-dec').textContent =
        `Dec: ${decSign}${decD}° ${decM}' ${decS.toFixed(1)}"`;

    document.getElementById('telescope-title').textContent = 'Deep Sky View';

    // Start with wider view, then find nearest interesting object
    state.currentFov = 2.0;  // Start at 2 degrees - nice wide view
    initAladin(ra, dec);

    // Find and display the nearest interesting object
    findNearestObject(ra, dec);
}

// Initialize Aladin Lite viewer
function initAladin(ra, dec) {
    const container = document.getElementById('aladin-container');
    container.innerHTML = '';

    A.init.then(() => {
        state.aladin = A.aladin('#aladin-container', {
            target: `${ra} ${dec}`,
            fov: state.currentFov,
            survey: document.getElementById('survey-select').value,
            showReticle: true,
            showZoomControl: false,
            showFullscreenControl: false,
            showLayersControl: false,
            showGotoControl: false,
            showFrame: false,
            cooFrame: 'J2000'
        });

        // Add click handler for object identification
        state.aladin.on('objectClicked', function(object) {
            if (object) {
                showClickedObject(object);
            }
        });

        // Add click handler for empty space (coordinate display)
        // Delay binding to prevent firing on initialization
        setTimeout(() => {
            state.aladin.on('click', function(coords) {
                const clickInfo = document.getElementById('click-info');
                const ra = coords.ra.toFixed(4);
                const dec = coords.dec.toFixed(4);
                clickInfo.innerHTML = `Clicked: RA ${ra}°, Dec ${dec}° - searching...`;

                // Query SIMBAD for this exact position
                queryObjectAtPosition(coords.ra, coords.dec);
            });
        }, 500);

        // Load catalogs based on checkbox state
        loadCatalogs();

        updateFovDisplay();
    });
}

// Show info for clicked object
function showClickedObject(object) {
    const clickInfo = document.getElementById('click-info');
    clickInfo.classList.add('highlight');

    const name = object.data.name || object.data.Name || object.data.MAIN_ID || 'Unknown';
    const type = object.data.otype_longname || object.data.Type || object.data.OTYPE || '';
    const mag = object.data.Vmag || object.data.vmag || object.data.V || '';

    let info = `<strong>${name}</strong>`;
    if (type) info += ` - ${type}`;
    if (mag) info += ` (mag ${parseFloat(mag).toFixed(1)})`;

    clickInfo.innerHTML = info;

    // Fade highlight after 3 seconds
    setTimeout(() => {
        clickInfo.classList.remove('highlight');
    }, 3000);

    // Also show detailed info
    showDetailedObjectInfo(object.data);
}

// Query SIMBAD for object at specific position using backend API
async function queryObjectAtPosition(ra, dec) {
    const clickInfo = document.getElementById('click-info');

    try {
        // Use backend API to query SIMBAD (avoids CORS issues)
        const response = await fetch(
            `${API_URL}/api/simbad/region?ra=${ra}&dec=${dec}&radius=0.05&limit=1`
        );

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        if (data.objects && data.objects.length > 0) {
            const obj = data.objects[0];
            const name = obj.name || 'Unknown';
            const type = obj.type || '';
            const spType = obj.spectral_type ? `(${obj.spectral_type})` : '';
            const mag = obj.magnitude_v ? ` mag ${obj.magnitude_v.toFixed(1)}` : '';

            clickInfo.classList.add('highlight');
            clickInfo.innerHTML = `<strong>${name}</strong> ${type} ${spType}${mag}`;

            setTimeout(() => clickInfo.classList.remove('highlight'), 3000);
        } else {
            clickInfo.innerHTML = `No cataloged object at this position`;
        }
    } catch (e) {
        console.log('Position query error:', e);
        clickInfo.innerHTML = `RA ${ra.toFixed(4)}°, Dec ${dec.toFixed(4)}°`;
    }
}

// Show detailed object info in the info panel
function showDetailedObjectInfo(data) {
    const infoDiv = document.getElementById('object-info');
    let html = '<strong>Object Details:</strong><br>';

    for (const [key, value] of Object.entries(data)) {
        if (value && key !== 'x' && key !== 'y' && key !== '_cat') {
            html += `• ${key}: ${value}<br>`;
        }
    }

    infoDiv.innerHTML = html;
    infoDiv.classList.add('active');
}

// Load catalog overlays
function loadCatalogs() {
    if (!state.aladin) return;

    // Clear existing catalogs
    state.aladin.removeLayers();

    // Messier catalog
    if (document.getElementById('show-messier').checked) {
        A.catalogFromVizieR('VII/118/messier', state.aladin.getRaDec()[0] + ' ' + state.aladin.getRaDec()[1],
            10, {
                onClick: 'showTable',
                color: '#ff6b6b',
                sourceSize: 14,
                shape: 'circle',
                name: 'Messier'
            }, (cat) => {
                state.aladin.addCatalog(cat);
            }
        );
    }

    // NGC catalog
    if (document.getElementById('show-ngc').checked) {
        A.catalogFromVizieR('VII/1B/ngc', state.aladin.getRaDec()[0] + ' ' + state.aladin.getRaDec()[1],
            5, {
                onClick: 'showTable',
                color: '#00ff88',
                sourceSize: 10,
                shape: 'square',
                name: 'NGC'
            }, (cat) => {
                state.aladin.addCatalog(cat);
            }
        );
    }

    // Bright stars with names
    if (document.getElementById('show-stars').checked) {
        A.catalogFromVizieR('V/50/catalog', state.aladin.getRaDec()[0] + ' ' + state.aladin.getRaDec()[1],
            10, {
                onClick: 'showTable',
                color: '#ffdd44',
                sourceSize: 8,
                shape: 'plus',
                name: 'Bright Stars'
            }, (cat) => {
                state.aladin.addCatalog(cat);
            }
        );
    }
}

// Update FOV display
function updateFovDisplay() {
    const fovDisplay = document.getElementById('fov-display');
    if (state.currentFov >= 1) {
        fovDisplay.textContent = `FOV: ${state.currentFov.toFixed(1)}°`;
    } else {
        const arcmin = state.currentFov * 60;
        if (arcmin >= 1) {
            fovDisplay.textContent = `FOV: ${arcmin.toFixed(0)}'`;
        } else {
            const arcsec = arcmin * 60;
            fovDisplay.textContent = `FOV: ${arcsec.toFixed(0)}"`;
        }
    }
}

// Search for an object by name using backend API
async function searchObject(name) {
    if (!state.aladin || !name.trim()) return;

    const clickInfo = document.getElementById('click-info');
    const infoDiv = document.getElementById('object-info');
    clickInfo.innerHTML = `Searching for "${name}"...`;

    try {
        // Use backend API to resolve object name (avoids CORS issues)
        const response = await fetch(
            `${API_URL}/api/simbad/resolve?name=${encodeURIComponent(name)}`
        );

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.error) {
            clickInfo.innerHTML = `Object "${name}" not found`;
            return;
        }

        if (data.ra !== undefined && data.dec !== undefined) {
            state.aladin.gotoRaDec(data.ra, data.dec);

            // Adjust FOV based on object type - start wide so user can see context
            const objType = (data.type || '').toLowerCase();
            if (name.toLowerCase().startsWith('m') ||
                objType.includes('nebula') || objType.includes('galaxy') ||
                objType.includes('cluster') || objType.includes('hii')) {
                state.currentFov = 2.0; // Wide view for extended objects
            } else {
                state.currentFov = 0.5; // Closer for stars, but still contextual
            }
            state.aladin.setFov(state.currentFov);
            updateFovDisplay();

            clickInfo.classList.add('highlight');
            clickInfo.innerHTML = `<strong>${data.name || name}</strong> found!`;
            setTimeout(() => clickInfo.classList.remove('highlight'), 2000);

            // Display object details if we have them
            if (data.name) {
                displayObjectDetails(data, [data]);
            }

            // Reload catalogs for new position
            setTimeout(loadCatalogs, 500);
        } else {
            clickInfo.innerHTML = `Object "${name}" not found`;
        }
    } catch (e) {
        console.log('Search error:', e);
        clickInfo.innerHTML = `Error searching for "${name}". Make sure the backend is running.`;
    }
}

// Find the nearest interesting object and show detailed info
async function findNearestObject(ra, dec) {
    const clickInfo = document.getElementById('click-info');
    const infoDiv = document.getElementById('object-info');

    clickInfo.innerHTML = 'Scanning region for interesting objects...';
    infoDiv.classList.remove('active');

    try {
        // Use our backend to query SIMBAD (avoids CORS issues)
        const response = await fetch(
            `${API_URL}/api/simbad/region?ra=${ra}&dec=${dec}&radius=1.0&limit=15`
        );

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        if (data.objects && data.objects.length > 0) {
            displayObjectDetails(data.objects[0], data.objects);
        } else {
            clickInfo.innerHTML = `Region scanned - no bright objects cataloged here`;
            infoDiv.innerHTML = `<div class="empty-region">
                <p>This appears to be a relatively empty region of sky.</p>
                <p>Try right-clicking on a brighter star or search for a known object like M31!</p>
            </div>`;
            infoDiv.classList.add('active');
        }
    } catch (error) {
        console.log('SIMBAD query failed:', error);
        clickInfo.innerHTML = 'Click any object for details';
        infoDiv.innerHTML = `<div class="empty-region">
            <p>Could not query astronomical database.</p>
            <p>Make sure the backend server is running (python server.py)</p>
            <p>Try searching for an object by name above!</p>
        </div>`;
        infoDiv.classList.add('active');
    }
}

// Display detailed object information
function displayObjectDetails(obj, allObjects) {
    const clickInfo = document.getElementById('click-info');
    const infoDiv = document.getElementById('object-info');
    const titleEl = document.getElementById('telescope-title');

    const name = obj.name || 'Unknown Object';
    const ra = obj.ra;
    const dec = obj.dec;
    const objType = obj.type || 'Celestial Object';
    const spectralType = obj.spectral_type;
    const parallax = obj.parallax_mas;
    const radialVel = obj.radial_velocity_kms;
    const angularSize = obj.angular_size_arcmin;
    const distanceLY = obj.distance_ly;
    const magnitudes = obj.magnitudes || {};
    const primaryMag = obj.magnitude_v || magnitudes.V || magnitudes.B || magnitudes.R;

    // Update title with object name
    titleEl.textContent = name;

    // Highlight the click info
    clickInfo.classList.add('highlight');
    clickInfo.innerHTML = `<strong>${name}</strong> — ${objType}`;
    setTimeout(() => clickInfo.classList.remove('highlight'), 3000);

    // Build detailed info HTML
    let html = `<div class="object-details">`;

    // Main info card
    html += `<div class="detail-card main-card">
        <div class="object-name">${name}</div>
        <div class="object-type">${objType}</div>
    </div>`;

    // Stats grid
    html += `<div class="stats-grid">`;

    // Magnitude - show primary and list all available bands
    if (primaryMag !== null && primaryMag !== undefined) {
        const magBands = Object.entries(magnitudes)
            .filter(([k, v]) => v !== null)
            .map(([k, v]) => `${k}=${v.toFixed(1)}`)
            .join(', ');
        html += `<div class="stat-item">
            <span class="stat-label">Magnitude</span>
            <span class="stat-value">${primaryMag.toFixed(2)}</span>
            <span class="stat-desc">${getMagnitudeDescription(primaryMag)}</span>
            ${magBands ? `<span class="stat-extra">${magBands}</span>` : ''}
        </div>`;
    }

    if (spectralType) {
        html += `<div class="stat-item">
            <span class="stat-label">Spectral Type</span>
            <span class="stat-value">${spectralType}</span>
            <span class="stat-desc">${getSpectralDescription(spectralType)}</span>
        </div>`;
    }

    if (distanceLY) {
        html += `<div class="stat-item">
            <span class="stat-label">Distance</span>
            <span class="stat-value">${formatDistance(distanceLY)}</span>
            <span class="stat-desc">${distanceLY > 1000 ? 'Very distant' : distanceLY > 100 ? 'Distant' : 'Relatively nearby'}</span>
        </div>`;
    } else if (parallax && parallax > 0) {
        const calcDistance = 3261.5 / parallax;
        html += `<div class="stat-item">
            <span class="stat-label">Distance</span>
            <span class="stat-value">${formatDistance(calcDistance)}</span>
            <span class="stat-desc">${calcDistance > 1000 ? 'Very distant' : calcDistance > 100 ? 'Distant' : 'Relatively nearby'}</span>
        </div>`;
    }

    if (radialVel !== null && radialVel !== undefined) {
        const direction = radialVel > 0 ? 'receding from us' : 'approaching us';
        const arrow = radialVel > 0 ? '→' : '←';
        html += `<div class="stat-item">
            <span class="stat-label">Radial Velocity</span>
            <span class="stat-value">${Math.abs(radialVel).toFixed(1)} km/s</span>
            <span class="stat-desc">${arrow} ${direction}</span>
        </div>`;
    }

    if (angularSize && angularSize > 0) {
        html += `<div class="stat-item">
            <span class="stat-label">Angular Size</span>
            <span class="stat-value">${angularSize.toFixed(1)}'</span>
            <span class="stat-desc">${angularSize > 30 ? 'Large extended object' : angularSize > 5 ? 'Medium size' : 'Compact object'}</span>
        </div>`;
    }

    html += `</div>`; // end stats-grid

    // Coordinates
    if (ra !== undefined && dec !== undefined) {
        const raHours = ra / 15;
        const raH = Math.floor(raHours);
        const raM = Math.floor((raHours - raH) * 60);
        const raS = ((raHours - raH) * 60 - raM) * 60;
        html += `<div class="coord-info">
            <span>RA: ${raH}h ${raM}m ${raS.toFixed(1)}s</span>
            <span>Dec: ${dec > 0 ? '+' : ''}${dec.toFixed(4)}°</span>
        </div>`;
    }

    // Other objects in field - now using proper object properties
    if (allObjects && allObjects.length > 1) {
        html += `<div class="nearby-objects">
            <div class="nearby-title">Also in this region:</div>`;
        allObjects.slice(1, 6).forEach(other => {
            const otherName = other.name;
            const otherType = other.type || '';
            const otherMag = other.magnitude_v;
            html += `<div class="nearby-item">
                <span class="nearby-name">${otherName}</span>
                <span class="nearby-type">${otherType}${otherMag ? ` (mag ${otherMag.toFixed(1)})` : ''}</span>
            </div>`;
        });
        html += `</div>`;
    }

    // Fun fact based on object type
    const funFact = getFunFact(objType, name);
    if (funFact) {
        html += `<div class="fun-fact">${funFact}</div>`;
    }

    html += `</div>`; // end object-details

    infoDiv.innerHTML = html;
    infoDiv.classList.add('active');
}

// Helper functions for display
function getMagnitudeDescription(mag) {
    if (mag < 0) return 'Extremely bright';
    if (mag < 1) return 'Very bright star';
    if (mag < 2) return 'Bright, easy to see';
    if (mag < 4) return 'Visible to naked eye';
    if (mag < 6) return 'Faint, dark sky needed';
    if (mag < 10) return 'Binoculars needed';
    return 'Telescope required';
}

function getSpectralDescription(sp) {
    if (!sp) return '';
    const type = sp.charAt(0).toUpperCase();
    const descriptions = {
        'O': 'Blue supergiant, extremely hot',
        'B': 'Blue-white, very hot',
        'A': 'White star',
        'F': 'Yellow-white star',
        'G': 'Yellow star (like our Sun)',
        'K': 'Orange star',
        'M': 'Red dwarf or giant',
        'L': 'Brown dwarf',
        'T': 'Cool brown dwarf',
        'W': 'Wolf-Rayet star'
    };
    return descriptions[type] || '';
}

function formatDistance(ly) {
    if (ly < 100) return `${ly.toFixed(1)} light years`;
    if (ly < 1000) return `${ly.toFixed(0)} light years`;
    if (ly < 1000000) return `${(ly/1000).toFixed(1)}k light years`;
    return `${(ly/1000000).toFixed(1)}M light years`;
}

function getFunFact(objType, name) {
    const type = objType.toLowerCase();

    if (type.includes('galaxy')) {
        return `Galaxies contain billions of stars. The light you're seeing may have traveled millions of years to reach us.`;
    }
    if (type.includes('nebula')) {
        return `Nebulae are stellar nurseries where new stars are born from clouds of gas and dust.`;
    }
    if (type.includes('cluster')) {
        return `Star clusters are groups of stars born from the same molecular cloud, traveling together through space.`;
    }
    if (type.includes('supernova')) {
        return `Supernovae are the explosive deaths of massive stars, briefly outshining entire galaxies.`;
    }
    if (type.includes('pulsar')) {
        return `Pulsars are rapidly spinning neutron stars that emit beams of radiation like cosmic lighthouses.`;
    }
    if (type.includes('variable')) {
        return `Variable stars change brightness over time, some used as "standard candles" to measure cosmic distances.`;
    }
    if (type.includes('double') || type.includes('binary')) {
        return `Binary stars orbit a common center of mass. About half of all stars are in binary systems.`;
    }
    if (name.toLowerCase().includes('polaris')) {
        return `Polaris, the North Star, is actually a triple star system about 433 light years away.`;
    }
    if (name.toLowerCase().includes('sirius')) {
        return `Sirius is the brightest star in Earth's night sky, just 8.6 light years away with a white dwarf companion.`;
    }
    if (name.toLowerCase().includes('betelgeuse')) {
        return `Betelgeuse is a red supergiant that could explode as a supernova anytime in the next 100,000 years.`;
    }

    return null;
}

// Set up telescope modal controls
function setupTelescopeControls() {
    // Close button
    document.getElementById('modal-close').addEventListener('click', () => {
        document.getElementById('telescope-modal').classList.remove('active');
    });

    // Click outside to close
    document.getElementById('telescope-modal').addEventListener('click', (e) => {
        if (e.target.id === 'telescope-modal') {
            document.getElementById('telescope-modal').classList.remove('active');
        }
    });

    // Escape key to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.getElementById('telescope-modal').classList.remove('active');
        }
    });

    // Survey selector
    document.getElementById('survey-select').addEventListener('change', (e) => {
        if (state.aladin) {
            state.aladin.setImageSurvey(e.target.value);
        }
    });

    // Zoom buttons
    document.getElementById('zoom-in').addEventListener('click', () => {
        if (state.aladin) {
            state.currentFov = Math.max(0.001, state.currentFov / 2);
            state.aladin.setFov(state.currentFov);
            updateFovDisplay();
        }
    });

    document.getElementById('zoom-out').addEventListener('click', () => {
        if (state.aladin) {
            state.currentFov = Math.min(60, state.currentFov * 2);
            state.aladin.setFov(state.currentFov);
            updateFovDisplay();
        }
    });

    // Object search
    document.getElementById('search-btn').addEventListener('click', () => {
        const name = document.getElementById('object-search').value;
        searchObject(name);
    });

    document.getElementById('object-search').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            searchObject(e.target.value);
        }
    });

    // Catalog toggles
    document.getElementById('show-messier').addEventListener('change', loadCatalogs);
    document.getElementById('show-ngc').addEventListener('change', loadCatalogs);
    document.getElementById('show-stars').addEventListener('change', loadCatalogs);

    // Fullscreen button
    document.getElementById('fullscreen-btn').addEventListener('click', toggleFullscreen);
}

// Toggle fullscreen mode for telescope view
function toggleFullscreen() {
    const modalContent = document.querySelector('.modal-content');
    const modal = document.getElementById('telescope-modal');

    if (modalContent.classList.contains('fullscreen')) {
        // Exit fullscreen
        modalContent.classList.remove('fullscreen');
        if (document.exitFullscreen) {
            document.exitFullscreen().catch(() => {});
        }
    } else {
        // Enter fullscreen
        modalContent.classList.add('fullscreen');
        if (modal.requestFullscreen) {
            modal.requestFullscreen().catch(() => {});
        }
    }

    // Resize Aladin after transition
    setTimeout(() => {
        if (state.aladin) {
            state.aladin.setSize(
                document.getElementById('aladin-container').offsetWidth,
                document.getElementById('aladin-container').offsetHeight
            );
        }
    }, 100);
}

// Handle fullscreen change from browser
document.addEventListener('fullscreenchange', () => {
    const modalContent = document.querySelector('.modal-content');
    if (!document.fullscreenElement && modalContent) {
        modalContent.classList.remove('fullscreen');
        setTimeout(() => {
            if (state.aladin) {
                state.aladin.setSize(
                    document.getElementById('aladin-container').offsetWidth,
                    document.getElementById('aladin-container').offsetHeight
                );
            }
        }, 100);
    }
});

// Initialize everything when DOM is ready
S(document).ready(function() {
    initPlanetarium();
    setupEventListeners();
    setupTelescopeControls();
    updateInfoPanel();
    updateTimeDisplay();

    // Update time display every second
    setInterval(updateTimeDisplay, 1000);
});
