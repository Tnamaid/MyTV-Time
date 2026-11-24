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
