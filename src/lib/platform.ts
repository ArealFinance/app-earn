/**
 * Platform detection — the single seam that tells the app whether it is running
 * inside the Capacitor native Android shell (Seeker / dApp Store build) or in a
 * normal web browser.
 *
 * Capacitor's `isNativePlatform()` returns `true` only when the JS is executing
 * inside the native WebView (it checks for the injected `Capacitor` bridge). In
 * the plain web build the same call returns `false`, so the existing browser
 * wallet path is preserved untouched.
 *
 * Importing `@capacitor/core` in the web bundle is safe: the package degrades to
 * a web-platform stub when no native bridge is present, so `isNativePlatform()`
 * resolves to `false` without throwing. This keeps ONE codebase for web + native.
 */

import { Capacitor } from '@capacitor/core';

/**
 * True when running inside the Capacitor native shell (Android device/emulator).
 * Drives the wallet-backend selection in `$lib/wallet/backend`.
 */
export function isNativePlatform(): boolean {
	try {
		return Capacitor.isNativePlatform();
	} catch {
		// Defensive: if the bridge is somehow unavailable, treat as web.
		return false;
	}
}

/** Lowercase platform id: `'android'` | `'ios'` | `'web'`. */
export function getPlatform(): string {
	try {
		return Capacitor.getPlatform();
	} catch {
		return 'web';
	}
}
