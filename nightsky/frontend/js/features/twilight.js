/**
 * Astronomical Twilight / Darkness Window Bar
 *
 * Renders a compact horizontal timeline bar showing the transition through
 * day, civil twilight, nautical twilight, astronomical twilight, and full
 * night. Moon-up periods are shown as a hatched overlay. A thin amber line
 * marks the current time and updates every minute.
 */
(function() {
    const BACKEND_URL = 'http://localhost:5051';
    let updateInterval = null;
    let cachedData = null;

    // Color mapping for segment types (Observatory Brass palette)
    const SEGMENT_COLORS = {
        day:                     '#d4a017',
        civil_twilight:          '#b46a1f',
        nautical_twilight:       '#1e3a5f',
        astronomical_twilight:   '#0f1b33',
        night:                   '#050510'
    };

    const SEGMENT_LABELS = {
        day:                     'Day',
        civil_twilight:          'Civil',
        nautical_twilight:       'Nautical',
        astronomical_twilight:   'Astro',
        night:                   'Night'
    };

    function init() {
        createDOMStructure();
        fetchTwilightData();
        updateInterval = setInterval(updateNowMarker, 60 * 1000);
    }

    /**
     * Helper: create an element with class, optional styles, optional text.
     */
    function el(tag, className, textContent) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (textContent) node.textContent = textContent;
        return node;
    }

    /**
     * Create the twilight bar DOM elements inside the info-panel.
     */
    function createDOMStructure() {
        var infoPanel = document.getElementById('info-panel');
        if (!infoPanel) return;
        if (document.getElementById('twilight-container')) return;

        var container = el('div', 'twilight-container');
        container.id = 'twilight-container';

        // Header row
        var header = el('div', 'twilight-header');
        header.appendChild(el('span', 'twilight-title', 'Darkness Window'));
        var summarySpan = el('span', 'twilight-summary');
        summarySpan.id = 'twilight-summary';
        header.appendChild(summarySpan);
        container.appendChild(header);

        // Bar wrapper (relative positioned container)
        var barWrapper = el('div', 'twilight-bar-wrapper');

        var bar = el('div', 'twilight-bar');
        bar.id = 'twilight-bar';
        barWrapper.appendChild(bar);

        var moonOverlay = el('div', 'twilight-moon-overlay');
        moonOverlay.id = 'twilight-moon-overlay';
        barWrapper.appendChild(moonOverlay);

        var nowMarker = el('div', 'twilight-now-marker');
        nowMarker.id = 'twilight-now-marker';
        barWrapper.appendChild(nowMarker);

        container.appendChild(barWrapper);

        // Time labels
        var labels = el('div', 'twilight-labels');
        labels.id = 'twilight-labels';
        container.appendChild(labels);

        // Legend
        var legend = el('div', 'twilight-legend');
        legend.id = 'twilight-legend';
        container.appendChild(legend);

        infoPanel.appendChild(container);
    }

    /**
     * Fetch twilight data from the backend.
     */
    function fetchTwilightData() {
        var ns = window.NightSky;
        if (!ns || !ns.state) return;

        var lat = ns.state.latitude;
        var lon = ns.state.longitude;

        fetch(BACKEND_URL + '/api/nightsky/twilight?lat=' + lat + '&lon=' + lon)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.error) {
                    showOffline();
                    return;
                }
                cachedData = data;
                renderBar(data);
                updateNowMarker();
            })
            .catch(function() {
                showOffline();
            });
    }

    function showOffline() {
        var summary = document.getElementById('twilight-summary');
        if (summary) {
            summary.textContent = 'Backend offline';
            summary.style.color = '#6b7280';
        }
    }

    /**
     * Render the twilight bar from API data.
     */
    function renderBar(data) {
        var bar = document.getElementById('twilight-bar');
        var moonOverlay = document.getElementById('twilight-moon-overlay');
        var labelsContainer = document.getElementById('twilight-labels');
        var legendContainer = document.getElementById('twilight-legend');
        var summary = document.getElementById('twilight-summary');

        if (!bar) return;

        // Clear previous content
        bar.textContent = '';
        moonOverlay.textContent = '';
        labelsContainer.textContent = '';
        legendContainer.textContent = '';

        var windowStart = new Date(data.window.start);
        var windowEnd = new Date(data.window.end);
        var windowMs = windowEnd.getTime() - windowStart.getTime();

        if (windowMs <= 0) return;

        // Render segments
        var typesUsed = {};
        data.segments.forEach(function(seg) {
            var segStart = new Date(seg.start);
            var segEnd = new Date(seg.end);

            var leftPct = ((segStart.getTime() - windowStart.getTime()) / windowMs) * 100;
            var widthPct = ((segEnd.getTime() - segStart.getTime()) / windowMs) * 100;

            if (leftPct < 0) {
                widthPct += leftPct;
                leftPct = 0;
            }
            if (leftPct + widthPct > 100) {
                widthPct = 100 - leftPct;
            }
            if (widthPct <= 0) return;

            var div = document.createElement('div');
            div.className = 'twilight-segment';
            div.style.position = 'absolute';
            div.style.left = leftPct + '%';
            div.style.width = widthPct + '%';
            div.style.top = '0';
            div.style.height = '100%';
            div.style.background = SEGMENT_COLORS[seg.type] || '#333';
            div.title = SEGMENT_LABELS[seg.type] || seg.type;
            bar.appendChild(div);

            typesUsed[seg.type] = true;
        });

        // Render moon-up overlay (hatched pattern)
        if (data.moon && data.moon.periods) {
            data.moon.periods.forEach(function(period) {
                var riseTime = new Date(period.rise);
                var setTime = new Date(period.set);

                var leftPct = ((riseTime.getTime() - windowStart.getTime()) / windowMs) * 100;
                var widthPct = ((setTime.getTime() - riseTime.getTime()) / windowMs) * 100;

                if (leftPct < 0) {
                    widthPct += leftPct;
                    leftPct = 0;
                }
                if (leftPct + widthPct > 100) {
                    widthPct = 100 - leftPct;
                }
                if (widthPct <= 0) return;

                var div = document.createElement('div');
                div.className = 'twilight-moon-period';
                div.style.position = 'absolute';
                div.style.left = leftPct + '%';
                div.style.width = widthPct + '%';
                div.style.top = '0';
                div.style.height = '100%';
                div.title = 'Moon up (' + Math.round(data.moon.illumination) + '% illuminated)';
                moonOverlay.appendChild(div);
            });
        }

        // Time labels every 3 hours
        for (var h = -12; h <= 12; h += 3) {
            var labelTime = new Date(windowStart.getTime() + ((h + 12) / 24) * windowMs);
            var pct = ((h + 12) / 24) * 100;
            if (pct < 0 || pct > 100) continue;

            var label = el('span', 'twilight-time-label');
            label.style.left = pct + '%';
            label.textContent = labelTime.toLocaleTimeString('en-US', {
                hour: 'numeric',
                hour12: true
            });
            labelsContainer.appendChild(label);
        }

        // Legend
        var legendTypes = ['day', 'civil_twilight', 'nautical_twilight', 'astronomical_twilight', 'night'];
        legendTypes.forEach(function(type) {
            if (!typesUsed[type]) return;

            var item = el('span', 'twilight-legend-item');
            var swatch = el('span', 'twilight-legend-swatch');
            swatch.style.background = SEGMENT_COLORS[type];
            item.appendChild(swatch);
            item.appendChild(document.createTextNode(SEGMENT_LABELS[type]));
            legendContainer.appendChild(item);
        });

        // Moon legend entry
        if (data.moon && data.moon.periods && data.moon.periods.length > 0) {
            var moonItem = el('span', 'twilight-legend-item');
            var moonSwatch = el('span', 'twilight-legend-swatch twilight-legend-moon');
            moonItem.appendChild(moonSwatch);
            moonItem.appendChild(document.createTextNode(
                'Moon ' + Math.round(data.moon.illumination) + '%'
            ));
            legendContainer.appendChild(moonItem);
        }

        // Summary text
        if (summary) {
            var parts = [];
            if (data.darkness_window) {
                parts.push(data.darkness_window.duration_hours.toFixed(1) + 'h dark');
            }
            if (data.moonless_darkness) {
                parts.push(data.moonless_darkness.duration_hours.toFixed(1) + 'h moonless');
            }
            if (data.moon) {
                parts.push(data.moon.phase_name);
            }
            summary.textContent = parts.join(' \u2022 ');
            summary.style.color = '';
        }
    }

    /**
     * Update the "now" marker position on the bar.
     */
    function updateNowMarker() {
        if (!cachedData) return;

        var marker = document.getElementById('twilight-now-marker');
        if (!marker) return;

        var windowStart = new Date(cachedData.window.start);
        var windowEnd = new Date(cachedData.window.end);
        var windowMs = windowEnd.getTime() - windowStart.getTime();
        var now = new Date();

        var pct = ((now.getTime() - windowStart.getTime()) / windowMs) * 100;

        if (pct < 0 || pct > 100) {
            marker.style.display = 'none';
            return;
        }

        marker.style.display = 'block';
        marker.style.left = pct + '%';
    }

    function onLocationChange() {
        fetchTwilightData();
    }

    function onTimeChange() {
        updateNowMarker();
    }

    function destroy() {
        if (updateInterval) {
            clearInterval(updateInterval);
            updateInterval = null;
        }
        var container = document.getElementById('twilight-container');
        if (container) container.remove();
        cachedData = null;
    }

    if (window.NightSky && window.NightSky.features) {
        window.NightSky.features.register('twilight', {
            init: init,
            onLocationChange: onLocationChange,
            onTimeChange: onTimeChange,
            destroy: destroy
        });
    }
})();
