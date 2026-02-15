/**
 * astronomy.js - Astronomical Calculations for Night Sky Planner
 *
 * Provides client-side astronomical calculations for:
 * - Angular distance between celestial coordinates
 * - Julian Date conversion
 * - Local Sidereal Time
 * - Altitude/Azimuth from RA/Dec
 * - Rise/Set/Transit time estimation
 * - Moon phase visualization
 * - Sun position calculations
 * - Twilight times
 *
 * References:
 * - Meeus, Jean. "Astronomical Algorithms" (2nd ed., 1998)
 * - USNO/AENA - The Astronomical Almanac
 * - IAU SOFA Library documentation
 */

const Astronomy = {
    // ===========================================================================
    // FUNDAMENTAL CONSTANTS
    // ===========================================================================

    // Conversion factors
    DEG_TO_RAD: Math.PI / 180,
    RAD_TO_DEG: 180 / Math.PI,
    HOURS_TO_DEG: 15,                    // 360° / 24h
    ARCSEC_TO_DEG: 1 / 3600,
    ARCMIN_TO_DEG: 1 / 60,

    // J2000.0 Epoch - January 1, 2000, 12:00 TT (Terrestrial Time)
    // This is the standard epoch for modern astronomical coordinates
    J2000: 2451545.0,

    // Julian century in days
    JULIAN_CENTURY: 36525,

    // Mean obliquity of the ecliptic at J2000.0
    // Value: 23°26'21".448 = 23.439291111°
    // Source: IAU 1976 System of Astronomical Constants
    OBLIQUITY_J2000: 23.439291111,

    // Rate of change of obliquity (arcseconds per Julian century)
    // The obliquity is slowly decreasing
    OBLIQUITY_RATE: -46.8150,

    // ===========================================================================
    // LUNAR CONSTANTS
    // ===========================================================================

    // Synodic month (New Moon to New Moon)
    // Mean value: 29.530588853 days
    // More precise: 29.5305888531 + 0.00000021621×T (where T = Julian centuries from J2000)
    // Source: Meeus, Astronomical Algorithms
    SYNODIC_MONTH: 29.530588853,

    // Reference New Moon for phase calculations
    // January 6, 2000, 18:14 TT (approximately 18:14 UT)
    // JD = 2451550.1
    // Source: Meeus, Astronomical Algorithms, Table 49.a
    NEW_MOON_REF: 2451550.1,

    // Mean lunar angular diameter at mean distance
    // 31'05".2 = 31.087 arcminutes = 0.51811°
    MOON_ANGULAR_DIAMETER: 0.51811,

    // Moon's mean distance from Earth in km
    MOON_MEAN_DISTANCE: 384400,

    // ===========================================================================
    // SOLAR CONSTANTS
    // ===========================================================================

    // Mean solar angular diameter
    // 31'59".3 = 31.988 arcminutes = 0.53313°
    SUN_ANGULAR_DIAMETER: 0.53313,

    // Solar semidiameter for rise/set calculations
    // 16' = 0.26667°
    SUN_SEMIDIAMETER: 0.26667,

    // ===========================================================================
    // ATMOSPHERIC REFRACTION
    // ===========================================================================

    // Standard atmospheric refraction at the horizon for a point source (stars)
    // Value: 34 arcminutes = 0.5667°
    // This is the amount the atmosphere bends light at the horizon
    REFRACTION_HORIZON: 0.5667,

    // Horizon correction for Sun rise/set
    // Accounts for: refraction (34') + semidiameter (16') = 50' = 0.8333°
    // The Sun is said to rise/set when its upper limb touches the horizon
    SUN_HORIZON_ANGLE: -0.8333,

    // Horizon correction for Moon rise/set
    // Similar to Sun but Moon's angular size varies significantly
    MOON_HORIZON_ANGLE: -0.5667,  // Average; varies with distance

    // ===========================================================================
    // TWILIGHT DEFINITIONS
    // ===========================================================================

    // Civil twilight: Sun 6° below horizon
    // Bright enough for outdoor activities without artificial light
    TWILIGHT_CIVIL: -6,

    // Nautical twilight: Sun 12° below horizon
    // Horizon still visible at sea, bright stars visible
    TWILIGHT_NAUTICAL: -12,

    // Astronomical twilight: Sun 18° below horizon
    // Sky is dark enough for all astronomical observations
    TWILIGHT_ASTRONOMICAL: -18,

    // ===========================================================================
    // SIDEREAL TIME CONSTANTS
    // ===========================================================================

    // Sidereal day in SI seconds
    // 23h 56m 4.091s = 86164.091 seconds
    SIDEREAL_DAY_SECONDS: 86164.091,

    // Ratio of sidereal time to mean solar time
    // One sidereal day is shorter than a solar day
    // Ratio: 366.24219 / 365.24219 = 1.00273790935
    SIDEREAL_RATIO: 1.00273790935,

    // GMST at J2000.0 midnight
    // GMST = 280°.46061837 at J2000.0
    GMST_AT_J2000: 280.46061837,

    // GMST rate in degrees per day
    GMST_RATE: 360.98564736629,

    // ===========================================================================
    // SOLAR POSITION FORMULA COEFFICIENTS
    // ===========================================================================

    // Mean longitude of the Sun at J2000.0 (degrees)
    SUN_MEAN_LONGITUDE_J2000: 280.461,

    // Daily motion of Sun's mean longitude (degrees/day)
    SUN_MEAN_LONGITUDE_RATE: 0.9856474,

    // Mean anomaly of the Sun at J2000.0 (degrees)
    SUN_MEAN_ANOMALY_J2000: 357.528,

    // Daily motion of Sun's mean anomaly (degrees/day)
    SUN_MEAN_ANOMALY_RATE: 0.9856003,

    // Equation of center coefficients (degrees)
    // First term coefficient
    SUN_EOC_1: 1.915,
    // Second term coefficient
    SUN_EOC_2: 0.020,

    // ===========================================================================
    // BORTLE SCALE DATA
    // ===========================================================================

    // Bortle Dark-Sky Scale with Naked-Eye Limiting Magnitude (NELM)
    // Source: John E. Bortle, "The Bortle Dark-Sky Scale", Sky & Telescope, Feb 2001
    BORTLE_SCALE: {
        1: {
            name: 'Excellent Dark-Sky Site',
            limitingMag: 7.8,  // Range: 7.6-8.0
            sqm: 21.99,        // Sky Quality Meter reading (mag/arcsec²)
            description: 'Zodiacal light, gegenschein, and zodiacal band visible. Scorpius and Sagittarius regions of Milky Way cast obvious shadows. M33 easily visible with naked eye.',
            details: 'Airglow is readily apparent. The Milky Way casts obvious shadows on the ground. Jupiter and Venus affect dark adaptation.'
        },
        2: {
            name: 'Typical Truly Dark Site',
            limitingMag: 7.3,  // Range: 7.1-7.5
            sqm: 21.89,
            description: 'Airglow weakly visible near horizon. M33 easily visible with naked eye. Summer Milky Way highly structured.',
            details: 'Zodiacal light bright enough to cast shadows just before dawn and after dusk. Clouds appear as dark holes against the sky.'
        },
        3: {
            name: 'Rural Sky',
            limitingMag: 6.8,  // Range: 6.6-7.0
            sqm: 21.69,
            description: 'Some light pollution on horizon. Milky Way still appears complex. M15, M4, M5, M22 visible with naked eye.',
            details: 'Zodiacal light obvious in spring and autumn. Clouds faintly illuminated near horizon, dark overhead.'
        },
        4: {
            name: 'Rural/Suburban Transition',
            limitingMag: 6.3,  // Range: 6.1-6.5
            sqm: 21.25,
            description: 'Light pollution domes visible in several directions. Milky Way visible but not striking. M31 obvious.',
            details: 'Zodiacal light still visible but not striking. Clouds illuminated in directions of light sources.'
        },
        5: {
            name: 'Suburban Sky',
            limitingMag: 5.8,  // Range: 5.6-6.0
            sqm: 20.49,
            description: 'Milky Way very weak or invisible near horizon. Light sources visible in most directions. M31 visible but not obvious.',
            details: 'Only hints of zodiacal light on best nights. Clouds notably brighter than sky background.'
        },
        6: {
            name: 'Bright Suburban Sky',
            limitingMag: 5.3,  // Range: 5.1-5.5
            sqm: 19.50,
            description: 'Milky Way only visible near zenith. Sky within 35° of horizon glows grayish. M33 not visible, M31 difficult.',
            details: 'No zodiacal light. Clouds quite bright. Any dark area in the sky appears impressive.'
        },
        7: {
            name: 'Suburban/Urban Transition',
            limitingMag: 4.8,  // Range: 4.6-5.0
            sqm: 18.94,
            description: 'Entire sky has grayish-white hue. Strong light sources in all directions. Milky Way invisible.',
            details: 'Clouds brilliantly lit. Even high clouds glow. M44 and M31 may be glimpsed but are difficult.'
        },
        8: {
            name: 'City Sky',
            limitingMag: 4.3,  // Range: 4.1-4.5
            sqm: 18.38,
            description: 'Sky glows white or orange. Orion and other constellations visible but unimpressive. Many stars invisible.',
            details: 'The sky is bright enough to read by. M31, M44, and M45 occasionally glimpsed by experienced observers.'
        },
        9: {
            name: 'Inner-City Sky',
            limitingMag: 4.0,  // Range: 3.6-4.0
            sqm: 17.80,
            description: 'Only Moon, planets, and a few brightest stars visible. Many constellations incomplete or unrecognizable.',
            details: 'The entire sky appears bright. Only Sirius, Vega, and a handful of other stars visible on good nights.'
        }
    },

    // ===========================================================================
    // PLANETARY ORBITAL ELEMENTS (J2000.0 Epoch)
    // ===========================================================================
    // Source: NASA JPL - Keplerian Elements for Approximate Positions of the Major Planets
    // Valid for 1800 AD - 2050 AD
    // Reference: https://ssd.jpl.nasa.gov/planets/approx_pos.html
    //
    // Elements: a (AU), e, I (deg), L (deg), longPeri (deg), longNode (deg)
    // Rates: per Julian century

    PLANETS: {
        mercury: {
            name: 'Mercury',
            symbol: '☿',
            // Orbital elements at J2000.0
            a: 0.38709927,      // Semi-major axis (AU)
            e: 0.20563593,      // Eccentricity
            I: 7.00497902,      // Inclination (degrees)
            L: 252.25032350,    // Mean longitude (degrees)
            longPeri: 77.45779628,   // Longitude of perihelion (degrees)
            longNode: 48.33076593,   // Longitude of ascending node (degrees)
            // Rates of change per Julian century
            aRate: 0.00000037,
            eRate: 0.00001906,
            IRate: -0.00594749,
            LRate: 149472.67411175,
            longPeriRate: 0.16047689,
            longNodeRate: -0.12534081,
            // Physical and observational data
            siderealPeriod: 87.969,      // Days
            synodicPeriod: 115.88,       // Days
            maxElongation: [18, 28],     // Min/max greatest elongation (degrees)
            apparentMagRange: [-2.6, 5.7],
            angularDiamRange: [4.5, 13.0]  // Arcseconds
        },
        venus: {
            name: 'Venus',
            symbol: '♀',
            a: 0.72333566,
            e: 0.00677672,
            I: 3.39467605,
            L: 181.97909950,
            longPeri: 131.60246718,
            longNode: 76.67984255,
            aRate: 0.00000390,
            eRate: -0.00004107,
            IRate: -0.00078890,
            LRate: 58517.81538729,
            longPeriRate: 0.00268329,
            longNodeRate: -0.27769418,
            siderealPeriod: 224.701,
            synodicPeriod: 583.92,
            maxElongation: [45, 47],
            apparentMagRange: [-4.9, -3.8],
            angularDiamRange: [9.7, 66.0]
        },
        earth: {
            name: 'Earth',
            symbol: '⊕',
            a: 1.00000261,
            e: 0.01671123,
            I: -0.00001531,
            L: 100.46457166,
            longPeri: 102.93768193,
            longNode: 0.0,
            aRate: 0.00000562,
            eRate: -0.00004392,
            IRate: -0.01294668,
            LRate: 35999.37244981,
            longPeriRate: 0.32327364,
            longNodeRate: 0.0,
            siderealPeriod: 365.256,
            synodicPeriod: null  // Reference planet
        },
        mars: {
            name: 'Mars',
            symbol: '♂',
            a: 1.52371034,
            e: 0.09339410,
            I: 1.84969142,
            L: -4.55343205,
            longPeri: -23.94362959,
            longNode: 49.55953891,
            aRate: 0.00001847,
            eRate: 0.00007882,
            IRate: -0.00813131,
            LRate: 19140.30268499,
            longPeriRate: 0.44441088,
            longNodeRate: -0.29257343,
            siderealPeriod: 686.980,
            synodicPeriod: 779.94,
            apparentMagRange: [-2.94, 1.86],
            angularDiamRange: [3.5, 25.1]
        },
        jupiter: {
            name: 'Jupiter',
            symbol: '♃',
            a: 5.20288700,
            e: 0.04838624,
            I: 1.30439695,
            L: 34.39644051,
            longPeri: 14.72847983,
            longNode: 100.47390909,
            aRate: -0.00011607,
            eRate: -0.00013253,
            IRate: -0.00183714,
            LRate: 3034.74612775,
            longPeriRate: 0.21252668,
            longNodeRate: 0.20469106,
            siderealPeriod: 4332.59,      // ~11.86 years
            synodicPeriod: 398.88,
            apparentMagRange: [-2.94, -1.66],
            angularDiamRange: [29.8, 50.1]
        },
        saturn: {
            name: 'Saturn',
            symbol: '♄',
            a: 9.53667594,
            e: 0.05386179,
            I: 2.48599187,
            L: 49.95424423,
            longPeri: 92.59887831,
            longNode: 113.66242448,
            aRate: -0.00125060,
            eRate: -0.00050991,
            IRate: 0.00193609,
            LRate: 1222.49362201,
            longPeriRate: -0.41897216,
            longNodeRate: -0.28867794,
            siderealPeriod: 10759.22,     // ~29.46 years
            synodicPeriod: 378.09,
            apparentMagRange: [-0.55, 1.17],
            angularDiamRange: [14.5, 20.1]
        },
        uranus: {
            name: 'Uranus',
            symbol: '⛢',
            a: 19.18916464,
            e: 0.04725744,
            I: 0.77263783,
            L: 313.23810451,
            longPeri: 170.95427630,
            longNode: 74.01692503,
            aRate: -0.00196176,
            eRate: -0.00004397,
            IRate: -0.00242939,
            LRate: 428.48202785,
            longPeriRate: 0.40805281,
            longNodeRate: 0.04240589,
            siderealPeriod: 30688.5,      // ~84.01 years
            synodicPeriod: 369.66,
            apparentMagRange: [5.38, 6.03],
            angularDiamRange: [3.3, 4.1]
        },
        neptune: {
            name: 'Neptune',
            symbol: '♆',
            a: 30.06992276,
            e: 0.00859048,
            I: 1.77004347,
            L: -55.12002969,
            longPeri: 44.96476227,
            longNode: 131.78422574,
            aRate: 0.00026291,
            eRate: 0.00005105,
            IRate: 0.00035372,
            LRate: 218.45945325,
            longPeriRate: -0.32241464,
            longNodeRate: -0.00508664,
            siderealPeriod: 60182.0,      // ~164.8 years
            synodicPeriod: 367.49,
            apparentMagRange: [7.78, 8.02],
            angularDiamRange: [2.2, 2.4]
        }
    },

    // Planetary perturbation terms for Jupiter and Saturn
    // The "great inequality" has a period of ~918 years
    JUPITER_SATURN_PERTURBATION: {
        period: 918,  // years
        jupiterAmplitude: 0.332,  // degrees
        saturnAmplitude: 0.812   // degrees
    },

    // ===========================================================================
    // PLANETARY PHYSICAL CONSTANTS
    // ===========================================================================

    // Planet mean radii in km (for angular size calculations)
    PLANET_RADII: {
        mercury: 2439.7,
        venus: 6051.8,
        earth: 6371.0,
        mars: 3389.5,
        jupiter: 69911,
        saturn: 58232,
        uranus: 25362,
        neptune: 24622
    },

    // ===========================================================================
    // UTILITY METHODS
    // ===========================================================================

    /**
     * Convert degrees to radians
     * @param {number} degrees - Angle in degrees
     * @returns {number} Angle in radians
     */
    toRadians(degrees) {
        return degrees * this.DEG_TO_RAD;
    },

    /**
     * Convert radians to degrees
     * @param {number} radians - Angle in radians
     * @returns {number} Angle in degrees
     */
    toDegrees(radians) {
        return radians * this.RAD_TO_DEG;
    },

    /**
     * Normalize angle to 0-360 range
     * @param {number} angle - Angle in degrees
     * @returns {number} Normalized angle in degrees
     */
    normalizeAngle(angle) {
        angle = angle % 360;
        return angle < 0 ? angle + 360 : angle;
    },

    /**
     * Normalize angle to -180 to +180 range
     * @param {number} angle - Angle in degrees
     * @returns {number} Normalized angle in degrees
     */
    normalizeAngleSigned(angle) {
        angle = this.normalizeAngle(angle);
        return angle > 180 ? angle - 360 : angle;
    },

    // ===========================================================================
    // JULIAN DATE METHODS
    // ===========================================================================

    /**
     * Convert JavaScript Date to Julian Date
     * Uses the algorithm from Meeus, Astronomical Algorithms, Ch. 7
     *
     * @param {Date} date - JavaScript Date object
     * @returns {number} Julian Date
     */
    dateToJulian(date) {
        const y = date.getUTCFullYear();
        const m = date.getUTCMonth() + 1;
        const d = date.getUTCDate();
        const h = date.getUTCHours() + date.getUTCMinutes() / 60 +
                  date.getUTCSeconds() / 3600 + date.getUTCMilliseconds() / 3600000;

        let jy = y;
        let jm = m;
        if (m <= 2) {
            jy = y - 1;
            jm = m + 12;
        }

        // Gregorian calendar correction
        const a = Math.floor(jy / 100);
        const b = 2 - a + Math.floor(a / 4);

        return Math.floor(365.25 * (jy + 4716)) +
               Math.floor(30.6001 * (jm + 1)) +
               d + h / 24 + b - 1524.5;
    },

    /**
     * Convert Julian Date to JavaScript Date
     * @param {number} jd - Julian Date
     * @returns {Date} JavaScript Date object
     */
    julianToDate(jd) {
        const z = Math.floor(jd + 0.5);
        const f = jd + 0.5 - z;

        let a = z;
        if (z >= 2299161) {
            const alpha = Math.floor((z - 1867216.25) / 36524.25);
            a = z + 1 + alpha - Math.floor(alpha / 4);
        }

        const b = a + 1524;
        const c = Math.floor((b - 122.1) / 365.25);
        const d = Math.floor(365.25 * c);
        const e = Math.floor((b - d) / 30.6001);

        const day = b - d - Math.floor(30.6001 * e) + f;
        const month = e < 14 ? e - 1 : e - 13;
        const year = month > 2 ? c - 4716 : c - 4715;

        const dayFrac = day - Math.floor(day);
        const hours = dayFrac * 24;
        const mins = (hours - Math.floor(hours)) * 60;
        const secs = (mins - Math.floor(mins)) * 60;

        return new Date(Date.UTC(year, month - 1, Math.floor(day),
                                 Math.floor(hours), Math.floor(mins), Math.floor(secs)));
    },

    /**
     * Get Julian centuries since J2000.0
     * @param {number} jd - Julian Date
     * @returns {number} Julian centuries
     */
    julianCenturies(jd) {
        return (jd - this.J2000) / this.JULIAN_CENTURY;
    },

    // ===========================================================================
    // SIDEREAL TIME METHODS
    // ===========================================================================

    /**
     * Calculate Greenwich Mean Sidereal Time in degrees
     * Uses the IAU 1982 expression
     *
     * GMST = 280°.46061837 + 360°.98564736629 × D + 0°.000387933 × T² - T³/38710000
     *
     * Where D = days since J2000.0 and T = Julian centuries since J2000.0
     *
     * @param {number} jd - Julian Date
     * @returns {number} GMST in degrees (0-360)
     */
    gmst(jd) {
        const d = jd - this.J2000;
        const t = d / this.JULIAN_CENTURY;

        let gmst = this.GMST_AT_J2000 +
                   this.GMST_RATE * d +
                   0.000387933 * t * t -
                   t * t * t / 38710000;

        return this.normalizeAngle(gmst);
    },

    /**
     * Calculate Local Sidereal Time in degrees
     * @param {number} jd - Julian Date
     * @param {number} longitude - Observer longitude in degrees (east positive)
     * @returns {number} LST in degrees (0-360)
     */
    lst(jd, longitude) {
        return this.normalizeAngle(this.gmst(jd) + longitude);
    },

    /**
     * Calculate Local Sidereal Time in hours
     * @param {number} jd - Julian Date
     * @param {number} longitude - Observer longitude in degrees
     * @returns {number} LST in hours (0-24)
     */
    lstHours(jd, longitude) {
        return this.lst(jd, longitude) / this.HOURS_TO_DEG;
    },

    // ===========================================================================
    // OBLIQUITY OF THE ECLIPTIC
    // ===========================================================================

    /**
     * Calculate the mean obliquity of the ecliptic
     * Uses the IAU 1980 expression
     *
     * ε = 23°26'21".448 - 46".8150×T - 0".00059×T² + 0".001813×T³
     *
     * @param {number} jd - Julian Date
     * @returns {number} Mean obliquity in degrees
     */
    meanObliquity(jd) {
        const t = this.julianCenturies(jd);

        // Convert from arcseconds to degrees for the rate terms
        return this.OBLIQUITY_J2000 +
               (this.OBLIQUITY_RATE * t +
                -0.00059 * t * t +
                0.001813 * t * t * t) / 3600;
    },

    // ===========================================================================
    // COORDINATE TRANSFORMATIONS
    // ===========================================================================

    /**
     * Convert RA/Dec to Altitude/Azimuth
     * @param {number} ra - Right Ascension in degrees
     * @param {number} dec - Declination in degrees
     * @param {number} lat - Observer latitude in degrees
     * @param {number} lst - Local Sidereal Time in degrees
     * @returns {object} {altitude, azimuth} in degrees
     */
    raDecToAltAz(ra, dec, lat, lst) {
        const ha = this.toRadians(lst - ra);
        const decRad = this.toRadians(dec);
        const latRad = this.toRadians(lat);

        // Calculate altitude
        const sinAlt = Math.sin(decRad) * Math.sin(latRad) +
                       Math.cos(decRad) * Math.cos(latRad) * Math.cos(ha);
        const altitude = this.toDegrees(Math.asin(sinAlt));

        // Calculate azimuth
        const cosAz = (Math.sin(decRad) - Math.sin(latRad) * sinAlt) /
                      (Math.cos(latRad) * Math.cos(Math.asin(sinAlt)));
        let azimuth = this.toDegrees(Math.acos(Math.max(-1, Math.min(1, cosAz))));

        // Correct azimuth for hour angle
        if (Math.sin(ha) > 0) {
            azimuth = 360 - azimuth;
        }

        return { altitude, azimuth };
    },

    /**
     * Convert Altitude/Azimuth to RA/Dec
     * @param {number} alt - Altitude in degrees
     * @param {number} az - Azimuth in degrees
     * @param {number} lat - Observer latitude in degrees
     * @param {number} lst - Local Sidereal Time in degrees
     * @returns {object} {ra, dec} in degrees
     */
    altAzToRaDec(alt, az, lat, lst) {
        const altRad = this.toRadians(alt);
        const azRad = this.toRadians(az);
        const latRad = this.toRadians(lat);

        // Calculate declination
        const sinDec = Math.sin(altRad) * Math.sin(latRad) +
                       Math.cos(altRad) * Math.cos(latRad) * Math.cos(azRad);
        const dec = this.toDegrees(Math.asin(sinDec));

        // Calculate hour angle
        const cosH = (Math.sin(altRad) - Math.sin(latRad) * sinDec) /
                     (Math.cos(latRad) * Math.cos(Math.asin(sinDec)));
        let ha = this.toDegrees(Math.acos(Math.max(-1, Math.min(1, cosH))));

        // Correct hour angle sign
        if (Math.sin(azRad) > 0) {
            ha = 360 - ha;
        }

        // Calculate RA from hour angle
        const ra = this.normalizeAngle(lst - ha);

        return { ra, dec };
    },

    // ===========================================================================
    // ANGULAR DISTANCE
    // ===========================================================================

    /**
     * Calculate angular distance between two celestial positions
     * Using the spherical law of cosines (accurate for all separations)
     *
     * cos(d) = sin(δ1)sin(δ2) + cos(δ1)cos(δ2)cos(α1-α2)
     *
     * @param {number} ra1 - RA of first position in degrees
     * @param {number} dec1 - Dec of first position in degrees
     * @param {number} ra2 - RA of second position in degrees
     * @param {number} dec2 - Dec of second position in degrees
     * @returns {number} Angular distance in degrees
     */
    angularDistance(ra1, dec1, ra2, dec2) {
        const dec1Rad = this.toRadians(dec1);
        const dec2Rad = this.toRadians(dec2);
        const dRa = this.toRadians(ra2 - ra1);

        const cosD = Math.sin(dec1Rad) * Math.sin(dec2Rad) +
                     Math.cos(dec1Rad) * Math.cos(dec2Rad) * Math.cos(dRa);

        // Clamp to valid range to avoid numerical issues
        return this.toDegrees(Math.acos(Math.max(-1, Math.min(1, cosD))));
    },

    /**
     * Calculate angular distance using the haversine formula
     * (More accurate for small angles)
     *
     * @param {number} ra1 - RA of first position in degrees
     * @param {number} dec1 - Dec of first position in degrees
     * @param {number} ra2 - RA of second position in degrees
     * @param {number} dec2 - Dec of second position in degrees
     * @returns {number} Angular distance in degrees
     */
    angularDistanceHaversine(ra1, dec1, ra2, dec2) {
        const dec1Rad = this.toRadians(dec1);
        const dec2Rad = this.toRadians(dec2);
        const dRa = this.toRadians(ra2 - ra1);
        const dDec = dec2Rad - dec1Rad;

        const a = Math.sin(dDec / 2) ** 2 +
                  Math.cos(dec1Rad) * Math.cos(dec2Rad) * Math.sin(dRa / 2) ** 2;

        return this.toDegrees(2 * Math.asin(Math.sqrt(a)));
    },

    /**
     * Format angular distance for display
     * @param {number} degrees - Distance in degrees
     * @returns {object} {degrees, arcminutes, arcseconds, moonWidths, formatted}
     */
    formatAngularDistance(degrees) {
        const arcminutes = degrees * 60;
        const arcseconds = degrees * 3600;
        const moonWidths = degrees / this.MOON_ANGULAR_DIAMETER;

        let formatted;
        if (degrees >= 1) {
            formatted = `${degrees.toFixed(2)}°`;
        } else if (arcminutes >= 1) {
            formatted = `${arcminutes.toFixed(1)}'`;
        } else {
            formatted = `${arcseconds.toFixed(0)}"`;
        }

        return {
            degrees,
            arcminutes,
            arcseconds,
            moonWidths,
            formatted
        };
    },

    // ===========================================================================
    // COORDINATE PARSING AND FORMATTING
    // ===========================================================================

    /**
     * Parse coordinate string (RA in HMS or degrees, Dec in DMS or degrees)
     * @param {string} str - Coordinate string
     * @param {string} type - 'ra' or 'dec'
     * @returns {number|null} Coordinate in degrees
     */
    parseCoordinate(str, type) {
        str = str.trim();

        // Try decimal degrees first
        const decimalMatch = str.match(/^([+-]?\d+\.?\d*)°?$/);
        if (decimalMatch) {
            return parseFloat(decimalMatch[1]);
        }

        if (type === 'ra') {
            // RA in hours: "12h 30m 45s" or "12:30:45" or "12 30 45"
            const hmsMatch = str.match(/(\d+)[h:\s]+(\d+)[m:\s]+(\d+\.?\d*)s?/i);
            if (hmsMatch) {
                const hours = parseFloat(hmsMatch[1]);
                const minutes = parseFloat(hmsMatch[2]);
                const seconds = parseFloat(hmsMatch[3]);
                return (hours + minutes / 60 + seconds / 3600) * this.HOURS_TO_DEG;
            }

            // Simple hour format: "12.5h"
            const hourMatch = str.match(/(\d+\.?\d*)h/i);
            if (hourMatch) {
                return parseFloat(hourMatch[1]) * this.HOURS_TO_DEG;
            }
        }

        if (type === 'dec') {
            // Dec in degrees: "+41° 16' 09"" or "-41:16:09" or "-41 16 09"
            const dmsMatch = str.match(/([+-]?\d+)[°:\s]+(\d+)[\':\s]+(\d+\.?\d*)[\"s]?/i);
            if (dmsMatch) {
                const sign = dmsMatch[1].startsWith('-') ? -1 : 1;
                const degrees = Math.abs(parseFloat(dmsMatch[1]));
                const minutes = parseFloat(dmsMatch[2]);
                const seconds = parseFloat(dmsMatch[3]);
                return sign * (degrees + minutes / 60 + seconds / 3600);
            }
        }

        return null;
    },

    /**
     * Format RA for display
     * @param {number} ra - RA in degrees
     * @returns {string} Formatted string "12h 30m 45.0s"
     */
    formatRA(ra) {
        ra = this.normalizeAngle(ra);
        const hours = ra / this.HOURS_TO_DEG;
        const h = Math.floor(hours);
        const m = Math.floor((hours - h) * 60);
        const s = ((hours - h) * 60 - m) * 60;
        return `${h}h ${m}m ${s.toFixed(1)}s`;
    },

    /**
     * Format Dec for display
     * @param {number} dec - Dec in degrees
     * @returns {string} Formatted string "+41° 16' 09""
     */
    formatDec(dec) {
        const sign = dec >= 0 ? '+' : '-';
        dec = Math.abs(dec);
        const d = Math.floor(dec);
        const m = Math.floor((dec - d) * 60);
        const s = ((dec - d) * 60 - m) * 60;
        return `${sign}${d}° ${m}' ${s.toFixed(0)}"`;
    },

    // ===========================================================================
    // RISE, TRANSIT, SET CALCULATIONS
    // ===========================================================================

    /**
     * Calculate approximate rise, transit, set times for a celestial object
     *
     * @param {number} ra - RA in degrees
     * @param {number} dec - Dec in degrees
     * @param {number} lat - Observer latitude
     * @param {number} lon - Observer longitude
     * @param {Date} date - Date for calculation
     * @param {number} horizonAngle - Horizon angle (default: standard refraction correction)
     * @returns {object} {rise, transit, set} as Date objects or null if circumpolar/never rises
     */
    calculateRiseTransitSet(ra, dec, lat, lon, date, horizonAngle = -this.REFRACTION_HORIZON) {
        const decRad = this.toRadians(dec);
        const latRad = this.toRadians(lat);
        const h0Rad = this.toRadians(horizonAngle);

        // Hour angle at rise/set
        // cos(H) = (sin(h0) - sin(φ)sin(δ)) / (cos(φ)cos(δ))
        const cosH = (Math.sin(h0Rad) - Math.sin(latRad) * Math.sin(decRad)) /
                     (Math.cos(latRad) * Math.cos(decRad));

        // Check if object is circumpolar or never rises
        if (cosH < -1) {
            // Always above horizon (circumpolar)
            return {
                circumpolar: true,
                rise: null,
                transit: this.calculateTransit(ra, lon, date),
                set: null
            };
        }
        if (cosH > 1) {
            // Never rises
            return { neverRises: true, rise: null, transit: null, set: null };
        }

        const H = this.toDegrees(Math.acos(cosH));

        // Transit time (when HA = 0)
        const transit = this.calculateTransit(ra, lon, date);

        // Rise time (transit - H in hours)
        const riseOffset = H / this.HOURS_TO_DEG * 3600000; // H in degrees to hours to ms
        const rise = new Date(transit.getTime() - riseOffset);

        // Set time (transit + H in hours)
        const set = new Date(transit.getTime() + riseOffset);

        return { rise, transit, set, circumpolar: false, neverRises: false };
    },

    /**
     * Calculate transit time for an object
     * Transit occurs when the object's RA equals the LST
     *
     * @param {number} ra - Right Ascension in degrees
     * @param {number} lon - Observer longitude in degrees
     * @param {Date} date - Date for calculation
     * @returns {Date} Transit time
     */
    calculateTransit(ra, lon, date) {
        const midnight = new Date(date);
        midnight.setUTCHours(0, 0, 0, 0);

        const jd = this.dateToJulian(midnight);
        const lst0 = this.lst(jd, lon);

        // Time until object transits (RA = LST)
        let hourAngle = ra - lst0;
        if (hourAngle < 0) hourAngle += 360;
        if (hourAngle > 180) hourAngle -= 360;

        // Convert from sidereal time to mean solar time
        const hoursUntilTransit = hourAngle / this.HOURS_TO_DEG;
        const transitMs = hoursUntilTransit * 3600000 / this.SIDEREAL_RATIO;

        return new Date(midnight.getTime() + transitMs);
    },

    // ===========================================================================
    // SUN POSITION AND TWILIGHT
    // ===========================================================================

    /**
     * Calculate approximate Sun position for a date
     * Uses low-precision formulas accurate to about 0.01° in longitude
     *
     * @param {Date} date - Date for calculation
     * @returns {object} {ra, dec, longitude, distance}
     */
    approximateSunPosition(date) {
        const jd = this.dateToJulian(date);
        const n = jd - this.J2000;  // Days since J2000.0
        const t = n / this.JULIAN_CENTURY;  // Julian centuries

        // Mean longitude of the Sun
        const L = this.normalizeAngle(this.SUN_MEAN_LONGITUDE_J2000 + this.SUN_MEAN_LONGITUDE_RATE * n);

        // Mean anomaly of the Sun
        const g = this.normalizeAngle(this.SUN_MEAN_ANOMALY_J2000 + this.SUN_MEAN_ANOMALY_RATE * n);
        const gRad = this.toRadians(g);

        // Equation of center
        const C = this.SUN_EOC_1 * Math.sin(gRad) +
                  this.SUN_EOC_2 * Math.sin(2 * gRad);

        // Ecliptic longitude of the Sun
        const lambda = L + C;

        // Obliquity of the ecliptic (time-dependent)
        const epsilon = this.meanObliquity(jd);
        const epsilonRad = this.toRadians(epsilon);
        const lambdaRad = this.toRadians(lambda);

        // Ecliptic to equatorial coordinate conversion
        const ra = this.toDegrees(Math.atan2(
            Math.cos(epsilonRad) * Math.sin(lambdaRad),
            Math.cos(lambdaRad)
        ));
        const dec = this.toDegrees(Math.asin(
            Math.sin(epsilonRad) * Math.sin(lambdaRad)
        ));

        // Approximate distance in AU
        const distance = 1.00014 - 0.01671 * Math.cos(gRad) - 0.00014 * Math.cos(2 * gRad);

        return {
            ra: this.normalizeAngle(ra),
            dec,
            longitude: lambda,
            distance
        };
    },

    /**
     * Calculate Sun rise/set for specific horizon angle
     * @param {number} sunDec - Sun's declination in degrees
     * @param {number} lat - Observer latitude
     * @param {number} lon - Observer longitude
     * @param {Date} date - Date for calculation
     * @param {number} h0 - Horizon angle in degrees (negative = below horizon)
     * @returns {object} {rise, set} as Date objects
     */
    calculateSunRiseSet(sunDec, lat, lon, date, h0) {
        const decRad = this.toRadians(sunDec);
        const latRad = this.toRadians(lat);
        const h0Rad = this.toRadians(h0);

        const cosH = (Math.sin(h0Rad) - Math.sin(latRad) * Math.sin(decRad)) /
                     (Math.cos(latRad) * Math.cos(decRad));

        if (cosH < -1 || cosH > 1) {
            // Sun never reaches this altitude today (polar day/night)
            return { rise: null, set: null, polarDay: cosH < -1, polarNight: cosH > 1 };
        }

        const H = this.toDegrees(Math.acos(cosH));
        const sunPos = this.approximateSunPosition(date);
        const transit = this.calculateTransit(sunPos.ra, lon, date);

        const riseOffset = H / this.HOURS_TO_DEG * 3600000;

        return {
            rise: new Date(transit.getTime() - riseOffset),
            set: new Date(transit.getTime() + riseOffset)
        };
    },

    /**
     * Calculate all twilight times for a location
     * @param {number} lat - Latitude
     * @param {number} lon - Longitude
     * @param {Date} date - Date
     * @returns {object} Complete twilight information
     */
    calculateTwilightTimes(lat, lon, date) {
        const sunCoords = this.approximateSunPosition(date);

        // All horizon angles for different events
        const events = {
            sunrise: { angle: this.SUN_HORIZON_ANGLE, isPM: false },
            sunset: { angle: this.SUN_HORIZON_ANGLE, isPM: true },
            civilDawn: { angle: this.TWILIGHT_CIVIL, isPM: false },
            civilDusk: { angle: this.TWILIGHT_CIVIL, isPM: true },
            nauticalDawn: { angle: this.TWILIGHT_NAUTICAL, isPM: false },
            nauticalDusk: { angle: this.TWILIGHT_NAUTICAL, isPM: true },
            astronomicalDawn: { angle: this.TWILIGHT_ASTRONOMICAL, isPM: false },
            astronomicalDusk: { angle: this.TWILIGHT_ASTRONOMICAL, isPM: true }
        };

        const result = {
            date: date,
            sunPosition: sunCoords
        };

        for (const [name, config] of Object.entries(events)) {
            const times = this.calculateSunRiseSet(sunCoords.dec, lat, lon, date, config.angle);
            result[name] = config.isPM ? times.set : times.rise;
        }

        // Calculate duration of darkness (astronomical twilight to twilight)
        if (result.astronomicalDusk && result.astronomicalDawn) {
            // Next day's dawn
            const nextDate = new Date(date);
            nextDate.setDate(nextDate.getDate() + 1);
            const nextTwilight = this.calculateTwilightTimes(lat, lon, nextDate);

            if (nextTwilight.astronomicalDawn) {
                result.darknessDuration = (nextTwilight.astronomicalDawn - result.astronomicalDusk) / 3600000;
            }
        }

        return result;
    },

    // ===========================================================================
    // MOON CALCULATIONS
    // ===========================================================================

    /**
     * Calculate Moon phase
     * Uses the synodic month and a reference new moon date
     *
     * @param {Date} date
     * @returns {object} {phase, illumination, age, name, emoji, nextNew, nextFull}
     */
    calculateMoonPhase(date) {
        const jd = this.dateToJulian(date);

        // Days since reference new moon
        const daysSinceNew = jd - this.NEW_MOON_REF;

        // Current lunation number and age within current lunation
        const lunations = daysSinceNew / this.SYNODIC_MONTH;
        const age = (lunations - Math.floor(lunations)) * this.SYNODIC_MONTH;

        // Phase angle (0 = new, 180 = full)
        const phase = (age / this.SYNODIC_MONTH) * 360;

        // Illumination fraction (0-100%)
        // Formula: k = (1 - cos(phase)) / 2
        const illumination = (1 - Math.cos(this.toRadians(phase))) / 2 * 100;

        // Phase name and emoji
        let name, emoji;
        const normalizedPhase = this.normalizeAngle(phase);

        if (normalizedPhase < 22.5) {
            name = 'New Moon'; emoji = '🌑';
        } else if (normalizedPhase < 67.5) {
            name = 'Waxing Crescent'; emoji = '🌒';
        } else if (normalizedPhase < 112.5) {
            name = 'First Quarter'; emoji = '🌓';
        } else if (normalizedPhase < 157.5) {
            name = 'Waxing Gibbous'; emoji = '🌔';
        } else if (normalizedPhase < 202.5) {
            name = 'Full Moon'; emoji = '🌕';
        } else if (normalizedPhase < 247.5) {
            name = 'Waning Gibbous'; emoji = '🌖';
        } else if (normalizedPhase < 292.5) {
            name = 'Last Quarter'; emoji = '🌗';
        } else if (normalizedPhase < 337.5) {
            name = 'Waning Crescent'; emoji = '🌘';
        } else {
            name = 'New Moon'; emoji = '🌑';
        }

        // Calculate days to next new and full moon
        const daysToNew = (1 - (age / this.SYNODIC_MONTH)) * this.SYNODIC_MONTH;
        let daysToFull = ((0.5 - age / this.SYNODIC_MONTH) * this.SYNODIC_MONTH);
        if (daysToFull < 0) daysToFull += this.SYNODIC_MONTH;

        return {
            phase: normalizedPhase,
            illumination,
            age,
            name,
            emoji,
            daysToNew,
            daysToFull,
            nextNew: new Date(date.getTime() + daysToNew * 24 * 3600000),
            nextFull: new Date(date.getTime() + daysToFull * 24 * 3600000)
        };
    },

    /**
     * Calculate approximate Moon position
     * Low-precision formulas for rise/set and altitude calculations
     *
     * @param {Date} date
     * @returns {object} {ra, dec, distance, angularSize}
     */
    approximateMoonPosition(date) {
        const jd = this.dateToJulian(date);
        const d = jd - this.J2000;  // Days since J2000.0

        // Mean orbital elements (low precision)
        // Mean longitude
        const L = this.normalizeAngle(218.316 + 13.176396 * d);
        // Mean anomaly
        const M = this.normalizeAngle(134.963 + 13.064993 * d);
        // Mean distance (argument of latitude)
        const F = this.normalizeAngle(93.272 + 13.229350 * d);

        // Ecliptic longitude
        const lambda = L + 6.289 * Math.sin(this.toRadians(M));
        // Ecliptic latitude
        const beta = 5.128 * Math.sin(this.toRadians(F));
        // Distance in Earth radii
        const dist = 385001 - 20905 * Math.cos(this.toRadians(M));

        // Obliquity
        const epsilon = this.meanObliquity(jd);
        const epsilonRad = this.toRadians(epsilon);
        const lambdaRad = this.toRadians(lambda);
        const betaRad = this.toRadians(beta);

        // Convert to equatorial coordinates
        const ra = this.toDegrees(Math.atan2(
            Math.sin(lambdaRad) * Math.cos(epsilonRad) - Math.tan(betaRad) * Math.sin(epsilonRad),
            Math.cos(lambdaRad)
        ));
        const dec = this.toDegrees(Math.asin(
            Math.sin(betaRad) * Math.cos(epsilonRad) +
            Math.cos(betaRad) * Math.sin(epsilonRad) * Math.sin(lambdaRad)
        ));

        // Angular size varies with distance
        // At mean distance (384400 km), angular diameter is 0.518°
        const angularSize = this.MOON_ANGULAR_DIAMETER * (this.MOON_MEAN_DISTANCE / dist);

        return {
            ra: this.normalizeAngle(ra),
            dec,
            distance: dist,
            angularSize
        };
    },

    /**
     * Calculate Moon rise, transit, and set times
     * @param {number} lat - Observer latitude
     * @param {number} lon - Observer longitude
     * @param {Date} date - Date for calculation
     * @returns {object} {rise, transit, set}
     */
    calculateMoonRiseTransitSet(lat, lon, date) {
        const moonPos = this.approximateMoonPosition(date);

        // Use moon's current parallax-corrected horizon angle
        // The Moon is close enough that parallax matters
        const parallax = this.toDegrees(Math.asin(6378.14 / moonPos.distance));
        const horizonAngle = -(this.REFRACTION_HORIZON + moonPos.angularSize / 2 - parallax);

        return this.calculateRiseTransitSet(moonPos.ra, moonPos.dec, lat, lon, date, horizonAngle);
    },

    /**
     * Generate SVG path for moon phase visualization
     * @param {number} phase - Phase angle in degrees (0=new, 180=full)
     * @param {number} size - SVG size in pixels
     * @returns {string} SVG markup
     */
    generateMoonSVG(phase, size = 100) {
        const cx = size / 2;
        const cy = size / 2;
        const r = size / 2 - 2;

        // Normalize phase to 0-360
        phase = this.normalizeAngle(phase);

        // Calculate the terminator curve
        // The terminator is an ellipse when projected onto the disk
        const terminatorX = r * Math.cos(this.toRadians(phase));

        let litPath;

        if (phase < 180) {
            // Waxing - right side lit
            const sweep1 = 1;  // Right side arc
            const sweep2 = phase < 90 ? 0 : 1;  // Terminator arc direction

            litPath = `M ${cx} ${cy - r}
                       A ${r} ${r} 0 0 ${sweep1} ${cx} ${cy + r}
                       A ${Math.abs(terminatorX)} ${r} 0 0 ${sweep2} ${cx} ${cy - r}`;
        } else {
            // Waning - left side lit
            const sweep1 = 0;  // Left side arc
            const sweep2 = phase < 270 ? 1 : 0;  // Terminator arc direction

            litPath = `M ${cx} ${cy - r}
                       A ${r} ${r} 0 0 ${sweep1} ${cx} ${cy + r}
                       A ${Math.abs(terminatorX)} ${r} 0 0 ${sweep2} ${cx} ${cy - r}`;
        }

        return `
            <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
                <defs>
                    <radialGradient id="moonGradient" cx="30%" cy="30%">
                        <stop offset="0%" style="stop-color:#fffde7"/>
                        <stop offset="100%" style="stop-color:#e0d8a8"/>
                    </radialGradient>
                </defs>
                <circle cx="${cx}" cy="${cy}" r="${r}" fill="#1a1a2e"/>
                <path d="${litPath}" fill="url(#moonGradient)"/>
                <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#333" stroke-width="1"/>
            </svg>
        `;
    },

    // ===========================================================================
    // PLANETARY CALCULATIONS
    // ===========================================================================

    /**
     * Get orbital elements for a planet at a given Julian Date
     * Applies rates of change from J2000.0 epoch
     *
     * @param {string} planetName - Planet name (lowercase)
     * @param {number} jd - Julian Date
     * @returns {object} Orbital elements adjusted for date
     */
    getPlanetElements(planetName, jd) {
        const planet = this.PLANETS[planetName.toLowerCase()];
        if (!planet) return null;

        const T = this.julianCenturies(jd);  // Julian centuries since J2000.0

        return {
            name: planet.name,
            symbol: planet.symbol,
            a: planet.a + planet.aRate * T,
            e: planet.e + planet.eRate * T,
            I: planet.I + planet.IRate * T,
            L: this.normalizeAngle(planet.L + planet.LRate * T),
            longPeri: planet.longPeri + planet.longPeriRate * T,
            longNode: planet.longNode + planet.longNodeRate * T,
            siderealPeriod: planet.siderealPeriod,
            synodicPeriod: planet.synodicPeriod
        };
    },

    /**
     * Calculate heliocentric position of a planet
     * Returns ecliptic coordinates relative to the Sun
     *
     * @param {string} planetName - Planet name
     * @param {Date} date - Date for calculation
     * @returns {object} {longitude, latitude, distance} in ecliptic coordinates
     */
    calculateHeliocentricPosition(planetName, date) {
        const jd = this.dateToJulian(date);
        const elements = this.getPlanetElements(planetName, jd);
        if (!elements) return null;

        // Argument of perihelion
        const omega = elements.longPeri - elements.longNode;

        // Mean anomaly
        const M = this.normalizeAngle(elements.L - elements.longPeri);
        const MRad = this.toRadians(M);

        // Solve Kepler's equation for eccentric anomaly (iterative)
        let E = M + this.toDegrees(elements.e) * Math.sin(MRad);  // Initial approximation
        for (let i = 0; i < 10; i++) {
            const ERad = this.toRadians(E);
            const dE = (M - E + this.toDegrees(elements.e * Math.sin(ERad))) /
                       (1 - elements.e * Math.cos(ERad));
            E += dE;
            if (Math.abs(dE) < 0.0001) break;
        }
        const ERad = this.toRadians(E);

        // True anomaly
        const xv = elements.a * (Math.cos(ERad) - elements.e);
        const yv = elements.a * Math.sqrt(1 - elements.e * elements.e) * Math.sin(ERad);

        const v = this.toDegrees(Math.atan2(yv, xv));  // True anomaly
        const r = Math.sqrt(xv * xv + yv * yv);        // Distance from Sun in AU

        // Heliocentric ecliptic coordinates
        const omegaRad = this.toRadians(omega);
        const nodeRad = this.toRadians(elements.longNode);
        const iRad = this.toRadians(elements.I);
        const vRad = this.toRadians(v);

        // Position in orbital plane
        const xh = r * (Math.cos(nodeRad) * Math.cos(vRad + omegaRad) -
                       Math.sin(nodeRad) * Math.sin(vRad + omegaRad) * Math.cos(iRad));
        const yh = r * (Math.sin(nodeRad) * Math.cos(vRad + omegaRad) +
                       Math.cos(nodeRad) * Math.sin(vRad + omegaRad) * Math.cos(iRad));
        const zh = r * Math.sin(vRad + omegaRad) * Math.sin(iRad);

        // Ecliptic longitude and latitude
        const lonEcl = this.toDegrees(Math.atan2(yh, xh));
        const latEcl = this.toDegrees(Math.atan2(zh, Math.sqrt(xh * xh + yh * yh)));

        return {
            longitude: this.normalizeAngle(lonEcl),
            latitude: latEcl,
            distance: r,
            x: xh,
            y: yh,
            z: zh,
            trueAnomaly: v,
            meanAnomaly: M
        };
    },

    /**
     * Calculate geocentric position of a planet (as seen from Earth)
     * Returns RA/Dec coordinates
     *
     * @param {string} planetName - Planet name
     * @param {Date} date - Date for calculation
     * @returns {object} {ra, dec, distance, elongation, phase}
     */
    calculatePlanetPosition(planetName, date) {
        if (planetName.toLowerCase() === 'earth') {
            return null;  // Can't observe Earth from Earth
        }

        const jd = this.dateToJulian(date);

        // Get heliocentric positions
        const planet = this.calculateHeliocentricPosition(planetName, date);
        const earth = this.calculateHeliocentricPosition('earth', date);

        if (!planet || !earth) return null;

        // Geocentric rectangular coordinates (ecliptic)
        const xg = planet.x - earth.x;
        const yg = planet.y - earth.y;
        const zg = planet.z - earth.z;

        // Geocentric distance
        const dist = Math.sqrt(xg * xg + yg * yg + zg * zg);

        // Geocentric ecliptic longitude and latitude
        const lonEcl = this.toDegrees(Math.atan2(yg, xg));
        const latEcl = this.toDegrees(Math.atan2(zg, Math.sqrt(xg * xg + yg * yg)));

        // Convert ecliptic to equatorial coordinates
        const epsilon = this.meanObliquity(jd);
        const epsilonRad = this.toRadians(epsilon);
        const lonRad = this.toRadians(lonEcl);
        const latRad = this.toRadians(latEcl);

        const ra = this.toDegrees(Math.atan2(
            Math.sin(lonRad) * Math.cos(epsilonRad) - Math.tan(latRad) * Math.sin(epsilonRad),
            Math.cos(lonRad)
        ));

        const dec = this.toDegrees(Math.asin(
            Math.sin(latRad) * Math.cos(epsilonRad) +
            Math.cos(latRad) * Math.sin(epsilonRad) * Math.sin(lonRad)
        ));

        // Calculate elongation (angular distance from Sun)
        const sunPos = this.approximateSunPosition(date);
        const elongation = this.angularDistance(this.normalizeAngle(ra), dec, sunPos.ra, sunPos.dec);

        // Calculate phase angle (Sun-Planet-Earth angle)
        const r = planet.distance;  // Planet distance from Sun
        const R = dist;             // Planet distance from Earth
        const s = earth.distance;   // Earth distance from Sun

        const phaseAngle = this.toDegrees(Math.acos(
            (r * r + R * R - s * s) / (2 * r * R)
        ));

        // Illuminated fraction
        const illumination = (1 + Math.cos(this.toRadians(phaseAngle))) / 2 * 100;

        // Angular diameter
        const planetRadius = this.PLANET_RADII[planetName.toLowerCase()] || 0;
        const angularDiam = 2 * this.toDegrees(Math.atan(planetRadius / (dist * 149597870.7))) * 3600;  // arcseconds

        return {
            ra: this.normalizeAngle(ra),
            dec,
            distance: dist,          // AU from Earth
            distanceSun: r,          // AU from Sun
            elongation,              // degrees from Sun
            phaseAngle,              // degrees
            illumination,            // percentage
            angularDiameter: angularDiam,  // arcseconds
            eclipticLongitude: this.normalizeAngle(lonEcl),
            eclipticLatitude: latEcl
        };
    },

    /**
     * Calculate positions for all visible planets
     *
     * @param {Date} date - Date for calculations
     * @returns {object} Object with planet name keys
     */
    calculateAllPlanetPositions(date) {
        const planets = ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
        const result = {};

        for (const planetName of planets) {
            result[planetName] = this.calculatePlanetPosition(planetName, date);
        }

        return result;
    },

    /**
     * Calculate synodic period between Earth and another planet
     * Formula: 1/Psyn = |1/P1 - 1/P2|
     *
     * @param {string} planetName - Planet name
     * @returns {number} Synodic period in days
     */
    calculateSynodicPeriod(planetName) {
        const planet = this.PLANETS[planetName.toLowerCase()];
        const earth = this.PLANETS.earth;

        if (!planet || !planet.siderealPeriod) return null;

        const P1 = earth.siderealPeriod;
        const P2 = planet.siderealPeriod;

        return Math.abs(1 / (1 / P1 - 1 / P2));
    },

    /**
     * Calculate next opposition or conjunction for a planet
     * Opposition: planet opposite to Sun (superior planets only)
     * Conjunction: planet aligned with Sun
     *
     * @param {string} planetName - Planet name
     * @param {Date} startDate - Start searching from this date
     * @param {string} event - 'opposition' or 'conjunction'
     * @returns {Date} Approximate date of event
     */
    calculateNextPlanetaryEvent(planetName, startDate, event = 'opposition') {
        const planet = this.PLANETS[planetName.toLowerCase()];
        if (!planet) return null;

        const isInferior = planet.a < 1;  // Mercury and Venus

        // Inferior planets don't have opposition
        if (isInferior && event === 'opposition') {
            return null;
        }

        // Target elongation
        const targetElong = event === 'opposition' ? 180 : 0;

        // Search in small steps
        let date = new Date(startDate);
        const maxDays = planet.synodicPeriod ? planet.synodicPeriod * 1.5 : 800;

        for (let day = 0; day < maxDays; day++) {
            const pos = this.calculatePlanetPosition(planetName, date);
            if (!pos) continue;

            // Check if we're close to target
            const diff = Math.abs(pos.elongation - targetElong);
            if (diff < 1) {
                // Refine by checking if elongation is increasing or decreasing
                const nextDate = new Date(date.getTime() + 86400000);
                const nextPos = this.calculatePlanetPosition(planetName, nextDate);

                if (event === 'opposition') {
                    // Opposition is maximum elongation
                    if (nextPos && nextPos.elongation < pos.elongation) {
                        return date;
                    }
                } else {
                    // Conjunction is minimum elongation
                    if (nextPos && nextPos.elongation > pos.elongation) {
                        return date;
                    }
                }
            }

            date = new Date(date.getTime() + 86400000);  // Advance one day
        }

        return null;
    },

    /**
     * Calculate greatest elongation for inferior planets (Mercury, Venus)
     *
     * @param {string} planetName - 'mercury' or 'venus'
     * @param {Date} startDate - Start searching from this date
     * @param {string} type - 'eastern' (evening) or 'western' (morning)
     * @returns {object} {date, elongation}
     */
    calculateGreatestElongation(planetName, startDate, type = 'eastern') {
        const planet = this.PLANETS[planetName.toLowerCase()];
        if (!planet || planet.a >= 1) {
            return null;  // Only for inferior planets
        }

        let date = new Date(startDate);
        let maxElong = 0;
        let maxDate = null;
        const maxDays = planet.synodicPeriod * 1.5;

        for (let day = 0; day < maxDays; day++) {
            const pos = this.calculatePlanetPosition(planetName, date);
            if (!pos) continue;

            // Determine if eastern or western elongation based on RA difference with Sun
            const sunPos = this.approximateSunPosition(date);
            const raDiff = this.normalizeAngleSigned(pos.ra - sunPos.ra);

            const isEastern = raDiff > 0;

            if ((type === 'eastern' && isEastern) || (type === 'western' && !isEastern)) {
                if (pos.elongation > maxElong) {
                    maxElong = pos.elongation;
                    maxDate = new Date(date);
                }
            }

            // If we found a maximum and elongation is decreasing, we're done
            if (maxDate && pos.elongation < maxElong - 2) {
                break;
            }

            date = new Date(date.getTime() + 86400000);
        }

        return maxDate ? {
            date: maxDate,
            elongation: maxElong,
            type: type
        } : null;
    },

    /**
     * Check if a planet is in retrograde motion
     * Retrograde occurs when Earth overtakes (superior) or is overtaken by (inferior) a planet
     *
     * @param {string} planetName - Planet name
     * @param {Date} date - Date to check
     * @returns {object} {isRetrograde, angularSpeed}
     */
    isPlanetRetrograde(planetName, date) {
        const today = this.calculatePlanetPosition(planetName, date);
        const tomorrow = this.calculatePlanetPosition(planetName,
            new Date(date.getTime() + 86400000));

        if (!today || !tomorrow) return null;

        // Calculate change in ecliptic longitude
        let deltaLon = tomorrow.eclipticLongitude - today.eclipticLongitude;

        // Handle wrap-around at 360°
        if (deltaLon > 180) deltaLon -= 360;
        if (deltaLon < -180) deltaLon += 360;

        return {
            isRetrograde: deltaLon < 0,
            angularSpeed: deltaLon,  // degrees per day (negative = retrograde)
            eclipticLongitude: today.eclipticLongitude
        };
    },

    /**
     * Calculate planet rise, transit, and set times
     *
     * @param {string} planetName - Planet name
     * @param {number} lat - Observer latitude
     * @param {number} lon - Observer longitude
     * @param {Date} date - Date for calculation
     * @returns {object} {rise, transit, set}
     */
    calculatePlanetRiseTransitSet(planetName, lat, lon, date) {
        const pos = this.calculatePlanetPosition(planetName, date);
        if (!pos) return null;

        return this.calculateRiseTransitSet(pos.ra, pos.dec, lat, lon, date);
    },

    /**
     * Get observable planets for tonight with visibility info
     *
     * @param {number} lat - Observer latitude
     * @param {number} lon - Observer longitude
     * @param {Date} date - Observation date
     * @returns {Array} Array of planet visibility objects
     */
    getVisiblePlanets(lat, lon, date) {
        const planets = ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
        const result = [];

        const jd = this.dateToJulian(date);
        const lst = this.lst(jd, lon);

        for (const planetName of planets) {
            const pos = this.calculatePlanetPosition(planetName, date);
            if (!pos) continue;

            const altAz = this.raDecToAltAz(pos.ra, pos.dec, lat, lst);
            const rts = this.calculatePlanetRiseTransitSet(planetName, lat, lon, date);
            const retrograde = this.isPlanetRetrograde(planetName, date);
            const planet = this.PLANETS[planetName];

            // Estimate apparent magnitude (simplified)
            let apparentMag = null;
            if (planet.apparentMagRange) {
                // Rough estimate based on phase and distance
                const magRange = planet.apparentMagRange[1] - planet.apparentMagRange[0];
                const brightestAtOpposition = planet.a > 1;
                if (brightestAtOpposition) {
                    // Superior planets brightest at opposition (180° elongation)
                    const elongFactor = 1 - pos.elongation / 180;
                    apparentMag = planet.apparentMagRange[0] + magRange * elongFactor;
                } else {
                    // Inferior planets - complex, use middle value
                    apparentMag = (planet.apparentMagRange[0] + planet.apparentMagRange[1]) / 2;
                }
            }

            result.push({
                name: planet.name,
                symbol: planet.symbol,
                ra: pos.ra,
                dec: pos.dec,
                altitude: altAz.altitude,
                azimuth: altAz.azimuth,
                elongation: pos.elongation,
                illumination: pos.illumination,
                angularDiameter: pos.angularDiameter,
                distance: pos.distance,
                magnitude: apparentMag,
                isVisible: altAz.altitude > 0,
                isRetrograde: retrograde?.isRetrograde,
                riseTime: rts?.rise,
                transitTime: rts?.transit,
                setTime: rts?.set
            });
        }

        // Sort by altitude (highest first)
        return result.sort((a, b) => b.altitude - a.altitude);
    },

    // ===========================================================================
    // BORTLE SCALE AND LIGHT POLLUTION
    // ===========================================================================

    /**
     * Get Bortle class information
     * @param {number} bortleClass - Bortle class (1-9)
     * @returns {object} Bortle scale information
     */
    getBortleInfo(bortleClass) {
        bortleClass = Math.max(1, Math.min(9, Math.round(bortleClass)));
        return this.BORTLE_SCALE[bortleClass];
    },

    /**
     * Estimate Bortle class from coordinates
     * This is a placeholder - real implementation would query a light pollution database
     *
     * @param {number} lat - Latitude
     * @param {number} lon - Longitude
     * @returns {object} Estimated Bortle data
     */
    estimateBortleClass(lat, lon) {
        // This would normally query a light pollution database
        // For now, return a placeholder that the API should override
        return {
            class: 5,
            ...this.BORTLE_SCALE[5],
            estimated: true,
            message: 'Use backend API for accurate light pollution data'
        };
    },

    /**
     * Convert Sky Quality Meter reading to Bortle class
     * @param {number} sqm - SQM reading in mag/arcsec²
     * @returns {number} Approximate Bortle class
     */
    sqmToBortle(sqm) {
        if (sqm >= 21.99) return 1;
        if (sqm >= 21.89) return 2;
        if (sqm >= 21.69) return 3;
        if (sqm >= 21.25) return 4;
        if (sqm >= 20.49) return 5;
        if (sqm >= 19.50) return 6;
        if (sqm >= 18.94) return 7;
        if (sqm >= 18.38) return 8;
        return 9;
    },

    /**
     * Convert Bortle class to approximate SQM reading
     * @param {number} bortle - Bortle class (1-9)
     * @returns {number} Approximate SQM in mag/arcsec²
     */
    bortleToSqm(bortle) {
        return this.getBortleInfo(bortle).sqm;
    },

    // ===========================================================================
    // VISIBILITY SCORING
    // ===========================================================================

    /**
     * Calculate visibility score for a deep sky object
     *
     * @param {object} obj - Object with magnitude, size, type
     * @param {number} altitude - Current altitude in degrees
     * @param {number} limitingMag - Naked-eye limiting magnitude
     * @returns {number} Score from 0-100
     */
    calculateVisibilityScore(obj, altitude, limitingMag = 5.8) {
        // Object below horizon
        if (altitude < 0) return 0;

        let score = 0;

        // Altitude factor (0-50 points)
        // Optimal range: 30-70 degrees
        // Penalty for very low (atmospheric extinction) and very high (neck strain)
        if (altitude < 15) {
            score += altitude * 1.5;  // 0-22.5 points
        } else if (altitude < 30) {
            score += 22.5 + (altitude - 15) * 1.0;  // 22.5-37.5 points
        } else if (altitude < 70) {
            score += 37.5 + (altitude - 30) * 0.3125;  // 37.5-50 points
        } else {
            score += 50 - (altitude - 70) * 0.5;  // Slight penalty above 70°
        }

        // Brightness factor (0-30 points)
        // How much brighter than limiting magnitude?
        const magDiff = limitingMag - obj.magnitude;
        if (magDiff < -2) {
            // Object is much fainter than limiting mag - very difficult
            score += 0;
        } else if (magDiff < 0) {
            // Object is fainter than limiting mag - challenging
            score += (magDiff + 2) * 5;  // 0-10 points
        } else if (magDiff < 3) {
            // Object is visible
            score += 10 + magDiff * 6.67;  // 10-30 points
        } else {
            // Very easy target
            score += 30;
        }

        // Size factor for extended objects (0-20 points)
        // Larger objects are easier to find and more impressive
        if (obj.size) {
            const sizeArcmin = parseFloat(obj.size) || 0;
            if (sizeArcmin > 5) {
                score += Math.min(20, sizeArcmin / 3);
            }
        }

        return Math.min(100, Math.max(0, Math.round(score)));
    },

    /**
     * Rank a list of objects by observability
     *
     * @param {Array} objects - Array of objects with ra, dec, magnitude, size
     * @param {number} lat - Observer latitude
     * @param {number} lon - Observer longitude
     * @param {Date} date - Observation date/time
     * @param {number} limitingMag - Limiting magnitude for the site
     * @returns {Array} Sorted array with visibility scores
     */
    rankObjectsByVisibility(objects, lat, lon, date, limitingMag = 5.8) {
        const jd = this.dateToJulian(date);
        const localSiderealTime = this.lst(jd, lon);

        return objects.map(obj => {
            // Convert RA from hours to degrees if needed
            let ra = obj.ra;
            if (typeof ra === 'string' && ra.includes('h')) {
                ra = this.parseCoordinate(ra, 'ra');
            } else if (ra < 24) {
                ra = ra * this.HOURS_TO_DEG;  // Assume hours if small number
            }

            let dec = obj.dec;
            if (typeof dec === 'string') {
                dec = this.parseCoordinate(dec, 'dec');
            }

            const altAz = this.raDecToAltAz(ra, dec, lat, localSiderealTime);
            const score = this.calculateVisibilityScore(obj, altAz.altitude, limitingMag);

            return {
                ...obj,
                currentAltitude: altAz.altitude,
                currentAzimuth: altAz.azimuth,
                visibilityScore: score,
                isVisible: altAz.altitude > 0,
                isOptimal: altAz.altitude > 30 && altAz.altitude < 70
            };
        })
        .filter(obj => obj.isVisible)
        .sort((a, b) => b.visibilityScore - a.visibilityScore);
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Astronomy;
}
