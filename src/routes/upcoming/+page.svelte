<script lang="ts">
	import { epCode, shortDate } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const days = $derived.by(() => {
		const groups: { date: string; items: typeof data.items }[] = [];
		for (const item of data.items) {
			const last = groups.at(-1);
			if (last?.date === item.airDate) last.items.push(item);
			else groups.push({ date: item.airDate, items: [item] });
		}
		return groups;
	});

	const refYear = $derived(Number(data.today.slice(0, 4)));

	function relative(date: string): string {
		const diff = Math.round((Date.parse(date) - Date.parse(data.today)) / 86_400_000);
		return diff === 1 ? 'Tomorrow' : `In ${diff} days`;
	}
</script>

<svelte:head><title>Upcoming · MyTV-Time</title></svelte:head>

<h1 class="page-title">Upcoming</h1>

{#if days.length === 0}
	<p class="empty">Nothing airing in the next 30 days for the shows you follow.</p>
{:else}
	{#each days as day (day.date)}
		<section>
			<h2>{shortDate(day.date, refYear)} <span>{relative(day.date)}</span></h2>
			<ul>
				{#each day.items as item (item.episodeId)}
					<li>
						<a href="/title/{item.titleId}">
							<span class="show">{item.name}</span>
							<span class="ep">
								<strong>{epCode(item.season, item.episode)}</strong>{#if item.episodeName}{` · ${item.episodeName}`}{/if}
							</span>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/each}
{/if}

<style>
	section + section {
		margin-top: 1.25rem;
	}

	h2 {
		font-size: 0.95rem;
		margin-bottom: 0.4rem;
	}

	h2 span {
		color: var(--muted);
		font-weight: 500;
		margin-left: 0.35rem;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
	}

	li + li {
		border-top: 1px solid var(--border);
	}

	a {
		display: flex;
		flex-direction: column;
		justify-content: center;
		min-height: 56px;
		padding: 0.5rem 0.9rem;
		text-decoration: none;
	}

	a:hover {
		background: var(--surface-2);
	}

	.show {
		font-weight: 700;
	}

	.ep {
		color: var(--muted);
		font-size: 0.9rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
