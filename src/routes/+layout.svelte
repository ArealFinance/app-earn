<script lang="ts">
	// MUST be first — sets globalThis.Buffer before any wallet / SPL-token
	// module evaluates (see browser-globals.ts).
	import '$lib/runtime/browser-globals';
	import '$lib/styles/tokens.css';
	import '$lib/styles/global.css';

	let { children } = $props();
</script>

<svelte:head>
	<title>Areal — Yield on RWT</title>
</svelte:head>

{@render children?.()}
