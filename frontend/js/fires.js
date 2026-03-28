/**
 * NASA FIRMS Active Fire Overlay
 *
 * Fetches fire detections from the backend proxy (which caches FIRMS data)
 * and renders them as sized/colored dots on the D3 map layers.
 */

class FireOverlay {
    constructor(projection, apiBase) {
        this.projection = projection;
        this.apiBase = apiBase;
        this.fires = [];
        this.visible = false;
        this.refreshTimer = null;
        this.tooltip = null;

        // Create a persistent tooltip element
        this._initTooltip();
    }

    // ── Tooltip ───────────────────────────────────────────────

    _initTooltip() {
        this.tooltip = d3.select('body').append('div')
            .attr('class', 'fire-tooltip')
            .style('position', 'absolute')
            .style('pointer-events', 'none')
            .style('background', 'rgba(20, 20, 30, 0.92)')
            .style('color', '#f0e6d2')
            .style('padding', '6px 10px')
            .style('border-radius', '4px')
            .style('font-size', '11px')
            .style('font-family', 'monospace')
            .style('line-height', '1.5')
            .style('border', '1px solid rgba(255, 100, 0, 0.5)')
            .style('box-shadow', '0 2px 8px rgba(0,0,0,0.5)')
            .style('z-index', '9999')
            .style('display', 'none');
    }

    // ── Data fetching ─────────────────────────────────────────

    async fetchFires() {
        try {
            const response = await fetch(`${this.apiBase}/fires?hours=24`);
            if (!response.ok) {
                console.warn('FIRMS fetch returned', response.status);
                return;
            }
            const data = await response.json();
            this.fires = data.fires || [];
            console.log(`FIRMS: loaded ${this.fires.length} fire detections`);
        } catch (err) {
            console.error('Failed to fetch fire data:', err);
        }
    }

    // ── Rendering ─────────────────────────────────────────────

    /**
     * Render fire points on the markers layer as small circles.
     * Dot radius is proportional to FRP (fire radiative power).
     */
    draw() {
        const markersLayer = this.projection.getLayer('markers');
        // Remove any previous fire points
        markersLayer.selectAll('.fire-point').remove();

        if (!this.visible || this.fires.length === 0) return;

        const proj = this.projection;
        const tooltip = this.tooltip;

        this.fires.forEach(fire => {
            const pos = proj.project(fire.lon, fire.lat);
            if (!pos) return;

            // Radius proportional to sqrt(FRP), clamped between 1.5 and 7
            const r = Math.max(1.5, Math.min(7, Math.sqrt(fire.frp || 1) * 0.5));

            // Color by confidence: high = bright red, nominal = orange-red
            const color = fire.confidence === 'high' ? '#ff2200' : '#ff6b00';
            const glowColor = fire.confidence === 'high' ? 'rgba(255,34,0,0.4)' : 'rgba(255,107,0,0.3)';

            const g = markersLayer.append('g')
                .attr('class', 'fire-point')
                .attr('transform', `translate(${pos[0]}, ${pos[1]})`)
                .style('cursor', 'pointer');

            // Soft glow
            g.append('circle')
                .attr('r', r + 2)
                .style('fill', glowColor)
                .style('stroke', 'none');

            // Core dot
            g.append('circle')
                .attr('r', r)
                .style('fill', color)
                .style('fill-opacity', 0.8)
                .style('stroke', '#ff0000')
                .style('stroke-width', 0.3)
                .style('stroke-opacity', 0.4);

            // Hover interactions
            g.on('mouseenter', function (event) {
                d3.select(this).select('circle:nth-child(2)')
                    .transition().duration(100)
                    .attr('r', r * 1.6)
                    .style('fill-opacity', 1);

                const timeStr = fire.acq_time
                    ? `${fire.acq_time.slice(0, 2)}:${fire.acq_time.slice(2)} UTC`
                    : '';
                const dateStr = fire.acq_date || '';

                tooltip
                    .style('display', 'block')
                    .html(
                        `<b>Active Fire</b><br/>` +
                        `Brightness: ${fire.brightness.toFixed(1)} K<br/>` +
                        `FRP: ${fire.frp.toFixed(1)} MW<br/>` +
                        `Confidence: ${fire.confidence}<br/>` +
                        `${dateStr} ${timeStr}<br/>` +
                        `${Math.abs(fire.lat).toFixed(2)}\u00B0${fire.lat >= 0 ? 'N' : 'S'} ` +
                        `${Math.abs(fire.lon).toFixed(2)}\u00B0${fire.lon >= 0 ? 'E' : 'W'}`
                    );
            })
            .on('mousemove', function (event) {
                tooltip
                    .style('left', (event.pageX + 14) + 'px')
                    .style('top', (event.pageY - 10) + 'px');
            })
            .on('mouseleave', function () {
                d3.select(this).select('circle:nth-child(2)')
                    .transition().duration(150)
                    .attr('r', r)
                    .style('fill-opacity', 0.8);

                tooltip.style('display', 'none');
            });
        });
    }

    /**
     * Redraw all fire points (call after projection change).
     */
    redraw() {
        if (this.visible) {
            this.draw();
        }
    }

    // ── Toggle / lifecycle ────────────────────────────────────

    /**
     * Toggle visibility. Returns new visible state.
     */
    async toggle() {
        this.visible = !this.visible;

        if (this.visible) {
            // Fetch if we have no data yet
            if (this.fires.length === 0) {
                await this.fetchFires();
            }
            this.draw();
            this._startAutoRefresh();
        } else {
            this._clearPoints();
            this._stopAutoRefresh();
        }

        return this.visible;
    }

    /**
     * Explicitly show fires.
     */
    async show() {
        if (!this.visible) {
            await this.toggle();
        }
    }

    /**
     * Explicitly hide fires.
     */
    hide() {
        if (this.visible) {
            this.toggle();
        }
    }

    _clearPoints() {
        const markersLayer = this.projection.getLayer('markers');
        markersLayer.selectAll('.fire-point').remove();
        if (this.tooltip) this.tooltip.style('display', 'none');
    }

    // ── Auto-refresh (every 15 minutes) ──────────────────────

    _startAutoRefresh() {
        this._stopAutoRefresh();
        this.refreshTimer = setInterval(async () => {
            if (!this.visible) return;
            await this.fetchFires();
            this.draw();
        }, 15 * 60 * 1000);
    }

    _stopAutoRefresh() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    }

    /**
     * Clean up (call if the overlay is destroyed).
     */
    destroy() {
        this._stopAutoRefresh();
        this._clearPoints();
        if (this.tooltip) {
            this.tooltip.remove();
            this.tooltip = null;
        }
    }
}

window.FireOverlay = FireOverlay;
