/**
 * Globe3D - 3D WebGL Earth visualization using globe.gl
 * Shows satellite position at altitude, ground track, VIIRS swath, day/night
 */

class Globe3D {
    constructor(containerId) {
        this.containerId = containerId;
        this.globe = null;
        this._initialized = false;
    }

    init() {
        if (this._initialized) return;
        if (typeof Globe === 'undefined') {
            console.error('Globe3D: globe.gl not loaded');
            return;
        }

        const container = document.getElementById(this.containerId);
        if (!container) return;

        this.globe = Globe()(container)
            .globeImageUrl('//unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
            .backgroundImageUrl('//unpkg.com/three-globe/example/img/night-sky.png')
            .atmosphereColor('#00d4ff')
            .atmosphereAltitude(0.15)
            // Satellite position points
            .pointsData([])
            .pointLat(d => d.lat)
            .pointLng(d => d.lon)
            .pointAltitude(d => (d.alt || 824) / 6371)
            .pointColor(d => d.color)
            .pointRadius(0.5)
            .pointLabel(d =>
                `<div style="color:${d.color};font-weight:bold;font-size:13px">${d.name}</div>` +
                `<div style="color:#aaa;font-size:11px">${d.lat.toFixed(2)}° ${d.lat >= 0 ? 'N' : 'S'}, ${Math.abs(d.lon).toFixed(2)}° ${d.lon >= 0 ? 'E' : 'W'}</div>` +
                `<div style="color:#aaa;font-size:11px">${(d.alt || 824).toFixed(0)} km altitude</div>`
            )
            // Ground track paths (past + future)
            .pathsData([])
            .pathPoints(d => d.points)
            .pathPointLat(p => p.lat)
            .pathPointLng(p => p.lon)
            .pathPointAlt(p => (p.alt || 824) / 6371)
            .pathColor(d => d.color)
            .pathStroke(1.5)
            .pathDashLength(d => d.dashed ? 0.5 : 1)
            .pathDashGap(d => d.dashed ? 0.3 : 0)
            .pathDashAnimateTime(() => 0)
            // VIIRS swath polygon
            .polygonsData([])
            .polygonGeoJsonGeometry(d => d.geometry)
            .polygonCapColor(() => 'rgba(0, 212, 255, 0.10)')
            .polygonSideColor(() => 'transparent')
            .polygonStrokeColor(() => 'rgba(0, 212, 255, 0.5)')
            .polygonAltitude(0.001);

        // Start with polar top-down view (matches the 2D azimuthal view)
        this.globe.pointOfView({ lat: 90, lng: 0, altitude: 2.0 });

        this._initialized = true;
    }

    /**
     * Compute a geodesic circle ring (for VIIRS swath footprint).
     * Returns [[lon, lat], ...] in GeoJSON coordinate order.
     */
    _geodesicCircle(lat0, lon0, radiusKm, steps = 72) {
        const R = 6371;
        const r = radiusKm / R;  // angular radius (radians)
        const lat0r = lat0 * Math.PI / 180;
        const lon0r = lon0 * Math.PI / 180;
        const ring = [];

        for (let i = 0; i <= steps; i++) {
            const bearing = (i / steps) * 2 * Math.PI;
            const latR = Math.asin(
                Math.sin(lat0r) * Math.cos(r) +
                Math.cos(lat0r) * Math.sin(r) * Math.cos(bearing)
            );
            const lonR = lon0r + Math.atan2(
                Math.sin(bearing) * Math.sin(r) * Math.cos(lat0r),
                Math.cos(r) - Math.sin(lat0r) * Math.sin(latR)
            );
            ring.push([lonR * 180 / Math.PI, latR * 180 / Math.PI]);
        }
        return ring;
    }

    /** Update single satellite marker. */
    updateSatellite(pos, color, name) {
        if (!this.globe) return;
        this.globe.pointsData([{
            lat: pos.latitude,
            lon: pos.longitude,
            alt: pos.altitude_km,
            color: color || '#ff6b6b',
            name: name || 'Satellite'
        }]);
    }

    /** Update all constellation satellites at once. */
    updateConstellation(satellites) {
        if (!this.globe) return;
        this.globe.pointsData(satellites.map(s => ({
            lat: s.latitude,
            lon: s.longitude,
            alt: s.altitude_km,
            color: s.color,
            name: s.name
        })));
    }

    /**
     * Update ground track.
     * @param {Array} past  - [{lat, lon, alt}, ...] past positions
     * @param {Array} future - [{lat, lon, alt}, ...] future positions
     * @param {string} color - hex color
     */
    updateTrack(past, future, color) {
        if (!this.globe) return;
        const tracks = [];
        if (past && past.length > 1) {
            tracks.push({ points: past, color: color || '#ff6b6b', dashed: false });
        }
        if (future && future.length > 1) {
            // Semi-transparent for future prediction
            const fColor = (color || '#ff6b6b').replace('#', '');
            const r = parseInt(fColor.slice(0, 2), 16);
            const g = parseInt(fColor.slice(2, 4), 16);
            const b = parseInt(fColor.slice(4, 6), 16);
            tracks.push({ points: future, color: `rgba(${r},${g},${b},0.5)`, dashed: true });
        }
        this.globe.pathsData(tracks);
    }

    /** Update VIIRS swath circle at given lat/lon center. */
    updateSwath(lat, lon) {
        if (!this.globe) return;
        const ring = this._geodesicCircle(lat, lon, 1530);
        this.globe.polygonsData([{
            geometry: {
                type: 'Polygon',
                coordinates: [ring]
            }
        }]);
    }

    /** Show the globe container. */
    show() {
        const el = document.getElementById(this.containerId);
        if (el) el.style.display = '';
    }

    /** Hide the globe container. */
    hide() {
        const el = document.getElementById(this.containerId);
        if (el) el.style.display = 'none';
    }

    /** Resize globe to fit container after layout changes. */
    resize() {
        if (!this.globe) return;
        const el = document.getElementById(this.containerId);
        if (el) {
            this.globe.width(el.clientWidth).height(el.clientHeight);
        }
    }
}

window.Globe3D = Globe3D;
