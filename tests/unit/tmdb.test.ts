import { expect, test, vi } from 'vitest';
import { TmdbClient, TmdbError } from '../../src/lib/server/tmdb/client';
import { isAnime } from '../../src/lib/server/tmdb/anime';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), { status, headers });

function setup(...responses: Response[]) {
	const fetchFn = vi.fn(async (_url: string | URL | Request) => {
		const r = responses.shift();
		if (!r) throw new Error('no more responses');
		return r;
	});
	const sleep = vi.fn(async (_ms: number) => {});
	const client = new TmdbClient('KEY', fetchFn as unknown as typeof fetch, sleep);
	const url = (i = 0) => new URL(String(fetchFn.mock.calls[i][0]));
	return { client, fetchFn, sleep, url };
}

test('findByTvdb builds URL and returns first tv result id', async () => {
	const { client, url } = setup(json({ tv_results: [{ id: 1399 }, { id: 5 }] }));
	expect(await client.findByTvdb(79824)).toBe(1399);
	const u = url();
	expect(u.origin).toBe('https://api.themoviedb.org');
	expect(u.pathname).toBe('/3/find/79824');
	expect(u.searchParams.get('external_source')).toBe('tvdb_id');
	expect(u.searchParams.get('api_key')).toBe('KEY');
});

test('findByTvdb returns null on empty results', async () => {
	const { client } = setup(json({ tv_results: [] }));
	expect(await client.findByTvdb(1)).toBeNull();
});

test('429 then 200 resolves, honouring Retry-After', async () => {
	const { client, sleep, fetchFn } = setup(
		json({}, 429, { 'Retry-After': '5' }),
		json({ tv_results: [{ id: 7 }] })
	);
	expect(await client.findByTvdb(1)).toBe(7);
	expect(fetchFn).toHaveBeenCalledTimes(2);
	expect(sleep).toHaveBeenCalledWith(5000);
});

test('429 without Retry-After waits 2s default', async () => {
	const { client, sleep } = setup(json({}, 429), json({ tv_results: [] }));
	await client.findByTvdb(1);
	expect(sleep).toHaveBeenCalledWith(2000);
});

test('429 x4 rejects with TmdbError 429 after 4 attempts', async () => {
	const { client, fetchFn } = setup(
		json({}, 429),
		json({}, 429),
		json({}, 429),
		json({}, 429)
	);
	const err = await client.findByTvdb(1).catch((e) => e);
	expect(err).toBeInstanceOf(TmdbError);
	expect(err.status).toBe(429);
	expect(fetchFn).toHaveBeenCalledTimes(4);
});

/** A fetch that plays a script: a Response is returned, an Error is thrown (network failure). */
function scripted(...steps: (Response | Error)[]) {
	const fetchFn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
		const s = steps.shift();
		if (!s) throw new Error('no more steps');
		if (s instanceof Error) throw s;
		return s;
	});
	const sleep = vi.fn(async (_ms: number) => {});
	return { client: new TmdbClient('KEY', fetchFn as unknown as typeof fetch, sleep), fetchFn, sleep };
}

test('5xx is retried with 1s/2s/4s backoff, then succeeds', async () => {
	const { client, fetchFn, sleep } = scripted(json({}, 502), json({}, 503), json({}, 500), json({ tv_results: [{ id: 9 }] }));
	expect(await client.findByTvdb(1)).toBe(9);
	expect(fetchFn).toHaveBeenCalledTimes(4);
	expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 4000]);
});

test('5xx x4 rejects with TmdbError(status) after 4 attempts', async () => {
	const { client, fetchFn } = scripted(json({}, 500), json({}, 500), json({}, 500), json({}, 503));
	const err = await client.getShow(1).catch((e) => e);
	expect(err).toBeInstanceOf(TmdbError);
	expect(err.status).toBe(503);
	expect(fetchFn).toHaveBeenCalledTimes(4);
});

test('network errors (fetch rejects) are retried, then succeed', async () => {
	const { client, fetchFn, sleep } = scripted(new TypeError('fetch failed'), new TypeError('fetch failed'), json({ tv_results: [] }));
	expect(await client.findByTvdb(1)).toBeNull();
	expect(fetchFn).toHaveBeenCalledTimes(2 + 1);
	expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
});

test('network error x4 -> TmdbError status 0 "network error: ..."', async () => {
	const e = () => new TypeError('fetch failed');
	const { client, fetchFn } = scripted(e(), e(), e(), e());
	const err = await client.findByTvdb(1).catch((x) => x);
	expect(err).toBeInstanceOf(TmdbError);
	expect(err.status).toBe(0);
	expect(err.message).toMatch(/^network error: .*fetch failed/);
	expect(fetchFn).toHaveBeenCalledTimes(4);
});

test('every request carries a 30s timeout signal; a timeout counts as a network error', async () => {
	const spy = vi.spyOn(AbortSignal, 'timeout');
	try {
		const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
		const { client, fetchFn } = scripted(timeout, json({ tv_results: [{ id: 3 }] }));
		expect(await client.findByTvdb(1)).toBe(3);
		expect(spy).toHaveBeenCalledWith(30_000);
		for (const call of fetchFn.mock.calls) expect(call[1]?.signal).toBeInstanceOf(AbortSignal);
	} finally {
		spy.mockRestore();
	}
});

test('4xx other than 429 rejects immediately', async () => {
	const { client, fetchFn, sleep } = scripted(json({}, 404));
	const err = await client.getShow(1).catch((e) => e);
	expect(err).toBeInstanceOf(TmdbError);
	expect(err.status).toBe(404);
	expect(fetchFn).toHaveBeenCalledTimes(1);
	expect(sleep).not.toHaveBeenCalled();
});

test('getShow requests external_ids; getSeason/episode ids use right paths', async () => {
	const { client, url } = setup(
		json({ id: 1, name: 'X' }),
		json({ episodes: [] }),
		json({ tvdb_id: 42 })
	);
	await client.getShow(1399);
	expect(url(0).pathname).toBe('/3/tv/1399');
	expect(url(0).searchParams.get('append_to_response')).toBe('external_ids');
	await client.getSeason(1399, 2);
	expect(url(1).pathname).toBe('/3/tv/1399/season/2');
	expect(await client.getEpisodeExternalIds(1399, 2, 3)).toEqual({ tvdb_id: 42 });
	expect(url(2).pathname).toBe('/3/tv/1399/season/2/episode/3/external_ids');
});

test('getEpisodeExternalIds maps missing tvdb_id to null', async () => {
	const { client } = setup(json({ imdb_id: 'tt1' }));
	expect(await client.getEpisodeExternalIds(1, 1, 1)).toEqual({ tvdb_id: null });
});

test('searchMovie passes query and year, returns results; searchTv; getMovie', async () => {
	const { client, url } = setup(
		json({ results: [{ id: 1, title: 'A' }] }),
		json({ results: [{ id: 2, name: 'B' }] }),
		json({ id: 3, title: 'C' })
	);
	expect(await client.searchMovie('Heat', 1995)).toEqual([{ id: 1, title: 'A' }]);
	expect(url(0).pathname).toBe('/3/search/movie');
	expect(url(0).searchParams.get('query')).toBe('Heat');
	expect(url(0).searchParams.get('year')).toBe('1995');
	expect(await client.searchTv('Lost')).toEqual([{ id: 2, name: 'B' }]);
	expect(url(1).pathname).toBe('/3/search/tv');
	await client.getMovie(3);
	expect(url(2).pathname).toBe('/3/movie/3');
});

test('searchMovie omits year when not given', async () => {
	const { client, url } = setup(json({ results: [] }));
	await client.searchMovie('Heat');
	expect(url().searchParams.has('year')).toBe(false);
});

test('isAnime: genre 16 and JP origin', () => {
	expect(isAnime({ genres: [{ id: 16 }], origin_country: ['JP'] })).toBe(true);
	expect(isAnime({ genres: [{ id: 16 }], origin_country: ['US'] })).toBe(false);
	expect(isAnime({ genres: [{ id: 18 }], origin_country: ['JP'] })).toBe(false);
	expect(isAnime({ genres: [{ id: 16 }] })).toBe(false);
});
