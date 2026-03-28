/**
 * ISS & Satellite Tracker Feature
 * Animated ISS marker on sky map with orbital path and next-pass predictions.
 * Uses satellite.js (SGP4) for propagation, CelesTrak TLE via backend proxy.
 */
(function() {
    const BACKEND_URL = 'http://localhost:5051';
    const ISS_NORAD_ID = 25544;

    let issRecord = null;
    let updateInterval = null;
    let drawEnabled = false;
    let showPath = true;
    let passes = [];

    function init() {
        const panel = document.getElementById('satellite-panel');
        if (!panel) return;

        const toggle = document.getElementById('sat-toggle-iss');
        if (toggle) {
            toggle.addEventListener('change', (e) => {
                drawEnabled = e.target.checked;
                if (drawEnabled && !issRecord) {
                    fetchTLE();
                }
                if (!drawEnabled) {
                    clearOverlay();
                }
            });
        }

        const pathToggle = document.getElementById('sat-toggle-path');
        if (pathToggle) {
            pathToggle.addEventListener('change', (e) => {
                showPath = e.target.checked;
            });
        }
    }

    function fetchTLE() {
        const statusEl = document.getElementById('sat-status');
        if (statusEl) statusEl.textContent = 'Fetching TLE data...';

        fetch(`${BACKEND_URL}/api/satellites/tle?norad_id=${ISS_NORAD_ID}`)
            .then(r => r.json())
            .then(data => {
                if (data.error) {
                    if (statusEl) statusEl.textContent = 'Backend offline';
                    return;
                }

                if (data.satellites && data.satellites.length > 0) {
                    const sat = data.satellites[0];
                    try {
                        // Use satellite.js to create a satellite record
                        const satrec = satellite.twoline2satrec(sat.tle1, sat.tle2);
                        issRecord = satrec;
                        if (statusEl) statusEl.textContent = 'ISS tracking active';

                        // Start update loop
                        startTracking();
                        // Compute passes
                        computePasses();
                    } catch(e) {
                        if (statusEl) statusEl.textContent = 'TLE parse error';
                        console.error('satellite.js parse error:', e);
                    }
                } else {
                    if (statusEl) statusEl.textContent = 'No TLE data returned';
                }
            })
            .catch(err => {
                if (statusEl) statusEl.textContent = 'Backend offline - start server';
                console.log('TLE fetch error:', err);
            });
    }

    function startTracking() {
        if (updateInterval) clearInterval(updateInterval);
        updateInterval = setInterval(updatePosition, 1000);
        updatePosition();
    }

    function updatePosition() {
        if (!issRecord || !drawEnabled) return;

        const ns = window.NightSky;
        if (!ns || !ns.state.planetarium) return;

        const now = ns.state.planetarium.clock instanceof Date
            ? ns.state.planetarium.clock : new Date();

        try {
            const positionAndVelocity = satellite.propagate(issRecord, now);
            const gmst = satellite.gstime(now);

            if (!positionAndVelocity.position) return;

            const positionGd = satellite.eciToGeodetic(positionAndVelocity.position, gmst);
            const lat = satellite.degreesLat(positionGd.latitude);
            const lon = satellite.degreesLong(positionGd.longitude);
            const altKm = positionGd.height;

            // Convert to RA/Dec for sky overlay
            const observerLat = ns.state.latitude;
            const observerLon = ns.state.longitude;

            // Compute look angles
            const observerGd = {
                longitude: satellite.degreesToRadians(observerLon),
                latitude: satellite.degreesToRadians(observerLat),
                height: 0
            };
            const positionEcf = satellite.eciToEcf(positionAndVelocity.position, gmst);
            const lookAngles = satellite.ecfToLookAngles(observerGd, positionEcf);

            const azDeg = satellite.radiansToDegrees(lookAngles.azimuth);
            const elDeg = satellite.radiansToDegrees(lookAngles.elevation);
            const rangeSat = lookAngles.rangeSat;

            // Update info display
            const infoEl = document.getElementById('sat-info');
            if (infoEl) {
                const aboveHorizon = elDeg > 0;
                infoEl.innerHTML = `
                    <div class="sat-position">
                        <span>Alt: ${elDeg.toFixed(1)}° | Az: ${azDeg.toFixed(1)}°</span>
                        <span>Height: ${altKm.toFixed(0)} km</span>
                    </div>
                    <div class="sat-visibility ${aboveHorizon ? 'visible' : ''}">
                        ${aboveHorizon ? 'ABOVE HORIZON' : 'Below horizon'}
                    </div>`;
            }

            // Draw on overlay canvas
            drawOnOverlay(azDeg, elDeg, now);

        } catch(e) {
            // Propagation can fail near TLE epoch boundaries
        }
    }

    function drawOnOverlay(az, el, now) {
        const ns = window.NightSky;
        if (!ns || !ns.state.planetarium) return;

        const overlay = document.getElementById('sky-overlay');
        if (!overlay) return;

        const ctx = overlay.getContext('2d');
        const p = ns.state.planetarium;

        // Only draw if ISS is above horizon for horizon-based projections
        const projection = document.getElementById('projection-select')?.value || 'stereo';
        const isHorizonProj = ['stereo', 'fisheye', 'ortho'].includes(projection);

        // Clear our layer (we'll coordinate with other features via requestAnimationFrame)
        // For now, just draw ISS marker

        // Convert Az/El to pixel coordinates using VirtualSky's coordinate system
        // VirtualSky uses RA/Dec internally, so we need to convert
        if (typeof Astronomy !== 'undefined') {
            const jd = Astronomy.dateToJulian(now);
            const lst = Astronomy.lst(jd, ns.state.longitude);
            const raDec = Astronomy.altAzToRaDec(el, az, ns.state.latitude, lst);

            // Use VirtualSky's radec2xy (RA in radians, Dec in radians)
            const raRad = raDec.ra * Math.PI / 180;
            const decRad = raDec.dec * Math.PI / 180;
            const xy = p.radec2xy(raRad, decRad);

            if (xy && xy.x !== undefined && isFinite(xy.x) && isFinite(xy.y)) {
                // Draw ISS marker
                ctx.save();

                // ISS dot
                ctx.beginPath();
                ctx.arc(xy.x, xy.y, 6, 0, 2 * Math.PI);
                ctx.fillStyle = el > 0 ? '#ff6b6b' : 'rgba(255, 107, 107, 0.3)';
                ctx.fill();

                // Glow
                if (el > 0) {
                    ctx.beginPath();
                    ctx.arc(xy.x, xy.y, 12, 0, 2 * Math.PI);
                    ctx.fillStyle = 'rgba(255, 107, 107, 0.2)';
                    ctx.fill();
                }

                // Label
                ctx.fillStyle = '#ff6b6b';
                ctx.font = '11px sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText('ISS', xy.x + 10, xy.y + 4);

                // Orbital path (show ±30 min arc)
                if (showPath && issRecord) {
                    drawOrbitalPath(ctx, p, now, ns.state.latitude, ns.state.longitude);
                }

                ctx.restore();
            }
        }
    }

    function drawOrbitalPath(ctx, planetarium, centerTime, obsLat, obsLon) {
        if (!issRecord) return;

        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 107, 107, 0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);

        let started = false;
        // Draw path for ±30 minutes in 1-minute steps
        for (let m = -30; m <= 30; m += 1) {
            const t = new Date(centerTime.getTime() + m * 60000);
            try {
                const pv = satellite.propagate(issRecord, t);
                const gmst = satellite.gstime(t);
                if (!pv.position) continue;

                const observerGd = {
                    longitude: satellite.degreesToRadians(obsLon),
                    latitude: satellite.degreesToRadians(obsLat),
                    height: 0
                };
                const posEcf = satellite.eciToEcf(pv.position, gmst);
                const la = satellite.ecfToLookAngles(observerGd, posEcf);
                const az = satellite.radiansToDegrees(la.azimuth);
                const el = satellite.radiansToDegrees(la.elevation);

                if (el < -5) continue; // Skip well below horizon

                const jd = Astronomy.dateToJulian(t);
                const lst = Astronomy.lst(jd, obsLon);
                const raDec = Astronomy.altAzToRaDec(el, az, obsLat, lst);
                const raRad = raDec.ra * Math.PI / 180;
                const decRad = raDec.dec * Math.PI / 180;
                const xy = planetarium.radec2xy(raRad, decRad);

                if (xy && isFinite(xy.x) && isFinite(xy.y)) {
                    if (!started) {
                        ctx.moveTo(xy.x, xy.y);
                        started = true;
                    } else {
                        ctx.lineTo(xy.x, xy.y);
                    }
                }
            } catch(e) {}
        }
        ctx.stroke();
        ctx.setLineDash([]);
    }

    function computePasses() {
        if (!issRecord) return;
        const ns = window.NightSky;
        if (!ns) return;

        // Simple pass finder: step through next 24 hours in 1-minute increments
        // Find when ISS rises above 10° elevation
        passes = [];
        const now = new Date();
        const observerGd = {
            longitude: satellite.degreesToRadians(ns.state.longitude),
            latitude: satellite.degreesToRadians(ns.state.latitude),
            height: 0
        };

        let inPass = false;
        let passStart = null;
        let maxEl = 0;
        let maxElTime = null;

        for (let m = 0; m < 24 * 60 && passes.length < 3; m++) {
            const t = new Date(now.getTime() + m * 60000);
            try {
                const pv = satellite.propagate(issRecord, t);
                const gmst = satellite.gstime(t);
                if (!pv.position) continue;

                const posEcf = satellite.eciToEcf(pv.position, gmst);
                const la = satellite.ecfToLookAngles(observerGd, posEcf);
                const el = satellite.radiansToDegrees(la.elevation);

                if (el > 10 && !inPass) {
                    inPass = true;
                    passStart = t;
                    maxEl = el;
                    maxElTime = t;
                } else if (el > maxEl && inPass) {
                    maxEl = el;
                    maxElTime = t;
                } else if (el < 5 && inPass) {
                    inPass = false;
                    passes.push({
                        start: passStart,
                        maxEl: maxEl,
                        maxElTime: maxElTime,
                        end: t
                    });
                }
            } catch(e) {}
        }

        renderPasses();
    }

    function renderPasses() {
        const container = document.getElementById('sat-passes');
        if (!container) return;

        if (passes.length === 0) {
            container.innerHTML = '<div class="text-muted">No visible passes in next 24h</div>';
            return;
        }

        let html = '';
        passes.forEach(pass => {
            const startStr = pass.start.toLocaleString('en-US', {
                hour: 'numeric', minute: '2-digit', hour12: true
            });
            const durMin = Math.round((pass.end - pass.start) / 60000);
            html += `<div class="sat-pass-entry">
                <span class="pass-time">${startStr}</span>
                <span class="pass-detail">Max ${pass.maxEl.toFixed(0)}° | ${durMin}min</span>
            </div>`;
        });

        container.innerHTML = html;
    }

    function clearOverlay() {
        const overlay = document.getElementById('sky-overlay');
        if (!overlay) return;
        // We share the overlay - just stop drawing. Full clear managed centrally.
    }

    function onLocationChange() {
        if (issRecord) {
            computePasses();
        }
    }

    if (window.NightSky && window.NightSky.features) {
        window.NightSky.features.register('satellites', {
            init: init,
            onLocationChange: onLocationChange,
            destroy: function() {
                if (updateInterval) clearInterval(updateInterval);
                drawEnabled = false;
            }
        });
    }
})();
