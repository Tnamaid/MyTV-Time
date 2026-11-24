<script lang="ts">
	import { enhance } from '$app/forms';

	/** Current rating (1–5) or null. Tapping the current value clears it. */
	let { value, action = '?/stars' }: { value: number | null; action?: string } = $props();

	let pending = $state<number | null | undefined>(undefined);
	const shown = $derived(pending === undefined ? value : pending);
</script>

<form
	method="POST"
	{action}
	class="stars"
	aria-label="Rating"
	use:enhance={({ formData }) => {
		const v = formData.get('stars');
		pending = v ? Number(v) : null;
		return async ({ update }) => {
			await update({ reset: false });
			pending = undefined;
		};
	}}
>
	{#each [1, 2, 3, 4, 5] as n (n)}
		<button
			name="stars"
			value={n === value ? '' : String(n)}
			class:filled={shown !== null && n <= shown}
			aria-label={n === value ? `Clear rating (${n} star${n > 1 ? 's' : ''})` : `Rate ${n} star${n > 1 ? 's' : ''}`}
			aria-pressed={n === shown}
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" />
			</svg>
		</button>
	{/each}
</form>

<style>
	.stars {
		display: flex;
	}

	button {
		width: var(--tap);
		height: var(--tap);
		display: grid;
		place-items: center;
		padding: 0;
		border: 0;
		background: none;
		cursor: pointer;
		color: var(--faint);
	}

	button.filled {
		color: var(--accent);
	}

	svg {
		width: 28px;
		height: 28px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linejoin: round;
	}

	.filled svg {
		fill: currentColor;
	}
</style>
