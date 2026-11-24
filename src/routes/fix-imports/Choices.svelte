<script lang="ts">
	import { enhance } from '$app/forms';
	import Poster from '#lib/components/Poster.svelte';

	type Choice = { tmdbId: number; name: string; year: number | null; posterUrl: string | null };

	/** TMDB titles to pick from for one issue; picking posts `action` with key + tmdbId. */
	let {
		choices,
		action,
		issueKey,
		busy = false,
		onbusy
	}: {
		choices: Choice[];
		action: string;
		issueKey: string;
		/** A pick or dismiss for this issue is in flight. */
		busy?: boolean;
		onbusy: (busy: boolean) => void;
	} = $props();

	const label = (c: Choice) => (c.year ? `${c.name} (${c.year})` : c.name);
</script>

<ul class="choices">
	{#each choices as c (c.tmdbId)}
		<li>
			<form
				method="POST"
				{action}
				use:enhance={() => {
					onbusy(true);
					return async ({ update }) => {
						await update();
						onbusy(false);
					};
				}}
			>
				<input type="hidden" name="key" value={issueKey} />
				<input type="hidden" name="tmdbId" value={c.tmdbId} />
				<button disabled={busy} aria-label="Pick {label(c)}">
					<Poster src={c.posterUrl} name={c.name} width={36} />
					<span class="name">{c.name}</span>
					{#if c.year}<span class="year">{c.year}</span>{/if}
					<span class="pick" aria-hidden="true">Pick</span>
				</button>
			</form>
		</li>
	{/each}
</ul>

<style>
	.choices {
		list-style: none;
		margin: 0.5rem 0 0;
		padding: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.35rem;
	}

	button {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.7rem;
		min-height: var(--tap);
		padding: 0.35rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--surface-2);
		text-align: left;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.55;
	}

	.name {
		flex: 1;
		min-width: 0;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.year {
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}

	.pick {
		color: var(--accent);
		font-weight: 700;
	}

	.choices :global(.poster span) {
		font-size: 0.8rem;
	}
</style>
