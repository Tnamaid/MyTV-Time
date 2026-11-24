<script lang="ts">
	let { src, name, width = 92 }: { src: string | null; name: string; width?: number } = $props();

	const initials = $derived(
		name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((w) => w[0]?.toUpperCase())
			.join('')
	);
</script>

<div class="poster" style:width="{width}px">
	{#if src}
		<img {src} alt="" loading="lazy" />
	{:else}
		<span aria-hidden="true">{initials}</span>
	{/if}
</div>

<style>
	.poster {
		flex: none;
		aspect-ratio: 2 / 3;
		border-radius: 10px;
		overflow: hidden;
		background: linear-gradient(160deg, var(--surface-2), var(--border));
		display: grid;
		place-items: center;
	}

	img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	span {
		font-weight: 800;
		font-size: 1.4rem;
		color: var(--muted);
	}
</style>
