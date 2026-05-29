<script lang="ts">
	/**
	 * Generic inline-SVG sparkline. Pure path math, no chart library.
	 *
	 * Y-axis auto-scales to the data's min/max so a gentle slope stays visible.
	 * A soft area fill under the line gives it weight. Colour follows the overall
	 * trend (up = success, down = danger) unless `color` is passed explicitly.
	 */

	interface Props {
		/** The series to plot. */
		values: number[];
		width?: number;
		height?: number;
		/** Override the auto-derived trend colour. */
		color?: string;
		/** Accessible description of the series. */
		label?: string;
	}

	let { values, width = 480, height = 64, color, label = 'Value over time' }: Props =
		$props();

	const padding = 2;
	const uid = `spark-${Math.random().toString(36).slice(2, 9)}`;

	const trendColor = $derived.by(() => {
		if (color) return color;
		if (values.length < 2) return 'var(--color-success)';
		return values[values.length - 1] >= values[0]
			? 'var(--color-success)'
			: 'var(--color-danger)';
	});

	const path = $derived.by(() => {
		if (values.length < 2) return { line: '', area: '' };

		const min = Math.min(...values);
		const max = Math.max(...values);
		const range = max - min || 1;
		const xStep = (width - padding * 2) / (values.length - 1);

		const coords = values.map((v, i) => {
			const x = padding + i * xStep;
			const y = padding + (1 - (v - min) / range) * (height - padding * 2);
			return { x, y };
		});

		const line = coords
			.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`)
			.join(' ');
		const last = coords[coords.length - 1];
		const first = coords[0];
		const area = `${line} L ${last.x.toFixed(2)} ${height} L ${first.x.toFixed(2)} ${height} Z`;

		return { line, area };
	});
</script>

<svg
	class="spark"
	viewBox={`0 0 ${width} ${height}`}
	preserveAspectRatio="none"
	role="img"
	aria-label={label}
>
	<defs>
		<linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
			<stop offset="0%" stop-color={trendColor} stop-opacity="0.25" />
			<stop offset="100%" stop-color={trendColor} stop-opacity="0" />
		</linearGradient>
	</defs>
	<path d={path.area} fill={`url(#${uid})`} />
	<path
		d={path.line}
		fill="none"
		stroke={trendColor}
		stroke-width="1.5"
		stroke-linejoin="round"
		stroke-linecap="round"
	/>
</svg>

<style>
	.spark {
		display: block;
		width: 100%;
		height: 64px;
	}
</style>
