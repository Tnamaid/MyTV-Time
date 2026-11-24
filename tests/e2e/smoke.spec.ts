import { expect, test } from '@playwright/test';

// The tests share one seeded database (see seed.ts) and run in order: each one starts
// from the state the previous one left behind.
test.describe.configure({ mode: 'serial' });

test('up next: one tap marks the episode and shows the next one', async ({ page }) => {
	await page.goto('/');
	const card = page.getByRole('article').filter({ hasText: 'Harbor Lights' });
	await expect(card).toContainText('S01E01');
	await expect(card).toContainText('+2 more');

	await card.getByRole('button', { name: /mark .* watched/i }).click();

	await expect(card).toContainText('S01E02');
	await expect(card).toContainText('+1 more');
});

test('upcoming lists the next episode by date', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('navigation').getByRole('link', { name: 'Upcoming' }).click();
	await expect(page.getByRole('heading', { name: 'Upcoming', level: 1 })).toBeVisible();
	await expect(page.getByRole('heading', { level: 2 })).toContainText('In 5 days');
	await expect(page.getByRole('link', { name: /Harbor Lights.*S01E04 · Fog Signal/ })).toBeVisible();
});

test('title page: stars, checkboxes, up to here, specials', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('link', { name: /Harbor Lights/ }).click();
	await expect(page.getByRole('heading', { name: 'Harbor Lights', level: 1 })).toBeVisible();

	// Stars: set 4, then tapping 4 again clears it.
	await page.getByRole('button', { name: 'Rate 4 stars' }).click();
	await expect(page.getByRole('button', { name: 'Clear rating (4 stars)' })).toHaveAttribute('aria-pressed', 'true');
	await page.getByRole('button', { name: 'Clear rating (4 stars)' }).click();
	await expect(page.getByRole('button', { name: 'Rate 4 stars' })).toHaveAttribute('aria-pressed', 'false');

	// Season 1 is open (it holds the next episode); E1 was ticked on Up next.
	const s1 = page.locator('details.season').filter({ hasText: 'Season 1' });
	await expect(s1).toHaveAttribute('open', '');
	await expect(s1.getByRole('checkbox', { name: 'S01E01 watched' })).toBeChecked();
	await expect(s1.locator(':scope > summary')).toContainText('1/4');

	// One tap on a checkbox toggles it.
	await s1.getByRole('checkbox', { name: 'S01E02 watched' }).click();
	await expect(s1.getByRole('checkbox', { name: 'S01E02 watched' })).toBeChecked();
	await expect(s1.locator(':scope > summary')).toContainText('2/4');
	await s1.getByRole('checkbox', { name: 'S01E02 watched' }).click();
	await expect(s1.getByRole('checkbox', { name: 'S01E02 watched' })).not.toBeChecked();

	// "Mark up to here" on E3 ticks E2 and E3; the unaired E4 stays unticked.
	await s1.getByLabel('More actions for S01E03').click();
	await s1.getByRole('button', { name: 'Mark up to here' }).click();
	await expect(s1.getByRole('checkbox', { name: 'S01E03 watched' })).toBeChecked();
	await expect(s1.getByRole('checkbox', { name: 'S01E02 watched' })).toBeChecked();
	await expect(s1.getByRole('checkbox', { name: 'S01E04 watched' })).not.toBeChecked();
	await expect(s1.locator(':scope > summary')).toContainText('3/4');

	// Specials are listed (closed) on the title page.
	await expect(page.locator('details.season').filter({ hasText: 'Specials' })).toBeVisible();

	// Nothing left aired → Up next is empty.
	await page.getByRole('navigation').getByRole('link', { name: 'Up next' }).click();
	await expect(page.getByText("You're all caught up")).toBeVisible();
});

test('title page rejects bad form input with 400', async ({ page, baseURL }) => {
	const res = await page.request.post('/title/1?/markEpisode', {
		form: { episodeId: 'abc' },
		headers: { origin: baseURL! }
	});
	expect(res.status()).toBe(400);
	const stars = await page.request.post('/title/1?/stars', {
		form: { stars: '9' },
		headers: { origin: baseURL! }
	});
	expect(stars.status()).toBe(400);
	const missing = await page.request.get('/title/999');
	expect(missing.status()).toBe(404);
});

test('refresh re-syncs from TMDB', async ({ page }) => {
	await page.goto('/title/1');
	await page.getByRole('button', { name: /Refresh/ }).click();
	// The fixture dates S1E4 in 2099 (the seed had moved it to 5 days from now).
	await expect(page.getByText(/5 Jan 2099/)).toBeVisible();
	await expect(page.getByRole('alert')).toHaveCount(0);
});

test('search "Dune" → Watchlist → appears on /watchlist', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('navigation').getByRole('link', { name: 'Search' }).click();
	await page.getByRole('searchbox', { name: 'Search TMDB' }).fill('Dune');
	await page.getByRole('button', { name: 'Search', exact: true }).click();
	await expect(page).toHaveURL(/\/search\?q=Dune/);

	const movie = page.getByRole('article').filter({ hasText: 'Movie · 2021' });
	await expect(movie.getByRole('heading', { name: 'Dune' })).toBeVisible();
	// Series results get a Follow button; movies don't.
	const series = page.getByRole('article').filter({ hasText: 'Dune: Sandwalkers' });
	await expect(series.getByRole('button', { name: 'Follow' })).toBeVisible();
	await expect(movie.getByRole('button', { name: 'Follow' })).toHaveCount(0);

	await movie.getByRole('button', { name: 'Watchlist' }).click();
	await expect(movie.getByRole('link', { name: /In library/ })).toBeVisible();
	await expect(movie).toContainText('On watchlist');

	await page.getByRole('navigation').getByRole('link', { name: 'Watchlist' }).click();
	await expect(page.getByRole('heading', { name: 'Watchlist', level: 1 })).toBeVisible();
	await expect(page.getByRole('article').filter({ hasText: 'Dune' })).toBeVisible();
});

test('library filters live in the URL; bad values are ignored', async ({ page }) => {
	await page.goto('/library');
	await expect(page.getByRole('heading', { name: 'Harbor Lights' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Dune' })).toBeVisible();

	await page.getByLabel('Kind').selectOption('movie');
	await expect(page).toHaveURL(/kind=movie/);
	await expect(page.getByRole('heading', { name: 'Dune' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Harbor Lights' })).toHaveCount(0);

	const res = await page.goto('/library?kind=bogus&stars=9&sort=nope&followed=maybe');
	expect(res!.status()).toBe(200);
	await expect(page.getByRole('heading', { name: 'Harbor Lights' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Dune' })).toBeVisible();
});

test('fix imports: dismiss, episode offset with preview, movie candidate, show search', async ({ page }) => {
	await page.goto('/settings');
	// The Settings tab carries a badge while issues are open.
	await expect(page.getByRole('navigation').getByRole('link', { name: 'Settings (4 open import issues)' })).toBeVisible();
	await page.getByRole('link', { name: /Fix imports.*4 open/ }).click();
	await expect(page.getByRole('heading', { name: 'Fix imports', level: 1 })).toBeVisible();

	// Dismiss: the issue goes away (its watch rows stay).
	const lost = page.getByRole('article').filter({ hasText: 'Lost Reel (1999)' });
	await lost.getByRole('button', { name: 'Dismiss' }).click();
	await expect(page.getByRole('article').filter({ hasText: 'Lost Reel (1999)' })).toHaveCount(0);

	// Episode issue: Harbor Lights raw S2E5–E6 are really S1E1–E2.
	const ep = page.getByRole('article').filter({ hasText: 'Harbor Lights S2' });
	await ep.getByLabel('Target season', { exact: true }).fill('1');
	await ep.getByLabel('Offset', { exact: true }).fill('-4');
	await expect(ep.getByRole('list', { name: 'Preview' })).toContainText('S02E05 → S01E01 · Low Tide');
	await expect(ep.getByRole('list', { name: 'Preview' })).toContainText('S02E06 → S01E02 · The Keeper');
	await ep.getByRole('button', { name: 'Apply' }).click();
	await expect(page.getByRole('status')).toContainText('Linked 2');
	await expect(page.getByRole('article').filter({ hasText: 'Harbor Lights S2' })).toHaveCount(0);

	// Movie issue: pick the stored candidate.
	const movie = page.getByRole('article').filter({ hasText: 'Dune Part One (2021)' });
	await movie.getByRole('button', { name: 'Pick Dune (2021)' }).click();
	await expect(page.getByRole('article').filter({ hasText: 'Dune Part One (2021)' })).toHaveCount(0);

	// Show issue: free TMDB search, then pick.
	const show = page.getByRole('article').filter({ hasText: 'Dune Sandwalkers (tvdb 900002)' });
	await show.getByRole('searchbox').fill('Dune');
	await show.getByRole('button', { name: 'Search TMDB' }).click();
	await page
		.getByRole('article')
		.filter({ hasText: 'Dune Sandwalkers (tvdb 900002)' })
		.getByRole('button', { name: 'Pick Dune: Sandwalkers (2025)' })
		.click();
	await expect(page.getByText('No open import issues')).toBeVisible();
	await expect(page.getByRole('navigation').getByRole('link', { name: 'Settings', exact: true })).toBeVisible();

	// The fixed show is now in the library with its imported watch linked.
	await page.goto('/library?q=Sandwalkers');
	await expect(page.getByRole('heading', { name: 'Dune: Sandwalkers' })).toBeVisible();
	await expect(page.getByRole('article').filter({ hasText: 'Dune: Sandwalkers' })).toContainText('1 watch');
});

test('fix imports, search and preview reject bad input with 400', async ({ page, baseURL }) => {
	const bad = await page.request.post('/fix-imports?/fixEpisodes', {
		form: { key: 'episode:900001:2', season: '1', offset: 'x' },
		headers: { origin: baseURL! }
	});
	expect(bad.status()).toBe(400);
	const search = await page.request.post('/search?/watchlist', {
		form: { tmdbId: 'abc', kind: 'movie' },
		headers: { origin: baseURL! }
	});
	expect(search.status()).toBe(400);
	const preview = await page.request.get('/fix-imports/preview?key=episode%3A900001%3A2&season=1&offset=oops');
	expect(preview.status()).toBe(400);
});

test('settings: JSON export downloads every table', async ({ page }) => {
	await page.goto('/settings');
	await expect(page.getByText(/tracker\.db/)).toBeVisible();
	const res = await page.request.get('/settings/export');
	expect(res.status()).toBe(200);
	expect(res.headers()['content-disposition']).toMatch(/^attachment; filename="watch-tracker-export-\d{4}-\d{2}-\d{2}\.json"$/);
	const body = await res.json();
	expect(body.titles.map((t: { name: string }) => t.name).sort()).toEqual(['Dune', 'Dune: Sandwalkers', 'Harbor Lights']);
	expect(body.watchlist).toHaveLength(1);
	expect(body.importIssues).toHaveLength(4);
	expect(body.importIssues.every((i: { resolved: boolean }) => i.resolved)).toBe(true);
	expect(body.watches.length).toBeGreaterThanOrEqual(4);
});

test('desktop: side navigation instead of the tab bar', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto('/');
	const nav = page.getByRole('navigation', { name: 'Main' });
	const box = (await nav.boundingBox())!;
	expect(box.x).toBe(0);
	expect(box.y).toBe(0);
	expect(box.height).toBeGreaterThanOrEqual(800);
	await expect(nav.getByRole('link', { name: 'MyTV-Time' })).toBeVisible();
});
