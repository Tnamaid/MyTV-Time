<script lang="ts">
	import PosterCard from '#lib/components/PosterCard.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const f = $derived(data.filter);
	const filtered = $derived(Object.entries(f).some(([k, v]) => k !== 'sort' && v !== ''));

	/** Selects apply at once (the button is there for no-JS and for the text box). */
	const submit = (e: Event) => (e.currentTarget as HTMLSelectElement).form?.requestSubmit();

	const kindLabel = (i: (typeof data.items)[number]) =>
		i.kind === 'movie' ? 'Movie' : i.isAnime ? 'Anime' : 'Series';
	const watchedLabel = (n: number) => (n === 0 ? 'not watched' : `${n} watch${n === 1 ? '' : 'es'}`);
</script>

<svelte:head><title>Library · MyTV-Time</title></svelte:head>

<h1 class="page-title">Library</h1>

<!-- GET form: every filter lands in the URL, so a filtered view can be bookmarked. -->
<form method="GET" class="filters" data-sveltekit-keepfocus data-sveltekit-noscroll data-sveltekit-replacestate>
	<label class="q">
		<span class="visually-hidden">Search library</span>
		<input type="search" name="q" value={f.q} placeholder="Search library" autocomplete="off" />
	</label>
	<label>
		<span>Kind</span>
		<select name="kind" value={f.kind} onchange={submit}>
			<option value="">All</option>
			<option value="movie">Movies</option>
			<option value="series">Series</option>
			<option value="anime">Anime</option>
		</select>
	</label>
	<label>
		<span>Stars</span>
		<select name="stars" value={f.stars} onchange={submit}>
			<option value="">Any</option>
			{#each [5, 4, 3, 2, 1] as n (n)}<option value={String(n)}>{'★'.repeat(n)}</option>{/each}
		</select>
	</label>
	<label>
		<span>Followed</span>
		<select name="followed" value={f.followed} onchange={submit}>
			<option value="">Any</option>
			<option value="1">Yes</option>
			<option value="0">No</option>
		</select>
	</label>
	<label>
		<span>Archived</span>
		<select name="archived" value={f.archived} onchange={submit}>
			<option value="">Any</option>
			<option value="1">Yes</option>
			<option value="0">No</option>
		</select>
	</label>
	<label>
		<span>Sort</span>
		<select name="sort" value={f.sort} onchange={submit}>
			<option value="name">Name</option>
			<option value="lastWatched">Last watched</option>
			<option value="stars">Stars</option>
		</select>
	</label>
	<div class="buttons">
		<button class="btn primary">Apply</button>
		{#if filtered}<a class="btn" href="/library">Clear</a>{/if}
	</div>
</form>

<p class="count">{data.items.length} title{data.items.length === 1 ? '' : 's'}</p>

{#if data.items.length === 0}
	<p class="empty">
		{#if filtered}Nothing matches these filters.{:else}Your library is empty. Add titles from <a href="/search">Search</a>.{/if}
	</p>
{:else}
	<ul>
		{#each data.items as item (item.titleId)}
			<li>
				<PosterCard href="/title/{item.titleId}" posterUrl={item.posterUrl} name={item.name}>
					<p class="meta">{[kindLabel(item), item.year].filter(Boolean).join(' · ')}</p>
					<p class="meta">
						{#if item.stars}
							<span class="stars" aria-hidden="true">{'★'.repeat(item.stars)}</span>
							<span class="visually-hidden">{item.stars} stars,</span>
						{/if}
						<span>{item.stars ? '· ' : ''}{watchedLabel(item.watchCount)}</span>
					</p>
				</PosterCard>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.filters {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem 0.75rem;
		margin-bottom: 0.75rem;
	}

	.q {
		grid-column: 1 / -1;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.8rem;
		color: var(--muted);
		font-weight: 600;
	}

	input,
	select {
		font: inherit;
		font-size: 1rem;
		font-weight: 400;
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		min-height: var(--tap);
		padding: 0 0.7rem;
		width: 100%;
	}

	.buttons {
		display: flex;
		gap: 0.5rem;
		align-items: end;
	}

	.count {
		color: var(--muted);
		font-size: 0.9rem;
		margin: 0 0 0.5rem;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.6rem;
	}

	.meta {
		margin: 0;
		color: var(--muted);
		font-size: 0.9rem;
	}

	.stars {
		color: var(--accent);
		letter-spacing: 1px;
	}

	@media (min-width: 768px) {
		.filters {
			grid-template-columns: 2fr repeat(5, 1fr) auto;
			align-items: end;
		}

		.q {
			grid-column: auto;
		}
	}

	@media (min-width: 1024px) {
		ul {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
