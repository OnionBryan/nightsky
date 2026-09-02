/**
 * Planet Stories + Click-to-Identify
 *
 * Adds interactive planet identification to the Night Sky Viewer:
 *  1. Loads planet_stories.json with cultural stories and Renaissance discovery maths
 *  2. Hooks into VirtualSky's click event to detect clicks on dynamic planet coordinates
 *  3. Shows floating glassmorphic panel with deep historical/mathematical lore
 */
(function() {
    'use strict';

    var planetData = {};
    var activePopup = null;

    function init() {
        loadPlanetStories();
        injectStyles();
        setupCanvasClickDetection();
    }

    function loadPlanetStories() {
        fetch('data/planet_stories.json')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                // Convert array to map for O(1) lookup
                data.forEach(function(p) {
                    planetData[p.name.toLowerCase()] = p;
                });
            })
            .catch(function(err) {
                console.warn('[PlanetStories] Could not load planet_stories.json:', err);
            });
    }

    function setupCanvasClickDetection() {
        setTimeout(function() {
            var container = document.getElementById('starmap');
            if (!container) return;

            container.addEventListener('click', function(evt) {
                if (activePopup) return; // wait for close

                var canvas = container.querySelector('canvas');
                if (!canvas) return;

                var rect = canvas.getBoundingClientRect();
                var x = evt.clientX - rect.left;
                var y = evt.clientY - rect.top;

                var p = window.NightSky && window.NightSky.state.planetarium;
                if (!p) return;

                var nearestPlanetName = findNearestPlanetByPixel(p, x, y);
                if (nearestPlanetName) {
                    var data = planetData[nearestPlanetName.toLowerCase()];
                    if (data) {
                        showPlanetStoryPopup(data, evt.clientX, evt.clientY);
                    }
                }
            });
        }, 1200); // Wait for VirtualSky to initialize
    }

    function findNearestPlanetByPixel(p, cx, cy) {
        var bestDist = 20; // Slightly larger hit area for planets
        var bestName = null;

        // VirtualSky stores planets in p.planets, and sometimes sun/moon are separate or included
        var bodies = [];
        if (p.planets) {
            bodies = bodies.concat(p.planets);
        }
        
        // Add sun and moon if they are explicitly available in VirtualSky state
        if (typeof p.getMoon === 'function') {
            var moon = p.getMoon();
            if (moon) { moon.name = 'Moon'; bodies.push(moon); }
        }
        if (typeof p.getSun === 'function') {
            var sun = p.getSun();
            if (sun) { sun.name = 'Sun'; bodies.push(sun); }
        }

        for (var i = 0; i < bodies.length; i++) {
            var body = bodies[i];
            // body.ra and body.dec are usually in radians or hours depending on VirtualSky version.
            // VirtualSky planets typically have a position object or ra/dec properties.
            var raRad, decRad;
            if (body.position) {
                raRad = body.position.ra;
                decRad = body.position.dec;
            } else if (body.ra !== undefined) {
                raRad = body.ra;
                decRad = body.dec;
            } else {
                continue;
            }

            var xy;
            try { xy = p.radec2xy(raRad, decRad); } catch (e) { continue; }
            if (!xy || !isFinite(xy.x) || !isFinite(xy.y)) continue;

            var dx = xy.x - cx;
            var dy = xy.y - cy;
            var dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist < bestDist) {
                bestDist = dist;
                bestName = body.name || body.id;
            }
        }
        return bestName;
    }

    function showPlanetStoryPopup(planet, screenX, screenY) {
        dismissPopup();

        var popup = document.createElement('div');
        popup.className = 'ps-popup';

        // ── Header
        var header = document.createElement('div');
        header.className = 'ps-header';

        var nameSpan = document.createElement('span');
        nameSpan.className = 'ps-name';
        nameSpan.textContent = planet.name;
        header.appendChild(nameSpan);

        var typeSpan = document.createElement('span');
        typeSpan.className = 'ps-type';
        typeSpan.textContent = 'Wandering Star';
        header.appendChild(typeSpan);

        var closeBtn = document.createElement('button');
        closeBtn.className = 'ps-close';
        closeBtn.title = 'Close';
        closeBtn.innerHTML = '&times;';
        closeBtn.addEventListener('click', dismissPopup);
        header.appendChild(closeBtn);

        popup.appendChild(header);

        // ── Story
        var story = document.createElement('p');
        story.className = 'ps-story';
        story.textContent = planet.story || '';
        popup.appendChild(story);

        // ── Tabs
        var tabBar = document.createElement('div');
        tabBar.className = 'ps-tabs';

        var tabContent = document.createElement('div');
        tabContent.className = 'ps-tab-content';

        var tabsData = [];
        
        if (planet.renaissance_discovery) {
            tabsData.push({ id: 'math', label: 'Mathematics & Discovery', content: planet.renaissance_discovery });
        }
        if (planet.culture_notes) {
            Object.keys(planet.culture_notes).forEach(function(culture) {
                tabsData.push({
                    id: culture,
                    label: culture.charAt(0).toUpperCase() + culture.slice(1) + ' Lore',
                    content: planet.culture_notes[culture]
                });
            });
        }

        tabsData.forEach(function(tab, index) {
            var btn = document.createElement('button');
            btn.className = 'ps-tab-btn' + (index === 0 ? ' active' : '');
            btn.textContent = tab.label;
            btn.setAttribute('data-tab', tab.id);
            tabBar.appendChild(btn);

            var pane = document.createElement('div');
            pane.className = 'ps-tab-pane' + (index === 0 ? ' active' : '');
            pane.setAttribute('data-tab', tab.id);
            
            // Allow basic markdown-like rendering for math/history
            var contentHtml = tab.content
                .replace(/\n\n/g, '</p><p>')
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>');
            pane.innerHTML = '<p>' + contentHtml + '</p>';
            
            tabContent.appendChild(pane);
        });

        tabBar.addEventListener('click', function(evt) {
            var clicked = evt.target.closest('.ps-tab-btn');
            if (!clicked) return;
            var tabId = clicked.getAttribute('data-tab');

            tabBar.querySelectorAll('.ps-tab-btn').forEach(function(b) {
                b.classList.toggle('active', b === clicked);
            });
            tabContent.querySelectorAll('.ps-tab-pane').forEach(function(pn) {
                pn.classList.toggle('active', pn.getAttribute('data-tab') === tabId);
            });
        });

        if (tabsData.length > 0) {
            popup.appendChild(tabBar);
            popup.appendChild(tabContent);
        }

        positionPopup(popup, screenX, screenY);
        document.body.appendChild(popup);
        activePopup = popup;

        setTimeout(function() {
            document.addEventListener('click', outsideClickHandler);
        }, 50);
    }

    function positionPopup(popup, sx, sy) {
        popup.style.position = 'fixed';
        popup.style.zIndex = '10001';
        popup.style.visibility = 'hidden';
        document.body.appendChild(popup);
        
        var w = popup.offsetWidth;
        var h = popup.offsetHeight;
        document.body.removeChild(popup);
        popup.style.visibility = '';

        var vw = window.innerWidth;
        var vh = window.innerHeight;

        var left = sx + 20;
        var top  = sy - 30;

        if (left + w > vw - 16) left = sx - w - 20;
        if (left < 16) left = 16;
        if (top + h > vh - 16) top = vh - h - 16;
        if (top < 16) top = 16;

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

    function injectStyles() {
        var css = '' +
        '.ps-popup {' +
            'background: rgba(8, 16, 24, 0.7);' +
            'backdrop-filter: blur(30px);' +
            '-webkit-backdrop-filter: blur(30px);' +
            'border: 1px solid rgba(130, 180, 255, 0.25);' +
            'border-radius: 16px;' +
            'width: 440px;' +
            'max-width: 94vw;' +
            'font-family: "DM Sans", sans-serif;' +
            'color: #d8e4f0;' +
            'box-shadow: 0 24px 60px rgba(0,0,0,0.9), inset 0 1px 2px rgba(255,255,255,0.08);' +
            'overflow: hidden;' +
            'animation: ps-slideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1);' +
        '}' +
        '@keyframes ps-slideUp {' +
            'from { opacity: 0; transform: translateY(20px) scale(0.97); }' +
            'to   { opacity: 1; transform: translateY(0) scale(1); }' +
        '}' +
        '.ps-header {' +
            'display: flex;' +
            'align-items: center;' +
            'padding: 16px 20px 12px;' +
            'background: linear-gradient(180deg, rgba(130,180,255,0.12) 0%, transparent 100%);' +
            'border-bottom: 1px solid rgba(130,180,255,0.1);' +
        '}' +
        '.ps-name {' +
            'font-family: "Playfair Display", serif;' +
            'font-size: 26px;' +
            'font-weight: 700;' +
            'color: #a0c4ff;' +
            'text-shadow: 0 2px 16px rgba(160,196,255,0.4);' +
            'letter-spacing: 0.02em;' +
        '}' +
        '.ps-type {' +
            'font-family: "JetBrains Mono", monospace;' +
            'font-size: 11px;' +
            'color: #7a9fd6;' +
            'text-transform: uppercase;' +
            'letter-spacing: 0.12em;' +
            'margin-left: 16px;' +
            'opacity: 0.85;' +
            'margin-top: 6px;' +
        '}' +
        '.ps-close {' +
            'background: rgba(255,255,255,0.04);' +
            'border: 1px solid rgba(255,255,255,0.1);' +
            'border-radius: 50%;' +
            'width: 28px;' +
            'height: 28px;' +
            'color: #8fa8c7;' +
            'font-size: 20px;' +
            'cursor: pointer;' +
            'display: flex;' +
            'align-items: center;' +
            'justify-content: center;' +
            'margin-left: auto;' +
            'transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);' +
        '}' +
        '.ps-close:hover { background: rgba(160,196,255,0.15); color: #cce0ff; transform: rotate(90deg); border-color: rgba(160,196,255,0.3); }' +
        '.ps-story {' +
            'padding: 18px 24px 14px;' +
            'font-size: 14.5px;' +
            'line-height: 1.65;' +
            'color: #e2ecf5;' +
            'margin: 0;' +
        '}' +
        '.ps-tabs {' +
            'display: flex;' +
            'gap: 4px;' +
            'padding: 0 20px;' +
            'border-bottom: 1px solid rgba(130,180,255,0.15);' +
            'overflow-x: auto;' +
            'margin-top: 4px;' +
        '}' +
        '.ps-tabs::-webkit-scrollbar { height: 2px; }' +
        '.ps-tabs::-webkit-scrollbar-thumb { background: rgba(130,180,255,0.3); }' +
        '.ps-tab-btn {' +
            'background: transparent;' +
            'border: none;' +
            'padding: 12px 16px;' +
            'font-size: 13.5px;' +
            'font-weight: 600;' +
            'color: #7a9fd6;' +
            'cursor: pointer;' +
            'white-space: nowrap;' +
            'border-bottom: 2px solid transparent;' +
            'font-family: "DM Sans", sans-serif;' +
            'transition: all 0.2s ease;' +
        '}' +
        '.ps-tab-btn:hover { color: #a0c4ff; }' +
        '.ps-tab-btn.active {' +
            'color: #cce0ff;' +
            'border-bottom-color: #cce0ff;' +
        '}' +
        '.ps-tab-content { padding: 20px 24px 28px; min-height: 100px; max-height: 300px; overflow-y: auto; }' +
        '.ps-tab-content::-webkit-scrollbar { width: 4px; }' +
        '.ps-tab-content::-webkit-scrollbar-thumb { background: rgba(130,180,255,0.3); border-radius: 2px; }' +
        '.ps-tab-pane {' +
            'display: none;' +
            'font-size: 14px;' +
            'line-height: 1.7;' +
            'color: #cfdee8;' +
            'animation: ps-fade 0.4s ease-out;' +
        '}' +
        '.ps-tab-pane p { margin-bottom: 12px; }' +
        '.ps-tab-pane p:last-child { margin-bottom: 0; }' +
        '.ps-tab-pane strong { color: #a0c4ff; font-weight: 600; }' +
        '@keyframes ps-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }' +
        '.ps-tab-pane.active { display: block; }' +
        '.redlight .ps-popup {' +
            'background: rgba(20, 0, 0, 0.85);' +
            'border-color: rgba(255, 60, 60, 0.4);' +
            'box-shadow: 0 24px 60px rgba(0,0,0,0.95), inset 0 1px 2px rgba(255,60,60,0.1);' +
        '}' +
        '.redlight .ps-header { background: linear-gradient(180deg, rgba(255,60,60,0.15) 0%, transparent 100%); border-bottom-color: rgba(255,60,60,0.2); }' +
        '.redlight .ps-name { color: #ff5555; text-shadow: 0 2px 16px rgba(255,60,60,0.4); }' +
        '.redlight .ps-type { color: #cc4444; }' +
        '.redlight .ps-tab-btn { color: #aa4444; }' +
        '.redlight .ps-tab-btn:hover { color: #ff5555; }' +
        '.redlight .ps-tab-btn.active { color: #ff7777; border-bottom-color: #ff7777; }' +
        '.redlight .ps-tab-pane strong { color: #ff5555; }';

        var style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    if (window.NightSky && window.NightSky.features) {
        window.NightSky.features.register('planetstories', {
            init: init
        });
    }
})();
