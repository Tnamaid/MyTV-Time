export const TMDB_API_BASE = 'https://api.themoviedb.org';
export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w342';

const MAX_RETRIES = 3;
const DEFAULT_RETRY_AFTER_S = 2;

export interface Genre {
	id: number;
	name: string;
}

export interface ShowDetails {
	id: number;
	name: string;
	original_name: string;
	first_air_date: string | null;
	poster_path: string | null;
	overview: string;
	status: string;
	genres: Genre[];
	origin_country: string[];
	seasons: { season_number: number; name: string; air_date: string | null }[];
	external_ids: { tvdb_id: number | null; imdb_id?: string | null };
}

export interface SeasonDetails {
	episodes: {
		episode_number: number;
		season_number: number;
		id: number;
		name: string;
		air_date: string | null;
		runtime: number | null;
	}[];
}

export interface MovieDetails {
	id: number;
	title: string;
	original_title: string;
	release_date: string | null;
	poster_path: string | null;
	overview: string;
	genres: Genre[];
}

export interface MovieSearchResult {
	id: number;
	title: string;
	original_title: string;
	release_date: string;
	poster_path: string | null;
}

export interface TvSearchResult {
	id: number;
	name: string;
	original_name: string;
	first_air_date: string;
	poster_path: string | null;
}

export class TmdbError extends Error {
	constructor(
		public status: number,
		message?: string
	) {
		super(message ?? `TMDB request failed with status ${status}`);
		this.name = 'TmdbError';
	}
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class TmdbClient {
	constructor(
		private apiKey: string,
		private fetchFn: typeof fetch = fetch,
		private sleep: (ms: number) => Promise<void> = defaultSleep
	) {}

	private async get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
		const url = new URL(path, TMDB_API_BASE);
		url.searchParams.set('api_key', this.apiKey);
		for (const [k, v] of Object.entries(params)) {
			if (v !== undefined) url.searchParams.set(k, String(v));
		}
		for (let attempt = 0; ; attempt++) {
			const res = await this.fetchFn(url.toString());
			if (res.status === 429) {
				if (attempt >= MAX_RETRIES) throw new TmdbError(429, 'TMDB rate limit exceeded');
				const header = Number(res.headers.get('Retry-After'));
				const seconds = Number.isFinite(header) && header > 0 ? header : DEFAULT_RETRY_AFTER_S;
				await this.sleep(seconds * 1000);
				continue;
			}
			if (!res.ok) throw new TmdbError(res.status);
			return (await res.json()) as T;
		}
	}

	async findByTvdb(tvdbId: number): Promise<number | null> {
		const r = await this.get<{ tv_results: { id: number }[] }>(`/3/find/${tvdbId}`, {
			external_source: 'tvdb_id'
		});
		return r.tv_results[0]?.id ?? null;
	}

	getShow(id: number): Promise<ShowDetails> {
		return this.get(`/3/tv/${id}`, { append_to_response: 'external_ids' });
	}

	getSeason(showId: number, n: number): Promise<SeasonDetails> {
		return this.get(`/3/tv/${showId}/season/${n}`);
	}

	async getEpisodeExternalIds(showId: number, s: number, e: number): Promise<{ tvdb_id: number | null }> {
		const r = await this.get<{ tvdb_id?: number | null }>(
			`/3/tv/${showId}/season/${s}/episode/${e}/external_ids`
		);
		return { tvdb_id: r.tvdb_id ?? null };
	}

	async searchMovie(query: string, year?: number): Promise<MovieSearchResult[]> {
		const r = await this.get<{ results: MovieSearchResult[] }>('/3/search/movie', { query, year });
		return r.results;
	}

	async searchTv(query: string): Promise<TvSearchResult[]> {
		const r = await this.get<{ results: TvSearchResult[] }>('/3/search/tv', { query });
		return r.results;
	}

	getMovie(id: number): Promise<MovieDetails> {
		return this.get(`/3/movie/${id}`);
	}
}
