<script lang="ts">
	import { enhance } from '$app/forms';
	import { epCode } from '#lib/format.ts';

	type Preview = { rawSeason: number; rawEpisode: number; targetSeason: number; targetEpisode: number; targetName: string | null };

	let {
		issueKey,
		rawSeason,
		seasons,
		initial
	}: { issueKey: string; rawSeason: number; seasons: number[]; initial: Preview[] } = $props();

	// Local form state, seeded once from the server (the parent keys this component by issue).
	// svelte-ignore state_referenced_locally
	let season = $state(String(rawSeason));
	let offset = $state('0');
	// svelte-ignore state_referenced_locally
	let preview = $state<Preview[]>(initial);
	let previewError = $state<string | null>(null);
	let busy = $state(false);

	const valid = $derived(/^\d{1,4}$/.test(season.trim()) && /^-?\d{1,6}$/.test(offset.trim()));

	/** Live preview: refetch (debounced) whenever season/offset change; ignore stale answers. */
	let seq = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let alive = true;
	$effect(() => () => {
		alive = false;
		clearTimeout(timer);
	});
	function refresh() {
		clearTimeout(timer);
		if (!alive) return;
		const n = ++seq;
		if (!valid) {
			previewError = 'Season and offset must be whole numbers.';
			return;
		}
		timer = setTimeout(async () => {
			const qs = new URLSearchParams({ key: issueKey, season: season.trim(), offset: offset.trim() });
			try {
				const res = await fetch(`/fix-imports/preview?${qs}`);
				if (n !== seq) return;
				if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `HTTP ${res.status}`);
				preview = await res.json();
				previewError = null;
			} catch (e) {
				if (n === seq) previewError = `Preview failed: ${e instanceof Error ? e.message : e}`;
			}
		}, 150);
	}

	function step(delta: number) {
		const v = Number(offset.trim());
		offset = String((Number.isInteger(v) ? v : 0) + delta);
		refresh();
	}
</script>

<form
	method="POST"
	action="?/fixEpisodes"
	use:enhance={() => {
		busy = true;
		return async ({ update }) => {
			await update({ reset: false });
			busy = false;
			// Partly linked: the issue stays and its remaining raw episodes change.
			refresh();
		};
	}}
>
	<input type="hidden" name="key" value={issueKey} />
	<div class="inputs">
		<label>
			<span>Target season</span>
			<input name="season" type="text" inputmode="numeric" pattern="\d+" autocomplete="off" bind:value={season} oninput={refresh} required list="seasons-{issueKey}" />
			<datalist id="seasons-{issueKey}">
				{#each seasons as s (s)}<option value={s}></option>{/each}
			</datalist>
		</label>
		<div class="field">
			<label for="offset-{issueKey}">Offset</label>
			<span class="stepper">
				<button type="button" class="step" aria-label="Decrease offset" onclick={() => step(-1)}>−</button>
				<!-- type=text: phone number pads often have no minus key; the ± buttons cover that. -->
				<input id="offset-{issueKey}" name="offset" type="text" pattern="-?\d+" autocomplete="off" bind:value={offset} oninput={refresh} required />
				<button type="button" class="step" aria-label="Increase offset" onclick={() => step(1)}>+</button>
			</span>
		</div>
	</div>
	<p class="hint">
		Raw S{rawSeason}E<i>n</i> → S{season || '?'}E<i>n</i>{Number(offset) >= 0 ? ' + ' : ' − '}{Math.abs(Number(offset) || 0)}.
		{#if seasons.length}TMDB seasons: {seasons.join(', ')}.{/if}
	</p>
	{#if previewError}
		<p class="hint error">{previewError}</p>
	{:else}
		<ul class="preview" aria-label="Preview">
			{#each preview as p (p.rawEpisode)}
				<li class:missing={p.targetName === null}>
					{epCode(p.rawSeason, p.rawEpisode)} → {epCode(p.targetSeason, p.targetEpisode)} · {p.targetName ?? 'no such episode'}
				</li>
			{:else}
				<li class="missing">No unlinked watches left.</li>
			{/each}
		</ul>
	{/if}
	<button class="btn primary" disabled={busy || !valid}>Apply</button>
</form>

<style>
	.inputs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	label,
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--muted);
	}

	input {
		font: inherit;
		font-size: 1rem;
		color: var(--text);
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 10px;
		min-height: var(--tap);
		width: 6.5rem;
		padding: 0 0.6rem;
	}

	.stepper {
		display: flex;
		gap: 0.3rem;
	}

	.stepper input {
		width: 5rem;
		text-align: center;
	}

	.step {
		width: var(--tap);
		min-height: var(--tap);
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--surface-2);
		font-size: 1.2rem;
		cursor: pointer;
	}

	.hint {
		color: var(--muted);
		font-size: 0.85rem;
		margin: 0.5rem 0;
	}

	.hint.error {
		color: var(--danger);
	}

	.preview {
		list-style: none;
		margin: 0 0 0.75rem;
		padding: 0.5rem 0.75rem;
		border-radius: 10px;
		background: var(--surface-2);
		font-variant-numeric: tabular-nums;
		font-size: 0.92rem;
		display: grid;
		gap: 0.2rem;
	}

	.missing {
		color: var(--danger);
	}
</style>
