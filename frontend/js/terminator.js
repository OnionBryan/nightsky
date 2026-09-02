/**
 * Day/Night Terminator - Shows sunlit vs dark side of Earth
 *
 * The terminator is a great circle 90° from the subsolar point.
 * On our polar azimuthal projection, this renders as a curve that
 * shifts with Earth's rotation and the seasons.
 */

class Terminator {
    constructor(projection) {
        this.projection = projection;
        this.path = projection.getPath();
        this.terminatorLayer = null;
        this.sunMarkerLayer = null;
        this.showTerminator = true;
        this.showSunMarker = true;

        // Cache for performance (only recalculate every second)
        this.lastUpdateTime = 0;
        this.cachedDeclination = 0;
        this.cachedHourAngle = 0;

        this.init();
    }

    init() {
        // Create terminator layer - should be above ocean, below land/markers
        // Insert it after the base layer
        const svg = this.projection.g;
        const baseLayer = this.projection.layers.base;

        // Insert terminator layer after base (so it's above ocean but below land)
        this.terminatorLayer = svg.insert('g', '.layer-land')
            .attr('class', 'layer-terminator');

        // Sun marker layer (on top of markers)
        this.sunMarkerLayer = svg.append('g')
            .attr('class', 'layer-sun');
    }

    /**
     * Calculate the subsolar point from current UTC time.
     * Returns { longitude, latitude } where the sun is directly overhead.
     *
     * Uses a low-order solar ephemeris (mean anomaly + equation of center)
     * including equation-of-time effects. Typical error vs high-precision
     * ephemerides: ~0.2–0.5° (vs ~1–4° for a pure sinusoidal model that
     * ignores EoT). Adequate for day/night terminator visualization.
     */
    getSolarPosition(date) {
        const now = date || new Date();

        // Julian centuries from J2000.0 (UT)
        const jd = now.getTime() / 86400000 + 2440587.5;
        const n = jd - 2451545.0; // days since J2000.0

        // Mean longitude and anomaly (deg)
        const L = (280.460 + 0.9856474 * n) % 360;
        const gDeg = (357.528 + 0.9856003 * n) % 360;
        const g = gDeg * Math.PI / 180;

        // Ecliptic longitude (equation of center)
        const lambdaDeg = L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g);
        const lambda = lambdaDeg * Math.PI / 180;

        // Obliquity of the ecliptic
        const eps = (23.439 - 0.0000004 * n) * Math.PI / 180;

        // Declination
        const sinDec = Math.sin(eps) * Math.sin(lambda);
        const declination = Math.asin(Math.max(-1, Math.min(1, sinDec))) * 180 / Math.PI;

        // Right ascension (radians → hours)
        const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
        const raHours = ((ra * 180 / Math.PI) / 15 + 24) % 24;

        // GMST (hours) — IAU-style linear term sufficient here
        const gmstHours = (18.697374558 + 24.06570982441908 * n) % 24;

        // Subsolar longitude: where hour angle is zero
        let longitude = (raHours - gmstHours) * 15;
        longitude = ((longitude + 180) % 360) - 180;

        return {
            longitude: longitude,
            latitude: declination
        };
    }

    /**
     * Update the terminator display
     */
    update(date) {
        const now = date || new Date();
        const currentTime = now.getTime();

        // Only recalculate solar position every second for performance
        if (currentTime - this.lastUpdateTime >= 1000) {
            this.lastUpdateTime = currentTime;
            const sunPos = this.getSolarPosition(now);
            this.cachedDeclination = sunPos.latitude;
            this.cachedHourAngle = sunPos.longitude;
        }

        this.drawTerminator();
        this.drawSunMarker();
    }

    /**
     * Draw the day/night overlay
     * Night side is a circle of radius 90° centered on the anti-solar point
     * Day side gets a subtle bright overlay for contrast
     */
    drawTerminator() {
        this.terminatorLayer.selectAll('.terminator-night, .terminator-day').remove();

        if (!this.showTerminator) return;

        // Night side center is opposite to the sun
        // Anti-solar point: (longitude + 180, -latitude)
        const antiSolarLon = this.cachedHourAngle + 180;
        const antiSolarLat = -this.cachedDeclination;

        // Day side - subtle bright overlay centered on subsolar point
        const dayPath = d3.geoCircle()
            .center([this.cachedHourAngle, this.cachedDeclination])
            .radius(90)
            .precision(0.5)();

        this.terminatorLayer.append('path')
            .datum(dayPath)
            .attr('class', 'terminator-day')
            .attr('d', this.path)
            .style('fill', 'rgba(255, 250, 220, 0.12)')
            .style('stroke', 'none')
            .style('pointer-events', 'none');

        // Night side - darker overlay
        const nightPath = d3.geoCircle()
            .center([antiSolarLon, antiSolarLat])
            .radius(90)
            .precision(0.5)();

        this.terminatorLayer.append('path')
            .datum(nightPath)
            .attr('class', 'terminator-night')
            .attr('d', this.path)
            .style('fill', 'rgba(0, 0, 20, 0.55)')
            .style('stroke', 'rgba(255, 180, 50, 0.8)')
            .style('stroke-width', 2)
            .style('pointer-events', 'none');
    }

    /**
     * Draw the sun marker at subsolar point
     */
    drawSunMarker() {
        this.sunMarkerLayer.selectAll('.sun-marker-group').remove();

        if (!this.showSunMarker || !this.showTerminator) return;

        const pos = this.projection.project(this.cachedHourAngle, this.cachedDeclination);
        if (!pos) return;

        const group = this.sunMarkerLayer.append('g')
            .attr('class', 'sun-marker-group')
            .attr('transform', `translate(${pos[0]}, ${pos[1]})`);

        // Outer glow
        group.append('circle')
            .attr('r', 15)
            .style('fill', 'rgba(255, 220, 0, 0.2)')
            .style('filter', 'blur(3px)');

        // Inner sun circle
        group.append('circle')
            .attr('class', 'sun-marker')
            .attr('r', 8)
            .style('fill', '#ffdd44')
            .style('stroke', '#ffaa00')
            .style('stroke-width', 2);

        // Sun rays (small lines radiating outward)
        const rayCount = 8;
        for (let i = 0; i < rayCount; i++) {
            const angle = (i / rayCount) * 2 * Math.PI;
            const innerR = 10;
            const outerR = 14;

            group.append('line')
                .attr('x1', Math.cos(angle) * innerR)
                .attr('y1', Math.sin(angle) * innerR)
                .attr('x2', Math.cos(angle) * outerR)
                .attr('y2', Math.sin(angle) * outerR)
                .style('stroke', '#ffaa00')
                .style('stroke-width', 2)
                .style('stroke-linecap', 'round');
        }
    }

    /**
     * Get current solar info for display
     */
    getSolarInfo() {
        const sunPos = this.getSolarPosition();
        return {
            subsolarLat: this.cachedDeclination,
            subsolarLon: this.cachedHourAngle,
            declination: this.cachedDeclination
        };
    }

    toggle() {
        this.showTerminator = !this.showTerminator;
        if (!this.showTerminator) {
            this.terminatorLayer.selectAll('.terminator-night').remove();
            this.sunMarkerLayer.selectAll('.sun-marker-group').remove();
        }
        return this.showTerminator;
    }

    toggleSunMarker() {
        this.showSunMarker = !this.showSunMarker;
        return this.showSunMarker;
    }

    setVisible(visible) {
        this.showTerminator = visible;
        if (!visible) {
            this.terminatorLayer.selectAll('.terminator-night').remove();
            this.sunMarkerLayer.selectAll('.sun-marker-group').remove();
        }
    }

    clear() {
        this.terminatorLayer.selectAll('*').remove();
        this.sunMarkerLayer.selectAll('*').remove();
    }
}

window.Terminator = Terminator;
