<script lang="ts">
	import type { Snippet } from 'svelte';
	import Poster from './Poster.svelte';

	let {
		href,
		posterUrl,
		name,
		children,
		action
	}: {
		href: string;
		posterUrl: string | null;
		name: string;
		/** Body under the name (episode line, meta…). */
		children?: Snippet;
		/** Trailing control, e.g. the ✓ button. Kept outside the link. */
		action?: Snippet;
	} = $props();
</script>

<article>
	<a class="main" {href}>
		<Poster src={posterUrl} {name} width={72} />
		<div class="body">
			<h2>{name}</h2>
			{@render children?.()}
		</div>
	</a>
	{#if action}
		<div class="action">{@render action()}</div>
	{/if}
</article>

<style>
	article {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.6rem;
	}

	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.85rem;
		text-decoration: none;
	}

	.body {
		min-width: 0;
	}

	h2 {
		font-size: 1.05rem;
		margin-bottom: 0.2rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.action {
		flex: none;
	}
</style>
