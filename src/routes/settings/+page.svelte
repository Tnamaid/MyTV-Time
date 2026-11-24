<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// openIssues comes from the root layout load.
	const open = $derived(data.openIssues);
</script>

<svelte:head><title>Settings · MyTV-Time</title></svelte:head>

<h1 class="page-title">Settings</h1>

<section class="panel">
	<h2>TV Time import</h2>
	<a class="row" href="/fix-imports">
		<span>Fix imports</span>
		<span class="badge" class:warn={open > 0}>{open > 0 ? `${open} open` : 'all fixed'}</span>
	</a>
</section>

<section class="panel">
	<h2>Your data</h2>
	<p>Everything lives in one SQLite file:</p>
	<p><code>{data.dbPath}</code></p>
	<p class="muted">
		To back up, stop the app and copy that file (plus any <code>-wal</code> file next to it) to another disk.
		The export below is a readable JSON copy of every table (titles, seasons, episodes, watches,
		watchlist and import issues) that you can download any time.
	</p>
	<a class="btn primary" href="/settings/export" download>Download export (JSON)</a>
</section>

<style>
	.panel {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1rem;
		margin-bottom: 1rem;
		max-width: 640px;
	}

	h2 {
		font-size: 1rem;
		margin-bottom: 0.5rem;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-size: 0.8rem;
	}

	p {
		margin: 0 0 0.6rem;
	}

	.muted {
		color: var(--muted);
		font-size: 0.9rem;
	}

	code {
		overflow-wrap: anywhere;
		font-size: 0.9rem;
	}

	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: var(--tap);
		font-weight: 600;
		text-decoration: none;
	}

	.row::after {
		content: '›';
		color: var(--muted);
		margin-left: 0.5rem;
		font-size: 1.3rem;
	}

	.badge {
		margin-left: auto;
		font-size: 0.85rem;
		color: var(--muted);
	}

	.badge.warn {
		color: var(--danger);
	}
</style>
