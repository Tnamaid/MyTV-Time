<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import Poster from '#lib/components/Poster.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	type Result = (typeof data.movies)[number] | (typeof data.series)[number];

	/** Keep ?q= in the action URL so the results survive the POST (with or without JS). */
	const act = (name: string) => `?${new URLSearchParams({ q: data.q })}&/${name}`;

	/** Result whose action is in flight: blocks double taps (two taps = two watches). */
	let busy = $state<string | null>(null);
	const track =
		(key: string): SubmitFunction =>
		() => {
			busy = key;
			return async ({ update }) => {
				await update({ reset: false });
				busy = null;
			};
		};

	const sections = $derived(
		[
			{ label: 'Series', items: data.series as Result[] },
			{ label: 'Movies', items: data.movies as Result[] }
		].filter((s) => s.items.length > 0)
	);
</script>

<svelte:head><title>{data.q ? `${data.q} · ` : ''}Search · MyTV-Time</title></svelte:head>

<h1 class="page-title">Search</h1>

{#if !data.configured}
	<p class="error-banner" role="alert">
		TMDB not configured. Set <code>TMDB_API_KEY</code> and restart the app to search and add titles.
	</p>
{:else}
	<form method="GET" class="bar" role="search" data-sveltekit-keepfocus>
		<input type="search" name="q" value={data.q} aria-label="Search TMDB" placeholder="Movie or series name" autocomplete="off" />
		<button class="btn primary">Search</button>
	</form>

	{#if form?.message}<p class="error-banner" role="alert">{form.message}</p>{/if}
	{#if data.error}<p class="error-banner" role="alert">{data.error}</p>{/if}

	{#if data.q && !data.error && sections.length === 0}
		<p class="empty">No results for “{data.q}”.</p>
	{/if}

	{#each sections as section (section.label)}
		<h2 class="section">{section.label}</h2>
		<ul>
			{#each section.items as r (r.tmdbId)}
				{@const key = `${r.kind}-${r.tmdbId}`}
				{@const lib = r.library}
				<li>
					<article>
						<Poster src={r.posterUrl} name={r.name} width={64} />
						<div class="body">
							<h3>{r.name}</h3>
							<p class="meta">{[r.kind === 'movie' ? 'Movie' : 'Series', r.year].filter(Boolean).join(' · ')}</p>
							{#if r.originalName && r.originalName !== r.name}<p class="meta">{r.originalName}</p>{/if}
							{#if lib}
								<p class="state">
									<a href="/title/{lib.titleId}">In library ›</a>
									{#if r.kind === 'movie' && lib.watchCount > 0}<span>✓ Watched</span>{/if}
									{#if lib.followed}<span>✓ Following</span>{/if}
									{#if lib.inWatchlist}<span>✓ On watchlist</span>{/if}
								</p>
							{/if}
							<div class="actions">
								{#if !lib || (r.kind === 'movie' && lib.watchCount === 0)}
									<form method="POST" action={act('watched')} use:enhance={track(key)}>
										<input type="hidden" name="tmdbId" value={r.tmdbId} />
										<input type="hidden" name="kind" value={r.kind} />
										<button class="btn primary" disabled={busy === key}>Watched</button>
									</form>
								{/if}
								{#if !lib?.inWatchlist}
									<form method="POST" action={act('watchlist')} use:enhance={track(key)}>
										<input type="hidden" name="tmdbId" value={r.tmdbId} />
										<input type="hidden" name="kind" value={r.kind} />
										<button class="btn" disabled={busy === key}>Watchlist</button>
									</form>
								{/if}
								{#if r.kind === 'series' && !lib?.followed}
									<form method="POST" action={act('follow')} use:enhance={track(key)}>
										<input type="hidden" name="tmdbId" value={r.tmdbId} />
										<input type="hidden" name="kind" value={r.kind} />
										<button class="btn" disabled={busy === key}>Follow</button>
									</form>
								{/if}
							</div>
						</div>
					</article>
				</li>
			{/each}
		</ul>
	{/each}
{/if}

<style>
	.bar {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	input {
		flex: 1;
		min-width: 0;
		font: inherit;
		font-size: 1rem;
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 999px;
		min-height: var(--tap);
		padding: 0 1rem;
	}

	.section {
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
		margin: 1.25rem 0 0.5rem;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.6rem;
	}

	article {
		display: flex;
		gap: 0.85rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.6rem;
	}

	.body {
		min-width: 0;
		flex: 1;
	}

	h3 {
		font-size: 1.05rem;
		margin-bottom: 0.15rem;
	}

	.meta {
		margin: 0;
		color: var(--muted);
		font-size: 0.88rem;
	}

	.state {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		margin: 0.3rem 0 0;
		font-size: 0.88rem;
		color: var(--accent);
	}

	.state a {
		font-weight: 700;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.5rem;
	}

	.actions .btn {
		padding: 0 0.9rem;
	}

	@media (min-width: 1024px) {
		ul {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
