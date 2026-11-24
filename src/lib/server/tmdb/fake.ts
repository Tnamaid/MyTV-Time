import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
	TmdbError,
	type MovieDetails,
	type MovieSearchResult,
	type SeasonDetails,
	type ShowDetails,
	type TmdbApi,
	type TvSearchResult
} from './client';

/**
 * Offline TMDB stand-in for e2e tests (TMDB_FAKE=1). Reads JSON fixtures from
 * `dir` (default tests/fixtures/tmdb, relative to cwd); see the README there.
 * Unknown ids throw TmdbError(404) like the real API.
 */
export class FakeTmdbClient implements TmdbApi {
	private dir: string;

	constructor(dir = 'tests/fixtures/tmdb') {
		this.dir = resolve(dir);
	}

	private read<T>(...parts: string[]): T {
		try {
			return JSON.parse(readFileSync(join(this.dir, ...parts), 'utf8')) as T;
		} catch {
			throw new TmdbError(404, `fake TMDB: no fixture ${parts.join('/')}`);
		}
	}

	private all<T>(kind: 'tv' | 'movie'): T[] {
		return readdirSync(join(this.dir, kind))
			.filter((f) => /^\d+\.json$/.test(f))
			.map((f) => this.read<T>(kind, f));
	}

	async getShow(id: number): Promise<ShowDetails> {
		return this.read<ShowDetails>('tv', `${id}.json`);
	}

	async getSeason(showId: number, n: number): Promise<SeasonDetails> {
		return this.read<SeasonDetails>('tv', `${showId}-season-${n}.json`);
	}

	async getMovie(id: number): Promise<MovieDetails> {
		return this.read<MovieDetails>('movie', `${id}.json`);
	}

	async findByTvdb(tvdbId: number): Promise<number | null> {
		return this.all<ShowDetails>('tv').find((s) => s.external_ids?.tvdb_id === tvdbId)?.id ?? null;
	}

	async getEpisodeExternalIds(): Promise<{ tvdb_id: number | null }> {
		return { tvdb_id: null };
	}

	async searchMovie(query: string, year?: number): Promise<MovieSearchResult[]> {
		const q = query.trim().toLowerCase();
		return this.all<MovieDetails>('movie')
			.filter((m) => `${m.title} ${m.original_title}`.toLowerCase().includes(q))
			.filter((m) => year === undefined || (m.release_date ?? '').startsWith(String(year)))
			.map((m) => ({
				id: m.id,
				title: m.title,
				original_title: m.original_title,
				release_date: m.release_date ?? '',
				poster_path: m.poster_path
			}));
	}

	async searchTv(query: string): Promise<TvSearchResult[]> {
		const q = query.trim().toLowerCase();
		return this.all<ShowDetails>('tv')
			.filter((s) => `${s.name} ${s.original_name}`.toLowerCase().includes(q))
			.map((s) => ({
				id: s.id,
				name: s.name,
				original_name: s.original_name,
				first_air_date: s.first_air_date ?? '',
				poster_path: s.poster_path
			}));
	}
}
