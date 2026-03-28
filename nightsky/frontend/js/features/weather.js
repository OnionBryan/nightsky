/**
 * Weather / Cloud Forecast Panel
 *
 * Fetches combined Open-Meteo + 7Timer data from the backend, renders a
 * compact sidebar panel with current conditions, an astronomy score gauge,
 * and a 12-hour hourly color-bar forecast. Updates on location change and
 * auto-refreshes every 30 minutes.
 */
(function() {
    var BACKEND_URL = 'http://localhost:5051';
    var refreshTimer = null;
    var cachedData = null;
    var debounceTimer = null;

    // ── Colour thresholds ──────────────────────────────────────────────

    function scoreColor(score) {
        if (score >= 70) return '#10b981';   // green  -- good
        if (score >= 45) return '#f59e0b';   // amber  -- ok
        return '#ef4444';                     // red    -- poor
    }

    function cloudColor(pct) {
        if (pct <= 25) return '#10b981';
        if (pct <= 50) return '#34d399';
        if (pct <= 75) return '#f59e0b';
        return '#ef4444';
    }

    function scoreLabel(score) {
        if (score >= 80) return 'Excellent';
        if (score >= 60) return 'Good';
        if (score >= 40) return 'Fair';
        if (score >= 20) return 'Poor';
        return 'Bad';
    }

    // ── Helpers ────────────────────────────────────────────────────────

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    function hourLabel(isoTime) {
        try {
            var h = parseInt(isoTime.split('T')[1].split(':')[0], 10);
            if (h === 0) return '12a';
            if (h < 12) return h + 'a';
            if (h === 12) return '12p';
            return (h - 12) + 'p';
        } catch (e) {
            return '';
        }
    }

    // ── DOM Construction ───────────────────────────────────────────────

    function init() {
        createPanel();
        fetchWeather();
        // Auto-refresh every 30 minutes
        refreshTimer = setInterval(fetchWeather, 30 * 60 * 1000);
    }

    function createPanel() {
        var infoPanel = document.getElementById('info-panel');
        if (!infoPanel) return;
        if (document.getElementById('weather-container')) return;

        var container = el('div', 'weather-container');
        container.id = 'weather-container';

        // Header
        var header = el('div', 'weather-header');
        header.appendChild(el('span', 'weather-title', 'Weather Forecast'));
        var status = el('span', 'weather-status');
        status.id = 'weather-status';
        status.textContent = 'Loading...';
        header.appendChild(status);
        container.appendChild(header);

        // Current conditions row
        var conditions = el('div', 'weather-conditions');
        conditions.id = 'weather-conditions';
        container.appendChild(conditions);

        // Score gauge
        var gaugeRow = el('div', 'weather-gauge-row');
        gaugeRow.id = 'weather-gauge-row';
        container.appendChild(gaugeRow);

        // Hourly forecast bars
        var forecastLabel = el('div', 'weather-forecast-label', 'Next 12 hours');
        container.appendChild(forecastLabel);
        var forecast = el('div', 'weather-forecast');
        forecast.id = 'weather-forecast';
        container.appendChild(forecast);

        // Time labels beneath bars
        var timeLabels = el('div', 'weather-time-labels');
        timeLabels.id = 'weather-time-labels';
        container.appendChild(timeLabels);

        // Updated timestamp
        var updated = el('div', 'weather-updated');
        updated.id = 'weather-updated';
        container.appendChild(updated);

        infoPanel.appendChild(container);
    }

    // ── Data Fetching ──────────────────────────────────────────────────

    function fetchWeather() {
        var ns = window.NightSky;
        if (!ns || !ns.state) return;

        var lat = ns.state.latitude;
        var lon = ns.state.longitude;

        var status = document.getElementById('weather-status');
        if (status) {
            status.textContent = 'Updating...';
            status.style.color = '';
        }

        fetch(BACKEND_URL + '/api/nightsky/weather?lat=' + lat + '&lon=' + lon)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.error) {
                    showError(data.error);
                    return;
                }
                cachedData = data;
                renderPanel(data);
            })
            .catch(function() {
                showError('Backend offline');
            });
    }

    function showError(msg) {
        var status = document.getElementById('weather-status');
        if (status) {
            status.textContent = msg;
            status.style.color = '#a04040';
        }
    }

    // ── Rendering ──────────────────────────────────────────────────────

    function renderPanel(data) {
        renderConditions(data);
        renderGauge(data);
        renderForecast(data);
        renderTimestamp(data);

        var status = document.getElementById('weather-status');
        if (status && data.summary) {
            status.textContent = data.summary.overall || '';
            status.style.color = '';
        }
    }

    /**
     * Current conditions: show the nearest hour's data.
     */
    function renderConditions(data) {
        var box = document.getElementById('weather-conditions');
        if (!box) return;
        box.textContent = '';

        // Find nearest hour to now
        var now = new Date();
        var nearest = null;
        var minDiff = Infinity;
        for (var i = 0; i < data.hourly.length; i++) {
            var h = data.hourly[i];
            var t = new Date(h.time);
            var diff = Math.abs(now - t);
            if (diff < minDiff) {
                minDiff = diff;
                nearest = h;
            }
        }
        if (!nearest) return;

        // Cloud cover
        var cloudItem = el('div', 'weather-cond-item');
        cloudItem.appendChild(el('span', 'weather-cond-label', 'Cloud'));
        var cloudVal = el('span', 'weather-cond-value', nearest.cloud_cover !== null ? nearest.cloud_cover + '%' : '--');
        if (nearest.cloud_cover !== null) cloudVal.style.color = cloudColor(nearest.cloud_cover);
        cloudItem.appendChild(cloudVal);
        box.appendChild(cloudItem);

        // Seeing
        var seeItem = el('div', 'weather-cond-item');
        seeItem.appendChild(el('span', 'weather-cond-label', 'Seeing'));
        seeItem.appendChild(el('span', 'weather-cond-value', nearest.seeing_label || '--'));
        box.appendChild(seeItem);

        // Transparency
        var transItem = el('div', 'weather-cond-item');
        transItem.appendChild(el('span', 'weather-cond-label', 'Transp'));
        transItem.appendChild(el('span', 'weather-cond-value', nearest.transparency_label || '--'));
        box.appendChild(transItem);

        // Temperature
        var tempItem = el('div', 'weather-cond-item');
        tempItem.appendChild(el('span', 'weather-cond-label', 'Temp'));
        tempItem.appendChild(el('span', 'weather-cond-value',
            nearest.temp_c !== null ? nearest.temp_c.toFixed(0) + '\u00b0C' : '--'));
        box.appendChild(tempItem);

        // Wind
        var windItem = el('div', 'weather-cond-item');
        windItem.appendChild(el('span', 'weather-cond-label', 'Wind'));
        windItem.appendChild(el('span', 'weather-cond-value',
            nearest.wind_kmh !== null ? nearest.wind_kmh.toFixed(0) + ' km/h' : '--'));
        box.appendChild(windItem);

        // Humidity
        var humItem = el('div', 'weather-cond-item');
        humItem.appendChild(el('span', 'weather-cond-label', 'Humid'));
        humItem.appendChild(el('span', 'weather-cond-value',
            nearest.humidity !== null ? nearest.humidity + '%' : '--'));
        box.appendChild(humItem);
    }

    /**
     * Astronomy score gauge: a compact horizontal bar with numeric label.
     */
    function renderGauge(data) {
        var row = document.getElementById('weather-gauge-row');
        if (!row) return;
        row.textContent = '';

        // Find current-hour score
        var now = new Date();
        var nearest = null;
        var minDiff = Infinity;
        for (var i = 0; i < data.hourly.length; i++) {
            var t = new Date(data.hourly[i].time);
            var diff = Math.abs(now - t);
            if (diff < minDiff) {
                minDiff = diff;
                nearest = data.hourly[i];
            }
        }

        var score = nearest ? nearest.astronomy_score : null;
        if (score === null || score === undefined) {
            row.appendChild(el('span', 'weather-gauge-label', 'Astronomy Score: --'));
            return;
        }

        var label = el('div', 'weather-gauge-label');
        label.appendChild(document.createTextNode('Astronomy Score: '));
        var strong = el('strong', null, String(score));
        label.appendChild(strong);
        label.appendChild(document.createTextNode('/100 \u2014 ' + scoreLabel(score)));
        row.appendChild(label);

        var trackOuter = el('div', 'weather-gauge-track');
        var fill = el('div', 'weather-gauge-fill');
        fill.style.width = score + '%';
        fill.style.background = scoreColor(score);
        trackOuter.appendChild(fill);
        row.appendChild(trackOuter);
    }

    /**
     * Hourly forecast: colored bars for the next 12 hours from now.
     */
    function renderForecast(data) {
        var box = document.getElementById('weather-forecast');
        var labelsBox = document.getElementById('weather-time-labels');
        if (!box || !labelsBox) return;
        box.textContent = '';
        labelsBox.textContent = '';

        // Find the index of the hour nearest to now, then take next 12
        var now = new Date();
        var startIdx = 0;
        var minDiff = Infinity;
        for (var i = 0; i < data.hourly.length; i++) {
            var t = new Date(data.hourly[i].time);
            var diff = Math.abs(now - t);
            if (diff < minDiff) {
                minDiff = diff;
                startIdx = i;
            }
        }

        var hours = data.hourly.slice(startIdx, startIdx + 12);

        for (var j = 0; j < hours.length; j++) {
            var h = hours[j];
            var bar = el('div', 'weather-bar');
            var sc = h.astronomy_score;
            bar.style.background = sc !== null ? scoreColor(sc) : '#333';
            bar.title = hourLabel(h.time)
                + ' | Cloud: ' + (h.cloud_cover !== null ? h.cloud_cover + '%' : '--')
                + ' | Score: ' + (sc !== null ? sc : '--');
            box.appendChild(bar);

            // Time label (show every other to avoid crowding)
            var tl = el('span', 'weather-time-tick');
            tl.textContent = (j % 2 === 0) ? hourLabel(h.time) : '';
            labelsBox.appendChild(tl);
        }
    }

    function renderTimestamp(data) {
        var box = document.getElementById('weather-updated');
        if (!box) return;
        if (data.fetched_at) {
            var d = new Date(data.fetched_at);
            box.textContent = 'Updated ' + d.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
        }
    }

    // ── Feature Lifecycle ──────────────────────────────────────────────

    function onLocationChange() {
        // Debounce 500ms
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(fetchWeather, 500);
    }

    function onTimeChange() {
        // Re-render with cached data (no refetch needed)
        if (cachedData) renderPanel(cachedData);
    }

    function destroy() {
        if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = null;
        }
        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }
        var container = document.getElementById('weather-container');
        if (container) container.remove();
        cachedData = null;
    }

    // ── Register ───────────────────────────────────────────────────────

    if (window.NightSky && window.NightSky.features) {
        window.NightSky.features.register('weather', {
            init: init,
            onLocationChange: onLocationChange,
            onTimeChange: onTimeChange,
            destroy: destroy
        });
    }
})();
