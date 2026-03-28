/**
 * Rise / Transit / Set Times + Altitude vs Time Plot
 *
 * Shows rise, transit, and set times for a selected celestial object along
 * with a compact altitude-over-time chart using Chart.js. The panel lives
 * in the controls sidebar and can be triggered by selecting an object from
 * a dropdown or programmatically via the .show() method.
 */
(function() {
    const BACKEND_URL = 'http://localhost:5051';
    let chartInstance = null;

    // Supported objects for the dropdown
    const OBJECTS = [
        { value: 'sun', label: 'Sun' },
        { value: 'moon', label: 'Moon' },
        { value: 'mercury', label: 'Mercury' },
        { value: 'venus', label: 'Venus' },
        { value: 'mars', label: 'Mars' },
        { value: 'jupiter', label: 'Jupiter' },
        { value: 'saturn', label: 'Saturn' }
    ];

    function init() {
        createDOMStructure();
    }

    /**
     * Helper: create an element with class and optional text.
     */
    function el(tag, className, textContent) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (textContent) node.textContent = textContent;
        return node;
    }

    /**
     * Remove all child nodes from an element.
     */
    function clearChildren(node) {
        while (node.firstChild) {
            node.removeChild(node.firstChild);
        }
    }

    /**
     * Create the collapsible panel in the controls sidebar.
     */
    function createDOMStructure() {
        var sidebar = document.querySelector('.controls-panel');
        if (!sidebar) return;
        if (document.getElementById('riseset-section')) return;

        // Create a control-section like the existing ones
        var section = el('div', 'control-section');
        section.id = 'riseset-section';

        var heading = el('h3', null, 'Rise / Set Times');
        section.appendChild(heading);

        // Object selector row
        var selectorRow = el('div', 'riseset-selector-row');
        var select = document.createElement('select');
        select.id = 'riseset-object-select';
        select.className = 'riseset-select';

        var placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Select object...';
        placeholder.disabled = true;
        placeholder.selected = true;
        select.appendChild(placeholder);

        OBJECTS.forEach(function(obj) {
            var opt = document.createElement('option');
            opt.value = obj.value;
            opt.textContent = obj.label;
            select.appendChild(opt);
        });
        selectorRow.appendChild(select);

        var goBtn = el('button', 'riseset-go-btn', 'Show');
        goBtn.id = 'riseset-go-btn';
        selectorRow.appendChild(goBtn);
        section.appendChild(selectorRow);

        // Results container (hidden by default)
        var results = el('div', 'riseset-results');
        results.id = 'riseset-results';
        results.style.display = 'none';

        // Times row
        var timesRow = el('div', 'riseset-times');
        timesRow.id = 'riseset-times';
        results.appendChild(timesRow);

        // Chart container
        var chartWrap = el('div', 'riseset-chart-wrap');
        var canvas = document.createElement('canvas');
        canvas.id = 'riseset-chart';
        canvas.width = 300;
        canvas.height = 150;
        chartWrap.appendChild(canvas);
        results.appendChild(chartWrap);

        section.appendChild(results);
        sidebar.appendChild(section);

        // Attach event listener
        goBtn.addEventListener('click', function() {
            var objName = select.value;
            if (objName) fetchRiseSet(objName);
        });

        select.addEventListener('change', function() {
            var objName = select.value;
            if (objName) fetchRiseSet(objName);
        });

        // Inject component styles
        injectStyles();
    }

    /**
     * Inject scoped CSS for the riseset panel.
     */
    function injectStyles() {
        if (document.getElementById('riseset-styles')) return;

        var style = document.createElement('style');
        style.id = 'riseset-styles';
        style.textContent = [
            '.riseset-selector-row { display: flex; gap: 6px; margin-bottom: 8px; }',
            '.riseset-select { flex: 1; padding: 4px 8px; background: rgba(255,255,255,0.06);',
            '  border: 1px solid rgba(200,164,86,0.25); border-radius: 4px;',
            '  color: #e0d5c0; font-size: 0.85rem; font-family: inherit; }',
            '.riseset-select option { background: #1a1a2e; color: #e0d5c0; }',
            '.riseset-go-btn { padding: 4px 12px; background: rgba(200,164,86,0.15);',
            '  border: 1px solid rgba(200,164,86,0.3); border-radius: 4px;',
            '  color: #c8a456; cursor: pointer; font-size: 0.85rem; font-family: inherit; }',
            '.riseset-go-btn:hover { background: rgba(200,164,86,0.25); }',
            '.riseset-results { margin-top: 4px; }',
            '.riseset-times { display: grid; grid-template-columns: 1fr 1fr 1fr;',
            '  gap: 4px; margin-bottom: 8px; text-align: center; font-size: 0.78rem; }',
            '.riseset-time-item { padding: 4px 2px; background: rgba(255,255,255,0.04);',
            '  border-radius: 3px; }',
            '.riseset-time-label { color: #8b8b9e; display: block; font-size: 0.7rem;',
            '  text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }',
            '.riseset-time-value { color: #c8a456; font-family: "JetBrains Mono", monospace;',
            '  font-size: 0.82rem; }',
            '.riseset-chart-wrap { width: 100%; max-width: 300px; height: 150px;',
            '  margin: 0 auto; }',
            '.riseset-chart-wrap canvas { width: 100% !important; height: 100% !important; }',
            '.riseset-status { color: #8b8b9e; font-size: 0.78rem; text-align: center;',
            '  padding: 4px; }',
            '.riseset-flags { text-align: center; font-size: 0.75rem; color: #c8a456;',
            '  margin-bottom: 6px; font-style: italic; }',
            '.riseset-max-alt { text-align: center; font-size: 0.75rem; color: #8b8b9e;',
            '  margin-top: 4px; }'
        ].join('\n');
        document.head.appendChild(style);
    }

    /**
     * Fetch rise/set data from the backend.
     */
    function fetchRiseSet(objectName) {
        var ns = window.NightSky;
        if (!ns || !ns.state) return;

        var lat = ns.state.latitude;
        var lon = ns.state.longitude;
        var results = document.getElementById('riseset-results');
        var timesDiv = document.getElementById('riseset-times');

        if (!results || !timesDiv) return;

        // Show loading state
        results.style.display = 'block';
        clearChildren(timesDiv);
        timesDiv.appendChild(el('div', 'riseset-status', 'Loading...'));
        if (chartInstance) {
            chartInstance.destroy();
            chartInstance = null;
        }

        var url = BACKEND_URL + '/api/nightsky/riseset?lat=' + lat +
                  '&lon=' + lon + '&object=' + encodeURIComponent(objectName);

        fetch(url)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.error) {
                    clearChildren(timesDiv);
                    timesDiv.appendChild(el('div', 'riseset-status', data.error));
                    return;
                }
                renderResults(data);
            })
            .catch(function() {
                clearChildren(timesDiv);
                timesDiv.appendChild(el('div', 'riseset-status', 'Backend offline'));
            });
    }

    /**
     * Render the rise/transit/set times and altitude chart.
     */
    function renderResults(data) {
        var results = document.getElementById('riseset-results');
        var timesDiv = document.getElementById('riseset-times');

        if (!results || !timesDiv) return;

        results.style.display = 'block';
        clearChildren(timesDiv);

        // Remove any stale max-alt div from prior render
        var staleMax = results.querySelectorAll('.riseset-max-alt');
        for (var s = 0; s < staleMax.length; s++) staleMax[s].remove();

        // Edge case flags
        if (data.circumpolar || data.never_rises) {
            var flagDiv = el('div', 'riseset-flags');
            if (data.circumpolar) {
                flagDiv.textContent = data.object + ' is circumpolar (never sets)';
            } else {
                flagDiv.textContent = data.object + ' never rises from this location';
            }
            timesDiv.appendChild(flagDiv);
        }

        // Time items
        var items = [
            { label: 'Rise', value: data.rise },
            { label: 'Transit', value: data.transit },
            { label: 'Set', value: data.set }
        ];

        items.forEach(function(item) {
            var div = el('div', 'riseset-time-item');
            div.appendChild(el('span', 'riseset-time-label', item.label));
            var valSpan = el('span', 'riseset-time-value');
            if (item.value) {
                var d = new Date(item.value);
                valSpan.textContent = d.toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                });
            } else {
                valSpan.textContent = '--';
                valSpan.style.color = '#6b7280';
            }
            div.appendChild(valSpan);
            timesDiv.appendChild(div);
        });

        // Max altitude note
        if (data.max_altitude !== undefined && data.max_altitude !== null) {
            var maxDiv = el('div', 'riseset-max-alt',
                'Peak altitude: ' + data.max_altitude.toFixed(1) + '\u00B0');
            timesDiv.parentNode.insertBefore(maxDiv, timesDiv.nextSibling);
        }

        // Render the altitude chart
        renderChart(data);
    }

    /**
     * Render the altitude-over-time chart using Chart.js.
     */
    function renderChart(data) {
        if (!data.altitude_data || data.altitude_data.length === 0) return;
        if (typeof Chart === 'undefined') return;

        var canvas = document.getElementById('riseset-chart');
        if (!canvas) return;

        // Destroy previous chart instance
        if (chartInstance) {
            chartInstance.destroy();
            chartInstance = null;
        }

        var ctx = canvas.getContext('2d');

        var labels = data.altitude_data.map(function(p) { return p.time; });
        var altitudes = data.altitude_data.map(function(p) { return p.altitude; });

        // Compute y-axis bounds
        var minAlt = Math.min.apply(null, altitudes);
        var maxAlt = Math.max.apply(null, altitudes);
        var yMin = Math.min(-10, Math.floor(minAlt / 10) * 10);
        var yMax = Math.max(45, Math.ceil(maxAlt / 10) * 10);

        chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: data.object + ' Altitude',
                    data: altitudes,
                    borderColor: '#c8a456',
                    backgroundColor: 'rgba(200, 164, 86, 0.08)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    pointHoverBackgroundColor: '#c8a456',
                    borderWidth: 1.5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 300 },
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(20, 20, 40, 0.9)',
                        titleColor: '#c8a456',
                        bodyColor: '#e0d5c0',
                        borderColor: 'rgba(200,164,86,0.3)',
                        borderWidth: 1,
                        padding: 6,
                        titleFont: { size: 11 },
                        bodyFont: { size: 11 },
                        displayColors: false,
                        callbacks: {
                            label: function(context) {
                                return context.parsed.y.toFixed(1) + '\u00B0';
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        min: yMin,
                        max: yMax,
                        title: {
                            display: true,
                            text: 'Alt (\u00B0)',
                            color: '#8b8b9e',
                            font: { size: 10 }
                        },
                        ticks: {
                            color: '#8b8b9e',
                            font: { size: 9 },
                            stepSize: 15
                        },
                        grid: {
                            color: function(context) {
                                // Highlight the horizon line at 0 degrees
                                if (context.tick && context.tick.value === 0) {
                                    return 'rgba(245, 158, 11, 0.5)';
                                }
                                return 'rgba(255,255,255,0.06)';
                            },
                            lineWidth: function(context) {
                                if (context.tick && context.tick.value === 0) {
                                    return 1.5;
                                }
                                return 0.5;
                            }
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: 'Local Time',
                            color: '#8b8b9e',
                            font: { size: 10 }
                        },
                        ticks: {
                            color: '#8b8b9e',
                            font: { size: 8 },
                            maxRotation: 45,
                            autoSkip: true,
                            maxTicksLimit: 9
                        },
                        grid: {
                            color: 'rgba(255,255,255,0.04)',
                            lineWidth: 0.5
                        }
                    }
                }
            }
        });
    }

    function onLocationChange() {
        var select = document.getElementById('riseset-object-select');
        if (select && select.value) {
            fetchRiseSet(select.value);
        }
    }

    function onTimeChange() {
        // Rise/set data is date-based; skip refresh for minor time adjustments
    }

    function destroy() {
        if (chartInstance) {
            chartInstance.destroy();
            chartInstance = null;
        }
        var section = document.getElementById('riseset-section');
        if (section) section.remove();
        var style = document.getElementById('riseset-styles');
        if (style) style.remove();
    }

    if (window.NightSky && window.NightSky.features) {
        window.NightSky.features.register('riseset', {
            init: init,
            onLocationChange: onLocationChange,
            onTimeChange: onTimeChange,
            destroy: destroy,
            // Public method so other features or the planetarium can trigger it
            show: function(objectName) {
                var select = document.getElementById('riseset-object-select');
                if (select) {
                    select.value = objectName.toLowerCase();
                }
                fetchRiseSet(objectName.toLowerCase());
            }
        });
    }
})();
