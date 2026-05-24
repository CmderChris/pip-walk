// Synchronous performance tier detection.
// Uses CPU thread count and reported RAM (Chrome/Edge only) to classify devices.
// This catches Windows tablets, low-end laptops, and phones that slip through a
// simple mobile UA check (e.g. Surface Go 2 reports a desktop Windows user agent).

const mobileUA = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
const cores    = navigator.hardwareConcurrency ?? 8;

export const isMobile = mobileUA;
export const isLowEnd = mobileUA || cores <= 4;
