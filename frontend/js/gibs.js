/**
 * NASA GIBS (Global Imagery Browse Services) WMTS Overlay
 *
 * Renders satellite imagery tiles from GIBS as a canvas layer beneath the
 * D3 SVG map.  Works with the equirectangular projection (EPSG:4326 tiles
 * align directly); automatically hides in polar mode.
 *
 * GIBS is free, no API key, CORS-enabled.
 *
 * Tile URL template (RESTful):
 *   https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/{Layer}/default/{Date}/{TileMatrixSet}/{z}/{y}/{x}.{ext}
 *
 * EPSG:4326 "250m" tile matrix properties:
 *   - Tile size: 512 x 512 px
 *   - Origin: (-180, 90)  (upper-left)
 *   - Zoom 0: 2 cols x 1 row  (each tile = 180 deg wide x 180 deg tall -> but globe is 360x180,
 *     so two tiles side-by-side cover full width, one row covers full height)
 *
 * Columns at zoom z:  matrixWidth  = 2 * 2^z  (for 250m set: 2, 3, 5, 10, 20, ...)
 * Rows    at zoom z:  matrixHeight = 1 * 2^z  (for 250m set: 1, 2, 3,  5, 10, ...)
 *
 * Actually the 250m set uses non-power-of-2 progression (see research doc).
 * We will use zoom level 2 (5 cols x 3 rows) for a good balance between
 * quality and number of tile fetches for the overview map.
 */

class GIBSOverlay {
    constructor(mapContainer, projection) {
        this.mapContainer = typeof mapContainer === 'string'
            ? document.querySelector(mapContainer)
            : mapContainer;
        this.projection = projection;  // PolarProjection instance

        this.visible = false;
        this.canvas = null;
        this.ctx = null;

        // Layer configuration
        this.layers = {
            'VIIRS_SNPP_CorrectedReflectance_TrueColor': {
                label: 'VIIRS SNPP True Color',
                matrixSet: '250m',
                ext: 'jpg'
            },
            'VIIRS_NOAA20_CorrectedReflectance_TrueColor': {
                label: 'VIIRS NOAA-20 True Color',
                matrixSet: '250m',
                ext: 'jpg'
            },
            'MODIS_Terra_CorrectedReflectance_TrueColor': {
                label: 'MODIS Terra True Color',
                matrixSet: '250m',
                ext: 'jpg'
            },
            'VIIRS_SNPP_DayNightBand_AtSensor_M15': {
                label: 'VIIRS Day/Night Band (M15)',
                matrixSet: '500m',
                ext: 'png'
            }
        };

        this.currentLayer = 'VIIRS_SNPP_CorrectedReflectance_TrueColor';
        this.date = this._todayStr();
        this.opacity = 0.75;

        // Tile matrix definitions for EPSG:4326
        // From the research doc - these are the actual GIBS matrix dimensions
        this._tileMatrices = {
            '250m': [
                { z: 0, cols: 2,  rows: 1,  pixelDeg: 0.3515625 },
                { z: 1, cols: 3,  rows: 2,  pixelDeg: 0.17578125 },
                { z: 2, cols: 5,  rows: 3,  pixelDeg: 0.087890625 },
                { z: 3, cols: 10, rows: 5,  pixelDeg: 0.0439453125 },
                { z: 4, cols: 20, rows: 10, pixelDeg: 0.02197265625 },
                { z: 5, cols: 40, rows: 20, pixelDeg: 0.010986328125 }
            ],
            '500m': [
                { z: 0, cols: 2,  rows: 1,  pixelDeg: 0.3515625 },
                { z: 1, cols: 3,  rows: 2,  pixelDeg: 0.17578125 },
                { z: 2, cols: 5,  rows: 3,  pixelDeg: 0.087890625 },
                { z: 3, cols: 10, rows: 5,  pixelDeg: 0.0439453125 },
                { z: 4, cols: 20, rows: 10, pixelDeg: 0.02197265625 }
            ]
        };

        this.TILE_SIZE = 512;

        // Tile cache to avoid re-fetching
        this._tileCache = new Map();
        this._loadingTiles = new Set();

        this._createCanvas();
    }

    // ----------------------------------------------------------------
    // Setup
    // ----------------------------------------------------------------

    _createCanvas() {
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'gibs-canvas';
        this.canvas.style.cssText = `
            position: absolute;
            top: 0; left: 0;
            width: 100%; height: 100%;
            pointer-events: none;
            z-index: 0;
            display: none;
        `;
        // Insert canvas before the SVG so it sits behind it
        const svg = this.mapContainer.querySelector('svg');
        if (svg) {
            this.mapContainer.insertBefore(this.canvas, svg);
        } else {
            this.mapContainer.appendChild(this.canvas);
        }
        this.ctx = this.canvas.getContext('2d');
    }

    // ----------------------------------------------------------------
    // Public API
    // ----------------------------------------------------------------

    /** Toggle GIBS visibility. Returns new visible state. */
    toggle() {
        this.visible = !this.visible;
        this.canvas.style.display = this.visible ? 'block' : 'none';
        if (this.visible) {
            this.render();
        }
        return this.visible;
    }

    /** Show the overlay */
    show() {
        this.visible = true;
        this.canvas.style.display = 'block';
        this.render();
    }

    /** Hide the overlay */
    hide() {
        this.visible = false;
        this.canvas.style.display = 'none';
    }

    /** Set the active GIBS layer identifier */
    setLayer(layerId) {
        if (!this.layers[layerId]) {
            console.warn('Unknown GIBS layer:', layerId);
            return;
        }
        if (layerId === this.currentLayer) return;
        this.currentLayer = layerId;
        this._tileCache.clear();
        if (this.visible) this.render();
    }

    /** Set the date string (YYYY-MM-DD) */
    setDate(dateStr) {
        if (dateStr === this.date) return;
        this.date = dateStr;
        this._tileCache.clear();
        if (this.visible) this.render();
    }

    /** Set opacity 0-1 */
    setOpacity(val) {
        this.opacity = Math.max(0, Math.min(1, val));
        if (this.visible) this.render();
    }

    /** Called when projection changes or window resizes */
    render() {
        if (!this.visible) return;

        // GIBS tiles are EPSG:4326 — only render in equirectangular mode
        if (this.projection.projectionType !== 'equirectangular') {
            this._clearCanvas();
            return;
        }

        this._syncCanvasSize();
        this._renderTiles();
    }

    /** Full redraw (call after projection switch) */
    refresh() {
        if (this.visible) this.render();
    }

    // ----------------------------------------------------------------
    // Rendering
    // ----------------------------------------------------------------

    _syncCanvasSize() {
        const svg = this.mapContainer.querySelector('svg');
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        // Match canvas pixel dimensions to displayed SVG size for crisp rendering
        const dpr = 1;  // Use 1:1 to keep tile images sharp; CSS scales to container
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
    }

    _clearCanvas() {
        if (!this.ctx) return;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    /**
     * Choose a zoom level appropriate for the current canvas size.
     * We want roughly one tile per ~200-300 canvas pixels for decent quality
     * without flooding the network.
     */
    _pickZoomLevel() {
        const layerConf = this.layers[this.currentLayer];
        const matrixSet = layerConf.matrixSet;
        const matrices = this._tileMatrices[matrixSet];

        // The canvas shows 360 degrees of longitude.
        // Each tile at zoom z covers (360 / cols) degrees of longitude.
        // We want tile pixel size (512) to roughly match the canvas pixels per tile.
        const canvasWidth = this.canvas.width;

        for (let i = matrices.length - 1; i >= 0; i--) {
            const m = matrices[i];
            const canvasPxPerTile = canvasWidth / m.cols;
            // If each tile maps to at least 128 canvas pixels, use this zoom
            if (canvasPxPerTile >= 128) {
                return m;
            }
        }
        // Fallback: use the lowest zoom
        return matrices[0];
    }

    /**
     * Render all tiles for the current zoom level onto the canvas.
     * Maps geographic tile coordinates to canvas pixel positions using
     * the D3 equirectangular projection.
     */
    _renderTiles() {
        this._clearCanvas();
        this.ctx.globalAlpha = this.opacity;

        const matrix = this._pickZoomLevel();
        const layerConf = this.layers[this.currentLayer];
        const { cols, rows, z } = matrix;

        // Geographic extent of each tile
        const tileDegWidth = 360 / cols;
        const tileDegHeight = 180 / rows;

        // Use the D3 projection to convert geographic coords to pixel coords.
        // The equirectangular projection maps (-180,90) -> top-left, (180,-90) -> bottom-right.
        const proj = this.projection.projection;

        // We need to map from projection coordinates (in the SVG viewBox space)
        // to canvas pixel coordinates.
        const svgW = this.projection.width;
        const svgH = this.projection.height;
        const canW = this.canvas.width;
        const canH = this.canvas.height;
        const scaleX = canW / svgW;
        const scaleY = canH / svgH;

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                // Geographic bounds of this tile
                // Origin is (-180, 90), tiles go left-to-right, top-to-bottom
                const lonLeft = -180 + col * tileDegWidth;
                const latTop  =  90  - row * tileDegHeight;
                const lonRight = lonLeft + tileDegWidth;
                const latBottom = latTop - tileDegHeight;

                // Project corners to SVG coords
                const topLeft = proj([lonLeft, latTop]);
                const bottomRight = proj([lonRight, latBottom]);

                if (!topLeft || !bottomRight) continue;

                // Convert to canvas pixel coords
                const cx = topLeft[0] * scaleX;
                const cy = topLeft[1] * scaleY;
                const cw = (bottomRight[0] - topLeft[0]) * scaleX;
                const ch = (bottomRight[1] - topLeft[1]) * scaleY;

                // Build tile URL
                const url = this._tileUrl(this.currentLayer, this.date,
                    layerConf.matrixSet, z, row, col, layerConf.ext);

                this._drawTile(url, cx, cy, cw, ch);
            }
        }
    }

    /**
     * Draw a single tile image onto the canvas.
     * Uses cache; loads asynchronously if not cached.
     */
    _drawTile(url, x, y, w, h) {
        const cached = this._tileCache.get(url);
        if (cached) {
            // Already loaded
            this.ctx.drawImage(cached, x, y, w, h);
            return;
        }

        if (this._loadingTiles.has(url)) return;  // Already loading
        this._loadingTiles.add(url);

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            this._tileCache.set(url, img);
            this._loadingTiles.delete(url);
            // Re-render to show newly loaded tile
            if (this.visible && this.projection.projectionType === 'equirectangular') {
                this._renderTiles();
            }
        };
        img.onerror = () => {
            this._loadingTiles.delete(url);
            // Tile may not exist for this date/layer — silently ignore
        };
        img.src = url;
    }

    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------

    _tileUrl(layer, date, matrixSet, z, row, col, ext) {
        return `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/` +
            `${layer}/default/${date}/${matrixSet}/${z}/${row}/${col}.${ext}`;
    }

    _todayStr() {
        // Use yesterday's date as a safer default (today's imagery may not be available yet)
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return d.toISOString().slice(0, 10);
    }
}

window.GIBSOverlay = GIBSOverlay;
