/**
 * Animation Controller - Time controls and playback
 */

class AnimationController {
    constructor() {
        this.isPlaying = true;
        this.speed = 1;  // 1 = real-time, 10 = 10x speed
        this.updateInterval = 1000;  // ms between updates
        this.timer = null;
        this.onUpdate = null;
        this.lastUpdateTime = Date.now();
    }

    /**
     * Set the update callback
     */
    setUpdateCallback(callback) {
        this.onUpdate = callback;
    }

    /**
     * Start the animation loop
     */
    start() {
        if (this.timer) return;

        this.isPlaying = true;
        this.lastUpdateTime = Date.now();

        this.timer = setInterval(() => {
            if (this.isPlaying && this.onUpdate) {
                this.onUpdate();
            }
        }, this.updateInterval);
    }

    /**
     * Stop the animation
     */
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.isPlaying = false;
    }

    /**
     * Toggle play/pause
     */
    toggle() {
        this.isPlaying = !this.isPlaying;
        return this.isPlaying;
    }

    /**
     * Set playback speed
     */
    setSpeed(speed) {
        this.speed = Math.max(1, Math.min(100, speed));
        // Adjust update interval for faster updates at higher speeds
        this.updateInterval = Math.max(100, 1000 / Math.sqrt(this.speed));

        // Restart timer with new interval
        if (this.timer) {
            this.stop();
            this.start();
        }
    }

    /**
     * Get current speed
     */
    getSpeed() {
        return this.speed;
    }

    /**
     * Check if playing
     */
    isActive() {
        return this.isPlaying;
    }
}

window.AnimationController = AnimationController;
