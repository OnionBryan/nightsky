/**
 * PlaybackController - Historical time simulation
 * Allows replaying satellite passes over any time window.
 *
 * Usage:
 *   const pb = new PlaybackController();
 *   pb.onTimeChange = (simTime) => { ... };
 *   pb.start(new Date('2025-03-01T00:00:00Z'), 360, 60);
 */

class PlaybackController {
    constructor() {
        this.active = false;
        this.simTime = new Date();
        this.playbackSpeed = 60;     // sim-seconds advance per real-second
        this.isPlaying = false;
        this.windowStart = null;     // start of the loaded window
        this.windowEnd = null;       // end of the loaded window
        this.onTimeChange = null;    // callback(simTime)
        this._interval = null;
    }

    /**
     * Start playback.
     * @param {Date} fromDate       - simulation start time
     * @param {number} durationMin  - window length in minutes
     * @param {number} speed        - sim-seconds per real-second (default 60)
     */
    start(fromDate, durationMin, speed) {
        this.active = true;
        this.simTime = new Date(fromDate);
        this.windowStart = new Date(fromDate);
        this.windowEnd = new Date(fromDate.getTime() + (durationMin || 360) * 60000);
        this.playbackSpeed = speed || 60;
        this.isPlaying = true;
        this._startTick();
    }

    _startTick() {
        if (this._interval) clearInterval(this._interval);
        this._interval = setInterval(() => {
            if (!this.isPlaying || !this.active) return;
            this.simTime = new Date(this.simTime.getTime() + this.playbackSpeed * 1000);
            // Loop back when we reach the end of the window
            if (this.simTime >= this.windowEnd) {
                this.simTime = new Date(this.windowStart);
            }
            if (this.onTimeChange) this.onTimeChange(this.simTime);
        }, 1000);
    }

    pause() {
        this.isPlaying = false;
    }

    resume() {
        if (!this.active) return;
        this.isPlaying = true;
    }

    setSpeed(s) {
        this.playbackSpeed = Number(s);
        if (this.active) this._startTick();
    }

    /** Jump to a specific sim time. */
    scrubTo(date) {
        this.simTime = new Date(date);
        if (this.onTimeChange) this.onTimeChange(this.simTime);
    }

    /** Stop playback and reset state. */
    stop() {
        this.active = false;
        this.isPlaying = false;
        if (this._interval) clearInterval(this._interval);
        this._interval = null;
    }

    /** Progress [0, 1] through the loaded window. */
    getProgress() {
        if (!this.windowStart || !this.windowEnd) return 0;
        const total = this.windowEnd - this.windowStart;
        if (total <= 0) return 0;
        return Math.max(0, Math.min(1, (this.simTime - this.windowStart) / total));
    }
}

window.PlaybackController = PlaybackController;
