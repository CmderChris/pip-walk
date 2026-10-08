// Synchronous performance tier: a mobile UA or <=4 CPU threads counts as low-end.
// The thread check catches devices with a desktop UA (e.g. Surface Go 2).

// iPadOS 13+ reports a desktop Mac user agent, so spot it by touch support.
const isIPadOS = /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
const mobileUA = isIPadOS || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
const cores    = navigator.hardwareConcurrency ?? 8;
// Chrome-only; assume a reasonable 4 GB where it isn't reported (Safari, Firefox)
const memoryGB = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;

export const isLowEnd = mobileUA || cores <= 4;

// Modern phones and tablets (6+ cores) still take the low-end render path (no shadows or
// post-processing) but can afford denser grass than a genuinely weak device.
const midRangeMobile = mobileUA && cores >= 6 && memoryGB >= 4;

// Share of the full grass density generated for this device. adaptiveQuality can thin
// it further at runtime if the frame rate can't hold.
export const grassDensityTier = !isLowEnd ? 1 : midRangeMobile ? 1 : 0.7;

// Render resolution range. Phones are DPR 2-3, so DPR 1 upscales and looks soft. R3F clamps
// the range to the real devicePixelRatio, and the max is capped to bound fill cost.
export const canvasDpr: [number, number] = !isLowEnd ? [1, 2] : midRangeMobile ? [1.5, 2] : [1, 1.5];
