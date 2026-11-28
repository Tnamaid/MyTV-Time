<script lang="ts">
	import { enhance } from '$app/forms';
	import Poster from '#lib/components/Poster.svelte';
	import { epCode } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** Titles whose ✓ is in flight: blocks double taps (a second tap would log a rewatch). */
	let busy = $state<Record<number, boolean>>({});
</script>

<svelte:head><title>Up next · MyTV-Time</title></svelte:head>

<h1 class="page-title">Up next</h1>

{#if form?.message}<p class="error-banner" role="alert">{form.message}</p>{/if}

{#if data.items.length === 0}
	<p class="empty">You're all caught up. Follow shows from <a href="/search">Search</a>.</p>
{:else}
	<ul>
		{#each data.items as item (item.titleId)}
			{@const code = epCode(item.season, item.episode)}
			<li>
				<!-- Tile: poster, name and episode only; the rest is on the title page. -->
				<article>
					<a href="/title/{item.titleId}">
						<Poster src={item.posterUrl} name={item.name} width={null} />
						<h2>{item.name}</h2>
						<p class="ep">{code}</p>
					</a>
					<form
						method="POST"
						action="?/watch"
						use:enhance={() => {
							busy[item.titleId] = true;
							return async ({ update }) => {
								await update();
								busy[item.titleId] = false;
							};
						}}
					>
						<input type="hidden" name="episodeId" value={item.episodeId} />
						<button class="tick" aria-label="Mark {item.name} {code} watched" disabled={busy[item.titleId]}>
							✓
						</button>
					</form>
				</article>
			</li>
		{/each}
	</ul>
{/if}

<style>
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		/* 3 tiles across on a phone, more on wider screens. */
		grid-template-columns: repeat(auto-fill, minmax(min(30%, 150px), 1fr));
		gap: 0.75rem 0.6rem;
	}

	@media (min-width: 600px) {
		ul {
			grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
			gap: 1rem 0.85rem;
		}
	}

	article {
		position: relative;
	}

	a {
		display: block;
		text-decoration: none;
	}

	h2 {
		font-size: 0.9rem;
		margin: 0.4rem 0 0.1rem;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.ep {
		margin: 0;
		font-size: 0.85rem;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}

	/* ✓ sits on the poster's bottom-right corner. */
	form {
		position: absolute;
		top: 0;
		right: 0;
		width: 100%;
		aspect-ratio: 2 / 3;
		pointer-events: none;
		display: flex;
		align-items: flex-end;
		justify-content: flex-end;
		padding: 0.35rem;
	}

	.tick {
		pointer-events: auto;
		width: 44px;
		height: 44px;
		border-radius: 50%;
		border: 2px solid var(--bg);
		background: var(--accent);
		color: var(--accent-text);
		font-size: 1.3rem;
		font-weight: 800;
		cursor: pointer;
		display: grid;
		place-items: center;
		box-shadow: 0 2px 8px rgb(0 0 0 / 0.45);
		transition: transform 0.1s;
	}

	.tick:active {
		transform: scale(0.92);
	}

	.tick:disabled {
		opacity: 0.5;
	}
</style>
