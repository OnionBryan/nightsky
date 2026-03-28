/**
 * Spotlight - VIIRS swath and satellite marker with interactions
 */

class Spotlight {
    constructor(projection) {
        this.projection = projection;
        this.swathLayer = projection.getLayer('swath');
        this.markerLayer = projection.getLayer('markers');
        this.path = projection.getPath();

        this.swathRadiusKm = 1530;
        this.showSwath = true;
        this.showVelocity = true;
        this.satelliteColor = '#ff6b6b';
        this.swathColor = 'rgba(0, 212, 255, 0.12)';
        this.swathStroke = 'rgba(0, 212, 255, 0.4)';

        this.onSatelliteClick = null;
        this.onSwathHover = null;
    }

    setColor(color) {
        this.satelliteColor = color;
        // Derive swath color from satellite color with transparency
        this.swathColor = this.hexToRgba(color, 0.12);
        this.swathStroke = this.hexToRgba(color, 0.4);
    }

    hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    drawSwath(lon, lat) {
        this.swathLayer.selectAll('.viirs-swath').remove();

        if (!this.showSwath) return;

        const swathCircle = this.projection.createGeodesicCircle(lon, lat, this.swathRadiusKm);
        const fillColor = this.swathColor;
        const strokeColor = this.swathStroke;
        const fillHover = this.hexToRgba(this.satelliteColor, 0.2);
        const strokeHover = this.hexToRgba(this.satelliteColor, 0.6);

        this.swathLayer.append('path')
            .datum(swathCircle)
            .attr('class', 'viirs-swath')
            .attr('d', this.path)
            .style('fill', fillColor)
            .style('stroke', strokeColor)
            .style('stroke-width', 1.5)
            .style('stroke-dasharray', '6, 3')
            .on('mouseenter', () => {
                if (this.onSwathHover) this.onSwathHover(true);
                d3.select('.viirs-swath')
                    .style('fill', fillHover)
                    .style('stroke', strokeHover);
            })
            .on('mouseleave', () => {
                if (this.onSwathHover) this.onSwathHover(false);
                d3.select('.viirs-swath')
                    .style('fill', fillColor)
                    .style('stroke', strokeColor);
            });
    }

    drawSatellite(lon, lat, data = {}) {
        this.markerLayer.selectAll('.satellite-group').remove();

        const pos = this.projection.project(lon, lat);
        if (!pos) return;

        const color = this.satelliteColor;
        const pulseColor = this.hexToRgba(color, 0.5);
        const glowColor = this.hexToRgba(color, 0.2);

        const group = this.markerLayer.append('g')
            .attr('class', 'satellite-group')
            .attr('transform', `translate(${pos[0]}, ${pos[1]})`)
            .style('cursor', 'pointer');

        // Outer pulse rings
        for (let i = 0; i < 3; i++) {
            group.append('circle')
                .attr('class', 'satellite-pulse')
                .attr('r', 8)
                .style('fill', 'none')
                .style('stroke', pulseColor)
                .style('stroke-width', 2)
                .style('animation', `pulse 2s ease-out infinite ${i * 0.5}s`);
        }

        // Glow circle
        group.append('circle')
            .attr('r', 12)
            .style('fill', glowColor)
            .style('filter', 'url(#glow)');

        // Main satellite marker
        group.append('circle')
            .attr('class', 'satellite-marker')
            .attr('r', 7)
            .style('fill', color)
            .style('stroke', '#fff')
            .style('stroke-width', 2)
            .style('filter', 'url(#glow)');

        // Click handler
        group.on('click', () => {
            if (this.onSatelliteClick) {
                this.onSatelliteClick(data);
            }
        });

        // Hover effect
        group.on('mouseenter', function() {
            d3.select(this).select('.satellite-marker')
                .transition().duration(150)
                .attr('r', 9);
        }).on('mouseleave', function() {
            d3.select(this).select('.satellite-marker')
                .transition().duration(150)
                .attr('r', 7);
        });
    }

    drawVelocityVector(lon, lat, nextLon, nextLat) {
        this.markerLayer.selectAll('.velocity-vector').remove();

        if (!this.showVelocity) return;

        const pos1 = this.projection.project(lon, lat);
        const pos2 = this.projection.project(nextLon, nextLat);

        if (!pos1 || !pos2) return;

        const dx = pos2[0] - pos1[0];
        const dy = pos2[1] - pos1[1];
        const len = Math.sqrt(dx * dx + dy * dy);

        if (len < 1) return;

        const scale = 35 / len;
        const endX = pos1[0] + dx * scale;
        const endY = pos1[1] + dy * scale;

        this.markerLayer.append('line')
            .attr('class', 'velocity-vector')
            .attr('x1', pos1[0])
            .attr('y1', pos1[1])
            .attr('x2', endX)
            .attr('y2', endY)
            .style('stroke', '#ffd93d')
            .style('stroke-width', 2.5)
            .style('stroke-linecap', 'round')
            .attr('marker-end', 'url(#arrowhead)');
    }

    update(currentPos, nextPos = null, data = {}) {
        this.drawSwath(currentPos.lon, currentPos.lat);
        this.drawSatellite(currentPos.lon, currentPos.lat, data);

        if (nextPos && this.showVelocity) {
            this.drawVelocityVector(
                currentPos.lon, currentPos.lat,
                nextPos.lon, nextPos.lat
            );
        }
    }

    toggleSwath() {
        this.showSwath = !this.showSwath;
        return this.showSwath;
    }

    toggleVelocity() {
        this.showVelocity = !this.showVelocity;
        return this.showVelocity;
    }

    clear() {
        this.swathLayer.selectAll('*').remove();
        this.markerLayer.selectAll('.satellite-group, .velocity-vector').remove();
    }
}

window.Spotlight = Spotlight;
