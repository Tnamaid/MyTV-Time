<script lang="ts">
	import { enhance } from '$app/forms';
	import PosterCard from '#lib/components/PosterCard.svelte';
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
				<PosterCard href="/title/{item.titleId}" posterUrl={item.posterUrl} name={item.name}>
					<p class="ep"><strong>{code}</strong>{#if item.episodeName}{` · ${item.episodeName}`}{/if}</p>
					{#if item.remainingAired > 1}<p class="more">+{item.remainingAired - 1} more</p>{/if}
					{#snippet action()}
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
							<button
								class="tick"
								aria-label="Mark {item.name} {code} watched"
								disabled={busy[item.titleId]}
							>
								✓
							</button>
						</form>
					{/snippet}
				</PosterCard>
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
		gap: 0.75rem;
	}

	@media (min-width: 1024px) {
		ul {
			grid-template-columns: 1fr 1fr;
		}
	}

	.ep {
		margin: 0;
		color: var(--text);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.ep strong {
		font-variant-numeric: tabular-nums;
	}

	.more {
		margin: 0.15rem 0 0;
		font-size: 0.85rem;
		color: var(--muted);
	}

	.tick {
		width: 60px;
		height: 60px;
		border-radius: 50%;
		border: 0;
		background: var(--accent);
		color: var(--accent-text);
		font-size: 1.8rem;
		font-weight: 800;
		cursor: pointer;
		display: grid;
		place-items: center;
		transition: transform 0.1s;
	}

	.tick:active {
		transform: scale(0.92);
	}

	.tick:disabled {
		opacity: 0.5;
	}
</style>
