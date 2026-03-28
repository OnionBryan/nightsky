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

    clear() {
        this.trackLayer.selectAll('*').remove();
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
