<script lang="ts" module>
	export type EpisodeRowData = {
		id: number;
		seasonNumber: number;
		episodeNumber: number;
		name: string | null;
		airDate: string | null;
		watchCount: number;
	};
</script>

<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import { epCode, shortDate } from '#lib/format.ts';

	let { ep, today }: { ep: EpisodeRowData; today: string } = $props();

	const aired = $derived(ep.airDate !== null && ep.airDate <= today);
	const code = $derived(epCode(ep.seasonNumber, ep.episodeNumber));
	const refYear = $derived(Number(today.slice(0, 4)));

	/** Optimistic watched state while a toggle is in flight. */
	let optimistic = $state<boolean | null>(null);
	let busy = $state(false);
	const watched = $derived(optimistic ?? ep.watchCount > 0);

	let menu = $state<HTMLDetailsElement>();

	// use:enhance keeps the callback it got at mount, so read `watched` at submit time.
	const submit = (kind: 'toggle' | 'upTo'): SubmitFunction => () => {
		busy = true;
		optimistic = kind === 'toggle' ? !watched : null;
		if (menu) menu.open = false;
		return async ({ update }) => {
			await update({ reset: false });
			optimistic = null;
			busy = false;
		};
	};
</script>

<li class:unaired={!aired} class:watched>
	<form
		method="POST"
		action={watched ? '?/unmarkEpisode' : '?/markEpisode'}
		use:enhance={submit('toggle')}
	>
		<input type="hidden" name="episodeId" value={ep.id} />
		<button
			class="check"
			role="checkbox"
			aria-checked={watched}
			aria-label="{code} watched"
			disabled={busy}
		>
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
		</button>
	</form>

	<div class="text">
		<span class="code">{code}</span>
		<span class="name">{ep.name ?? 'TBA'}</span>
		<span class="meta">
			{#if !ep.airDate}No air date{:else if aired}{shortDate(ep.airDate, refYear)}{:else}Airs {shortDate(ep.airDate, refYear)}{/if}{#if ep.watchCount > 1}{` · watched ${ep.watchCount}×`}{/if}
		</span>
	</div>

	<details class="menu" bind:this={menu}>
		<summary aria-label="More actions for {code}">
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
			</svg>
		</summary>
		<form method="POST" action="?/markUpTo" use:enhance={submit('upTo')}>
			<input type="hidden" name="episodeId" value={ep.id} />
			<button disabled={busy}>Mark up to here</button>
		</form>
	</details>
</li>

<style>
	li {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.35rem 0;
		border-top: 1px solid var(--border);
	}

	li:first-child {
		border-top: 0;
	}

	.check {
		width: var(--tap);
		height: var(--tap);
		flex: none;
		display: grid;
		place-items: center;
		padding: 0;
		background: none;
		border: 0;
		cursor: pointer;
	}

	.check svg {
		width: 30px;
		height: 30px;
		padding: 4px;
		border-radius: 50%;
		border: 2px solid var(--faint);
		fill: none;
		stroke: transparent;
		stroke-width: 3;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.watched .check svg {
		background: var(--accent);
		border-color: var(--accent);
		stroke: var(--accent-text);
	}

	.text {
		flex: 1;
		min-width: 0;
		display: grid;
		grid-template-columns: auto 1fr;
		column-gap: 0.5rem;
	}

	.code {
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		font-size: 0.85rem;
		color: var(--muted);
		align-self: center;
	}

	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.meta {
		grid-column: 2;
		font-size: 0.8rem;
		color: var(--muted);
	}

	.unaired .text {
		color: var(--faint);
	}

	.unaired .meta {
		color: var(--faint);
		font-style: italic;
	}

	.menu {
		position: relative;
		flex: none;
	}

	summary {
		list-style: none;
		width: var(--tap);
		height: var(--tap);
		display: grid;
		place-items: center;
		cursor: pointer;
		border-radius: 50%;
		color: var(--muted);
	}

	summary::-webkit-details-marker {
		display: none;
	}

	summary svg {
		width: 22px;
		height: 22px;
		fill: currentColor;
	}

	.menu[open] summary {
		background: var(--surface-2);
	}

	.menu form {
		position: absolute;
		right: 0;
		top: calc(100% + 4px);
		z-index: 5;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 12px;
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
		padding: 0.25rem;
	}

	.menu button {
		min-height: var(--tap);
		padding: 0 1rem;
		border: 0;
		background: none;
		white-space: nowrap;
		cursor: pointer;
		border-radius: 8px;
	}

	.menu button:hover {
		background: var(--border);
	}
</style>
