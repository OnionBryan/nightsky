/**
 * Coverage Heatmap - Canvas-based grid overlay showing pass counts
 *
 * Fetches precomputed grid data from /api/coverage-heatmap and renders
 * colored rectangles on a canvas element that sits under the SVG map.
 * Each cell is colored by how many satellite swath passes cover it.
 *
 * Color scale:
 *   1 pass      -> dark blue
 *   2-3 passes  -> cyan
 *   4-6 passes  -> yellow
 *   7+ passes   -> red
 */

class CoverageHeatmap {
    constructor(projection) {
        this.projection = projection;
        this.canvas = null;
        this.ctx = null;
        this.data = null;       // raw API response
        this.visible = false;
        this._createCanvas();
    }

    /* ---- setup ---- */

    _createCanvas() {
        const container = this.projection.container;
        const el = container instanceof HTMLElement
            ? container
            : document.querySelector(container);

        this.canvas = document.createElement('canvas');
        this.canvas.id = 'heatmap-canvas';
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.display = 'none';
        // Insert before SVG so the heatmap sits beneath map elements
        const svg = el.querySelector('svg');
        if (svg) {
            el.insertBefore(this.canvas, svg);
        } else {
            el.appendChild(this.canvas);
        }
        this.ctx = this.canvas.getContext('2d');
    }

    /* ---- color mapping ---- */

    _passColor(passes, maxPasses) {
        // Stepped palette: dark blue -> cyan -> yellow -> red
        if (passes <= 0) return null;

        const t = Math.min(passes / Math.max(maxPasses, 1), 1.0);

        if (passes === 1) {
            return 'rgba(0, 80, 160, 0.40)';
        } else if (passes <= 3) {
            return 'rgba(0, 180, 220, 0.45)';
        } else if (passes <= 6) {
            return 'rgba(220, 200, 40, 0.50)';
        } else {
            // 7+ : blend toward red as count climbs
            const redness = Math.min((passes - 6) / Math.max(maxPasses - 6, 1), 1.0);
            const r = Math.round(200 + 55 * redness);
            const g = Math.round(60 * (1 - redness));
            const b = Math.round(30 * (1 - redness));
            return `rgba(${r}, ${g}, ${b}, 0.55)`;
        }
    }

    /* ---- data fetching ---- */

    async fetch(satellite = 'noaa21', hours = 24, gridSize = 2) {
        const url = `${API_BASE}/coverage-heatmap?satellite=${satellite}&hours=${hours}&grid=${gridSize}`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Heatmap fetch failed: ${resp.status}`);
        this.data = await resp.json();
        return this.data;
    }

    /* ---- rendering ---- */

    render() {
        if (!this.data || !this.data.cells || !this.ctx) return;

        const proj = this.projection;
        const w = proj.width;
        const h = proj.height;
        const dpr = window.devicePixelRatio || 1;

        // Size canvas to match SVG viewBox (times device pixel ratio for sharpness)
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Apply the same zoom transform the SVG uses
        const t = proj.currentTransform;
        this.ctx.clearRect(0, 0, w, h);
        this.ctx.save();
        this.ctx.translate(t.x, t.y);
        this.ctx.scale(t.k, t.k);

        const gs = this.data.grid_size;
        const maxPasses = this.data.max_passes;
        const pathGen = d3.geoPath().projection(proj.projection).context(this.ctx);

        for (const cell of this.data.cells) {
            const color = this._passColor(cell.passes, maxPasses);
            if (!color) continue;

            const lat0 = cell.lat - gs / 2;
            const lat1 = cell.lat + gs / 2;
            const lon0 = cell.lon - gs / 2;
            const lon1 = cell.lon + gs / 2;

            const cellGeo = {
                type: 'Polygon',
                coordinates: [[
                    [lon0, lat0], [lon1, lat0], [lon1, lat1], [lon0, lat1], [lon0, lat0]
                ]]
            };

            this.ctx.beginPath();
            pathGen(cellGeo);
            this.ctx.fillStyle = color;
            this.ctx.fill();
        }

        this.ctx.restore();
    }

    /* ---- visibility ---- */

    show() {
        this.visible = true;
        if (this.canvas) this.canvas.style.display = '';
    }

    hide() {
        this.visible = false;
        if (this.canvas) this.canvas.style.display = 'none';
    }

    clear() {
        if (this.ctx && this.canvas) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    /* ---- legend (drawn into the SVG coverage layer) ---- */

    drawLegend(maxPasses) {
        const layer = this.projection.getLayer('coverage');
        layer.selectAll('.heatmap-legend').remove();

        const legendG = layer.append('g')
            .attr('class', 'heatmap-legend')
            .attr('transform', `translate(${this.projection.width - 220}, ${this.projection.height - 80})`);

        // Background
        legendG.append('rect')
            .attr('width', 200).attr('height', 60)
            .attr('rx', 6)
            .style('fill', 'rgba(13, 27, 42, 0.85)')
            .style('stroke', 'rgba(65, 90, 119, 0.5)')
            .style('stroke-width', '1px');

        // Title
        legendG.append('text')
            .attr('x', 100).attr('y', 14)
            .attr('text-anchor', 'middle')
            .style('fill', '#e0e1dd').style('font-size', '10px')
            .text('Passes in 24h');

        // Color stops
        const stops = [
            { label: '1', color: 'rgba(0, 80, 160, 0.8)' },
            { label: '2-3', color: 'rgba(0, 180, 220, 0.8)' },
            { label: '4-6', color: 'rgba(220, 200, 40, 0.8)' },
            { label: '7+', color: 'rgba(220, 40, 30, 0.8)' }
        ];
        const bw = 40;
        const bx0 = 10;
        stops.forEach((s, i) => {
            legendG.append('rect')
                .attr('x', bx0 + i * (bw + 4)).attr('y', 22)
                .attr('width', bw).attr('height', 14)
                .attr('rx', 2)
                .style('fill', s.color);
            legendG.append('text')
                .attr('x', bx0 + i * (bw + 4) + bw / 2).attr('y', 50)
                .attr('text-anchor', 'middle')
                .style('fill', '#778da9').style('font-size', '9px')
                .text(s.label);
        });
    }

    removeLegend() {
        const layer = this.projection.getLayer('coverage');
        if (layer) layer.selectAll('.heatmap-legend').remove();
    }
}

window.CoverageHeatmap = CoverageHeatmap;
