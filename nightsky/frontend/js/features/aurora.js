/**
 * Aurora Forecast Feature
 * Real-time Kp index from NOAA SWPC with aurora visibility estimate.
 * Pulsing alert when Kp >= 5.
 */
(function() {
    const BACKEND_URL = 'http://localhost:5051';
    let refreshInterval = null;

    function init() {
        const panel = document.getElementById('aurora-panel');
        if (!panel) return;

        fetchAuroraData();
        // Refresh every 15 minutes
        refreshInterval = setInterval(fetchAuroraData, 15 * 60 * 1000);
    }

    function fetchAuroraData() {
        const ns = window.NightSky;
        if (!ns) return;

        const kpValue = document.getElementById('aurora-kp-value');
        const kpBar = document.getElementById('aurora-kp-bar');
        const visLabel = document.getElementById('aurora-visibility');
        const forecastList = document.getElementById('aurora-forecast');
        const alertEl = document.getElementById('aurora-alert');

        fetch(`${BACKEND_URL}/api/aurora/kp?lat=${ns.state.latitude}`)
            .then(r => r.json())
            .then(data => {
                if (data.error) {
                    showOffline();
                    return;
                }

                const kp = data.current_kp || 0;

                // Update Kp display
                if (kpValue) kpValue.textContent = kp.toFixed(1);
                if (kpBar) {
                    const pct = Math.min((kp / 9) * 100, 100);
                    kpBar.style.width = pct + '%';
                    kpBar.style.background = getKpColor(kp);
                }

                // Visibility
                if (visLabel && data.visibility) {
                    visLabel.textContent = data.visibility.description;
                    visLabel.style.color = data.visibility.color;
                }

                // Alert for Kp >= 5
                if (alertEl) {
                    if (kp >= 5) {
                        alertEl.classList.add('active');
                        alertEl.textContent = kp >= 7 ? 'GEOMAGNETIC STORM' : 'AURORA ALERT';
                    } else {
                        alertEl.classList.remove('active');
                    }
                }

                // Forecast
                if (forecastList && data.kp_forecast) {
                    renderForecast(forecastList, data.kp_forecast);
                }
            })
            .catch(() => {
                showOffline();
            });
    }

    function showOffline() {
        const kpValue = document.getElementById('aurora-kp-value');
        const visLabel = document.getElementById('aurora-visibility');
        if (kpValue) kpValue.textContent = '--';
        if (visLabel) {
            visLabel.textContent = 'Backend offline - start server for live data';
            visLabel.style.color = '#6b7280';
        }
    }

    function getKpColor(kp) {
        if (kp >= 7) return '#ef4444';
        if (kp >= 5) return '#f59e0b';
        if (kp >= 3) return '#10b981';
        return '#00d4ff';
    }

    function renderForecast(container, forecast) {
        // Show next few forecast entries
        let html = '';
        const entries = forecast.slice(1, 5); // Skip header, show 4

        entries.forEach(entry => {
            try {
                const time = entry[0];
                const kp = parseFloat(entry[1]);
                if (isNaN(kp)) return;
                const color = getKpColor(kp);
                const date = new Date(time);
                const timeStr = date.toLocaleString('en-US', {
                    month: 'short', day: 'numeric',
                    hour: 'numeric', hour12: true
                });
                html += `<div class="aurora-forecast-entry">
                    <span class="forecast-time">${timeStr}</span>
                    <span class="forecast-kp" style="color:${color}">Kp ${kp.toFixed(1)}</span>
                </div>`;
            } catch(e) {}
        });

        container.innerHTML = html || '<div class="text-muted">No forecast data</div>';
    }

    function onLocationChange() {
        fetchAuroraData();
    }

    if (window.NightSky && window.NightSky.features) {
        window.NightSky.features.register('aurora', {
            init: init,
            onLocationChange: onLocationChange,
            destroy: function() {
                if (refreshInterval) clearInterval(refreshInterval);
            }
        });
    }
})();
