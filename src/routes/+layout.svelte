<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	// SVG path data (24×24, stroked) for each tab icon.
	const tabs = [
		{ href: '/', label: 'Up next', icon: 'M8 5.5v13l10.5-6.5z' },
		{
			href: '/upcoming',
			label: 'Upcoming',
			icon: 'M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 10h16M9 3v4M15 3v4'
		},
		{
			href: '/library',
			label: 'Library',
			icon: 'M4 4h5v16H4zM10.5 4h5v16h-5zM17 5l3.2-.8 3 15.5-3.2.8z'
		},
		{ href: '/watchlist', label: 'Watchlist', icon: 'M6 3.5h12v17l-6-4.5-6 4.5z' },
		{ href: '/search', label: 'Search', icon: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5 20 20' }
	];

	const isActive = (href: string) =>
		href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="shell">
	<nav aria-label="Main">
		<a class="brand" href="/">MyTV-Time</a>
		<ul>
			{#each tabs as tab (tab.href)}
				<li>
					<a href={tab.href} aria-current={isActive(tab.href) ? 'page' : undefined}>
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d={tab.icon} /></svg>
						<span>{tab.label}</span>
					</a>
				</li>
			{/each}
		</ul>
	</nav>

	<main>
		{@render children()}
	</main>
</div>

<style>
	main {
		max-width: 960px;
		margin: 0 auto;
		padding: 1rem 1rem calc(var(--nav-h) + env(safe-area-inset-bottom) + 1.5rem);
	}

	nav {
		position: fixed;
		z-index: 10;
		inset: auto 0 0 0;
		background: color-mix(in srgb, var(--surface) 92%, transparent);
		backdrop-filter: blur(12px);
		border-top: 1px solid var(--border);
		padding-bottom: env(safe-area-inset-bottom);
	}

	.brand {
		display: none;
	}

	ul {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	ul a {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		height: var(--nav-h);
		color: var(--muted);
		text-decoration: none;
		font-size: 0.72rem;
		font-weight: 600;
	}

	ul a[aria-current='page'] {
		color: var(--accent);
	}

	svg {
		width: 24px;
		height: 24px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linejoin: round;
		stroke-linecap: round;
	}

	@media (min-width: 768px) {
		nav {
			inset: 0 auto 0 0;
			width: var(--side-w);
			border-top: 0;
			border-right: 1px solid var(--border);
			padding: 1.25rem 0.75rem;
		}

		.brand {
			display: block;
			font-weight: 800;
			font-size: 1.15rem;
			text-decoration: none;
			padding: 0 0.75rem 1.25rem;
		}

		ul {
			grid-template-columns: 1fr;
			gap: 2px;
		}

		ul a {
			flex-direction: row;
			justify-content: flex-start;
			gap: 0.75rem;
			height: var(--tap);
			padding: 0 0.75rem;
			border-radius: 10px;
			font-size: 0.95rem;
		}

		ul a:hover {
			background: var(--surface-2);
		}

		ul a[aria-current='page'] {
			background: var(--surface-2);
		}

		main {
			margin-left: var(--side-w);
			padding: 1.5rem 2rem 3rem;
		}

		.shell {
			min-height: 100vh;
		}
	}

	@media (min-width: 1200px) {
		main {
			margin-left: max(var(--side-w), calc((100vw - 960px) / 2));
		}
	}
</style>
