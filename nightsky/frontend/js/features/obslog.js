/**
 * Observation Log with Catalog Progress Tracking
 *
 * Registers as 'obslog' with window.NightSky.features.
 * Persists all data in localStorage (offline-first, no backend required).
 *
 * Data model per observation:
 *   { id, objectName, catalog, date, time, location, seeing, transparency, notes, rating }
 *
 * Provides:
 *   - "Log Observation" button that opens a compact inline form
 *   - Recent observations list (last 5, expandable to full list)
 *   - Catalog progress bars: Messier (110), Caldwell (109)
 *   - CSV export of all observations
 *   - Auto-fill object name from last viewed star/object
 */
(function () {
    'use strict';

    // ── Constants ──────────────────────────────────────────────
    var STORAGE_KEY = 'nightsky-obslog';
    var MESSIER_TOTAL = 110;
    var CALDWELL_TOTAL = 109;
    var RECENT_LIMIT = 5;

    // ── State ──────────────────────────────────────────────────
    var observations = [];
    var formVisible = false;
    var listExpanded = false;

    // ── Persistence ────────────────────────────────────────────
    function loadObservations() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            observations = raw ? JSON.parse(raw) : [];
        } catch (e) {
            console.error('[obslog] Error loading observations:', e);
            observations = [];
        }
        importLegacyObserved();
    }

    function saveObservations() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(observations));
        } catch (e) {
            console.error('[obslog] Error saving observations:', e);
        }
    }

    /**
     * One-time migration: import legacy nightsky-observed-messier / caldwell
     * arrays from the planner as minimal observation records.
     */
    function importLegacyObserved() {
        var migrated = false;
        ['messier', 'caldwell'].forEach(function (cat) {
            var key = 'nightsky-observed-' + cat;
            var raw = localStorage.getItem(key);
            if (!raw) return;
            try {
                var ids = JSON.parse(raw);
                if (!Array.isArray(ids) || ids.length === 0) return;
                var existing = {};
                observations.forEach(function (obs) {
                    if (obs.catalog === cat) existing[obs.objectName] = true;
                });
                var prefix = cat === 'messier' ? 'M' : 'C';
                ids.forEach(function (id) {
                    var name = prefix + id;
                    if (!existing[name]) {
                        observations.push({
                            id: generateId(),
                            objectName: name,
                            catalog: cat,
                            date: '2026-01-01',
                            time: '00:00',
                            location: '',
                            seeing: 3,
                            transparency: 3,
                            notes: 'Imported from planner checklist',
                            rating: 3
                        });
                        migrated = true;
                    }
                });
                localStorage.removeItem(key);
            } catch (e) {
                // Ignore malformed legacy data
            }
        });
        if (migrated) saveObservations();
    }

    // ── Helpers ────────────────────────────────────────────────
    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
    }

    function el(tag, className, textContent) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (textContent !== undefined) node.textContent = textContent;
        return node;
    }

    function todayStr() {
        var d = new Date();
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    }

    function nowTimeStr() {
        var d = new Date();
        return String(d.getHours()).padStart(2, '0') + ':' +
            String(d.getMinutes()).padStart(2, '0');
    }

    /**
     * Attempt to determine the last-viewed object name from the
     * click-info panel in the telescope modal.
     */
    function getLastViewedObject() {
        var clickInfo = document.getElementById('click-info');
        if (clickInfo) {
            var strong = clickInfo.querySelector('strong');
            if (strong && strong.textContent && strong.textContent !== 'Unknown') {
                return strong.textContent.trim();
            }
        }
        return '';
    }

    function guessCatalog(name) {
        if (!name) return 'other';
        var n = name.trim().toUpperCase();
        if (/^M\s?\d+$/.test(n)) return 'messier';
        if (/^C\s?\d+$/.test(n) || /^CALDWELL/i.test(n)) return 'caldwell';
        return 'other';
    }

    // ── Catalog Progress ───────────────────────────────────────
    function getCatalogCounts() {
        var messier = {};
        var caldwell = {};
        observations.forEach(function (obs) {
            if (obs.catalog === 'messier') messier[obs.objectName] = true;
            if (obs.catalog === 'caldwell') caldwell[obs.objectName] = true;
        });
        return {
            messier: Object.keys(messier).length,
            caldwell: Object.keys(caldwell).length
        };
    }

    // ── Star Rating Rendering ──────────────────────────────────
    function renderStarsText(rating) {
        var s = '';
        for (var i = 1; i <= 5; i++) {
            s += i <= rating ? '\u2605' : '\u2606';
        }
        return s;
    }

    function buildStarPicker(initialValue) {
        var wrapper = el('div', 'obslog-star-picker');
        wrapper.id = 'obslog-rating-picker';
        wrapper.setAttribute('data-value', initialValue || 0);
        for (var i = 1; i <= 5; i++) {
            (function (val) {
                var star = el('span', 'obslog-star-pick', val <= initialValue ? '\u2605' : '\u2606');
                star.setAttribute('data-val', val);
                star.addEventListener('click', function () {
                    wrapper.setAttribute('data-value', val);
                    var stars = wrapper.querySelectorAll('.obslog-star-pick');
                    for (var j = 0; j < stars.length; j++) {
                        stars[j].textContent = (j + 1) <= val ? '\u2605' : '\u2606';
                        stars[j].classList.toggle('active', (j + 1) <= val);
                    }
                });
                star.addEventListener('mouseenter', function () {
                    var stars = wrapper.querySelectorAll('.obslog-star-pick');
                    for (var j = 0; j < stars.length; j++) {
                        stars[j].classList.toggle('hover', (j + 1) <= val);
                    }
                });
                star.addEventListener('mouseleave', function () {
                    var stars = wrapper.querySelectorAll('.obslog-star-pick');
                    for (var j = 0; j < stars.length; j++) {
                        stars[j].classList.remove('hover');
                    }
                });
                wrapper.appendChild(star);
            })(i);
        }
        return wrapper;
    }

    // ── Clear Children Helper ──────────────────────────────────
    function clearChildren(node) {
        while (node.firstChild) {
            node.removeChild(node.firstChild);
        }
    }

    // ── DOM Construction ───────────────────────────────────────
    function createDOMStructure() {
        var sidebar = document.querySelector('.controls-panel');
        if (!sidebar) return;
        if (document.getElementById('obslog-section')) return;

        var section = el('div', 'control-section obslog-section');
        section.id = 'obslog-section';

        // Header
        section.appendChild(el('h3', '', 'Observation Log'));

        // Top row: Log button + Export button
        var btnRow = el('div', 'obslog-btn-row');

        var logBtn = el('button', 'obslog-log-btn', 'Log Observation');
        logBtn.id = 'obslog-log-btn';
        logBtn.addEventListener('click', toggleForm);
        btnRow.appendChild(logBtn);

        var exportBtn = el('button', 'obslog-export-btn', 'Export CSV');
        exportBtn.id = 'obslog-export-btn';
        exportBtn.addEventListener('click', exportCSV);
        btnRow.appendChild(exportBtn);

        section.appendChild(btnRow);

        // Form container (hidden by default)
        var formWrap = el('div', 'obslog-form-wrap');
        formWrap.id = 'obslog-form-wrap';
        formWrap.style.display = 'none';
        section.appendChild(formWrap);

        // Catalog progress
        var progressWrap = el('div', 'obslog-progress-wrap');
        progressWrap.id = 'obslog-progress-wrap';
        section.appendChild(progressWrap);

        // Recent observations list
        var listHeader = el('div', 'obslog-list-header');
        listHeader.appendChild(el('span', 'obslog-list-title', 'Recent'));
        var expandBtn = el('button', 'obslog-expand-btn', 'Show all');
        expandBtn.id = 'obslog-expand-btn';
        expandBtn.addEventListener('click', toggleListExpand);
        listHeader.appendChild(expandBtn);
        section.appendChild(listHeader);

        var listContainer = el('div', 'obslog-list');
        listContainer.id = 'obslog-list';
        section.appendChild(listContainer);

        sidebar.appendChild(section);
    }

    /**
     * Build the observation form using safe DOM methods (no innerHTML).
     */
    function buildForm(parent) {
        clearChildren(parent);

        var form = el('div', 'obslog-form');

        // Object name
        var f1 = el('div', 'obslog-field');
        var l1 = el('label', '', 'Object');
        l1.setAttribute('for', 'obslog-object');
        f1.appendChild(l1);
        var inp1 = el('input');
        inp1.type = 'text';
        inp1.id = 'obslog-object';
        inp1.placeholder = 'e.g. M31, Sirius';
        inp1.autocomplete = 'off';
        f1.appendChild(inp1);
        form.appendChild(f1);

        // Catalog select
        var f2 = el('div', 'obslog-field');
        var l2 = el('label', '', 'Catalog');
        l2.setAttribute('for', 'obslog-catalog');
        f2.appendChild(l2);
        var sel = document.createElement('select');
        sel.id = 'obslog-catalog';
        [['messier', 'Messier'], ['caldwell', 'Caldwell'], ['other', 'Other']].forEach(function (opt) {
            var o = document.createElement('option');
            o.value = opt[0];
            o.textContent = opt[1];
            sel.appendChild(o);
        });
        f2.appendChild(sel);
        form.appendChild(f2);

        // Date + Time row
        var row1 = el('div', 'obslog-field-row');

        var fDate = el('div', 'obslog-field');
        var lDate = el('label', '', 'Date');
        lDate.setAttribute('for', 'obslog-date');
        fDate.appendChild(lDate);
        var inpDate = el('input');
        inpDate.type = 'date';
        inpDate.id = 'obslog-date';
        fDate.appendChild(inpDate);
        row1.appendChild(fDate);

        var fTime = el('div', 'obslog-field');
        var lTime = el('label', '', 'Time');
        lTime.setAttribute('for', 'obslog-time');
        fTime.appendChild(lTime);
        var inpTime = el('input');
        inpTime.type = 'time';
        inpTime.id = 'obslog-time';
        fTime.appendChild(inpTime);
        row1.appendChild(fTime);

        form.appendChild(row1);

        // Location
        var f3 = el('div', 'obslog-field');
        var l3 = el('label', '', 'Location');
        l3.setAttribute('for', 'obslog-location');
        f3.appendChild(l3);
        var inp3 = el('input');
        inp3.type = 'text';
        inp3.id = 'obslog-location';
        inp3.placeholder = 'Observing site';
        f3.appendChild(inp3);
        form.appendChild(f3);

        // Seeing + Transparency row
        var row2 = el('div', 'obslog-field-row');

        var fSee = el('div', 'obslog-field');
        fSee.appendChild(el('label', '', 'Seeing (1-5)'));
        var rangeSee = el('input');
        rangeSee.type = 'range';
        rangeSee.id = 'obslog-seeing';
        rangeSee.min = '1';
        rangeSee.max = '5';
        rangeSee.value = '3';
        fSee.appendChild(rangeSee);
        var seeVal = el('span', 'obslog-range-val', '3');
        seeVal.id = 'obslog-seeing-val';
        fSee.appendChild(seeVal);
        row2.appendChild(fSee);

        var fTrans = el('div', 'obslog-field');
        fTrans.appendChild(el('label', '', 'Transparency (1-5)'));
        var rangeTrans = el('input');
        rangeTrans.type = 'range';
        rangeTrans.id = 'obslog-transparency';
        rangeTrans.min = '1';
        rangeTrans.max = '5';
        rangeTrans.value = '3';
        fTrans.appendChild(rangeTrans);
        var transVal = el('span', 'obslog-range-val', '3');
        transVal.id = 'obslog-transparency-val';
        fTrans.appendChild(transVal);
        row2.appendChild(fTrans);

        form.appendChild(row2);

        // Rating (star picker)
        var fRating = el('div', 'obslog-field');
        fRating.appendChild(el('label', '', 'Rating'));
        fRating.appendChild(buildStarPicker(3));
        form.appendChild(fRating);

        // Notes
        var fNotes = el('div', 'obslog-field');
        var lNotes = el('label', '', 'Notes');
        lNotes.setAttribute('for', 'obslog-notes');
        fNotes.appendChild(lNotes);
        var textarea = document.createElement('textarea');
        textarea.id = 'obslog-notes';
        textarea.rows = 2;
        textarea.placeholder = 'Observation notes...';
        fNotes.appendChild(textarea);
        form.appendChild(fNotes);

        // Actions
        var actions = el('div', 'obslog-form-actions');
        var saveBtn = el('button', 'obslog-save-btn', 'Save');
        saveBtn.id = 'obslog-save-btn';
        saveBtn.addEventListener('click', saveObservation);
        actions.appendChild(saveBtn);

        var cancelBtn = el('button', 'obslog-cancel-btn', 'Cancel');
        cancelBtn.id = 'obslog-cancel-btn';
        cancelBtn.addEventListener('click', function () {
            formVisible = false;
            var wrap = document.getElementById('obslog-form-wrap');
            if (wrap) wrap.style.display = 'none';
        });
        actions.appendChild(cancelBtn);

        form.appendChild(actions);
        parent.appendChild(form);
    }

    // ── Form Logic ─────────────────────────────────────────────
    function toggleForm() {
        var wrap = document.getElementById('obslog-form-wrap');
        if (!wrap) return;

        formVisible = !formVisible;
        wrap.style.display = formVisible ? 'block' : 'none';

        if (formVisible) {
            buildForm(wrap);
            populateFormDefaults();
            attachFormListeners();
        }
    }

    function populateFormDefaults() {
        var dateInput = document.getElementById('obslog-date');
        var timeInput = document.getElementById('obslog-time');
        var objectInput = document.getElementById('obslog-object');
        var catalogSelect = document.getElementById('obslog-catalog');
        var locationInput = document.getElementById('obslog-location');

        if (dateInput) dateInput.value = todayStr();
        if (timeInput) timeInput.value = nowTimeStr();

        // Auto-fill object name from last viewed
        var lastObj = getLastViewedObject();
        if (lastObj && objectInput) {
            objectInput.value = lastObj;
            if (catalogSelect) catalogSelect.value = guessCatalog(lastObj);
        }

        // Auto-fill location from NightSky state
        var ns = window.NightSky;
        if (ns && ns.state && locationInput) {
            if (ns.state.displayName) {
                locationInput.value = ns.state.displayName;
            } else if (ns.state.latitude && ns.state.longitude) {
                locationInput.value = ns.state.latitude.toFixed(2) + ', ' + ns.state.longitude.toFixed(2);
            }
        }
    }

    function attachFormListeners() {
        var seeing = document.getElementById('obslog-seeing');
        var seeingVal = document.getElementById('obslog-seeing-val');
        if (seeing && seeingVal) {
            seeing.oninput = function () { seeingVal.textContent = seeing.value; };
        }

        var trans = document.getElementById('obslog-transparency');
        var transVal = document.getElementById('obslog-transparency-val');
        if (trans && transVal) {
            trans.oninput = function () { transVal.textContent = trans.value; };
        }

        var objectInput = document.getElementById('obslog-object');
        var catalogSelect = document.getElementById('obslog-catalog');
        if (objectInput && catalogSelect) {
            objectInput.addEventListener('input', function () {
                catalogSelect.value = guessCatalog(objectInput.value);
            });
        }
    }

    function saveObservation() {
        var objectField = document.getElementById('obslog-object');
        var objectName = (objectField ? objectField.value : '').trim();
        if (!objectName) {
            if (objectField) {
                objectField.style.borderColor = 'var(--error)';
                objectField.focus();
                setTimeout(function () { objectField.style.borderColor = ''; }, 2000);
            }
            return;
        }

        var ratingPicker = document.getElementById('obslog-rating-picker');
        var rating = ratingPicker ? parseInt(ratingPicker.getAttribute('data-value'), 10) || 3 : 3;

        var obs = {
            id: generateId(),
            objectName: objectName,
            catalog: (document.getElementById('obslog-catalog') || {}).value || 'other',
            date: (document.getElementById('obslog-date') || {}).value || todayStr(),
            time: (document.getElementById('obslog-time') || {}).value || nowTimeStr(),
            location: ((document.getElementById('obslog-location') || {}).value || '').trim(),
            seeing: parseInt((document.getElementById('obslog-seeing') || {}).value, 10) || 3,
            transparency: parseInt((document.getElementById('obslog-transparency') || {}).value, 10) || 3,
            notes: ((document.getElementById('obslog-notes') || {}).value || '').trim(),
            rating: rating
        };

        observations.unshift(obs);
        saveObservations();

        // Close form and refresh UI
        formVisible = false;
        var wrap = document.getElementById('obslog-form-wrap');
        if (wrap) wrap.style.display = 'none';

        renderProgress();
        renderList();

        // Keep legacy planner observed sets in sync
        syncToLegacyPlanner(obs);
    }

    /**
     * Keep legacy planner observed sets in sync so the planner checklist
     * reflects observations logged here.
     */
    function syncToLegacyPlanner(obs) {
        if (obs.catalog !== 'messier' && obs.catalog !== 'caldwell') return;
        var match = obs.objectName.match(/^[MC]\s?(\d+)$/i);
        if (!match) return;
        var id = parseInt(match[1], 10);
        var key = 'nightsky-observed-' + obs.catalog;
        try {
            var raw = localStorage.getItem(key);
            var arr = raw ? JSON.parse(raw) : [];
            if (arr.indexOf(id) === -1) {
                arr.push(id);
                localStorage.setItem(key, JSON.stringify(arr));
            }
        } catch (e) {
            // Ignore
        }
    }

    // ── Render: Progress Bars ──────────────────────────────────
    function renderProgress() {
        var wrap = document.getElementById('obslog-progress-wrap');
        if (!wrap) return;

        clearChildren(wrap);

        var counts = getCatalogCounts();
        renderProgressBar(wrap, 'Messier', counts.messier, MESSIER_TOTAL);
        renderProgressBar(wrap, 'Caldwell', counts.caldwell, CALDWELL_TOTAL);
    }

    function renderProgressBar(parent, label, count, total) {
        var row = el('div', 'obslog-progress-row');

        row.appendChild(el('span', 'obslog-progress-label', label));

        var barOuter = el('div', 'obslog-progress-bar');
        var barInner = el('div', 'obslog-progress-fill');
        var pct = total > 0 ? Math.min((count / total) * 100, 100) : 0;
        barInner.style.width = pct.toFixed(1) + '%';
        barOuter.appendChild(barInner);
        row.appendChild(barOuter);

        row.appendChild(el('span', 'obslog-progress-count', count + '/' + total));

        parent.appendChild(row);
    }

    // ── Render: Recent List ────────────────────────────────────
    function renderList() {
        var container = document.getElementById('obslog-list');
        var expandBtn = document.getElementById('obslog-expand-btn');
        if (!container) return;

        clearChildren(container);

        if (observations.length === 0) {
            container.appendChild(el('div', 'obslog-empty', 'No observations yet. Start logging!'));
            if (expandBtn) expandBtn.style.display = 'none';
            return;
        }

        // Sort by date descending (newest first)
        var sorted = observations.slice().sort(function (a, b) {
            var da = a.date + 'T' + (a.time || '00:00');
            var db = b.date + 'T' + (b.time || '00:00');
            return db.localeCompare(da);
        });

        var limit = listExpanded ? sorted.length : Math.min(sorted.length, RECENT_LIMIT);
        for (var i = 0; i < limit; i++) {
            container.appendChild(renderObsCard(sorted[i]));
        }

        if (expandBtn) {
            if (sorted.length > RECENT_LIMIT) {
                expandBtn.style.display = 'inline-block';
                expandBtn.textContent = listExpanded ? 'Show less' : 'Show all (' + sorted.length + ')';
            } else {
                expandBtn.style.display = 'none';
            }
        }
    }

    function renderObsCard(obs) {
        var card = el('div', 'obslog-card');
        card.setAttribute('data-id', obs.id);

        var topRow = el('div', 'obslog-card-top');
        topRow.appendChild(el('span', 'obslog-card-name', obs.objectName));
        topRow.appendChild(el('span', 'obslog-card-stars', renderStarsText(obs.rating)));
        card.appendChild(topRow);

        var meta = el('div', 'obslog-card-meta');
        var dateStr = obs.date || '';
        if (obs.time) dateStr += ' ' + obs.time;
        if (obs.catalog && obs.catalog !== 'other') {
            dateStr += ' \u00B7 ' + obs.catalog.charAt(0).toUpperCase() + obs.catalog.slice(1);
        }
        meta.textContent = dateStr;
        card.appendChild(meta);

        if (obs.notes) {
            card.appendChild(el('div', 'obslog-card-notes', obs.notes));
        }

        // Delete button
        var delBtn = el('button', 'obslog-card-del', '\u00D7');
        delBtn.title = 'Delete observation';
        delBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            deleteObservation(obs.id);
        });
        card.appendChild(delBtn);

        return card;
    }

    function deleteObservation(id) {
        observations = observations.filter(function (o) { return o.id !== id; });
        saveObservations();
        renderProgress();
        renderList();
    }

    function toggleListExpand() {
        listExpanded = !listExpanded;
        renderList();
    }

    // ── CSV Export ──────────────────────────────────────────────
    function exportCSV() {
        if (observations.length === 0) return;

        var headers = ['Date', 'Time', 'Object', 'Catalog', 'Location',
                       'Seeing', 'Transparency', 'Rating', 'Notes'];
        var rows = observations.map(function (obs) {
            return [
                obs.date || '',
                obs.time || '',
                obs.objectName || '',
                obs.catalog || '',
                obs.location || '',
                obs.seeing || '',
                obs.transparency || '',
                obs.rating || '',
                obs.notes || ''
            ];
        });

        var lines = [headers];
        rows.forEach(function (r) { lines.push(r); });

        var csv = lines.map(function (row) {
            return row.map(function (v) {
                return '"' + String(v).replace(/"/g, '""') + '"';
            }).join(',');
        }).join('\n');

        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'observation_log_' + todayStr() + '.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ── Feature Module Interface ───────────────────────────────
    function init() {
        loadObservations();
        createDOMStructure();
        renderProgress();
        renderList();
    }

    function destroy() {
        var section = document.getElementById('obslog-section');
        if (section) section.remove();
        observations = [];
        formVisible = false;
        listExpanded = false;
    }

    // Register with NightSky feature system
    if (window.NightSky && window.NightSky.features) {
        window.NightSky.features.register('obslog', {
            init: init,
            destroy: destroy,
            onLocationChange: function () {},
            onTimeChange: function () {}
        });
    }
})();
