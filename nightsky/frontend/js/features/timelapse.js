/**
 * Time-Lapse Animator Feature
 * Smooth play/pause/speed controls with timeline scrubber and jump-to buttons.
 */
(function() {
    let isPlaying = false;
    let speed = 60; // seconds per frame (1x = real-time, but we step faster)
    let animFrame = null;
    let lastFrameTime = 0;
    const MIN_FRAME_INTERVAL = 67; // ~15fps max to avoid overloading VirtualSky

    const SPEEDS = [
        { label: '1x', value: 1 },
        { label: '10x', value: 10 },
        { label: '60x', value: 60 },
        { label: '300x', value: 300 },
        { label: '1000x', value: 1000 },
        { label: '3600x', value: 3600 },
        { label: '10000x', value: 10000 }
    ];

    function init() {
        const panel = document.getElementById('timelapse-panel');
        if (!panel) return;

        // Play/pause button
        const playBtn = document.getElementById('timelapse-play');
        if (playBtn) {
            playBtn.addEventListener('click', togglePlay);
        }

        // Speed selector
        const speedSelect = document.getElementById('timelapse-speed');
        if (speedSelect) {
            speedSelect.addEventListener('change', (e) => {
                speed = parseInt(e.target.value);
            });
        }

        // Jump buttons
        document.getElementById('jump-sunset')?.addEventListener('click', () => jumpTo('sunset'));
        document.getElementById('jump-midnight')?.addEventListener('click', () => jumpTo('midnight'));
        document.getElementById('jump-sunrise')?.addEventListener('click', () => jumpTo('sunrise'));
        document.getElementById('jump-golden')?.addEventListener('click', () => jumpTo('golden'));

        // Scrubber
        const scrubber = document.getElementById('timelapse-scrubber');
        if (scrubber) {
            scrubber.addEventListener('input', (e) => {
                const hours = parseFloat(e.target.value);
                scrubTo(hours);
            });
        }
    }

    function togglePlay() {
        isPlaying = !isPlaying;
        const btn = document.getElementById('timelapse-play');
        const icon = document.getElementById('timelapse-play-icon');

        if (isPlaying) {
            if (btn) btn.classList.add('playing');
            if (icon) icon.textContent = '\u23F8'; // pause symbol
            // Disable live mode
            const ns = window.NightSky;
            if (ns && ns.state.planetarium) {
                ns.state.planetarium.live = false;
                const liveCheckbox = document.getElementById('opt-live');
                if (liveCheckbox) liveCheckbox.checked = false;
            }
            lastFrameTime = performance.now();
            animate();
        } else {
            if (btn) btn.classList.remove('playing');
            if (icon) icon.textContent = '\u25B6'; // play symbol
            if (animFrame) {
                cancelAnimationFrame(animFrame);
                animFrame = null;
            }
        }
    }

    function animate() {
        if (!isPlaying) return;

        const now = performance.now();
        const elapsed = now - lastFrameTime;

        if (elapsed >= MIN_FRAME_INTERVAL) {
            const ns = window.NightSky;
            if (ns && ns.state.planetarium) {
                // Advance time: speed seconds per real frame
                const currentClock = ns.state.planetarium.clock instanceof Date
                    ? ns.state.planetarium.clock : new Date();
                const newTime = new Date(currentClock.getTime() + speed * 1000);

                ns.state.planetarium.clock = newTime;
                ns.state.currentTime = newTime;
                ns.state.planetarium.trigger('change');

                updateScrubber(newTime);
                updateTimeDisplay(newTime);
            }
            lastFrameTime = now;
        }

        animFrame = requestAnimationFrame(animate);
    }

    function jumpTo(target) {
        const ns = window.NightSky;
        if (!ns || typeof Astronomy === 'undefined') return;

        const lat = ns.state.latitude;
        const lon = ns.state.longitude;
        const today = new Date();

        try {
            const twilight = Astronomy.calculateTwilightTimes(lat, lon, today);
            let targetTime = null;

            switch(target) {
                case 'sunset':
                    targetTime = twilight.sunset;
                    break;
                case 'sunrise':
                    targetTime = twilight.sunrise;
                    break;
                case 'midnight':
                    targetTime = new Date(today);
                    targetTime.setHours(0, 0, 0, 0);
                    targetTime.setDate(targetTime.getDate() + 1); // midnight tonight
                    break;
                case 'golden':
                    // Golden hour = ~30 min before sunset
                    if (twilight.sunset) {
                        targetTime = new Date(twilight.sunset.getTime() - 30 * 60000);
                    }
                    break;
            }

            if (targetTime && ns.state.planetarium) {
                ns.state.planetarium.live = false;
                const liveCheckbox = document.getElementById('opt-live');
                if (liveCheckbox) liveCheckbox.checked = false;

                ns.state.planetarium.clock = targetTime;
                ns.state.currentTime = targetTime;
                ns.state.planetarium.trigger('change');
                updateScrubber(targetTime);
                updateTimeDisplay(targetTime);
            }
        } catch(e) {
            console.log('Jump-to error:', e);
        }
    }

    function scrubTo(hours) {
        const ns = window.NightSky;
        if (!ns || !ns.state.planetarium) return;

        // hours: 0-24 range, relative to today midnight
        const base = new Date();
        base.setHours(0, 0, 0, 0);
        const targetTime = new Date(base.getTime() + hours * 3600000);

        ns.state.planetarium.live = false;
        const liveCheckbox = document.getElementById('opt-live');
        if (liveCheckbox) liveCheckbox.checked = false;

        ns.state.planetarium.clock = targetTime;
        ns.state.currentTime = targetTime;
        ns.state.planetarium.trigger('change');
        updateTimeDisplay(targetTime);
    }

    function updateScrubber(time) {
        const scrubber = document.getElementById('timelapse-scrubber');
        if (!scrubber || !(time instanceof Date)) return;

        const hours = time.getHours() + time.getMinutes() / 60;
        scrubber.value = hours;
    }

    function updateTimeDisplay(time) {
        const display = document.getElementById('timelapse-time');
        if (!display || !(time instanceof Date)) return;

        display.textContent = time.toLocaleString('en-US', {
            month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit',
            hour12: true
        });
    }

    if (window.NightSky && window.NightSky.features) {
        window.NightSky.features.register('timelapse', {
            init: init,
            destroy: function() {
                isPlaying = false;
                if (animFrame) cancelAnimationFrame(animFrame);
            }
        });
    }
})();
