/**
 * Star Stories + Click-to-Identify
 *
 * Adds interactive star identification to the Night Sky Viewer:
 *  1. Loads star_stories.json with cultural stories for the 20 brightest stars
 *  2. Registers VirtualSky pointers for those 20 stars (clickable markers)
 *  3. Shows floating Observatory Brass popup with story, science, cultural tabs
 *  4. Canvas click detection for other stars queries the backend SIMBAD endpoint
 */
(function() {
    'use strict';

    var BACKEND_URL = 'http://localhost:5051';

    // Star story data loaded from JSON
    var starData = [];
    // Whether pointers have been added to the current planetarium instance
    var pointersRegistered = false;
    // Currently visible popup element
    var activePopup = null;

    // ── Initialization ────────────────────────────────────────

    function init() {
        loadStarStories();
        injectStyles();
        setupCanvasClickDetection();
    }

    /**
     * Fetch the star stories JSON data.
     */
    function loadStarStories() {
        fetch('data/star_stories.json')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                starData = data;
                registerPointers();
            })
            .catch(function(err) {
                console.warn('[StarStories] Could not load star_stories.json:', err);
            });
    }

    // ── VirtualSky Pointer Registration ───────────────────────

    /**
     * Add VirtualSky pointers for each of the 20 brightest stars.
     * Uses addPointer() which gives us built-in hit detection across all
     * projections and coordinate transforms.
     */
    function registerPointers() {
        var p = window.NightSky && window.NightSky.state.planetarium;
        if (!p || !starData.length) return;
        if (pointersRegistered) return;

        starData.forEach(function(star) {
            try {
                p.addPointer({
                    ra:    star.ra * Math.PI / 180,
                    dec:   star.dec * Math.PI / 180,
                    label: star.name,
                    colour: '#c8a456'
                });
            } catch (e) {
                console.warn('[StarStories] addPointer failed for', star.name, e);
            }
        });

        pointersRegistered = true;

        // Hook into VirtualSky's click callback to intercept pointer hits
        hookClickCallback(p);
    }

    /**
     * Wrap VirtualSky's click callback so we can intercept pointer matches.
     */
    function hookClickCallback(p) {
        var existingClick = (p.callback && p.callback.click) || null;
        if (!p.callback) p.callback = {};

        p.callback.click = function(e) {
            if (e && typeof e.matched === 'number' && e.matched >= 0 && e.matched < starData.length) {
                showStarStoryPopup(starData[e.matched], e.x, e.y);
                return;
            }
            if (existingClick) existingClick(e);
        };
    }

    // ── Canvas Click Detection (for stars beyond top 20) ──────

    function setupCanvasClickDetection() {
        setTimeout(function() {
            var container = document.getElementById('starmap');
            if (!container) return;

            container.addEventListener('click', function(evt) {
                if (activePopup) return;

                var canvas = container.querySelector('canvas');
                if (!canvas) return;

                var rect = canvas.getBoundingClientRect();
                var x = evt.clientX - rect.left;
                var y = evt.clientY - rect.top;

                var p = window.NightSky.state.planetarium;
                if (!p) return;

                // Check pointer hits first
                if (p.pointers && p.pointers.length > 0) {
                    var hit = whichPointerHit(p, x, y);
                    if (hit >= 0) {
                        showStarStoryPopup(starData[hit], evt.clientX, evt.clientY);
                        return;
                    }
                }

                // Check pixel proximity to our 20 known stars
                var nearest = findNearestStarByPixel(p, x, y);
                if (nearest) {
                    showStarStoryPopup(nearest, evt.clientX, evt.clientY);
                    return;
                }

                // Fall back: attempt RA/Dec estimation and query SIMBAD
                attemptSimbadLookup(p, x, y, evt.clientX, evt.clientY);
            });
        }, 1000);
    }

    /**
     * Hit-test pointers by pixel distance.
     */
    function whichPointerHit(p, cx, cy) {
        var threshold = 12;
        if (!p.pointers) return -1;

        for (var i = 0; i < p.pointers.length && i < starData.length; i++) {
            var ptr = p.pointers[i];
            if (!ptr) continue;

            var xy;
            try { xy = p.radec2xy(ptr.ra, ptr.dec); } catch (e) { continue; }
            if (!xy || !isFinite(xy.x) || !isFinite(xy.y)) continue;

            var dx = xy.x - cx;
            var dy = xy.y - cy;
            if (Math.sqrt(dx * dx + dy * dy) < threshold) return i;
        }
        return -1;
    }

    /**
     * Find the nearest star in our 20-star catalog by canvas pixel position.
     */
    function findNearestStarByPixel(p, cx, cy) {
        var bestDist = 15;
        var bestStar = null;

        for (var i = 0; i < starData.length; i++) {
            var star = starData[i];
            var raRad  = star.ra  * Math.PI / 180;
            var decRad = star.dec * Math.PI / 180;

            var xy;
            try { xy = p.radec2xy(raRad, decRad); } catch (e) { continue; }
            if (!xy || !isFinite(xy.x) || !isFinite(xy.y)) continue;

            var dx = xy.x - cx;
            var dy = xy.y - cy;
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < bestDist) {
                bestDist = dist;
                bestStar = star;
            }
        }
        return bestStar;
    }

    /**
     * Attempt to convert canvas x,y to approximate RA/Dec and query SIMBAD.
     */
    function attemptSimbadLookup(p, canvasX, canvasY, screenX, screenY) {
        var raDeg, decDeg;
        try {
            if (typeof p.xy2radec === 'function') {
                var rd = p.xy2radec(canvasX, canvasY);
                if (rd && isFinite(rd.ra) && isFinite(rd.dec)) {
                    raDeg  = rd.ra  * 180 / Math.PI;
                    decDeg = rd.dec * 180 / Math.PI;
                }
            }
        } catch (e) { /* not available */ }

        if (raDeg === undefined) {
            raDeg = estimateRaDec(p, canvasX, canvasY, 'ra');
            decDeg = estimateRaDec(p, canvasX, canvasY, 'dec');
        }

        if (raDeg === undefined || decDeg === undefined) return;

        raDeg = ((raDeg % 360) + 360) % 360;
        querySimbadRegion(raDeg, decDeg, screenX, screenY);
    }

    /**
     * Estimate RA or Dec at a canvas point by inverse-distance weighted
     * interpolation from our known star positions.
     */
    function estimateRaDec(p, cx, cy, coord) {
        var pts = [];
        for (var i = 0; i < starData.length; i++) {
            var star = starData[i];
            var raRad  = star.ra  * Math.PI / 180;
            var decRad = star.dec * Math.PI / 180;
            var xy;
            try { xy = p.radec2xy(raRad, decRad); } catch (e) { continue; }
            if (!xy || !isFinite(xy.x) || !isFinite(xy.y)) continue;
            pts.push({ sx: xy.x, sy: xy.y, ra: star.ra, dec: star.dec });
        }

        if (pts.length < 2) return undefined;

        pts.sort(function(a, b) {
            var da = (a.sx - cx) * (a.sx - cx) + (a.sy - cy) * (a.sy - cy);
            var db = (b.sx - cx) * (b.sx - cx) + (b.sy - cy) * (b.sy - cy);
            return da - db;
        });

        var a = pts[0], b = pts[1];
        var da = Math.sqrt((a.sx - cx) * (a.sx - cx) + (a.sy - cy) * (a.sy - cy)) || 0.1;
        var db = Math.sqrt((b.sx - cx) * (b.sx - cx) + (b.sy - cy) * (b.sy - cy)) || 0.1;
        var wa = 1 / da, wb = 1 / db;
        var total = wa + wb;

        if (coord === 'ra')  return (a.ra  * wa + b.ra  * wb) / total;
        if (coord === 'dec') return (a.dec * wa + b.dec * wb) / total;
        return undefined;
    }

    /**
     * Query the backend SIMBAD region endpoint and show a simple popup.
     */
    function querySimbadRegion(raDeg, decDeg, screenX, screenY) {
        var url = BACKEND_URL + '/api/simbad/region?ra=' + raDeg +
                  '&dec=' + decDeg + '&radius=0.5&limit=1';

        fetch(url)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.objects && data.objects.length > 0) {
                    showSimbadPopup(data.objects[0], screenX, screenY);
                }
            })
            .catch(function(err) {
                console.log('[StarStories] SIMBAD query failed:', err);
            });
    }

    // ── Popup Display ─────────────────────────────────────────

    /**
     * Create a telescope button as a DOM element.
     */
    function createTelescopeButton(ra, dec) {
        var btn = document.createElement('button');
        btn.className = 'ss-telescope-btn';

        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '14');
        svg.setAttribute('height', '14');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z');
        svg.appendChild(path);
        btn.appendChild(svg);

        var label = document.createTextNode(' View in Telescope');
        btn.appendChild(label);

        btn.addEventListener('click', function() {
            dismissPopup();
            if (typeof openTelescopeView === 'function') {
                openTelescopeView(ra, dec);
            }
        });

        return btn;
    }

    /**
     * Show the full star story popup for one of the top-20 stars.
     */
    function showStarStoryPopup(star, screenX, screenY) {
        dismissPopup();

        var popup = document.createElement('div');
        popup.className = 'ss-popup';

        // ── Header
        var header = document.createElement('div');
        header.className = 'ss-header';

        var nameSpan = document.createElement('span');
        nameSpan.className = 'ss-name';
        nameSpan.textContent = star.name;
        header.appendChild(nameSpan);

        var constSpan = document.createElement('span');
        constSpan.className = 'ss-constellation';
        constSpan.textContent = star.constellation;
        header.appendChild(constSpan);

        var closeBtn = document.createElement('button');
        closeBtn.className = 'ss-close';
        closeBtn.title = 'Close';
        closeBtn.textContent = '\u00D7';
        closeBtn.addEventListener('click', dismissPopup);
        header.appendChild(closeBtn);

        popup.appendChild(header);

        // ── Stats row
        var stats = document.createElement('div');
        stats.className = 'ss-stats';

        var magSpan = document.createElement('span');
        magSpan.textContent = 'mag ' + star.magnitude;
        stats.appendChild(magSpan);

        var specSpan = document.createElement('span');
        specSpan.textContent = star.spectralType;
        stats.appendChild(specSpan);

        var distSpan = document.createElement('span');
        distSpan.textContent = star.distance;
        stats.appendChild(distSpan);

        popup.appendChild(stats);

        // ── Story paragraph
        var story = document.createElement('p');
        story.className = 'ss-story';
        story.textContent = star.story;
        popup.appendChild(story);

        // ── Culture tabs
        var notes = star.culture_notes;
        if (notes && Object.keys(notes).length > 0) {
            var tabBar = document.createElement('div');
            tabBar.className = 'ss-tabs';

            var tabContent = document.createElement('div');
            tabContent.className = 'ss-tab-content';

            var cultureLabels = {
                greek: 'Greek', arabic: 'Arabic',
                polynesian: 'Polynesian', chinese: 'Chinese',
                egyptian: 'Egyptian'
            };

            var first = true;
            Object.keys(notes).forEach(function(key) {
                if (!notes[key]) return;

                var btn = document.createElement('button');
                btn.className = 'ss-tab-btn' + (first ? ' active' : '');
                btn.textContent = cultureLabels[key] || key;
                btn.setAttribute('data-culture', key);
                tabBar.appendChild(btn);

                var pane = document.createElement('div');
                pane.className = 'ss-tab-pane' + (first ? ' active' : '');
                pane.setAttribute('data-culture', key);
                pane.textContent = notes[key];
                tabContent.appendChild(pane);

                first = false;
            });

            tabBar.addEventListener('click', function(evt) {
                var clicked = evt.target.closest('.ss-tab-btn');
                if (!clicked) return;
                var culture = clicked.getAttribute('data-culture');

                tabBar.querySelectorAll('.ss-tab-btn').forEach(function(b) {
                    b.classList.toggle('active', b === clicked);
                });
                tabContent.querySelectorAll('.ss-tab-pane').forEach(function(pn) {
                    pn.classList.toggle('active', pn.getAttribute('data-culture') === culture);
                });
            });

            popup.appendChild(tabBar);
            popup.appendChild(tabContent);
        }

        // ── Telescope button
        popup.appendChild(createTelescopeButton(star.ra, star.dec));

        // Position popup near click, clamped to viewport
        positionPopup(popup, screenX, screenY);

        document.body.appendChild(popup);
        activePopup = popup;

        // Dismiss on outside click (delayed to avoid immediate self-dismiss)
        setTimeout(function() {
            document.addEventListener('click', outsideClickHandler);
        }, 50);
    }

    /**
     * Show a simpler popup for SIMBAD-resolved objects (not in top 20).
     */
    function showSimbadPopup(obj, screenX, screenY) {
        dismissPopup();

        var popup = document.createElement('div');
        popup.className = 'ss-popup ss-popup-simple';

        // Header
        var header = document.createElement('div');
        header.className = 'ss-header';

        var nameSpan = document.createElement('span');
        nameSpan.className = 'ss-name';
        nameSpan.textContent = obj.name || 'Unknown';
        header.appendChild(nameSpan);

        var closeBtn = document.createElement('button');
        closeBtn.className = 'ss-close';
        closeBtn.title = 'Close';
        closeBtn.textContent = '\u00D7';
        closeBtn.addEventListener('click', dismissPopup);
        header.appendChild(closeBtn);

        popup.appendChild(header);

        // Stats
        var stats = document.createElement('div');
        stats.className = 'ss-stats';

        if (obj.type) {
            var typeSpan = document.createElement('span');
            typeSpan.textContent = obj.type;
            stats.appendChild(typeSpan);
        }

        if (obj.magnitude_v !== null && obj.magnitude_v !== undefined) {
            var magSpan = document.createElement('span');
            magSpan.textContent = 'mag ' + Number(obj.magnitude_v).toFixed(1);
            stats.appendChild(magSpan);
        }

        if (obj.spectral_type) {
            var specSpan = document.createElement('span');
            specSpan.textContent = obj.spectral_type;
            stats.appendChild(specSpan);
        }

        if (obj.distance_ly) {
            var distSpan = document.createElement('span');
            distSpan.textContent = formatDist(obj.distance_ly);
            stats.appendChild(distSpan);
        }

        popup.appendChild(stats);

        // Telescope button
        if (obj.ra !== undefined && obj.dec !== undefined) {
            popup.appendChild(createTelescopeButton(obj.ra, obj.dec));
        }

        positionPopup(popup, screenX, screenY);
        document.body.appendChild(popup);
        activePopup = popup;

        setTimeout(function() {
            document.addEventListener('click', outsideClickHandler);
        }, 50);
    }

    // ── Popup Helpers ─────────────────────────────────────────

    function positionPopup(popup, sx, sy) {
        popup.style.position = 'fixed';
        popup.style.zIndex = '10000';

        // Temporarily add to measure
        popup.style.visibility = 'hidden';
        document.body.appendChild(popup);
        var w = popup.offsetWidth;
        var h = popup.offsetHeight;
        document.body.removeChild(popup);
        popup.style.visibility = '';

        var vw = window.innerWidth;
        var vh = window.innerHeight;

        var left = sx + 16;
        var top  = sy - 20;

        // Clamp to viewport
        if (left + w > vw - 12) left = sx - w - 16;
        if (left < 12) left = 12;
        if (top + h > vh - 12) top = vh - h - 12;
        if (top < 12) top = 12;

        popup.style.left = left + 'px';
        popup.style.top  = top  + 'px';
    }

    function dismissPopup() {
        if (activePopup && activePopup.parentNode) {
            activePopup.parentNode.removeChild(activePopup);
        }
        activePopup = null;
        document.removeEventListener('click', outsideClickHandler);
    }

    function outsideClickHandler(evt) {
        if (activePopup && !activePopup.contains(evt.target)) {
            dismissPopup();
        }
    }

    function formatDist(ly) {
        if (ly < 100) return ly.toFixed(1) + ' ly';
        if (ly < 1000) return Math.round(ly) + ' ly';
        return (ly / 1000).toFixed(1) + 'k ly';
    }

    // ── Reattach After Reinit ─────────────────────────────────

    function onLocationChange() {
        pointersRegistered = false;
        if (starData.length) registerPointers();
    }

    // ── Injected Styles ───────────────────────────────────────

    function injectStyles() {
        var css = '' +
        '.ss-popup {' +
            'background: #0c0c0c;' +
            'border: 1px solid #8a7139;' +
            'border-radius: 6px;' +
            'width: 290px;' +
            'max-width: 90vw;' +
            'font-family: "DM Sans", sans-serif;' +
            'color: #d4cfc0;' +
            'box-shadow: 0 4px 24px rgba(0,0,0,0.7), 0 0 1px #8a7139;' +
            'overflow: hidden;' +
            'animation: ss-fadeIn 0.15s ease-out;' +
        '}' +

        '@keyframes ss-fadeIn {' +
            'from { opacity: 0; transform: translateY(6px); }' +
            'to   { opacity: 1; transform: translateY(0); }' +
        '}' +

        '.ss-header {' +
            'display: flex;' +
            'align-items: center;' +
            'padding: 8px 10px 4px;' +
            'border-bottom: 1px solid rgba(138,113,57,0.3);' +
        '}' +
        '.ss-name {' +
            'font-family: "Playfair Display", serif;' +
            'font-size: 15px;' +
            'font-weight: 600;' +
            'color: #c8a456;' +
        '}' +
        '.ss-constellation {' +
            'font-size: 11px;' +
            'color: #8a8577;' +
            'margin-left: 8px;' +
        '}' +
        '.ss-close {' +
            'background: none;' +
            'border: none;' +
            'color: #8a8577;' +
            'font-size: 18px;' +
            'cursor: pointer;' +
            'padding: 0 2px;' +
            'line-height: 1;' +
            'margin-left: auto;' +
        '}' +
        '.ss-close:hover { color: #c8a456; }' +

        '.ss-stats {' +
            'display: flex;' +
            'gap: 10px;' +
            'padding: 5px 10px;' +
            'font-family: "JetBrains Mono", monospace;' +
            'font-size: 10.5px;' +
            'color: #8a7139;' +
        '}' +

        '.ss-story {' +
            'padding: 6px 10px 8px;' +
            'font-size: 12.5px;' +
            'line-height: 1.5;' +
            'color: #d4cfc0;' +
            'margin: 0;' +
        '}' +

        '.ss-tabs {' +
            'display: flex;' +
            'gap: 0;' +
            'border-top: 1px solid rgba(138,113,57,0.2);' +
            'border-bottom: 1px solid rgba(138,113,57,0.2);' +
            'overflow-x: auto;' +
        '}' +
        '.ss-tab-btn {' +
            'background: none;' +
            'border: none;' +
            'padding: 5px 8px;' +
            'font-size: 10.5px;' +
            'color: #8a8577;' +
            'cursor: pointer;' +
            'white-space: nowrap;' +
            'border-bottom: 2px solid transparent;' +
            'font-family: "DM Sans", sans-serif;' +
        '}' +
        '.ss-tab-btn:hover { color: #c8a456; }' +
        '.ss-tab-btn.active {' +
            'color: #c8a456;' +
            'border-bottom-color: #c8a456;' +
        '}' +

        '.ss-tab-content { padding: 6px 10px 8px; min-height: 40px; }' +
        '.ss-tab-pane {' +
            'display: none;' +
            'font-size: 12px;' +
            'line-height: 1.5;' +
            'color: #d4cfc0;' +
        '}' +
        '.ss-tab-pane.active { display: block; }' +

        '.ss-telescope-btn {' +
            'display: flex;' +
            'align-items: center;' +
            'gap: 6px;' +
            'width: calc(100% - 16px);' +
            'margin: 4px 8px 8px;' +
            'padding: 6px 10px;' +
            'background: rgba(138,113,57,0.15);' +
            'border: 1px solid #8a7139;' +
            'border-radius: 4px;' +
            'color: #c8a456;' +
            'font-size: 11.5px;' +
            'font-family: "DM Sans", sans-serif;' +
            'cursor: pointer;' +
            'transition: background 0.15s;' +
        '}' +
        '.ss-telescope-btn:hover {' +
            'background: rgba(200,164,86,0.2);' +
        '}' +
        '.ss-telescope-btn svg { flex-shrink: 0; }' +

        '.ss-popup-simple .ss-story { display: none; }' +

        '.redlight .ss-popup {' +
            'border-color: #6b2020;' +
            'box-shadow: 0 4px 24px rgba(0,0,0,0.7), 0 0 1px #6b2020;' +
        '}' +
        '.redlight .ss-name { color: #cc4444; }' +
        '.redlight .ss-stats { color: #6b2020; }' +
        '.redlight .ss-tab-btn.active { color: #cc4444; border-bottom-color: #cc4444; }' +
        '.redlight .ss-telescope-btn {' +
            'border-color: #6b2020;' +
            'color: #cc4444;' +
            'background: rgba(107,32,32,0.15);' +
        '}' +
        '.redlight .ss-telescope-btn:hover { background: rgba(204,68,68,0.15); }';

        var style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    // ── Register with NightSky feature system ─────────────────

    window.NightSky.features.register('starstories', {
        init: init,
        onLocationChange: onLocationChange,
        onTimeChange: function() {
            // Pointers track automatically through VirtualSky's draw cycle
        }
    });
})();
