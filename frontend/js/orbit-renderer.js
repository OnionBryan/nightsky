/**
 * Orbit Renderer - Draws satellite paths on the stationary disk
 *
 * The satellite traces curved paths that:
 *   - Approach center (North Pole) at ~81°N
 *   - Curve toward edge (Antarctica) at ~81°S
 *   - Never touch center or edge exactly
 *   - Create sinusoidal patterns across the disk
 */

class OrbitRenderer {
    constructor(projection) {
        this.projection = projection;
        this.trackLayer = projection.getLayer('track');
        this.path = projection.getPath();
        this.trackHistory = [];
    }

    /**
     * Draw ground track as a continuous path
     * Handles the curved nature on the disk projection
     */
    drawGroundTrack(positions, options = {}) {
        const {
            className = 'ground-track',
            stroke = '#00d4ff',
            strokeWidth = 2,
            opacity = 1
        } = options;

        this.trackLayer.selectAll('.' + className).remove();

        if (positions.length < 2) return;

        // Split at longitude discontinuities (antimeridian)
        const segments = this.splitAtDiscontinuities(positions);

        segments.forEach((segment, idx) => {
            if (segment.length < 2) return;

            const lineData = {
                type: 'LineString',
                coordinates: segment.map(p => [p.lon, p.lat])
            };

            this.trackLayer.append('path')
                .datum(lineData)
                .attr('class', className)
                .attr('d', this.path)
                .style('fill', 'none')
                .style('stroke', stroke)
                .style('stroke-width', strokeWidth)
                .style('stroke-opacity', opacity)
                .style('stroke-linecap', 'round')
                .style('stroke-linejoin', 'round');
        });
    }

    /**
     * Draw path with gradient fade (trail effect)
     */
    drawFadingTrail(positions, color = '#00d4ff') {
        this.trackLayer.selectAll('.trail-segment').remove();

        if (positions.length < 2) return;

        const segments = this.splitAtDiscontinuities(positions);

        // Parse hex color to RGB
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);

        segments.forEach(segment => {
            const totalPoints = segment.length;

            for (let i = 0; i < totalPoints - 1; i++) {
                const opacity = 0.2 + (i / totalPoints) * 0.8;

                const lineData = {
                    type: 'LineString',
                    coordinates: [
                        [segment[i].lon, segment[i].lat],
                        [segment[i + 1].lon, segment[i + 1].lat]
                    ]
                };

                this.trackLayer.append('path')
                    .datum(lineData)
                    .attr('class', 'trail-segment')
                    .attr('d', this.path)
                    .style('fill', 'none')
                    .style('stroke', `rgba(${r}, ${g}, ${b}, ${opacity})`)
                    .style('stroke-width', 2)
                    .style('stroke-linecap', 'round');
            }
        });
    }

    /**
     * Split track where longitude jumps > 180° (antimeridian crossing)
     */
    splitAtDiscontinuities(positions) {
        const segments = [];
        let current = [];

        for (let i = 0; i < positions.length; i++) {
            const pos = positions[i];

            if (current.length > 0) {
                const prev = current[current.length - 1];
                const lonDiff = Math.abs(pos.lon - prev.lon);

                if (lonDiff > 180) {
                    segments.push(current);
                    current = [];
                }
            }

            current.push(pos);
        }

        if (current.length > 0) {
            segments.push(current);
        }

        return segments;
    }

    /**
     * Draw future path prediction (dashed)
     */
    drawPrediction(positions, color = '#00d4ff') {
        // Parse hex color to rgba with transparency
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);

        this.drawGroundTrack(positions, {
            className: 'prediction-track',
            stroke: `rgba(${r}, ${g}, ${b}, 0.4)`,
            strokeWidth: 1.5,
            opacity: 1
        });

        // Add dashed style
        this.trackLayer.selectAll('.prediction-track')
            .style('stroke-dasharray', '6, 4');
    }

    /**
     * Add position to history buffer
     */
    addToHistory(position) {
        this.trackHistory.push(position);
        if (this.trackHistory.length > 300) {
            this.trackHistory.shift();
        }
    }

    clearHistory() {
        this.trackHistory = [];
    }

    getHistory() {
        return [...this.trackHistory];
    }

    clearTrails() {
        this.trackLayer.selectAll('.trail-segment, .prediction-track').remove();
    }

    clearTimeTicks() {
        const layer = this.projection.getLayer('labels');
        layer.selectAll('.time-tick').remove();
    }

    clear() {
        this.trackLayer.selectAll('*').remove();
        this.clearTimeTicks();
        this.clearSwathStrip();
    }

    // ─── Geodesic helper functions for swath strip computation ───

    /**
     * Compute forward bearing (initial azimuth) from point 1 to point 2.
     * @returns bearing in radians
     */
    _forwardBearing(lat1, lon1, lat2, lon2) {
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const lat1r = lat1 * Math.PI / 180;
        const lat2r = lat2 * Math.PI / 180;

        const y = Math.sin(dLon) * Math.cos(lat2r);
        const x = Math.cos(lat1r) * Math.sin(lat2r) -
                  Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLon);

        return Math.atan2(y, x);
    }

    /**
     * Compute destination point given start, bearing, and distance.
     * Uses the Vincenty "direct" (great-circle) formula.
     * @returns {lat, lon} in degrees
     */
    _destinationPoint(lat, lon, bearing, distKm) {
        const R = 6371;
        const d = distKm / R;
        const lat1 = lat * Math.PI / 180;
        const lon1 = lon * Math.PI / 180;

        const lat2 = Math.asin(
            Math.sin(lat1) * Math.cos(d) +
            Math.cos(lat1) * Math.sin(d) * Math.cos(bearing)
        );
        const lon2 = lon1 + Math.atan2(
            Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
            Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
        );

        return {
            lat: lat2 * 180 / Math.PI,
            lon: lon2 * 180 / Math.PI
        };
    }

    // ─── Swath Strip ───

    /**
     * Draw the VIIRS (or other sensor) swath as a polygon strip that follows
     * the ground track, rather than a simple geodesic circle at the current
     * position.  The strip extends +-halfWidthKm perpendicular to the velocity
     * vector at every track point.
     *
     * @param {Array} positions - track points [{lat, lon, ...}, ...]
     * @param {number} halfWidthKm - half-swath-width in km (default 1530 for VIIRS)
     * @param {string} color - base colour in hex (default satellite colour)
     */
    drawSwathStrip(positions, halfWidthKm = 1530, color = '#00d4ff') {
        const swathLayer = this.projection.getLayer('swath');
        swathLayer.selectAll('.swath-strip').remove();

        if (!positions || positions.length < 2) return;
        if (halfWidthKm <= 0) return;

        // Split at antimeridian before computing edges
        const segments = this.splitAtDiscontinuities(positions);

        // Parse hex to rgba
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);

        segments.forEach(segment => {
            if (segment.length < 2) return;

            const leftEdge = [];
            const rightEdge = [];

            for (let i = 0; i < segment.length; i++) {
                const p = segment[i];
                let bearing;

                if (i < segment.length - 1) {
                    bearing = this._forwardBearing(
                        p.lat, p.lon,
                        segment[i + 1].lat, segment[i + 1].lon
                    );
                } else {
                    bearing = this._forwardBearing(
                        segment[i - 1].lat, segment[i - 1].lon,
                        p.lat, p.lon
                    );
                }

                const leftB = bearing - Math.PI / 2;
                const rightB = bearing + Math.PI / 2;

                const left = this._destinationPoint(p.lat, p.lon, leftB, halfWidthKm);
                const right = this._destinationPoint(p.lat, p.lon, rightB, halfWidthKm);

                leftEdge.push([left.lon, left.lat]);
                rightEdge.push([right.lon, right.lat]);
            }

            // Form closed polygon: left forward, right reversed
            const reversedRight = rightEdge.slice().reverse();
            const coords = leftEdge.concat(reversedRight);
            coords.push(leftEdge[0]); // close ring

            const polygon = {
                type: 'Polygon',
                coordinates: [coords]
            };

            swathLayer.append('path')
                .datum(polygon)
                .attr('class', 'swath-strip')
                .attr('d', this.path)
                .style('fill', `rgba(${r}, ${g}, ${b}, 0.10)`)
                .style('stroke', `rgba(${r}, ${g}, ${b}, 0.35)`)
                .style('stroke-width', 0.5);
        });
    }

    /**
     * Remove any existing swath strip polygons.
     */
    clearSwathStrip() {
        const swathLayer = this.projection.getLayer('swath');
        swathLayer.selectAll('.swath-strip').remove();
    }

    // ─── Time Tick Marks ───

    /**
     * Draw UTC time labels along the ground track at regular intervals.
     *
     * @param {Array} trackData - positions with time field [{lat, lon, time, ...}]
     * @param {number} intervalMinutes - spacing between ticks (default 10)
     */
    drawTimeTicks(trackData, intervalMinutes = 10) {
        const layer = this.projection.getLayer('labels');
        layer.selectAll('.time-tick').remove();

        if (!trackData || trackData.length < 2) return;

        // ── Select tick positions: points nearest N-minute boundaries ──
        const ticks = [];
        for (const p of trackData) {
            const dt = new Date(p.time);
            const min = dt.getUTCMinutes();
            const sec = dt.getUTCSeconds();

            if (min % intervalMinutes === 0 && sec < 30) {
                const label = `${String(dt.getUTCHours()).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
                if (!ticks.length || ticks[ticks.length - 1].label !== label) {
                    ticks.push({ lat: p.lat, lon: p.lon, time: dt, label });
                }
            }
        }

        if (ticks.length === 0) return;

        // ── Render ticks with overlap avoidance ──
        let lastRenderedPos = null;
        const minDist = 30; // minimum pixel distance between rendered labels

        ticks.forEach((tick, i) => {
            const pos = this.projection.project(tick.lon, tick.lat);
            if (!pos) return;

            // Skip if too close to the previous rendered tick
            if (lastRenderedPos) {
                const dx = pos[0] - lastRenderedPos[0];
                const dy = pos[1] - lastRenderedPos[1];
                const dist = Math.sqrt(dx * dx + dy * dy);
                // Use a larger threshold near the poles where tracks compress
                const threshold = Math.abs(tick.lat) > 75 ? 40 : minDist;
                if (dist < threshold) return;
            }

            // Compute bearing in screen space for perpendicular orientation
            const bearing = this._getScreenBearing(ticks, i);
            const perpAngle = bearing + Math.PI / 2;
            const tickLen = 6;

            const group = layer.append('g')
                .attr('class', 'time-tick')
                .attr('transform', `translate(${pos[0]}, ${pos[1]})`);

            // Perpendicular tick mark
            group.append('line')
                .attr('x1', -Math.cos(perpAngle) * tickLen)
                .attr('y1', -Math.sin(perpAngle) * tickLen)
                .attr('x2', Math.cos(perpAngle) * tickLen)
                .attr('y2', Math.sin(perpAngle) * tickLen)
                .style('stroke', '#778da9')
                .style('stroke-width', 1.5);

            // Time label offset perpendicular to track
            group.append('text')
                .attr('x', Math.cos(perpAngle) * 12)
                .attr('y', Math.sin(perpAngle) * 12)
                .attr('text-anchor', 'middle')
                .attr('dominant-baseline', 'central')
                .style('fill', '#aab8c8')
                .style('font-size', '9px')
                .style('font-family', "'SF Mono', 'Fira Code', monospace")
                .text(tick.label);

            // Tooltip with full timestamp
            group.append('title')
                .text(tick.time.toUTCString());

            lastRenderedPos = pos;
        });
    }

    /**
     * Compute the track bearing in *screen* (projected) coordinates so that
     * tick marks are oriented perpendicular to the visual path on the map.
     * @private
     */
    _getScreenBearing(ticks, index) {
        let prev = null, next = null;

        if (index > 0) {
            prev = this.projection.project(ticks[index - 1].lon, ticks[index - 1].lat);
        }
        if (index < ticks.length - 1) {
            next = this.projection.project(ticks[index + 1].lon, ticks[index + 1].lat);
        }

        if (prev && next) {
            return Math.atan2(next[1] - prev[1], next[0] - prev[0]);
        } else if (next) {
            const cur = this.projection.project(ticks[index].lon, ticks[index].lat);
            return cur ? Math.atan2(next[1] - cur[1], next[0] - cur[0]) : 0;
        } else if (prev) {
            const cur = this.projection.project(ticks[index].lon, ticks[index].lat);
            return cur ? Math.atan2(cur[1] - prev[1], cur[0] - prev[0]) : 0;
        }
        return 0;
    }

    /**
     * Draw ascending/descending equator crossing markers
     * @param {Object} crossings - { ascending_nodes: [...], descending_nodes: [...] }
     *   Each node: { time: "ISO string", longitude: number }
     */
    drawEquatorCrossings(crossings) {
        if (!crossings) return;

        const markersLayer = this.projection.getLayer('markers');
        markersLayer.selectAll('.node-marker').remove();

        const formatTime = (isoStr) => {
            const d = new Date(isoStr);
            return d.toUTCString().slice(17, 22);
        };

        const formatLon = (lon) => {
            const dir = lon >= 0 ? 'E' : 'W';
            return `${Math.abs(lon).toFixed(1)}${dir}`;
        };

        // Ascending nodes: green upward triangles (northbound / daytime ~13:30 LTAN)
        (crossings.ascending_nodes || []).forEach(node => {
            const pos = this.projection.project(node.longitude, 0);
            if (!pos) return;

            const group = markersLayer.append('g')
                .attr('class', 'node-marker ascending')
                .attr('transform', `translate(${pos[0]}, ${pos[1]})`);

            // Upward triangle
            group.append('polygon')
                .attr('points', '0,-8 -6,4 6,4')
                .style('fill', '#4ade80')
                .style('stroke', '#166534')
                .style('stroke-width', 1.5);

            // Time + longitude label
            group.append('text')
                .attr('x', 10)
                .attr('y', 4)
                .style('fill', '#4ade80')
                .style('font-size', '9px')
                .style('font-family', 'monospace')
                .text(`${formatTime(node.time)} ${formatLon(node.longitude)}`);

            // Tooltip
            group.append('title')
                .text(`Ascending Node - Daytime pass (~13:30 LTAN)\n${new Date(node.time).toUTCString()}\nLon: ${node.longitude.toFixed(3)}`);
        });

        // Descending nodes: orange downward triangles (southbound / nighttime ~01:30 LTAN)
        (crossings.descending_nodes || []).forEach(node => {
            const pos = this.projection.project(node.longitude, 0);
            if (!pos) return;

            const group = markersLayer.append('g')
                .attr('class', 'node-marker descending')
                .attr('transform', `translate(${pos[0]}, ${pos[1]})`);

            // Downward triangle
            group.append('polygon')
                .attr('points', '0,8 -6,-4 6,-4')
                .style('fill', '#f97316')
                .style('stroke', '#9a3412')
                .style('stroke-width', 1.5);

            // Time + longitude label
            group.append('text')
                .attr('x', 10)
                .attr('y', 4)
                .style('fill', '#f97316')
                .style('font-size', '9px')
                .style('font-family', 'monospace')
                .text(`${formatTime(node.time)} ${formatLon(node.longitude)}`);

            // Tooltip
            group.append('title')
                .text(`Descending Node - Nighttime pass (~01:30 LTAN)\n${new Date(node.time).toUTCString()}\nLon: ${node.longitude.toFixed(3)}`);
        });
    }
}

window.OrbitRenderer = OrbitRenderer;
