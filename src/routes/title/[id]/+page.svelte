<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import EpisodeRow from '#lib/components/EpisodeRow.svelte';
	import Poster from '#lib/components/Poster.svelte';
	import Stars from '#lib/components/Stars.svelte';
	import { shortDate } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const t = $derived(data.title);
	const isAnime = $derived(t.isAnimeOverride ?? t.isAnimeDetected);

	/** Name of the action currently in flight (disables its button). */
	let busy = $state<string | null>(null);
	const track =
		(name: string): SubmitFunction =>
		() => {
			busy = name;
			return async ({ update }) => {
				await update({ reset: false });
				busy = null;
			};
		};

	const animeChoices = [
		{ value: '', label: 'Auto' },
		{ value: '1', label: 'Yes' },
		{ value: '0', label: 'No' }
	];
	/** Close an open "⋯" episode menu when tapping anywhere else. */
	function closeMenus(e: MouseEvent) {
		for (const m of document.querySelectorAll<HTMLDetailsElement>('details.menu[open]')) {
			if (!m.contains(e.target as Node)) m.open = false;
		}
	}

	const animeCurrent = $derived(t.isAnimeOverride === null ? '' : t.isAnimeOverride ? '1' : '0');
</script>

<svelte:head><title>{t.name} · MyTV-Time</title></svelte:head>
<svelte:document onclick={closeMenus} />

{#key t.id}
	<header>
		<Poster src={t.posterUrl} name={t.name} width={120} />
		<div class="info">
			<h1>{t.name}</h1>
			<p class="meta">
				{[t.kind === 'movie' ? 'Movie' : isAnime ? 'Anime' : 'Series', t.year, t.status].filter(Boolean).join(' · ')}
			</p>
			{#if t.originalName && t.originalName !== t.name}<p class="meta">{t.originalName}</p>{/if}
			<Stars value={t.stars} />
		</div>
	</header>

	{#if form?.message}<p class="error-banner" role="alert">{form.message}</p>{/if}

	<div class="actions">
		{#if t.kind === 'series'}
			<form method="POST" action="?/follow" use:enhance={track('follow')}>
				<input type="hidden" name="value" value={t.followed ? '0' : '1'} />
				<button class="btn" class:on={t.followed} aria-pressed={t.followed} disabled={busy === 'follow'}>
					{t.followed ? '✓ Following' : 'Follow'}
				</button>
			</form>
			<form method="POST" action="?/archive" use:enhance={track('archive')}>
				<input type="hidden" name="value" value={t.archived ? '0' : '1'} />
				<button class="btn" class:on={t.archived} aria-pressed={t.archived} disabled={busy === 'archive'}>
					{t.archived ? 'Archived' : 'Archive'}
				</button>
			</form>
		{/if}
		<form method="POST" action="?/watchlist" use:enhance={track('watchlist')}>
			<input type="hidden" name="value" value={data.inWatchlist ? '0' : '1'} />
			<button class="btn" class:on={data.inWatchlist} aria-pressed={data.inWatchlist} disabled={busy === 'watchlist'}>
				{data.inWatchlist ? '✓ On watchlist' : '+ Watchlist'}
			</button>
		</form>
		{#if t.kind === 'series'}
			<form method="POST" action="?/refresh" use:enhance={track('refresh')}>
				<button class="btn" disabled={busy === 'refresh'} title={t.lastSyncedAt ? `Last synced ${t.lastSyncedAt.slice(0, 16).replace('T', ' ')} UTC` : 'Never synced'}>
					{busy === 'refresh' ? 'Refreshing…' : '↻ Refresh'}
				</button>
			</form>
		{/if}
	</div>

	{#if t.overview}<p class="overview">{t.overview}</p>{/if}

	{#if data.movie}
		<section class="panel movie">
			<p>
				{#if data.movie.watchCount === 0}
					Not watched yet.
				{:else}
					Watched {data.movie.watchCount}×{data.movie.lastWatchedAt ? ` · last ${shortDate(data.movie.lastWatchedAt.slice(0, 10), Number(data.today.slice(0, 4)))}` : ''}
				{/if}
			</p>
			<div class="row">
				<form method="POST" action="?/markMovie" use:enhance={track('markMovie')}>
					<button class="btn primary" disabled={busy === 'markMovie'}>
						✓ {data.movie.watchCount === 0 ? 'Mark watched' : 'Watched again'}
					</button>
				</form>
				{#if data.movie.watchCount > 0}
					<form method="POST" action="?/unmarkMovie" use:enhance={track('unmarkMovie')}>
						<button class="btn" disabled={busy === 'unmarkMovie'}>Unmark latest</button>
					</form>
				{/if}
			</div>
		</section>
	{:else}
		{#if data.seasons.length === 0}
			<p class="empty">No episodes yet. Try ↻ Refresh.</p>
		{/if}
		{#each data.seasons as s (s.number)}
			<details class="panel season" open={s.number === data.openSeason}>
				<summary>
					<span class="label">{s.label}</span>
					<span class="progress" class:done={s.total > 0 && s.watched === s.total}>{s.watched}/{s.total}</span>
				</summary>
				{#if s.airedUnwatched > 0}
					<form method="POST" action="?/markSeason" use:enhance={track(`season-${s.number}`)} class="mark-season">
						<input type="hidden" name="season" value={s.number} />
						<button class="btn" disabled={busy === `season-${s.number}`}>
							✓ Mark {s.number === 0 ? 'all specials' : 'season'} watched ({s.airedUnwatched})
						</button>
					</form>
				{/if}
				<ul>
					{#each s.episodes as ep (ep.id)}
						<EpisodeRow {ep} today={data.today} />
					{/each}
				</ul>
			</details>
		{/each}
	{/if}

	{#if t.kind === 'series'}
		<form method="POST" action="?/anime" use:enhance={track('anime')} class="anime">
			<span id="anime-label">Anime</span>
			<div class="segmented" role="group" aria-labelledby="anime-label">
				{#each animeChoices as c (c.value)}
					<button
						name="value"
						value={c.value}
						aria-pressed={animeCurrent === c.value}
						disabled={busy === 'anime'}
					>
						{c.value === '' ? `Auto (${t.isAnimeDetected ? 'yes' : 'no'})` : c.label}
					</button>
				{/each}
			</div>
		</form>
	{/if}
{/key}

<style>
	header {
		display: flex;
		gap: 1rem;
		align-items: flex-start;
		margin-bottom: 1rem;
	}

	.info {
		min-width: 0;
	}

	h1 {
		font-size: 1.45rem;
		margin-bottom: 0.25rem;
	}

	.meta {
		margin: 0 0 0.15rem;
		color: var(--muted);
		font-size: 0.9rem;
	}

	.info :global(.stars) {
		margin: 0.4rem 0 0 -8px;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.overview {
		color: var(--muted);
		margin: 0 0 1.25rem;
		max-width: 65ch;
	}

	.panel {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		margin-bottom: 0.75rem;
	}

	.movie {
		padding: 0.25rem 1rem 1rem;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 56px;
		padding: 0 1rem;
		cursor: pointer;
		font-weight: 700;
		list-style: none;
	}

	summary::-webkit-details-marker {
		display: none;
	}

	summary::after {
		content: '';
		width: 8px;
		height: 8px;
		margin-left: 0.75rem;
		border-right: 2px solid var(--muted);
		border-bottom: 2px solid var(--muted);
		transform: rotate(45deg) translateY(-3px);
		transition: transform 0.15s;
	}

	details[open] summary::after {
		transform: rotate(-135deg) translateY(-1px);
	}

	.label {
		flex: 1;
	}

	.progress {
		color: var(--muted);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		font-size: 0.9rem;
	}

	.progress.done {
		color: var(--accent);
	}

	.mark-season {
		padding: 0 1rem 0.5rem;
	}

	.season ul {
		list-style: none;
		margin: 0;
		padding: 0 0.5rem 0.5rem 0.25rem;
	}

	.anime {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-top: 1.5rem;
		color: var(--muted);
	}

	.segmented {
		display: inline-flex;
		border: 1px solid var(--border);
		border-radius: 999px;
		overflow: hidden;
	}

	.segmented button {
		min-height: var(--tap);
		padding: 0 0.9rem;
		border: 0;
		background: var(--surface);
		cursor: pointer;
	}

	.segmented button + button {
		border-left: 1px solid var(--border);
	}

	.segmented button[aria-pressed='true'] {
		background: var(--accent);
		color: var(--accent-text);
		font-weight: 700;
	}

	@media (min-width: 768px) {
		header :global(.poster) {
			width: 160px !important;
		}

		h1 {
			font-size: 1.9rem;
		}
	}
</style>
