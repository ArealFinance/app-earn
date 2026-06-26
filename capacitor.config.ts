import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor config — wraps the SvelteKit static SPA in a native Android shell
 * for the Solana Seeker / dApp Store build.
 *
 * `webDir` MUST match the static adapter's output directory. `svelte.config.js`
 * uses `@sveltejs/adapter-static` with `fallback: 'index.html'` and no custom
 * `pages`/`assets` override, so SvelteKit emits the SPA to `build/`. `cap sync`
 * copies that directory into the Android project's webview assets.
 *
 * No `server.url` is set on purpose: the web assets are BUNDLED into the APK
 * (offline-capable shell), not loaded from a remote origin. A remote `server.url`
 * would defeat the point of shipping a self-contained dApp-Store binary and would
 * also break the Mobile Wallet Adapter origin model.
 *
 * TODO(seeker): once a device build exists, confirm the SPA boots inside the
 * Android System WebView (Chromium) with `ssr=false` — already the case in
 * svelte.config.js, so no SSR shim is needed.
 */
const config: CapacitorConfig = {
	appId: 'finance.areal.earn',
	appName: 'Areal',
	webDir: 'build',
	android: {
		// Mixed content stays disabled; all app traffic is HTTPS (RPC + fonts).
		allowMixedContent: false
	}
};

export default config;
