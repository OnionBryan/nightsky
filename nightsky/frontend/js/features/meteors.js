/**
 * Enhanced Meteor Showers Feature
 * Animated shooting stars from correct radiant point on overlay canvas.
 * ZHR gauge, peak countdown, upcoming showers list.
 */
(function() {
    let enabled = false;
    let particles = [];
    let animFrame = null;
    let showerData = [];
    const MAX_PARTICLES = 100;
    const PARTICLE_LIFETIME = 500; // ms

    function init() {
        const panel = document.getElementById('meteor-panel');
        if (!panel) return;

        // Load meteor shower data
        loadShowerData();

        const toggle = document.getElementById('meteor-toggle');
        if (toggle) {
            toggle.addEventListener('change', (e) => {
                enabled = e.target.checked;
                if (enabled) {
                    startAnimation();
                } else {
                    stopAnimation();
                }
            });
        }
    }

    function loadShowerData() {
        fetch('data/meteor_showers.json')
            .then(r => r.json())
            .then(data => {
                showerData = data;
                window._meteorShowerData = data; // Share with whatsup.js
                updateShowerList();
            })
            .catch(err => {
                console.log('Failed to load meteor shower data:', err);
            });
    }

    function updateShowerList() {
        const now = new Date();
        const month = now.getMonth() + 1;
        const day = now.getDate();
        const mmdd = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

        // Find active showers
        const active = showerData.filter(s => isDateInRange(mmdd, s.start, s.end));

        // Find upcoming showers (next 60 days)
        const upcoming = showerData.filter(s => {
            if (isDateInRange(mmdd, s.start, s.end)) return false;
            const peakParts = s.peak.split('-');
            const peakMonth = parseInt(peakParts[0]);
            const peakDay = parseInt(peakParts[1]);
            let peakDate = new Date(now.getFullYear(), peakMonth - 1, peakDay);
            if (peakDate < now) peakDate = new Date(now.getFullYear() + 1, peakMonth - 1, peakDay);
            const daysUntil = Math.round((peakDate - now) / 86400000);
            return daysUntil > 0 && daysUntil <= 60;
        });

        // Render active showers
        const activeList = document.getElementById('meteor-active');
        if (activeList) {
            if (active.length === 0) {
                activeList.innerHTML = '<div class="text-muted">No active showers right now</div>';
            } else {
                let html = '';
                active.forEach(s => {
                    const peakParts = s.peak.split('-');
                    const peakMonth = parseInt(peakParts[0]);
                    const peakDay = parseInt(peakParts[1]);
                    const peakDate = new Date(now.getFullYear(), peakMonth - 1, peakDay);
                    const daysToPeak = Math.round((peakDate - now) / 86400000);
                    const peakStr = daysToPeak === 0 ? 'PEAK TONIGHT' :
                                    daysToPeak > 0 ? `Peak in ${daysToPeak}d` : `${-daysToPeak}d past peak`;

                    // ZHR activity gauge
                    const zhrPct = Math.min((s.zhr / 150) * 100, 100);
                    const activity = getActivityLevel(s.zhr, daysToPeak);

                    html += `<div class="meteor-shower-card">
                        <div class="shower-header">
                            <span class="shower-name">${s.name}</span>
                            <span class="shower-peak ${daysToPeak === 0 ? 'peak-tonight' : ''}">${peakStr}</span>
                        </div>
                        <div class="shower-stats">
                            <div class="zhr-gauge">
                                <div class="zhr-bar" style="width:${zhrPct}%;background:${activity.color}"></div>
                            </div>
                            <span class="zhr-label">ZHR: ${s.zhr} | ${s.speed_kms} km/s</span>
                        </div>
                        <div class="shower-desc">${s.description}</div>
                    </div>`;
                });
                activeList.innerHTML = html;
            }
        }

        // Render upcoming
        const upcomingList = document.getElementById('meteor-upcoming');
        if (upcomingList) {
            if (upcoming.length === 0) {
                upcomingList.innerHTML = '<div class="text-muted">No upcoming showers in next 60 days</div>';
            } else {
                let html = '';
                upcoming.slice(0, 3).forEach(s => {
                    const peakParts = s.peak.split('-');
                    const peakMonth = parseInt(peakParts[0]);
                    const peakDay = parseInt(peakParts[1]);
                    let peakDate = new Date(now.getFullYear(), peakMonth - 1, peakDay);
                    if (peakDate < now) peakDate = new Date(now.getFullYear() + 1, peakMonth - 1, peakDay);
                    const daysUntil = Math.round((peakDate - now) / 86400000);

                    html += `<div class="meteor-upcoming-entry">
                        <span class="upcoming-name">${s.name}</span>
                        <span class="upcoming-info">ZHR ${s.zhr} | ${daysUntil}d away</span>
                    </div>`;
                });
                upcomingList.innerHTML = html;
            }
        }
    }

    function getActivityLevel(zhr, daysToPeak) {
        // Adjust effective ZHR based on distance from peak
        const factor = Math.max(0, 1 - Math.abs(daysToPeak) * 0.1);
        const effectiveZHR = zhr * factor;

        if (effectiveZHR > 80) return { level: 'high', color: '#10b981' };
        if (effectiveZHR > 30) return { level: 'moderate', color: '#f59e0b' };
        if (effectiveZHR > 10) return { level: 'low', color: '#00d4ff' };
        return { level: 'minimal', color: '#6b7280' };
    }

    function startAnimation() {
        if (animFrame) return;

        const now = new Date();
        const month = now.getMonth() + 1;
        const day = now.getDate();
        const mmdd = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const active = showerData.filter(s => isDateInRange(mmdd, s.start, s.end));

        if (active.length === 0) return;

        animate(active);
    }

    function animate(activeShowers) {
        if (!enabled) return;

        const ns = window.NightSky;
        if (!ns || !ns.state.planetarium) return;

        const overlay = document.getElementById('sky-overlay');
        if (!overlay) return;

        const ctx = overlay.getContext('2d');
        const p = ns.state.planetarium;
        const now = performance.now();

        // Spawn new particles based on ZHR
        activeShowers.forEach(shower => {
            // Spawn rate: ZHR per hour = ZHR/3600 per second
            // At 60fps, that's ZHR/(3600*60) per frame, but speed it up for visibility
            const spawnChance = (shower.zhr / 3600) * 3; // 3x speedup for visual effect
            if (Math.random() < spawnChance && particles.length < MAX_PARTICLES) {
                spawnParticle(shower, now, p);
            }
        });

        // Draw particles
        particles.forEach(particle => {
            const age = now - particle.born;
            const progress = age / PARTICLE_LIFETIME;

            if (progress > 1) return; // Dead particle

            const alpha = 1 - progress;
            const x = particle.startX + (particle.dx * progress);
            const y = particle.startY + (particle.dy * progress);

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(particle.startX + particle.dx * Math.max(0, progress - 0.3), particle.startY + particle.dy * Math.max(0, progress - 0.3));
            ctx.lineTo(x, y);
            ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.8})`;
            ctx.lineWidth = particle.width;
            ctx.stroke();

            // Bright head
            ctx.beginPath();
            ctx.arc(x, y, particle.width, 0, 2 * Math.PI);
            ctx.fillStyle = `rgba(255, 255, 200, ${alpha})`;
            ctx.fill();
            ctx.restore();
        });

        // Remove dead particles
        particles = particles.filter(p => (now - p.born) < PARTICLE_LIFETIME);

        animFrame = requestAnimationFrame(() => animate(activeShowers));
    }

    function spawnParticle(shower, now, planetarium) {
        // Convert shower radiant RA/Dec to pixel coordinates
        const raRad = shower.radiant_ra * Math.PI / 180;
        const decRad = shower.radiant_dec * Math.PI / 180;
        const radiantXY = planetarium.radec2xy(raRad, decRad);

        if (!radiantXY || !isFinite(radiantXY.x) || !isFinite(radiantXY.y)) return;

        // Random direction radiating outward from radiant
        const angle = Math.random() * 2 * Math.PI;
        const speed = 50 + Math.random() * 150; // pixels
        const dx = Math.cos(angle) * speed;
        const dy = Math.sin(angle) * speed;

        // Start slightly offset from radiant
        const offset = 5 + Math.random() * 20;
        const startX = radiantXY.x + Math.cos(angle) * offset;
        const startY = radiantXY.y + Math.sin(angle) * offset;

        particles.push({
            born: now,
            startX: startX,
            startY: startY,
            dx: dx,
            dy: dy,
            width: 0.5 + Math.random() * 1.5
        });
    }

    function stopAnimation() {
        if (animFrame) {
            cancelAnimationFrame(animFrame);
            animFrame = null;
        }
        particles = [];
    }

    function isDateInRange(mmdd, start, end) {
        if (start <= end) {
            return mmdd >= start && mmdd <= end;
        } else {
            return mmdd >= start || mmdd <= end;
        }
    }

    if (window.NightSky && window.NightSky.features) {
        window.NightSky.features.register('meteors', {
            init: init,
            destroy: function() {
                stopAnimation();
                enabled = false;
            }
        });
    }
})();
