<script lang="ts">
	import { enhance } from '$app/forms';
	import PosterCard from '#lib/components/PosterCard.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** Titles with an action in flight (blocks a double tap logging two watches). */
	let busy = $state<Record<number, boolean>>({});
	const track = (id: number) => () => {
		busy[id] = true;
		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			busy[id] = false;
		};
	};
</script>

<svelte:head><title>Watchlist · MyTV-Time</title></svelte:head>

<h1 class="page-title">Watchlist</h1>

{#if form?.message}<p class="error-banner" role="alert">{form.message}</p>{/if}

{#if data.items.length === 0}
	<p class="empty">Nothing on your watchlist. Add titles from <a href="/search">Search</a>.</p>
{:else}
	<ul>
		{#each data.items as item (item.titleId)}
			<li>
				<PosterCard href="/title/{item.titleId}" posterUrl={item.posterUrl} name={item.name}>
					<p class="meta">
						{[item.kind === 'movie' ? 'Movie' : item.isAnime ? 'Anime' : 'Series', item.year].filter(Boolean).join(' · ')}
					</p>
					{#snippet action()}
						<div class="actions">
							{#if item.kind === 'movie'}
								<form method="POST" action="?/watched" use:enhance={track(item.titleId)}>
									<input type="hidden" name="titleId" value={item.titleId} />
									<button class="btn primary" disabled={busy[item.titleId]} aria-label="Mark {item.name} watched">
										✓ Watched
									</button>
								</form>
							{/if}
							<form method="POST" action="?/remove" use:enhance={track(item.titleId)}>
								<input type="hidden" name="titleId" value={item.titleId} />
								<button class="btn" disabled={busy[item.titleId]} aria-label="Remove {item.name} from watchlist">
									Remove
								</button>
							</form>
						</div>
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
		grid-template-columns: minmax(0, 1fr);
		gap: 0.6rem;
	}

	.meta {
		margin: 0;
		color: var(--muted);
		font-size: 0.9rem;
	}

	.actions {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.actions .btn {
		width: 100%;
		padding: 0 0.8rem;
	}

	@media (min-width: 1024px) {
		ul {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
