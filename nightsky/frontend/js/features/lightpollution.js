/**
 * Light Pollution / Bortle Scale Feature
 * Shows Bortle class for user's location with colored indicator.
 * Optionally adjusts VirtualSky magnitude limit to simulate realistic visibility.
 */
(function() {
    const BACKEND_URL = 'http://localhost:5051';

    // Bortle scale data (matches astronomy.js)
    const BORTLE = [
        null, // index 0 unused
        { name: 'Excellent Dark', mag: 7.6, sqm: 21.99, color: '#000000', textColor: '#ffffff' },
        { name: 'Typical Dark', mag: 7.1, sqm: 21.89, color: '#111122', textColor: '#ffffff' },
        { name: 'Rural Sky', mag: 6.6, sqm: 21.69, color: '#1a1a3a', textColor: '#ffffff' },
        { name: 'Rural/Suburban', mag: 6.2, sqm: 21.25, color: '#2a2a4a', textColor: '#ffffff' },
        { name: 'Suburban', mag: 5.6, sqm: 20.49, color: '#3a3a5a', textColor: '#ffffff' },
        { name: 'Bright Suburban', mag: 5.1, sqm: 19.50, color: '#555577', textColor: '#ffffff' },
        { name: 'Suburban/Urban', mag: 4.6, sqm: 18.94, color: '#887744', textColor: '#000000' },
        { name: 'City Sky', mag: 4.0, sqm: 18.38, color: '#aa8855', textColor: '#000000' },
        { name: 'Inner City', mag: 3.5, sqm: 17.80, color: '#cc9966', textColor: '#000000' }
    ];

    let currentBortle = 5;
    let simulateEnabled = false;
    let originalMagnitude = null;

    function init() {
        const panel = document.getElementById('bortle-panel');
        if (!panel) return;

        fetchBortle();

        // Simulate toggle
        const toggle = document.getElementById('bortle-simulate');
        if (toggle) {
            toggle.addEventListener('change', (e) => {
                simulateEnabled = e.target.checked;
                applySimulation();
            });
        }
    }

    function fetchBortle() {
        const ns = window.NightSky;
        if (!ns) return;

        const indicator = document.getElementById('bortle-indicator');
        const label = document.getElementById('bortle-label');
        const detail = document.getElementById('bortle-detail');
        const magLimit = document.getElementById('bortle-maglimit');

        // Try backend first
        fetch(`${BACKEND_URL}/api/lightpollution?lat=${ns.state.latitude}&lon=${ns.state.longitude}`)
            .then(r => r.json())
            .then(data => {
                if (data.bortle_class) {
                    currentBortle = data.bortle_class;
                }
                updateDisplay();
            })
            .catch(() => {
                // Fallback: simple heuristic based on coordinates
                currentBortle = estimateBortleFallback(ns.state.latitude, ns.state.longitude);
                updateDisplay();
            });
    }

    function estimateBortleFallback(lat, lon) {
        // Very rough fallback: assume suburban
        const absLat = Math.abs(lat);
        if (absLat > 65) return 2;
        if (absLat > 55) return 3;
        return 5;
    }

    function updateDisplay() {
        const b = BORTLE[currentBortle];
        if (!b) return;

        const indicator = document.getElementById('bortle-indicator');
        const label = document.getElementById('bortle-label');
        const detail = document.getElementById('bortle-detail');
        const magLimit = document.getElementById('bortle-maglimit');

        if (indicator) {
            indicator.style.background = b.color;
            indicator.style.color = b.textColor;
            indicator.textContent = currentBortle;
        }
        if (label) label.textContent = b.name;
        if (detail) detail.textContent = `Naked-eye limit: mag ${b.mag} | SQM: ${b.sqm}`;
        if (magLimit) magLimit.textContent = b.mag.toFixed(1);

        applySimulation();
    }

    function applySimulation() {
        const ns = window.NightSky;
        if (!ns || !ns.state.planetarium) return;

        const magSlider = document.getElementById('magnitude');
        const magDisplay = document.getElementById('mag-value');

        if (simulateEnabled) {
            const b = BORTLE[currentBortle];
            if (!b) return;

            if (originalMagnitude === null) {
                originalMagnitude = ns.state.planetarium.magnitude;
            }
            ns.state.planetarium.magnitude = b.mag;
            if (magSlider) magSlider.value = b.mag;
            if (magDisplay) magDisplay.textContent = b.mag;
            ns.state.planetarium.trigger('change');
        } else if (originalMagnitude !== null) {
            ns.state.planetarium.magnitude = originalMagnitude;
            if (magSlider) magSlider.value = originalMagnitude;
            if (magDisplay) magDisplay.textContent = originalMagnitude;
            ns.state.planetarium.trigger('change');
            originalMagnitude = null;
        }
    }

    function onLocationChange() {
        fetchBortle();
    }

    // Register with FeatureRegistry
    if (window.NightSky && window.NightSky.features) {
        window.NightSky.features.register('lightpollution', {
            init: init,
            onLocationChange: onLocationChange
        });
    }
})();
