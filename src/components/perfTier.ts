// Synchronous performance tier: a mobile UA or <=4 CPU threads counts as low-end.
// The thread check catches devices with a desktop UA (e.g. Surface Go 2).

// iPadOS 13+ reports a desktop Mac user agent, so spot it by touch support.
const isIPadOS = /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
const mobileUA = isIPadOS || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
const cores    = navigator.hardwareConcurrency ?? 8;

export const isLowEnd = mobileUA || cores <= 4;
