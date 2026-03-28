/**
 * Astrophotography Planning Mode
 * Shows camera sensor FOV rectangle on sky overlay.
 * Includes twilight timeline with optimal dark windows.
 */
(function() {
    let enabled = false;
    let sensorWidth = 36; // Full frame default (mm)
    let sensorHeight = 24;
    let focalLength = 50; // mm

    const SENSORS = {
        'fullframe': { name: 'Full Frame (36x24mm)', w: 36, h: 24 },
        'apsc': { name: 'APS-C (23.5x15.6mm)', w: 23.5, h: 15.6 },
        'm43': { name: 'Micro 4/3 (17.3x13mm)', w: 17.3, h: 13 }
    };

    function init() {
        const panel = document.getElementById('astrophoto-panel');
        if (!panel) return;

        const toggle = document.getElementById('astrophoto-toggle');
        if (toggle) {
            toggle.addEventListener('change', (e) => {
                enabled = e.target.checked;
                if (!enabled) clearOverlay();
                else drawFOV();
            });
        }

        const sensorSelect = document.getElementById('astrophoto-sensor');
        if (sensorSelect) {
            sensorSelect.addEventListener('change', (e) => {
                const sensor = SENSORS[e.target.value];
                if (sensor) {
                    sensorWidth = sensor.w;
                    sensorHeight = sensor.h;
                    updateFOVDisplay();
                    if (enabled) drawFOV();
                }
            });
        }

        const focalSlider = document.getElementById('astrophoto-focal');
        if (focalSlider) {
            focalSlider.addEventListener('input', (e) => {
                focalLength = parseInt(e.target.value);
                document.getElementById('astrophoto-focal-value').textContent = focalLength;
                updateFOVDisplay();
                if (enabled) drawFOV();
            });
        }

        updateFOVDisplay();
        updateTwilightTimeline();
    }

    function updateFOVDisplay() {
        const fovW = 2 * Math.atan(sensorWidth / (2 * focalLength)) * 180 / Math.PI;
        const fovH = 2 * Math.atan(sensorHeight / (2 * focalLength)) * 180 / Math.PI;

        const display = document.getElementById('astrophoto-fov-display');
        if (display) {
            display.textContent = `${fovW.toFixed(1)}° x ${fovH.toFixed(1)}°`;
        }

        // 500 rule for max exposure
        const maxExposure = 500 / focalLength;
        const ruleDisplay = document.getElementById('astrophoto-rule500');
        if (ruleDisplay) {
            ruleDisplay.textContent = `Max exposure (500 rule): ${maxExposure.toFixed(1)}s`;
        }
    }

    function drawFOV() {
        if (!enabled) return;

        const ns = window.NightSky;
        if (!ns || !ns.state.planetarium) return;

        const overlay = document.getElementById('sky-overlay');
        if (!overlay) return;

        const ctx = overlay.getContext('2d');
        const p = ns.state.planetarium;

        // Get center of view (RA/Dec)
        // Use the planetarium's current center
        const centerRA = p.ra_off || 0; // in radians
        const centerDec = p.dc_off || 0; // in radians

        // Compute FOV in degrees
        const fovW = 2 * Math.atan(sensorWidth / (2 * focalLength)) * 180 / Math.PI;
        const fovH = 2 * Math.atan(sensorHeight / (2 * focalLength)) * 180 / Math.PI;

        // Convert FOV corners to pixel coordinates
        const halfW = (fovW / 2) * Math.PI / 180;
        const halfH = (fovH / 2) * Math.PI / 180;

        const corners = [
            { ra: centerRA - halfW, dec: centerDec + halfH },
            { ra: centerRA + halfW, dec: centerDec + halfH },
            { ra: centerRA + halfW, dec: centerDec - halfH },
            { ra: centerRA - halfW, dec: centerDec - halfH }
        ];

        ctx.save();
        ctx.strokeStyle = '#ff6b6b';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 4]);

        ctx.beginPath();
        let validCorners = 0;
        corners.forEach((corner, i) => {
            const xy = p.radec2xy(corner.ra, corner.dec);
            if (xy && isFinite(xy.x) && isFinite(xy.y)) {
                if (validCorners === 0) {
                    ctx.moveTo(xy.x, xy.y);
                } else {
                    ctx.lineTo(xy.x, xy.y);
                }
                validCorners++;
            }
        });
        if (validCorners >= 3) {
            ctx.closePath();
            ctx.stroke();

            // Fill with translucent overlay
            ctx.fillStyle = 'rgba(255, 107, 107, 0.05)';
            ctx.fill();

            // Label
            const topCenter = p.radec2xy(centerRA, centerDec + halfH);
            if (topCenter && isFinite(topCenter.x)) {
                ctx.fillStyle = '#ff6b6b';
                ctx.font = '10px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(`${fovW.toFixed(1)}° x ${fovH.toFixed(1)}°`, topCenter.x, topCenter.y - 8);
            }
        }

        ctx.restore();
        ctx.setLineDash([]);
    }

    function updateTwilightTimeline() {
        const ns = window.NightSky;
        if (!ns || typeof Astronomy === 'undefined') return;

        const timeline = document.getElementById('astrophoto-timeline');
        if (!timeline) return;

        try {
            const twilight = Astronomy.calculateTwilightTimes(ns.state.latitude, ns.state.longitude, new Date());

            let html = '<div class="twilight-timeline">';

            // Build timeline bar
            if (twilight.sunset && twilight.sunrise) {
                const sunsetH = twilight.sunset.getHours() + twilight.sunset.getMinutes() / 60;
                const sunriseH = twilight.sunrise.getHours() + twilight.sunrise.getMinutes() / 60 + 24;
                const totalH = sunriseH - sunsetH;

                // Civil twilight
                const civilDuskH = twilight.civilDusk
                    ? twilight.civilDusk.getHours() + twilight.civilDusk.getMinutes() / 60
                    : sunsetH + 0.5;
                const nautDuskH = twilight.nauticalDusk
                    ? twilight.nauticalDusk.getHours() + twilight.nauticalDusk.getMinutes() / 60
                    : sunsetH + 1;
                const astroDuskH = twilight.astronomicalDusk
                    ? twilight.astronomicalDusk.getHours() + twilight.astronomicalDusk.getMinutes() / 60
                    : sunsetH + 1.5;
                const astroDawnH = twilight.astronomicalDawn
                    ? twilight.astronomicalDawn.getHours() + twilight.astronomicalDawn.getMinutes() / 60 + 24
                    : sunriseH - 1.5;

                html += `<div class="tl-bar">`;
                // Sunset to civil dusk
                html += `<div class="tl-segment tl-civil" style="flex:${(civilDuskH - sunsetH) / totalH}" title="Civil twilight"></div>`;
                // Civil to nautical
                html += `<div class="tl-segment tl-nautical" style="flex:${(nautDuskH - civilDuskH) / totalH}" title="Nautical twilight"></div>`;
                // Nautical to astronomical
                html += `<div class="tl-segment tl-astro" style="flex:${(astroDuskH - nautDuskH) / totalH}" title="Astronomical twilight"></div>`;
                // True darkness
                html += `<div class="tl-segment tl-dark" style="flex:${(astroDawnH - astroDuskH) / totalH}" title="True darkness - best imaging"></div>`;
                // Dawn twilight
                html += `<div class="tl-segment tl-astro" style="flex:${(sunriseH - astroDawnH) / totalH}" title="Astronomical dawn"></div>`;
                html += `</div>`;

                // Labels
                html += `<div class="tl-labels">`;
                html += `<span>Sunset ${formatTime(twilight.sunset)}</span>`;
                html += `<span>Dark ${twilight.astronomicalDusk ? formatTime(twilight.astronomicalDusk) : '--'}</span>`;
                html += `<span>Dawn ${twilight.astronomicalDawn ? formatTime(twilight.astronomicalDawn) : '--'}</span>`;
                html += `<span>Sunrise ${formatTime(twilight.sunrise)}</span>`;
                html += `</div>`;
            }

            html += '</div>';
            timeline.innerHTML = html;
        } catch(e) {}
    }

    function formatTime(date) {
        if (!(date instanceof Date)) return '--';
        return date.toLocaleTimeString('en-US', {
            hour: 'numeric', minute: '2-digit', hour12: true
        });
    }

    function clearOverlay() {
        // Shared overlay - stop drawing
    }

    function onLocationChange() {
        updateTwilightTimeline();
    }

    if (window.NightSky && window.NightSky.features) {
        window.NightSky.features.register('astrophoto', {
            init: init,
            onLocationChange: onLocationChange
        });
    }
})();
