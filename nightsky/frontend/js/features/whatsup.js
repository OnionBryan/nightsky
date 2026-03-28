/**
 * "What's Up Tonight" Dashboard
 * At-a-glance panel showing tonight's highlights using Astronomy.js calculations.
 */
(function() {

    function init() {
        const panel = document.getElementById('whatsup-panel');
        if (!panel) return;
        refresh();
    }

    function refresh() {
        const ns = window.NightSky;
        if (!ns || typeof Astronomy === 'undefined') return;

        const lat = ns.state.latitude;
        const lon = ns.state.longitude;
        const now = ns.state.planetarium ? ns.state.planetarium.clock : new Date();
        const date = now instanceof Date ? now : new Date();

        const content = document.getElementById('whatsup-content');
        if (!content) return;

        let html = '';

        // Moon Phase
        try {
            const moon = Astronomy.calculateMoonPhase(date);
            const moonRTS = Astronomy.calculateMoonRiseTransitSet(lat, lon, date);
            html += `<div class="whatsup-item">
                <div class="whatsup-icon">${moon.emoji}</div>
                <div class="whatsup-info">
                    <div class="whatsup-title">${moon.name}</div>
                    <div class="whatsup-detail">${moon.illumination.toFixed(0)}% illuminated`;
            if (moonRTS.rise) {
                html += ` | Rise ${formatTime(moonRTS.rise)}`;
            }
            if (moonRTS.set) {
                html += ` | Set ${formatTime(moonRTS.set)}`;
            }
            html += `</div></div></div>`;
        } catch(e) {}

        // Sun times / twilight
        try {
            const twilight = Astronomy.calculateTwilightTimes(lat, lon, date);
            html += `<div class="whatsup-item">
                <div class="whatsup-icon sun-icon">&#9788;</div>
                <div class="whatsup-info">
                    <div class="whatsup-title">Sun &amp; Twilight</div>
                    <div class="whatsup-detail">`;
            if (twilight.sunset) html += `Sunset ${formatTime(twilight.sunset)}`;
            if (twilight.astronomicalDusk) html += ` | Dark by ${formatTime(twilight.astronomicalDusk)}`;
            if (twilight.astronomicalDawn) html += ` | Dawn ${formatTime(twilight.astronomicalDawn)}`;
            if (twilight.sunrise) html += ` | Sunrise ${formatTime(twilight.sunrise)}`;
            if (twilight.darknessDuration) {
                const hrs = Math.floor(twilight.darknessDuration);
                const mins = Math.round((twilight.darknessDuration - hrs) * 60);
                html += `<br>True darkness: ${hrs}h ${mins}m`;
            }
            html += `</div></div></div>`;
        } catch(e) {}

        // Visible Planets
        try {
            const planets = Astronomy.getVisiblePlanets(lat, lon, date);
            const visible = planets.filter(p => p.altitude > 0);
            if (visible.length > 0) {
                const planetIcons = { Mercury: '\u263F', Venus: '\u2640', Mars: '\u2642', Jupiter: '\u2643', Saturn: '\u2644', Uranus: '\u2645', Neptune: '\u2646' };
                html += `<div class="whatsup-item">
                    <div class="whatsup-icon planet-icon">\u2643</div>
                    <div class="whatsup-info">
                        <div class="whatsup-title">Visible Planets (${visible.length})</div>
                        <div class="whatsup-detail">`;
                visible.forEach(p => {
                    const icon = planetIcons[p.name] || '';
                    html += `<span class="planet-tag">${icon} ${p.name} (alt ${p.altitude.toFixed(0)}°)</span> `;
                });
                html += `</div></div></div>`;
            } else {
                html += `<div class="whatsup-item">
                    <div class="whatsup-icon planet-icon">\u2643</div>
                    <div class="whatsup-info">
                        <div class="whatsup-title">Planets</div>
                        <div class="whatsup-detail">No planets currently above horizon</div>
                    </div></div>`;
            }
        } catch(e) {}

        // Active meteor showers
        try {
            const showers = getActiveShowers(date);
            if (showers.length > 0) {
                html += `<div class="whatsup-item">
                    <div class="whatsup-icon meteor-icon">&#9734;</div>
                    <div class="whatsup-info">
                        <div class="whatsup-title">Active Meteor Showers</div>
                        <div class="whatsup-detail">`;
                showers.forEach(s => {
                    const daysTo = s.daysToPeak;
                    const peakStr = daysTo === 0 ? '<strong>PEAK TONIGHT</strong>' :
                                    daysTo > 0 ? `Peak in ${daysTo}d` : `${-daysTo}d past peak`;
                    html += `<span class="shower-tag">${s.name} (ZHR ${s.zhr}) - ${peakStr}</span> `;
                });
                html += `</div></div></div>`;
            }
        } catch(e) {}

        content.innerHTML = html || '<div class="text-muted">No data available</div>';
    }

    function getActiveShowers(date) {
        // Check against meteor shower data loaded from JSON
        if (!window._meteorShowerData) return [];

        const month = date.getMonth() + 1;
        const day = date.getDate();
        const mmdd = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

        return window._meteorShowerData.filter(shower => {
            return isDateInRange(mmdd, shower.start, shower.end);
        }).map(shower => {
            const peakParts = shower.peak.split('-');
            const peakMonth = parseInt(peakParts[0]);
            const peakDay = parseInt(peakParts[1]);
            const peakDate = new Date(date.getFullYear(), peakMonth - 1, peakDay);
            const daysToPeak = Math.round((peakDate - date) / 86400000);

            return { ...shower, daysToPeak };
        });
    }

    function isDateInRange(mmdd, start, end) {
        // Handle year wrapping (e.g., Dec 28 - Jan 12)
        if (start <= end) {
            return mmdd >= start && mmdd <= end;
        } else {
            return mmdd >= start || mmdd <= end;
        }
    }

    function formatTime(date) {
        if (!(date instanceof Date)) return '--';
        return date.toLocaleTimeString('en-US', {
            hour: 'numeric', minute: '2-digit', hour12: true
        });
    }

    function onLocationChange() { refresh(); }
    function onTimeChange() { refresh(); }

    if (window.NightSky && window.NightSky.features) {
        window.NightSky.features.register('whatsup', {
            init: init,
            onLocationChange: onLocationChange,
            onTimeChange: onTimeChange
        });
    }
})();
