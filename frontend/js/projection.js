/**
 * D3 Azimuthal Equidistant Projection - North Pole Centered
 *
 * Enhanced with:
 *   - Zoom and pan
 *   - Country borders and labels
 *   - Hover interactions
 *   - Better graticule
 */

class PolarProjection {
    constructor(container, width, height) {
        this.container = container;
        this.width = width;
        this.height = height;
        this.svg = null;
        this.g = null;  // Main group for zoom/pan
        this.projection = null;
        this.path = null;
        this.zoom = null;
        this.currentTransform = d3.zoomIdentity;

        this.layers = {
            base: null,
            land: null,
            borders: null,
            coverage: null,
            track: null,
            swath: null,
            markers: null,
            labels: null
        };

        this.init();
    }

    init() {
        // Create SVG
        this.svg = d3.select(this.container)
            .append('svg')
            .attr('id', 'map-svg')
            .attr('viewBox', `0 0 ${this.width} ${this.height}`)
            .attr('preserveAspectRatio', 'xMidYMid meet')
            .style('cursor', 'grab');

        // Defs for markers and gradients
        const defs = this.svg.append('defs');

        // Arrowhead marker
        defs.append('marker')
            .attr('id', 'arrowhead')
            .attr('viewBox', '0 0 10 10')
            .attr('refX', 9)
            .attr('refY', 5)
            .attr('markerWidth', 6)
            .attr('markerHeight', 6)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M 0 0 L 10 5 L 0 10 z')
            .attr('fill', '#ffd93d');

        // Glow filter for satellite
        const glow = defs.append('filter')
            .attr('id', 'glow')
            .attr('x', '-50%')
            .attr('y', '-50%')
            .attr('width', '200%')
            .attr('height', '200%');
        glow.append('feGaussianBlur')
            .attr('stdDeviation', '3')
            .attr('result', 'coloredBlur');
        const glowMerge = glow.append('feMerge');
        glowMerge.append('feMergeNode').attr('in', 'coloredBlur');
        glowMerge.append('feMergeNode').attr('in', 'SourceGraphic');

        // Main group for zoom/pan
        this.g = this.svg.append('g').attr('class', 'map-group');

        // Projection
        this.projection = d3.geoAzimuthalEquidistant()
            .rotate([0, -90])
            .scale(this.width / 2.3)
            .translate([this.width / 2, this.height / 2])
            .clipAngle(180);

        this.path = d3.geoPath().projection(this.projection);

        // Setup zoom behavior
        this.setupZoom();

        // Create layers
        this.layers.base = this.g.append('g').attr('class', 'layer-base');
        this.layers.land = this.g.append('g').attr('class', 'layer-land');
        this.layers.borders = this.g.append('g').attr('class', 'layer-borders');
        this.layers.coverage = this.g.append('g').attr('class', 'layer-coverage');
        this.layers.track = this.g.append('g').attr('class', 'layer-track');
        this.layers.swath = this.g.append('g').attr('class', 'layer-swath');
        this.layers.markers = this.g.append('g').attr('class', 'layer-markers');
        this.layers.labels = this.g.append('g').attr('class', 'layer-labels');

        this.drawBase();
    }

    setupZoom() {
        this.zoom = d3.zoom()
            .scaleExtent([0.5, 8])
            .on('zoom', (event) => {
                this.currentTransform = event.transform;
                this.g.attr('transform', event.transform);
            })
            .on('start', () => {
                this.svg.style('cursor', 'grabbing');
            })
            .on('end', () => {
                this.svg.style('cursor', 'grab');
            });

        this.svg.call(this.zoom);

        // Double-click to reset zoom
        this.svg.on('dblclick.zoom', () => {
            this.svg.transition()
                .duration(500)
                .call(this.zoom.transform, d3.zoomIdentity);
        });
    }

    drawBase() {
        // Ocean background
        this.layers.base.append('path')
            .datum({ type: 'Sphere' })
            .attr('class', 'sphere')
            .attr('d', this.path);

        // Latitude rings every 15°
        const latitudes = [-75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75];
        latitudes.forEach(lat => {
            const ring = d3.geoCircle().center([0, 90]).radius(90 - lat)();
            this.layers.base.append('path')
                .datum(ring)
                .attr('class', 'graticule')
                .attr('d', this.path);
        });

        // Longitude lines every 30°
        for (let lon = 0; lon < 360; lon += 30) {
            const line = {
                type: 'LineString',
                coordinates: Array.from({ length: 181 }, (_, i) => [lon, 90 - i])
            };
            this.layers.base.append('path')
                .datum(line)
                .attr('class', 'graticule')
                .attr('d', this.path);
        }

        // Tropics and polar circles
        const specialLatitudes = [
            { lat: 66.5, name: 'Arctic Circle' },
            { lat: 23.5, name: 'Tropic of Cancer' },
            { lat: -23.5, name: 'Tropic of Capricorn' },
            { lat: -66.5, name: 'Antarctic Circle' }
        ];

        specialLatitudes.forEach(({ lat }) => {
            const ring = d3.geoCircle().center([0, 90]).radius(90 - lat)();
            this.layers.base.append('path')
                .datum(ring)
                .attr('d', this.path)
                .style('fill', 'none')
                .style('stroke', 'rgba(65, 90, 119, 0.4)')
                .style('stroke-width', '0.75px')
                .style('stroke-dasharray', '4,4');
        });

        // Equator (emphasized)
        const equator = d3.geoCircle().center([0, 90]).radius(90)();
        this.layers.base.append('path')
            .datum(equator)
            .attr('d', this.path)
            .style('fill', 'none')
            .style('stroke', 'rgba(65, 90, 119, 0.7)')
            .style('stroke-width', '1.5px');

        // North Pole marker
        const polePos = this.projection([0, 90]);
        this.layers.base.append('circle')
            .attr('cx', polePos[0])
            .attr('cy', polePos[1])
            .attr('r', 4)
            .style('fill', '#415a77')
            .style('stroke', '#778da9')
            .style('stroke-width', 1);

        this.layers.base.append('text')
            .attr('x', polePos[0])
            .attr('y', polePos[1] - 12)
            .attr('text-anchor', 'middle')
            .style('fill', '#778da9')
            .style('font-size', '10px')
            .text('90°N');
    }

    async loadLandmasses(topoJsonUrl) {
        try {
            const response = await fetch(topoJsonUrl);
            const topology = await response.json();

            // Land masses
            const land = topojson.feature(topology, topology.objects.land);

            this.layers.land.append('path')
                .datum(land)
                .attr('class', 'land')
                .attr('d', this.path);

            // Try to load countries for borders (separate file)
            await this.loadCountries();

            return true;
        } catch (error) {
            console.error('Failed to load landmasses:', error);
            return false;
        }
    }

    async loadCountries() {
        try {
            const response = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json');
            const topology = await response.json();

            const countries = topojson.feature(topology, topology.objects.countries);

            // Country fills with hover
            this.layers.land.selectAll('.country')
                .data(countries.features)
                .enter()
                .append('path')
                .attr('class', 'country')
                .attr('d', this.path)
                .style('fill', '#1b263b')
                .style('stroke', '#415a77')
                .style('stroke-width', '0.3px')
                .on('mouseenter', function(event, d) {
                    d3.select(this)
                        .style('fill', '#2a3f5f')
                        .style('stroke-width', '0.8px');
                })
                .on('mouseleave', function() {
                    d3.select(this)
                        .style('fill', '#1b263b')
                        .style('stroke-width', '0.3px');
                });

        } catch (error) {
            console.log('Countries data not available, using basic land');
        }
    }

    project(lon, lat) {
        return this.projection([lon, lat]);
    }

    createGeodesicCircle(centerLon, centerLat, radiusKm) {
        const earthRadius = 6371;
        const angularRadius = radiusKm / earthRadius * (180 / Math.PI);
        return d3.geoCircle()
            .center([centerLon, centerLat])
            .radius(angularRadius)
            .precision(2)();
    }

    getPath() {
        return this.path;
    }

    getLayer(name) {
        return this.layers[name];
    }

    clearLayer(name) {
        if (this.layers[name]) {
            this.layers[name].selectAll('*').remove();
        }
    }

    // Zoom controls
    zoomIn() {
        this.svg.transition().duration(300).call(this.zoom.scaleBy, 1.5);
    }

    zoomOut() {
        this.svg.transition().duration(300).call(this.zoom.scaleBy, 0.67);
    }

    resetZoom() {
        this.svg.transition().duration(500).call(this.zoom.transform, d3.zoomIdentity);
    }

    // Get coordinates from screen position using D3's built-in invert
    invert(screenX, screenY) {
        // Account for zoom transform
        const [x, y] = this.currentTransform.invert([screenX, screenY]);

        // Use D3's projection invert - it handles the azimuthal equidistant math
        const coords = this.projection.invert([x, y]);

        // Check for valid result
        if (!coords || !isFinite(coords[0]) || !isFinite(coords[1])) {
            return null;
        }

        let [lon, lat] = coords;

        // Normalize longitude to -180 to 180
        while (lon > 180) lon -= 360;
        while (lon < -180) lon += 360;

        return [lon, lat];
    }
}

window.PolarProjection = PolarProjection;
