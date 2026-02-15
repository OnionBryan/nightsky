/**
 * Main Application - JPSS Constellation Orbital Visualization
 * Supports multiple satellites: NOAA-21, NOAA-20, Suomi NPP
 */

const API_BASE = 'http://localhost:5050/api';

class App {
    constructor() {
        this.projection = null;
        this.orbitRenderer = null;
        this.spotlight = null;
        this.terminator = null;
        this.animation = null;

        this.currentMode = 'live';
        this.currentSatellite = 'noaa21';
        this.satellites = [];
        this.orbitInfo = null;
        this.trackData = [];
        this.currentPosition = null;
        this.constellationData = [];

        this.init();
    }

    async init() {
        this.showLoading(true, 'Initializing...');

        try {
            // Initialize projection
            const container = document.getElementById('map-container');
            const rect = container.getBoundingClientRect();
            const size = Math.min(rect.width, rect.height, 900);

            this.projection = new PolarProjection(container, size, size);

            this.showLoading(true, 'Loading map data...');
            await this.projection.loadLandmasses('data/world-110m.json');

            // Initialize components
            this.orbitRenderer = new OrbitRenderer(this.projection);
            this.spotlight = new Spotlight(this.projection);
            this.terminator = new Terminator(this.projection);
            this.animation = new AnimationController();

            // Setup spotlight callbacks
            this.spotlight.onSatelliteClick = (data) => this.showSatelliteInfo(data);

            this.showLoading(true, 'Fetching satellite data...');

            // Fetch available satellites
            await this.fetchSatellites();
            this.setupSatelliteSelector();

            await this.fetchOrbitInfo();
            await this.fetchTrack();

            // Start animation
            this.animation.setUpdateCallback(() => this.update());
            this.animation.start();

            // Setup UI
            this.setupEventListeners();
            this.setupCoordinateDisplay();
            this.updateInfoPanel();
            this.updateLegend();

            this.showLoading(false);

        } catch (error) {
            console.error('Initialization failed:', error);
            this.showError('Failed to initialize. Is the backend running on port 5050?');
        }
    }

    async fetchSatellites() {
        try {
            const response = await fetch(`${API_BASE}/satellites`);
            const data = await response.json();
            this.satellites = data.satellites;
            this.currentSatellite = data.default || 'noaa21';
        } catch (error) {
            console.error('Failed to fetch satellites:', error);
            // Fallback
            this.satellites = [
                { key: 'noaa21', name: 'NOAA-21', color: '#ff6b6b', norad_id: 54234 },
                { key: 'noaa20', name: 'NOAA-20', color: '#4ecdc4', norad_id: 43013 },
                { key: 'suominpp', name: 'Suomi NPP', color: '#ffe66d', norad_id: 37849 }
            ];
        }
    }

    setupSatelliteSelector() {
        const selector = document.getElementById('satellite-selector');
        if (!selector) return;

        selector.innerHTML = '';

        this.satellites.forEach(sat => {
            const btn = document.createElement('button');
            btn.className = `sat-btn ${sat.key === this.currentSatellite ? 'active' : ''}`;
            btn.dataset.satellite = sat.key;
            btn.innerHTML = `
                <span class="sat-dot" style="background: ${sat.color}"></span>
                <span>${sat.name}</span>
            `;

            btn.addEventListener('click', () => this.selectSatellite(sat.key));
            selector.appendChild(btn);
        });
    }

    async selectSatellite(satKey) {
        if (satKey === this.currentSatellite && this.currentMode !== 'constellation') return;

        this.currentSatellite = satKey;

        // Update selector UI
        document.querySelectorAll('.sat-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.satellite === satKey);
        });

        // Refresh data
        this.showLoading(true, `Loading ${this.getSatelliteName(satKey)}...`);

        this.orbitRenderer.clearHistory();
        await this.fetchOrbitInfo();
        await this.fetchTrack();
        this.updateInfoPanel();
        this.updateLegend();

        this.showLoading(false);
    }

    getSatelliteName(key) {
        const sat = this.satellites.find(s => s.key === key);
        return sat ? sat.name : key;
    }

    getSatelliteColor(key) {
        const sat = this.satellites.find(s => s.key === key);
        return sat ? sat.color : '#ff6b6b';
    }

    updateLegend() {
        const legendContainer = document.getElementById('satellite-legend');
        if (!legendContainer) return;

        // Reset to single satellite legend
        const color = this.getSatelliteColor(this.currentSatellite);
        legendContainer.innerHTML = `
            <div class="legend-item">
                <span class="legend-dot satellite" style="background: ${color}; box-shadow: 0 0 8px ${color}"></span>
                <span id="legend-sat-name">${this.getSatelliteName(this.currentSatellite)} Position</span>
            </div>
        `;
    }

    async fetchOrbitInfo() {
        try {
            const response = await fetch(`${API_BASE}/orbit-info?satellite=${this.currentSatellite}`);
            this.orbitInfo = await response.json();
        } catch (error) {
            console.error('Failed to fetch orbit info:', error);
            throw error;
        }
    }

    async fetchTrack() {
        try {
            const response = await fetch(`${API_BASE}/track?satellite=${this.currentSatellite}&duration=180&step=30`);
            const data = await response.json();
            this.trackData = data.positions;
        } catch (error) {
            console.error('Failed to fetch track:', error);
            throw error;
        }
    }

    async fetchCurrentPosition() {
        try {
            const response = await fetch(`${API_BASE}/current?satellite=${this.currentSatellite}`);
            return await response.json();
        } catch (error) {
            console.error('Failed to fetch position:', error);
            return null;
        }
    }

    async fetchConstellationPositions() {
        try {
            const response = await fetch(`${API_BASE}/constellation/current`);
            const data = await response.json();
            this.constellationData = data.satellites;
            return data.satellites;
        } catch (error) {
            console.error('Failed to fetch constellation:', error);
            return [];
        }
    }

    async update() {
        // Update day/night terminator
        if (this.terminator) {
            this.terminator.update();
        }

        if (this.currentMode === 'constellation') {
            await this.updateConstellation();
        } else {
            await this.updateSingleSatellite();
        }
        this.updateTimeDisplay();
    }

    async updateSingleSatellite() {
        const pos = await this.fetchCurrentPosition();
        if (!pos) return;

        this.currentPosition = pos;

        // Add to history
        this.orbitRenderer.addToHistory({ lat: pos.latitude, lon: pos.longitude });

        // Draw trail
        const history = this.orbitRenderer.getHistory();
        this.orbitRenderer.drawFadingTrail(history, this.getSatelliteColor(this.currentSatellite));

        // Draw future prediction
        const now = new Date();
        const futurePositions = this.trackData.filter(p => new Date(p.time) > now);
        if (futurePositions.length > 1) {
            this.orbitRenderer.drawPrediction(futurePositions, this.getSatelliteColor(this.currentSatellite));
        }

        // Update spotlight with satellite color
        const nextPos = futurePositions[0];
        this.spotlight.setColor(this.getSatelliteColor(this.currentSatellite));
        this.spotlight.update(
            { lon: pos.longitude, lat: pos.latitude },
            nextPos ? { lon: nextPos.lon, lat: nextPos.lat } : null,
            pos
        );

        // Update displays
        this.updatePositionDisplay(pos);
    }

    async updateConstellation() {
        const satellites = await this.fetchConstellationPositions();
        if (!satellites || satellites.length === 0) return;

        // Clear previous markers
        this.spotlight.clear();
        this.orbitRenderer.clearTrails();

        // Draw each satellite
        satellites.forEach((sat, index) => {
            this.drawConstellationSatellite(sat, index === 0);
        });

        // Update position display for selected satellite
        const selected = satellites.find(s => s.satellite_key === this.currentSatellite);
        if (selected) {
            this.updatePositionDisplay({
                latitude: selected.latitude,
                longitude: selected.longitude,
                altitude_km: selected.altitude_km,
                velocity_km_s: selected.velocity_km_s
            });
        }
    }

    drawConstellationSatellite(sat, isFirst = false) {
        const pos = this.projection.project(sat.longitude, sat.latitude);
        if (!pos) return;

        const markerLayer = this.projection.getLayer('markers');

        // Create satellite group
        const group = markerLayer.append('g')
            .attr('class', `constellation-sat sat-${sat.satellite_key}`)
            .attr('transform', `translate(${pos[0]}, ${pos[1]})`)
            .style('cursor', 'pointer');

        // Pulse ring
        group.append('circle')
            .attr('class', 'satellite-pulse')
            .attr('r', 8)
            .style('fill', 'none')
            .style('stroke', sat.color)
            .style('stroke-width', 2)
            .style('opacity', 0.6);

        // Glow
        group.append('circle')
            .attr('r', 10)
            .style('fill', sat.color)
            .style('opacity', 0.2);

        // Main marker
        group.append('circle')
            .attr('r', 6)
            .style('fill', sat.color)
            .style('stroke', '#fff')
            .style('stroke-width', 1.5);

        // Label
        group.append('text')
            .attr('x', 12)
            .attr('y', 4)
            .style('fill', sat.color)
            .style('font-size', '10px')
            .style('font-weight', '500')
            .text(sat.name);

        // Click to select
        group.on('click', () => {
            this.selectSatellite(sat.satellite_key);
        });

        // Hover effect
        group.on('mouseenter', function() {
            d3.select(this).select('circle:nth-child(3)')
                .transition().duration(150)
                .attr('r', 8);
        }).on('mouseleave', function() {
            d3.select(this).select('circle:nth-child(3)')
                .transition().duration(150)
                .attr('r', 6);
        });
    }

    updateInfoPanel() {
        if (!this.orbitInfo) return;

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };

        setVal('info-inclination', `${this.orbitInfo.inclination_deg.toFixed(2)}°`);
        setVal('info-altitude', `${this.orbitInfo.altitude_km.toFixed(0)} km`);
        setVal('info-period', `${this.orbitInfo.period_minutes.toFixed(1)} min`);
        setVal('info-orbit', `#${this.orbitInfo.current_orbit_number}`);
    }

    updatePositionDisplay(pos) {
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };

        const latDir = pos.latitude >= 0 ? 'N' : 'S';
        const lonDir = pos.longitude >= 0 ? 'E' : 'W';

        setVal('pos-lat', `${Math.abs(pos.latitude).toFixed(3)}° ${latDir}`);
        setVal('pos-lon', `${Math.abs(pos.longitude).toFixed(3)}° ${lonDir}`);
        setVal('pos-alt', `${pos.altitude_km.toFixed(1)} km`);
        setVal('pos-vel', `${pos.velocity_km_s.toFixed(2)} km/s`);
    }

    updateTimeDisplay() {
        const now = new Date();
        const timeStr = now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
        const el = document.getElementById('time-display');
        if (el) el.textContent = timeStr;
    }

    setupEventListeners() {
        // Tabs
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.switchMode(e.target.dataset.mode);
            });
        });

        // Play/Pause
        const playBtn = document.getElementById('btn-play');
        if (playBtn) {
            playBtn.addEventListener('click', () => {
                const playing = this.animation.toggle();
                playBtn.textContent = playing ? 'Pause' : 'Play';
                playBtn.classList.toggle('active', !playing);
            });
        }

        // Speed
        const speedBtn = document.getElementById('btn-speed');
        if (speedBtn) {
            speedBtn.addEventListener('click', () => {
                const speeds = [1, 2, 5, 10];
                const current = this.animation.getSpeed();
                const idx = speeds.indexOf(current);
                const next = speeds[(idx + 1) % speeds.length];
                this.animation.setSpeed(next);
                speedBtn.textContent = `${next}x`;
            });
        }

        // Refresh
        const refreshBtn = document.getElementById('btn-refresh');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                refreshBtn.textContent = '...';
                await this.fetchTrack();
                await this.fetchOrbitInfo();
                this.updateInfoPanel();
                this.orbitRenderer.clearHistory();
                refreshBtn.textContent = 'Refresh';
            });
        }

        // Zoom controls
        const zoomInBtn = document.getElementById('btn-zoom-in');
        const zoomOutBtn = document.getElementById('btn-zoom-out');
        const zoomResetBtn = document.getElementById('btn-zoom-reset');

        if (zoomInBtn) zoomInBtn.addEventListener('click', () => this.projection.zoomIn());
        if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => this.projection.zoomOut());
        if (zoomResetBtn) zoomResetBtn.addEventListener('click', () => this.projection.resetZoom());

        // Toggle buttons
        const toggleSwathBtn = document.getElementById('btn-toggle-swath');
        const toggleVelocityBtn = document.getElementById('btn-toggle-velocity');

        if (toggleSwathBtn) {
            toggleSwathBtn.addEventListener('click', () => {
                const on = this.spotlight.toggleSwath();
                toggleSwathBtn.classList.toggle('active', on);
            });
        }

        if (toggleVelocityBtn) {
            toggleVelocityBtn.addEventListener('click', () => {
                const on = this.spotlight.toggleVelocity();
                toggleVelocityBtn.classList.toggle('active', on);
            });
        }

        const toggleTerminatorBtn = document.getElementById('btn-toggle-terminator');
        if (toggleTerminatorBtn) {
            toggleTerminatorBtn.addEventListener('click', () => {
                const on = this.terminator.toggle();
                toggleTerminatorBtn.classList.toggle('active', on);
            });
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT') return;

            switch(e.key) {
                case ' ':
                    e.preventDefault();
                    document.getElementById('btn-play')?.click();
                    break;
                case '+':
                case '=':
                    this.projection.zoomIn();
                    break;
                case '-':
                    this.projection.zoomOut();
                    break;
                case '0':
                    this.projection.resetZoom();
                    break;
                case 'r':
                    document.getElementById('btn-refresh')?.click();
                    break;
            }
        });
    }

    setupCoordinateDisplay() {
        const coordDisplay = document.getElementById('coord-display');
        if (!coordDisplay) return;

        const svg = document.getElementById('map-svg');
        if (!svg) return;

        svg.addEventListener('mousemove', (e) => {
            const rect = svg.getBoundingClientRect();
            const x = (e.clientX - rect.left) * (this.projection.width / rect.width);
            const y = (e.clientY - rect.top) * (this.projection.height / rect.height);

            const coords = this.projection.invert(x, y);
            if (coords && isFinite(coords[0]) && isFinite(coords[1])) {
                const lon = coords[0];
                const lat = coords[1];
                const latDir = lat >= 0 ? 'N' : 'S';
                const lonDir = lon >= 0 ? 'E' : 'W';

                // Format coordinates nicely
                const latStr = Math.abs(lat).toFixed(1);
                const lonStr = Math.abs(lon).toFixed(1);

                // Special case: near poles
                if (Math.abs(lat) > 89.5) {
                    coordDisplay.textContent = lat > 0 ? '90°N (North Pole)' : '90°S (South Pole)';
                } else {
                    coordDisplay.textContent = `${latStr}°${latDir} ${lonStr}°${lonDir}`;
                }
            } else {
                coordDisplay.textContent = '-- --';
            }
        });

        svg.addEventListener('mouseleave', () => {
            coordDisplay.textContent = '-- --';
        });
    }

    switchMode(mode) {
        this.currentMode = mode;

        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });

        // Clear previous visuals
        this.projection.clearLayer('coverage');
        this.spotlight.clear();
        this.orbitRenderer.clearTrails();
        this.projection.getLayer('markers').selectAll('.constellation-sat').remove();

        if (mode === 'live') {
            this.orbitRenderer.clearHistory();
            this.updateLegend();
        } else if (mode === 'constellation') {
            this.orbitRenderer.clearHistory();
            this.updateConstellationLegend();
        } else if (mode === 'coverage') {
            this.drawCoverage();
        }
    }

    updateConstellationLegend() {
        const legendContainer = document.getElementById('satellite-legend');
        if (!legendContainer) return;

        legendContainer.innerHTML = '';

        this.satellites.forEach(sat => {
            const item = document.createElement('div');
            item.className = 'legend-item';
            item.innerHTML = `
                <span class="legend-dot" style="background: ${sat.color}; box-shadow: 0 0 8px ${sat.color}"></span>
                <span>${sat.name}</span>
            `;
            legendContainer.appendChild(item);
        });
    }

    async drawCoverage() {
        this.showLoading(true, `Loading 24h coverage for ${this.getSatelliteName(this.currentSatellite)}...`);

        try {
            const response = await fetch(`${API_BASE}/track?satellite=${this.currentSatellite}&duration=1440&step=60`);
            const data = await response.json();

            const color = this.getSatelliteColor(this.currentSatellite);
            // Parse hex to rgba
            const r = parseInt(color.slice(1, 3), 16);
            const g = parseInt(color.slice(3, 5), 16);
            const b = parseInt(color.slice(5, 7), 16);

            this.orbitRenderer.drawGroundTrack(data.positions, {
                className: 'coverage-track',
                stroke: `rgba(${r}, ${g}, ${b}, 0.5)`,
                strokeWidth: 1.5,
                opacity: 1
            });

            this.showLoading(false);
        } catch (error) {
            console.error('Failed to fetch coverage:', error);
            this.showLoading(false);
        }
    }

    showSatelliteInfo(data) {
        // Could show a modal or popup with detailed info
        console.log('Satellite clicked:', data);
    }

    showLoading(show, message = 'Loading...') {
        const overlay = document.getElementById('loading-overlay');
        const text = document.querySelector('.loading-text');

        if (overlay) {
            overlay.classList.toggle('hidden', !show);
        }
        if (text && message) {
            text.textContent = message;
        }
    }

    showError(message) {
        const errorEl = document.getElementById('error-message');
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.classList.add('visible');
        }
        this.showLoading(false);
    }
}

// Start
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
