/**
 * Lore Browser Feature
 *
 * Full celestial lore catalog: zodiac, constellations, planets, stars,
 * asterisms, and meteor showers — same depth as the Observation Planner
 * Stories panel, available from the main Night Sky Viewer.
 */
(function () {
    'use strict';

    var catalog = null;
    var selectedCategory = 'zodiac';
    var selectedCulture = 'all';
    var selectedObject = null;
    var extraPlanets = {}; // name -> planet_stories entry
    var extraStars = {};   // name -> star_stories entry

    function init() {
        setupEventListeners();
        loadCatalog();
    }

    function setupEventListeners() {
        var btn = document.getElementById('lore-btn');
        var modal = document.getElementById('lore-modal');
        var closeBtn = document.getElementById('lore-modal-close');
        var cultureSelect = document.getElementById('lore-culture-select');
        var searchInput = document.getElementById('lore-search-input');
        var categories = document.getElementById('lore-categories');

        if (btn && modal) {
            btn.addEventListener('click', function () {
                modal.classList.add('active');
                // Refresh list when opened (covers late-loaded data)
                if (catalog) updateObjectList();
            });
        }
        if (closeBtn && modal) {
            closeBtn.addEventListener('click', function () {
                modal.classList.remove('active');
            });
        }
        if (modal) {
            modal.addEventListener('click', function (e) {
                if (e.target === modal) modal.classList.remove('active');
            });
        }
        if (cultureSelect) {
            cultureSelect.addEventListener('change', function (e) {
                selectedCulture = e.target.value;
                if (selectedObject) displayStory(selectedObject);
            });
        }
        if (searchInput) {
            searchInput.addEventListener('input', function () {
                updateObjectList();
            });
        }
        if (categories) {
            categories.addEventListener('click', function (e) {
                var btnEl = e.target.closest('.lore-cat-btn');
                if (!btnEl) return;
                categories.querySelectorAll('.lore-cat-btn').forEach(function (b) {
                    b.classList.remove('active');
                });
                btnEl.classList.add('active');
                selectedCategory = btnEl.getAttribute('data-category');
                selectedObject = null;
                updateObjectList();
                showPlaceholder();
            });
        }
    }

    /**
     * Candidate URLs for data/*.json.
     * Preferred: same origin as the page (Go edge :5051 serves nightsky/frontend at /).
     */
    function dataUrlCandidates(filename) {
        var name = String(filename || '').replace(/^\/+/, '');
        var bases = [];
        try {
            // Directory of the current page (e.g. http://localhost:5051/ → …/data/…)
            var pageDir = new URL('.', window.location.href).href;
            bases.push(pageDir + 'data/' + name);
        } catch (e) { /* ignore */ }
        bases.push('data/' + name);
        bases.push('./data/' + name);
        bases.push('/data/' + name);
        // If UI was opened from another port, hit the Go nightsky edge directly
        try {
            var edge = (window.NightSky && window.NightSky.apiUrl) ||
                (typeof API_URL !== 'undefined' ? API_URL : 'http://localhost:5051');
            if (edge) {
                bases.push(String(edge).replace(/\/$/, '') + '/data/' + name);
            } else {
                bases.push(window.location.protocol + '//' + window.location.hostname + ':5051/data/' + name);
            }
        } catch (e2) {
            bases.push('http://localhost:5051/data/' + name);
        }
        // Dedupe
        var seen = {};
        return bases.filter(function (u) {
            if (seen[u]) return false;
            seen[u] = true;
            return true;
        });
    }

    function fetchJsonFirstOk(filename) {
        var urls = dataUrlCandidates(filename);
        var lastErr = null;
        var i = 0;

        function tryNext() {
            if (i >= urls.length) {
                return Promise.reject(lastErr || new Error('No URL worked for ' + filename));
            }
            var url = urls[i++];
            return fetch(url, { cache: 'no-cache' }).then(function (r) {
                if (!r.ok) {
                    lastErr = new Error(filename + ' HTTP ' + r.status + ' @ ' + url);
                    return tryNext();
                }
                return r.json().then(function (data) {
                    console.log('[LoreBrowser] loaded', filename, 'from', url);
                    return data;
                }).catch(function (parseErr) {
                    lastErr = new Error(filename + ' JSON parse failed @ ' + url + ': ' + parseErr.message);
                    return tryNext();
                });
            }).catch(function (netErr) {
                lastErr = new Error(filename + ' network error @ ' + url + ': ' + (netErr && netErr.message));
                return tryNext();
            });
        }
        return tryNext();
    }

    function fetchJsonOptional(filename) {
        return fetchJsonFirstOk(filename).catch(function (err) {
            console.warn('[LoreBrowser] optional file skipped:', filename, err && err.message);
            return null;
        });
    }

    function loadCatalog() {
        var listEl = document.getElementById('lore-object-list');
        if (listEl) {
            listEl.innerHTML = '<div class="lore-loading">Loading celestial lore…</div>';
        }

        // Main catalog is required; planet/star extras are optional enrichment
        fetchJsonFirstOk('constellations.json').then(function (main) {
            if (!main || typeof main !== 'object') {
                throw new Error('constellations.json did not contain a catalog object');
            }
            catalog = main;

            return Promise.all([
                fetchJsonOptional('planet_stories.json'),
                fetchJsonOptional('star_stories.json')
            ]).then(function (extras) {
                var planets = extras[0];
                var stars = extras[1];
                if (Array.isArray(planets)) {
                    planets.forEach(function (p) {
                        if (p && p.name) extraPlanets[p.name.toLowerCase()] = p;
                    });
                }
                if (Array.isArray(stars)) {
                    stars.forEach(function (s) {
                        if (s && s.name) extraStars[s.name.toLowerCase()] = s;
                    });
                }
                try {
                    mergeExtraPlanets();
                    mergeExtraStars();
                } catch (mergeErr) {
                    console.warn('[LoreBrowser] merge extras failed (catalog still usable):', mergeErr);
                }
                updateObjectList();
            });
        }).catch(function (err) {
            console.error('[LoreBrowser] Failed to load catalog:', err);
            if (listEl) {
                var detail = (err && err.message) ? err.message : String(err);
                listEl.innerHTML =
                    '<div class="lore-loading lore-error">' +
                    '<strong>Could not load lore catalog.</strong><br>' +
                    '<span style="font-size:11px;opacity:0.85;word-break:break-all">' + escapeHtml(detail) + '</span><br><br>' +
                    '<span style="font-size:12px">Open the viewer from the Go edge: ' +
                    '<code>http://localhost:5051/</code> (serves UI + <code>/data/constellations.json</code>). ' +
                    'Restart with <code>make edge-restart</code> if static files 404.</span>' +
                    '</div>';
            }
        });
    }

    function mergeExtraPlanets() {
        if (!catalog) return;
        catalog.planets = catalog.planets || [];
        var byId = {};
        catalog.planets.forEach(function (p) {
            byId[(p.id || p.name || '').toLowerCase()] = p;
        });
        Object.keys(extraPlanets).forEach(function (key) {
            var extra = extraPlanets[key];
            var existing = byId[key] || byId[(extra.id || '').toLowerCase()];
            if (existing) {
                // Enrich existing entry
                if (extra.story && !existing.intro) existing.intro = extra.story;
                if (extra.renaissance_discovery) existing.renaissance_discovery = extra.renaissance_discovery;
                if (extra.culture_notes) existing.culture_notes = extra.culture_notes;
            } else {
                catalog.planets.push({
                    id: extra.id || key,
                    name: extra.name,
                    type: extra.type || 'planet',
                    intro: extra.story,
                    renaissance_discovery: extra.renaissance_discovery,
                    culture_notes: extra.culture_notes,
                    mythology: cultureNotesToMythology(extra.culture_notes)
                });
            }
        });
    }

    function mergeExtraStars() {
        if (!catalog) return;
        catalog.stars = catalog.stars || [];
        var byName = {};
        catalog.stars.forEach(function (s) {
            byName[(s.name || '').toLowerCase()] = s;
        });
        Object.keys(extraStars).forEach(function (key) {
            var extra = extraStars[key];
            var existing = byName[key];
            if (existing) {
                if (extra.story && !existing.intro) existing.intro = extra.story;
                if (extra.culture_notes) existing.culture_notes = extra.culture_notes;
                if (extra.spectralType && !existing.spectralType) existing.spectralType = extra.spectralType;
                if (extra.distance && !existing.distance) existing.distance = extra.distance;
            } else {
                catalog.stars.push({
                    id: key.replace(/\s+/g, '-'),
                    name: extra.name,
                    constellation: extra.constellation,
                    magnitude: extra.magnitude,
                    spectralType: extra.spectralType,
                    distance: extra.distance,
                    intro: extra.story,
                    culture_notes: extra.culture_notes,
                    mythology: cultureNotesToMythology(extra.culture_notes)
                });
            }
        });
    }

    function cultureNotesToMythology(notes) {
        if (!notes || typeof notes !== 'object') return undefined;
        var myth = {};
        Object.keys(notes).forEach(function (k) {
            myth[k] = { story: notes[k] };
        });
        return myth;
    }

    function getCategoryObjects(category) {
        if (!catalog) return [];
        switch (category) {
            case 'zodiac': return catalog.zodiac || [];
            case 'constellations': return catalog.constellations || [];
            case 'planets': return catalog.planets || [];
            case 'stars': return catalog.stars || [];
            case 'asterisms': return catalog.asterisms || [];
            case 'meteorShowers': return catalog.meteorShowers || [];
            default: return [];
        }
    }

    function updateObjectList() {
        var listEl = document.getElementById('lore-object-list');
        var searchInput = document.getElementById('lore-search-input');
        if (!listEl || !catalog) return;

        var searchTerm = (searchInput && searchInput.value || '').toLowerCase().trim();
        var objects = getCategoryObjects(selectedCategory).slice();

        if (searchTerm) {
            objects = objects.filter(function (obj) {
                return (obj.name && obj.name.toLowerCase().includes(searchTerm)) ||
                    (obj.id && obj.id.toLowerCase().includes(searchTerm)) ||
                    (obj.abbreviation && obj.abbreviation.toLowerCase().includes(searchTerm)) ||
                    (obj.constellation && obj.constellation.toLowerCase().includes(searchTerm));
            });
        }

        // Alphabetical within category (zodiac keeps traditional order)
        if (selectedCategory !== 'zodiac') {
            objects.sort(function (a, b) {
                return (a.name || '').localeCompare(b.name || '');
            });
        }

        if (objects.length === 0) {
            listEl.innerHTML = '<div class="lore-loading">' +
                (searchTerm ? 'No matches found' : 'No objects in this category') +
                '</div>';
            return;
        }

        var selectedId = selectedObject && selectedObject.id;
        listEl.innerHTML = objects.map(function (obj) {
            var isSel = selectedId && obj.id === selectedId;
            var meta = obj.season || obj.constellation || obj.abbreviation || '';
            return '<div class="lore-object-item' + (isSel ? ' selected' : '') +
                '" data-id="' + escapeAttr(obj.id || obj.name) + '" role="button" tabindex="0">' +
                '<span class="lore-obj-name">' + escapeHtml(obj.name) + '</span>' +
                (meta ? '<span class="lore-obj-meta">' + escapeHtml(meta) + '</span>' : '') +
                '</div>';
        }).join('');

        listEl.querySelectorAll('.lore-object-item').forEach(function (item) {
            item.addEventListener('click', function () {
                var id = item.getAttribute('data-id');
                var obj = getCategoryObjects(selectedCategory).find(function (o) {
                    return (o.id || o.name) === id;
                });
                if (!obj) return;
                selectedObject = obj;
                listEl.querySelectorAll('.lore-object-item').forEach(function (el) {
                    el.classList.remove('selected');
                });
                item.classList.add('selected');
                displayStory(obj);
            });
        });
    }

    function showPlaceholder() {
        var area = document.getElementById('lore-content-area');
        if (!area) return;
        area.innerHTML =
            '<div class="lore-placeholder">' +
            '<div class="lore-placeholder-rule"></div>' +
            '<h3>Choose an entry</h3>' +
            '<p>From the list at left: zodiac, constellations, planets, named stars, asterisms, and showers — with myths as told across traditions.</p>' +
            '<div class="lore-placeholder-rule"></div>' +
            '</div>';
    }

    function displayStory(obj) {
        var area = document.getElementById('lore-content-area');
        if (!area || !obj) return;

        var cultures = (catalog && catalog.cultures) || {};
        var html = '';

        html += '<div class="lore-story-header">';
        html += '<div class="lore-story-title-row">';
        html += '<h2>' + escapeHtml(obj.name) + '</h2>';
        if (obj.abbreviation) {
            html += '<span class="lore-abbr">(' + escapeHtml(obj.abbreviation) + ')</span>';
        }
        if (obj.symbol && typeof obj.symbol === 'string' && obj.symbol.length <= 4) {
            html += '<span class="lore-symbol">' + escapeHtml(obj.symbol) + '</span>';
        }
        html += '</div>';
        // Open in planetarium / telescope when we can resolve a sky position
        var canOpenSky = !!(coordsFromObject(obj) || obj.name);
        if (canOpenSky) {
            html += '<div class="lore-actions">';
            html += '<button type="button" class="lore-action-btn" data-lore-action="sky" title="Pan the planetarium to this object">View in sky</button>';
            html += '<button type="button" class="lore-action-btn lore-action-primary" data-lore-action="telescope" title="Open the telescope on this object">Telescope</button>';
            html += '</div>';
        }
        html += '</div>';

        // Meta bar
        var metaBits = [];
        if (obj.type) metaBits.push(['Type', obj.type, null]);
        if (obj.season) metaBits.push(['Season', obj.season, null]);
        if (obj.hemisphere) metaBits.push(['Hemisphere', obj.hemisphere, null]);
        if (obj.brightestStar) metaBits.push(['Brightest Star', obj.brightestStar, { star: obj.brightestStar }]);
        if (obj.constellation) metaBits.push(['Constellation', obj.constellation, { constellation: obj.constellation }]);
        if (obj.magnitude != null) metaBits.push(['Magnitude', String(obj.magnitude), null]);
        if (obj.spectralType || obj.spectral_class) {
            metaBits.push(['Class', obj.spectralType || obj.spectral_class, null]);
        }
        if (obj.distance || obj.distance_ly) {
            metaBits.push(['Distance', obj.distance || (obj.distance_ly + ' ly'), null]);
        }
        if (obj.coordinates) {
            metaBits.push(['Coordinates', 'RA ' + obj.coordinates.ra + ', Dec ' + obj.coordinates.dec, null]);
        }
        if (obj.peakDate || obj.peak) metaBits.push(['Peak', obj.peakDate || obj.peak, null]);
        if (obj.zhr || obj.rate) metaBits.push(['Rate / ZHR', String(obj.zhr || obj.rate), null]);
        if (obj.speed) metaBits.push(['Speed', String(obj.speed), null]);
        if (obj.radiant) metaBits.push(['Radiant', String(obj.radiant), { constellation: obj.radiant }]);
        if (obj.parent) metaBits.push(['Parent Body', obj.parent, null]);
        if (obj.designation) metaBits.push(['Designation', obj.designation, null]);

        if (metaBits.length) {
            html += '<div class="lore-meta">';
            metaBits.forEach(function (pair) {
                var label = pair[0];
                var value = pair[1];
                var link = pair[2];
                html += '<span class="lore-meta-item"><strong>' + escapeHtml(label) + '</strong> ';
                if (link && link.constellation) {
                    html += '<a href="#" class="lore-inline-link" data-constellation-link="' +
                        escapeAttr(link.constellation) + '">' + escapeHtml(value) + '</a>';
                } else if (link && link.star) {
                    html += '<a href="#" class="lore-inline-link" data-star-link="' +
                        escapeAttr(link.star) + '">' + escapeHtml(value) + '</a>';
                } else {
                    html += escapeHtml(value);
                }
                html += '</span>';
            });
            html += '</div>';
        }

        // Intro / overview story
        var intro = obj.intro || obj.story || obj.description;
        if (intro && typeof intro === 'string') {
            html += '<p class="lore-intro">' + escapeHtml(intro) + '</p>';
        }

        // Renaissance / math (from planet_stories enrichment)
        if (obj.renaissance_discovery) {
            html += '<div class="lore-section">';
            html += '<h3>Mathematics & Discovery</h3>';
            html += '<p class="lore-body">' +
                escapeHtml(String(obj.renaissance_discovery)).replace(/\n/g, '<br>') +
                '</p></div>';
        }

        // Mythology blocks (culture-keyed or flat single myth)
        if (obj.mythology && typeof obj.mythology === 'object') {
            var mythology = normalizeMythology(obj.mythology);
            html += '<div class="lore-section"><h3>Cultural Mythology</h3>';
            var mythKeys = selectedCulture === 'all'
                ? Object.keys(mythology)
                : (mythology[selectedCulture] ? [selectedCulture] : []);

            if (mythKeys.length === 0) {
                html += '<p class="lore-muted">No mythology available for the selected culture.</p>';
            } else {
                mythKeys.forEach(function (key) {
                    var myth = mythology[key];
                    var cultureInfo = cultures[key] || { name: key };
                    var cultureName = (key === 'general')
                        ? 'Tradition'
                        : (cultureInfo.name || titleCase(key));

                    html += '<div class="lore-myth-block">';
                    html += '<h4 class="lore-culture-name">' + escapeHtml(cultureName) + '</h4>';
                    html += renderMythBody(myth);
                    html += '</div>';
                });
            }
            html += '</div>';
        }

        // Flat culture_notes (from enrichment) if no structured mythology was shown for them
        if (obj.culture_notes && !obj.mythology) {
            html += '<div class="lore-section"><h3>Cultural Significance</h3>';
            Object.keys(obj.culture_notes).forEach(function (key) {
                if (selectedCulture !== 'all' && key !== selectedCulture) return;
                html += '<div class="lore-myth-block">';
                html += '<h4 class="lore-culture-name">' + escapeHtml(titleCase(key)) + '</h4>';
                html += '<div class="lore-body">' + escapeHtml(obj.culture_notes[key]) + '</div>';
                html += '</div>';
            });
            html += '</div>';
        }

        // Notable stars within a constellation / asterism (objects or plain names)
        if (obj.stars && obj.stars.length) {
            html += '<div class="lore-section"><h3>Notable Stars</h3><div class="lore-stars-grid">';
            obj.stars.forEach(function (star) {
                if (typeof star === 'string') {
                    html += '<button type="button" class="lore-star-card lore-star-card-btn" data-star-link="' +
                        escapeAttr(star) + '"><div class="lore-star-name">' +
                        escapeHtml(star) + '</div><div class="lore-star-sub">Open in telescope</div></button>';
                    return;
                }
                var starName = star.name || star.designation || '';
                html += '<button type="button" class="lore-star-card lore-star-card-btn" data-star-link="' +
                    escapeAttr(starName) + '">';
                html += '<div class="lore-star-name">' + escapeHtml(star.name || '') + '</div>';
                if (star.designation) {
                    html += '<div class="lore-star-sub">' + escapeHtml(star.designation) + '</div>';
                }
                if (star.magnitude != null) {
                    html += '<div class="lore-star-sub">Mag: ' + escapeHtml(String(star.magnitude)) + '</div>';
                }
                if (star.arabicName) {
                    html += '<div class="lore-star-sub lore-italic">' + escapeHtml(star.arabicName) + '</div>';
                }
                if (star.etymology) {
                    html += '<div class="lore-star-sub">' + escapeHtml(star.etymology) + '</div>';
                }
                html += '<div class="lore-star-sub lore-open-hint">Open in telescope</div>';
                html += '</button>';
            });
            html += '</div></div>';
        }

        // Deep sky objects — click opens Aladin telescope via SIMBAD
        if (obj.deepSkyObjects && obj.deepSkyObjects.length) {
            html += '<div class="lore-section"><h3>Deep Sky Objects</h3>';
            html += '<p class="lore-section-hint">Click an object to open it in the telescope.</p>';
            html += '<ul class="lore-dso-list">';
            obj.deepSkyObjects.forEach(function (dso) {
                var label = typeof dso === 'string' ? dso : (dso.name || dso.id || String(dso));
                var query = simbadNameFromLabel(label);
                html += '<li><button type="button" class="lore-dso-btn" data-dso="' +
                    escapeAttr(label) + '" data-dso-query="' + escapeAttr(query) +
                    '" title="Open ' + escapeAttr(query || label) + ' in telescope">' +
                    escapeHtml(label) + '</button></li>';
            });
            html += '</ul></div>';
        }

        // Associated meteor shower (constellation)
        if (obj.meteorShower && typeof obj.meteorShower === 'string') {
            html += '<div class="lore-section"><h3>Associated Meteor Shower</h3>';
            html += '<p class="lore-body">' + escapeHtml(obj.meteorShower) + '</p></div>';
        }

        // Meteor shower detail fields
        if (obj.peakDate || obj.zhr || obj.speed || obj.radiant) {
            // already in meta; add parent body story if present
            if (obj.description && !intro) {
                html += '<p class="lore-body">' + escapeHtml(obj.description) + '</p>';
            }
        }

        area.innerHTML = html;
        area.scrollTop = 0;
        bindLoreLinks(area, obj);
    }

    // ── Sky / telescope navigation ─────────────────────────────

    function closeLoreModal() {
        var modal = document.getElementById('lore-modal');
        if (modal) modal.classList.remove('active');
    }

    function getPlanetarium() {
        return window.NightSky && window.NightSky.state && window.NightSky.state.planetarium;
    }

    /** Parse catalog RA → degrees (0–360). Accepts "5h 30m", hours number, or degrees. */
    function parseRA(ra) {
        if (ra == null || ra === '') return null;
        if (typeof ra === 'number' && !isNaN(ra)) {
            return ra <= 24 ? ra * 15 : ra;
        }
        var s = String(ra).trim();
        var hms = s.match(/([+-]?\d+(?:\.\d+)?)\s*h\s*([+-]?\d+(?:\.\d+)?)?\s*m?\s*([+-]?\d+(?:\.\d+)?)?\s*s?/i);
        if (hms) {
            var h = parseFloat(hms[1]) || 0;
            var m = parseFloat(hms[2]) || 0;
            var sec = parseFloat(hms[3]) || 0;
            return (h + m / 60 + sec / 3600) * 15;
        }
        var n = parseFloat(s);
        if (isNaN(n)) return null;
        return n <= 24 ? n * 15 : n;
    }

    /** Parse catalog Dec → degrees. Accepts "-5° 23'", "-0", numbers. */
    function parseDec(dec) {
        if (dec == null || dec === '') return null;
        if (typeof dec === 'number' && !isNaN(dec)) return dec;
        var s = String(dec).trim();
        var dms = s.match(/([+-]?\d+(?:\.\d+)?)\s*[°d]?\s*([+-]?\d+(?:\.\d+)?)?\s*['m]?\s*([+-]?\d+(?:\.\d+)?)?\s*["s]?/i);
        if (dms && /[°d'"mh]/.test(s)) {
            var sign = String(dms[1]).trim().charAt(0) === '-' ? -1 : 1;
            var d = Math.abs(parseFloat(dms[1]) || 0);
            var mi = parseFloat(dms[2]) || 0;
            var se = parseFloat(dms[3]) || 0;
            return sign * (d + mi / 60 + se / 3600);
        }
        var n = parseFloat(s);
        return isNaN(n) ? null : n;
    }

    function coordsFromObject(obj) {
        if (!obj) return null;
        if (obj.coordinates) {
            var ra = parseRA(obj.coordinates.ra);
            var dec = parseDec(obj.coordinates.dec);
            if (ra != null && dec != null) return { ra: ra, dec: dec };
        }
        if (obj.ra != null && obj.dec != null) {
            var ra2 = parseRA(obj.ra);
            var dec2 = parseDec(obj.dec);
            if (ra2 != null && dec2 != null) return { ra: ra2, dec: dec2 };
        }
        return null;
    }

    /**
     * Pull a SIMBAD-friendly identifier from a free-text DSO label.
     * "M42 Orion Nebula" → "M42"; "Flame Nebula (NGC 2024)" → "NGC 2024"
     */
    function simbadNameFromLabel(label) {
        var s = String(label || '').trim();
        if (!s) return '';
        var m;
        if ((m = s.match(/\((NGC\s*\d+[A-Za-z]?(?:\s*&\s*NGC\s*\d+[A-Za-z]?)?)\)/i))) {
            // Double Cluster (NGC 869 & NGC 884) → first NGC
            var part = m[1].split('&')[0].trim();
            return part.replace(/\s+/g, ' ');
        }
        if ((m = s.match(/\((IC\s*\d+)\)/i))) return m[1].replace(/\s+/g, ' ');
        if ((m = s.match(/\b(M\s*\d{1,3}[A-Za-z]?)\b/i))) return m[1].replace(/\s+/g, '');
        if ((m = s.match(/\b(NGC\s*\d+[A-Za-z]?)\b/i))) return m[1].replace(/\s+/g, ' ');
        if ((m = s.match(/\b(IC\s*\d+)\b/i))) return m[1].replace(/\s+/g, ' ');
        if ((m = s.match(/\b(Cr\s*\d+)\b/i))) return m[1].replace(/\s+/g, ' ');
        if ((m = s.match(/\b(Sh2[- ]?\d+)\b/i))) return m[1];
        // Drop trailing parenthetical notes
        return s.replace(/\s*\([^)]*\)\s*$/, '').trim();
    }

    function apiBase() {
        if (typeof API_URL !== 'undefined') return API_URL;
        if (window.NightSky && window.NightSky.apiUrl != null) return window.NightSky.apiUrl;
        if (typeof location !== 'undefined' && location.port === '5051') return '';
        return 'http://localhost:5051';
    }

    function panPlanetariumTo(raDeg, decDeg) {
        var p = getPlanetarium();
        if (!p) return false;
        try {
            // Prefer constellation lines/labels so the figure is readable
            if (p.constellation) {
                if (p.constellation.lines === false) p.constellation.lines = true;
                if (p.constellation.labels === false) p.constellation.labels = true;
            }
            if (typeof p.panTo === 'function') {
                p.panTo(raDeg, decDeg, 900);
            } else {
                if (typeof p.setRA === 'function') p.setRA(raDeg);
                if (typeof p.setDec === 'function') p.setDec(decDeg);
                if (typeof p.draw === 'function') p.draw();
            }
            return true;
        } catch (e) {
            console.warn('[LoreBrowser] panPlanetariumTo failed', e);
            return false;
        }
    }

    function openTelescopeAt(raDeg, decDeg, title) {
        if (typeof openTelescopeView === 'function') {
            openTelescopeView(raDeg, decDeg);
        } else if (window.openTelescopeView) {
            window.openTelescopeView(raDeg, decDeg);
        } else {
            console.warn('[LoreBrowser] openTelescopeView not available');
            return;
        }
        var titleEl = document.getElementById('telescope-title');
        if (titleEl && title) titleEl.textContent = title;
    }

    function resolveAndOpenTelescope(queryName, displayTitle) {
        var name = String(queryName || '').trim();
        if (!name) return Promise.resolve(false);

        var clickInfo = document.getElementById('click-info');
        if (clickInfo) clickInfo.innerHTML = 'Resolving “' + escapeHtml(displayTitle || name) + '”…';

        var url = apiBase() + '/api/simbad/resolve?name=' + encodeURIComponent(name);
        return fetch(url).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        }).then(function (data) {
            if (data.error || data.ra === undefined || data.dec === undefined) {
                throw new Error(data.error || 'not found');
            }
            closeLoreModal();
            openTelescopeAt(data.ra, data.dec, displayTitle || data.name || name);
            return true;
        }).catch(function (err) {
            console.warn('[LoreBrowser] SIMBAD resolve failed for', name, err);
            if (clickInfo) {
                clickInfo.innerHTML = 'Could not resolve “' + escapeHtml(displayTitle || name) + '”';
            }
            // Still try opening telescope after a coordinate fallback if we have none
            alert('Could not find “' + (displayTitle || name) + '” in SIMBAD.');
            return false;
        });
    }

    function openObjectInSky(obj, mode) {
        // mode: 'sky' | 'telescope' | 'both'
        mode = mode || 'both';
        var coords = coordsFromObject(obj);
        var title = obj && (obj.name || obj.id);

        function afterCoords(c) {
            if (!c) {
                // Resolve by name (constellation, star, planet…)
                if (mode === 'sky') {
                    // Need coords for planetarium; resolve then pan
                    return resolveCoordsByName(title).then(function (rc) {
                        if (!rc) {
                            alert('No coordinates for “' + title + '”.');
                            return;
                        }
                        closeLoreModal();
                        panPlanetariumTo(rc.ra, rc.dec);
                    });
                }
                return resolveAndOpenTelescope(title, title);
            }
            closeLoreModal();
            if (mode === 'sky' || mode === 'both') panPlanetariumTo(c.ra, c.dec);
            if (mode === 'telescope' || mode === 'both') {
                // slight delay so planetarium can start panning first when both
                if (mode === 'both') {
                    setTimeout(function () { openTelescopeAt(c.ra, c.dec, title); }, 200);
                } else {
                    openTelescopeAt(c.ra, c.dec, title);
                }
            }
            return Promise.resolve(true);
        }

        return Promise.resolve(afterCoords(coords));
    }

    function resolveCoordsByName(name) {
        var url = apiBase() + '/api/simbad/resolve?name=' + encodeURIComponent(name);
        return fetch(url).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        }).then(function (data) {
            if (data.ra === undefined || data.dec === undefined) return null;
            return { ra: data.ra, dec: data.dec, name: data.name };
        }).catch(function () { return null; });
    }

    function findConstellationByName(name) {
        if (!catalog || !name) return null;
        var n = String(name).toLowerCase().trim();
        var pools = []
            .concat(catalog.constellations || [])
            .concat(catalog.zodiac || [])
            .concat(catalog.asterisms || []);
        return pools.find(function (o) {
            return (o.name && o.name.toLowerCase() === n) ||
                (o.id && o.id.toLowerCase() === n) ||
                (o.abbreviation && o.abbreviation.toLowerCase() === n);
        }) || null;
    }

    function openConstellationEntry(name) {
        var entry = findConstellationByName(name);
        if (!entry) {
            // Fall back to sky resolve
            resolveAndOpenTelescope(name, name);
            return;
        }
        // Show lore for that constellation and switch category if needed
        if (entry.type === 'zodiac' || (catalog.zodiac || []).some(function (z) { return z.id === entry.id; })) {
            selectedCategory = 'zodiac';
        } else if ((catalog.asterisms || []).some(function (a) { return a.id === entry.id; })) {
            selectedCategory = 'asterisms';
        } else {
            selectedCategory = 'constellations';
        }
        var cats = document.getElementById('lore-categories');
        if (cats) {
            cats.querySelectorAll('.lore-cat-btn').forEach(function (b) {
                b.classList.toggle('active', b.getAttribute('data-category') === selectedCategory);
            });
        }
        selectedObject = entry;
        updateObjectList();
        displayStory(entry);
    }

    function bindLoreLinks(area, obj) {
        if (!area) return;

        area.querySelectorAll('[data-lore-action]').forEach(function (el) {
            el.addEventListener('click', function (e) {
                e.preventDefault();
                var action = el.getAttribute('data-lore-action');
                if (action === 'sky') openObjectInSky(obj, 'sky');
                else if (action === 'telescope') openObjectInSky(obj, 'telescope');
                else if (action === 'both') openObjectInSky(obj, 'both');
            });
        });

        area.querySelectorAll('[data-dso]').forEach(function (el) {
            el.addEventListener('click', function (e) {
                e.preventDefault();
                var label = el.getAttribute('data-dso') || el.textContent;
                var query = el.getAttribute('data-dso-query') || simbadNameFromLabel(label);
                el.classList.add('lore-link-busy');
                resolveAndOpenTelescope(query, label).finally(function () {
                    el.classList.remove('lore-link-busy');
                });
            });
        });

        area.querySelectorAll('[data-constellation-link]').forEach(function (el) {
            el.addEventListener('click', function (e) {
                e.preventDefault();
                var name = el.getAttribute('data-constellation-link');
                openConstellationEntry(name);
            });
        });

        area.querySelectorAll('[data-star-link]').forEach(function (el) {
            el.addEventListener('click', function (e) {
                e.preventDefault();
                var name = el.getAttribute('data-star-link') || el.textContent;
                el.classList.add('lore-link-busy');
                resolveAndOpenTelescope(name, name).finally(function () {
                    el.classList.remove('lore-link-busy');
                });
            });
        });
    }

    /**
     * Catalog entries use either culture-keyed mythology
     *   { greek: { story, ... }, chinese: { ... } }
     * or a flat single myth (meteor showers):
     *   { name, story }
     */
    function normalizeMythology(mythology) {
        var keys = Object.keys(mythology);
        var hasNestedCulture = keys.some(function (k) {
            var v = mythology[k];
            return v && typeof v === 'object' && !Array.isArray(v);
        });
        if (!hasNestedCulture) {
            return { general: mythology };
        }
        // Flat-ish with only name/story/note at top and no culture nests already handled;
        // if keys look like myth fields not cultures, wrap
        var cultureKeys = {
            greek: 1, roman: 1, chinese: 1, arabic: 1, hebrew: 1, african: 1,
            indigenous: 1, hindu: 1, mesopotamian: 1, egyptian: 1, babylonian: 1,
            polynesian: 1, mayan: 1, norse: 1, persian: 1, general: 1
        };
        var looksCultural = keys.some(function (k) { return cultureKeys[k]; });
        if (!looksCultural && (mythology.story || mythology.name)) {
            return { general: mythology };
        }
        return mythology;
    }

    function renderMythBody(myth) {
        var html = '';
        if (typeof myth === 'string') {
            return '<div class="lore-body">' + escapeHtml(myth) + '</div>';
        }
        if (!myth || typeof myth !== 'object') return '';
        if (myth.name) {
            html += '<div class="lore-myth-name">' + escapeHtml(myth.name) + '</div>';
        }
        if (myth.deity) {
            html += '<div class="lore-detail-line"><strong>Deity:</strong> ' +
                escapeHtml(myth.deity) + '</div>';
        }
        if (myth.domain) {
            html += '<div class="lore-detail-line"><strong>Domain:</strong> ' +
                escapeHtml(myth.domain) + '</div>';
        }
        if (myth.story) {
            html += '<div class="lore-body">' + escapeHtml(myth.story) + '</div>';
        }
        if (myth.note) {
            html += '<div class="lore-body">' + escapeHtml(myth.note) + '</div>';
        }
        if (myth.association) {
            html += '<div class="lore-detail-line"><strong>Association:</strong> ' +
                escapeHtml(myth.association) + '</div>';
        }
        if (myth.symbols) {
            var sym = Array.isArray(myth.symbols) ? myth.symbols.join(', ') : String(myth.symbols);
            html += '<div class="lore-detail-line"><strong>Symbols:</strong> ' +
                escapeHtml(sym) + '</div>';
        }
        if (myth.day) {
            html += '<div class="lore-detail-line"><strong>Day:</strong> ' +
                escapeHtml(myth.day) + '</div>';
        }
        if (myth.characters && myth.characters.length) {
            html += '<div class="lore-detail-line"><strong>Characters:</strong> ' +
                escapeHtml(myth.characters.join(', ')) + '</div>';
        }
        if (myth.moral) {
            html += '<div class="lore-detail-line"><strong>Theme:</strong> ' +
                escapeHtml(myth.moral) + '</div>';
        }
        if (myth.sources && myth.sources.length) {
            html += '<div class="lore-detail-line lore-sources"><strong>Sources:</strong> ' +
                escapeHtml(myth.sources.join('; ')) + '</div>';
        }
        return html;
    }

    function titleCase(s) {
        return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, function (c) {
            return c.toUpperCase();
        });
    }

    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function escapeAttr(str) {
        return escapeHtml(str).replace(/'/g, '&#39;');
    }

    if (window.NightSky && window.NightSky.features) {
        window.NightSky.features.register('lorebrowser', {
            init: init
        });
    }
})();
