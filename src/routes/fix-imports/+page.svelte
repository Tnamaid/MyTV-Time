<script lang="ts">
	import { enhance } from '$app/forms';
	import Choices from './Choices.svelte';
	import EpisodeFix from './EpisodeFix.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** Issue whose pick/dismiss is in flight. */
	let busy = $state<Record<string, boolean>>({});

	const groups = $derived([
		{ id: 'shows', title: 'Shows', hint: 'TV Time shows TMDB could not find. Pick the right series; its watches get linked.', n: data.shows.length },
		{ id: 'movies', title: 'Movies', hint: 'Movies without a single exact match. Pick one; its watches get linked.', n: data.movies.length },
		{ id: 'episodes', title: 'Episodes', hint: 'Watched episodes whose numbering differs on TMDB (anime absolute numbering, specials…). Map them with a target season and an offset.', n: data.episodes.length }
	]);
</script>

{#snippet dismiss(key: string)}
	<form
		method="POST"
		action="?/dismiss"
		use:enhance={() => {
			busy[key] = true;
			return async ({ update }) => {
				await update();
				busy[key] = false;
			};
		}}
	>
		<input type="hidden" name="key" value={key} />
		<button class="btn subtle" disabled={busy[key]}>Dismiss</button>
	</form>
{/snippet}

{#snippet searchBox(key: string, query: string, current: { q: string } | null, kind: string)}
	<form method="GET" class="search" data-sveltekit-noscroll data-sveltekit-keepfocus>
		<input type="hidden" name="issue" value={key} />
		<input type="search" name="q" value={current?.q ?? query} aria-label="TMDB {kind} search" autocomplete="off" />
		<button class="btn">Search TMDB</button>
	</form>
{/snippet}

<svelte:head><title>Fix imports · MyTV-Time</title></svelte:head>

<p class="crumb"><a href="/settings">‹ Settings</a></p>
<h1 class="page-title">Fix imports</h1>

{#if form?.message}<p class="error-banner" role="alert">{form.message}</p>{/if}
{#if form?.ok}<p class="ok-banner" role="status">{form.ok}</p>{/if}
{#if !data.tmdbConfigured && (data.shows.length || data.movies.length)}
	<p class="error-banner">TMDB not configured: show and movie issues can only be dismissed until <code>TMDB_API_KEY</code> is set.</p>
{/if}

{#if data.total === 0}
	<p class="empty">No open import issues. Everything from TV Time is linked.</p>
{/if}

{#each groups as g (g.id)}
	{#if g.n > 0}
		<section>
			<h2>{g.title} <span class="count">{g.n}</span></h2>
			<p class="hint">{g.hint}</p>
			<ul>
				{#if g.id === 'shows'}
					{#each data.shows as issue (issue.key)}
						<li>
							<article>
								<header><h3>{issue.label}</h3>{@render dismiss(issue.key)}</header>
								{#if data.tmdbConfigured}
									{@render searchBox(issue.key, issue.query, issue.search, 'series')}
									{#if issue.search?.error}<p class="hint error">{issue.search.error}</p>{/if}
									{#if issue.search && !issue.search.error}
										{#if issue.search.results.length}
											<Choices choices={issue.search.results} action="?/fixShow" issueKey={issue.key} busy={!!busy[issue.key]} onbusy={(v) => (busy[issue.key] = v)} />
										{:else}
											<p class="hint">No series found for “{issue.search.q}”.</p>
										{/if}
									{/if}
								{/if}
							</article>
						</li>
					{/each}
				{:else if g.id === 'movies'}
					{#each data.movies as issue (issue.key)}
						<li>
							<article>
								<header><h3>{issue.label}</h3>{@render dismiss(issue.key)}</header>
								{#if data.tmdbConfigured}
									{#if issue.candidates.length && !issue.search}
										<p class="hint">Candidates</p>
										<Choices choices={issue.candidates} action="?/fixMovie" issueKey={issue.key} busy={!!busy[issue.key]} onbusy={(v) => (busy[issue.key] = v)} />
									{/if}
									{@render searchBox(issue.key, issue.query, issue.search, 'movie')}
									{#if issue.search?.error}<p class="hint error">{issue.search.error}</p>{/if}
									{#if issue.search && !issue.search.error}
										{#if issue.search.results.length}
											<Choices choices={issue.search.results} action="?/fixMovie" issueKey={issue.key} busy={!!busy[issue.key]} onbusy={(v) => (busy[issue.key] = v)} />
										{:else}
											<p class="hint">No movies found for “{issue.search.q}”.</p>
										{/if}
									{/if}
								{/if}
							</article>
						</li>
					{/each}
				{:else}
					{#each data.episodes as issue (issue.key)}
						<li>
							<article>
								<header>
									<h3>{issue.label}</h3>
									{@render dismiss(issue.key)}
								</header>
								{#if issue.target}
									<p class="hint">Library title: <a href="/title/{issue.target.titleId}">{issue.target.name}</a></p>
									<EpisodeFix
										issueKey={issue.key}
										rawSeason={issue.rawSeason}
										seasons={issue.target.seasons}
										initial={issue.target.preview}
									/>
								{:else}
									<p class="hint">This show is not in the library yet. Fix the show issue first.</p>
								{/if}
							</article>
						</li>
					{/each}
				{/if}
			</ul>
		</section>
	{/if}
{/each}

<style>
	.crumb {
		margin: 0;
		font-size: 0.9rem;
	}

	.crumb a {
		color: var(--muted);
		text-decoration: none;
	}

	.ok-banner {
		border: 1px solid var(--accent);
		border-radius: var(--radius);
		padding: 0.6rem 0.9rem;
		margin-bottom: 1rem;
		background: color-mix(in srgb, var(--accent) 12%, transparent);
	}

	section {
		margin-bottom: 1.75rem;
		max-width: 720px;
	}

	h2 {
		font-size: 1.15rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.count {
		font-size: 0.8rem;
		background: var(--surface-2);
		border-radius: 999px;
		padding: 0.1rem 0.55rem;
		color: var(--muted);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		/* minmax(0, …): the inputs' intrinsic width must not widen the column past the screen. */
		grid-template-columns: minmax(0, 1fr);
		gap: 0.6rem;
	}

	article {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.75rem;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	h3 {
		font-size: 1rem;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.hint {
		color: var(--muted);
		font-size: 0.85rem;
		margin: 0.35rem 0;
	}

	.hint.error {
		color: var(--danger);
	}

	.search {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.5rem;
	}

	.search input {
		flex: 1;
		min-width: 0;
		font: inherit;
		font-size: 1rem;
		color: var(--text);
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 999px;
		min-height: var(--tap);
		width: 100%;
		padding: 0 0.9rem;
	}

	.btn.subtle {
		background: transparent;
		color: var(--muted);
		padding: 0 0.8rem;
	}
</style>
