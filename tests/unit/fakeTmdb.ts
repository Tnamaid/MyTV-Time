import type { TmdbClient, ShowDetails, SeasonDetails, MovieDetails } from '../../src/lib/server/tmdb/client';

export type FakeTmdb = Pick<TmdbClient, 'getShow' | 'getSeason' | 'getMovie'>;

export function ep(season: number, n: number, over: Record<string, unknown> = {}) {
	return {
		episode_number: n,
		season_number: season,
		id: season * 1000 + n,
		name: `E${n}`,
		air_date: '2020-01-01',
		runtime: 24,
		...over
	};
}

export function show(over: Partial<ShowDetails> = {}): ShowDetails {
	return {
		id: 1,
		name: 'Show',
		original_name: 'Show O',
		first_air_date: '2020-01-01',
		poster_path: '/p.jpg',
		overview: 'ov',
		status: 'Returning Series',
		genres: [],
		origin_country: ['US'],
		seasons: [{ season_number: 1, name: 'Season 1', air_date: '2020-01-01' }],
		external_ids: { tvdb_id: 555 },
		...over
	};
}

export function fakeTmdb(opts: {
	shows?: Record<number, ShowDetails>;
	seasons?: Record<string, SeasonDetails | Error>;
	movies?: Record<number, MovieDetails>;
}): FakeTmdb {
	return {
		getShow: async (id) => {
			const s = opts.shows?.[id];
			if (!s) throw new Error('no show ' + id);
			return s;
		},
		getSeason: async (id, n) => {
			const s = opts.seasons?.[`${id}:${n}`];
			if (!s) throw new Error('no season');
			if (s instanceof Error) throw s;
			return s;
		},
		getMovie: async (id) => {
			const m = opts.movies?.[id];
			if (!m) throw new Error('no movie ' + id);
			return m;
		}
	};
}
