import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';

export type EpisodeWatchRow = {
	tvdbSeriesId: number;
	tvdbEpisodeId: number;
	season: number;
	episode: number;
	seriesName: string;
	watchedAt: string;
	isRewatch: boolean;
};
export type MovieRow = {
	uuid: string;
	name: string;
	releaseYear: number | null;
	createdAt: string;
	type: 'watch' | 'rewatch' | 'towatch';
};
export type ShowStatusRow = {
	tvdbId: number;
	name: string;
	followed: boolean;
	archived: boolean;
	forLater: boolean;
	createdAt: string;
};
export type ParsedExport = {
	source: 'tvtime1' | 'tvtime2';
	episodes: EpisodeWatchRow[];
	movies: MovieRow[];
	shows: ShowStatusRow[];
};

type Rec = Record<string, string>;

/** 'YYYY-MM-DD HH:MM:SS' (UTC) or ISO-ish -> 'YYYY-MM-DDTHH:MM:SSZ'. */
export function toIso(value: string): string {
	const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/.exec(value.trim());
	if (!m) throw new Error(`Unrecognised date: "${value}"`);
	return `${m[1]}T${m[2]}Z`;
}

/** Reads a CSV by trimmed header name; missing file -> []. Throws if a required column is absent. */
function readCsv(dir: string, file: string, required: string[]): Rec[] {
	const path = join(dir, file);
	if (!existsSync(path)) return [];
	let header: string[] = [];
	const rows = parse(readFileSync(path), {
		columns: (h: string[]) => (header = h.map((c) => c.trim())),
		trim: true,
		skip_empty_lines: true,
		bom: true,
		relax_column_count: true
	}) as Rec[];
	for (const col of required) {
		if (!header.includes(col)) throw new Error(`${file}: missing required column "${col}"`);
	}
	return rows;
}

function int(file: string, col: string, v: string | undefined): number {
	const n = Number.parseInt(v ?? '', 10);
	if (Number.isNaN(n)) throw new Error(`${file}: column "${col}" is not an integer: "${v}"`);
	return n;
}

function parseEpisodes(dir: string): EpisodeWatchRow[] {
	const f = 'tracking-prod-records-v2.csv';
	const rows = readCsv(dir, f, ['key', 's_id', 'ep_id', 's_no', 'ep_no', 'series_name', 'created_at']);
	const out: EpisodeWatchRow[] = [];
	for (const r of rows) {
		const isRewatch = r.key.startsWith('rewatch-');
		if (!isRewatch && !r.key.startsWith('watch-')) continue;
		if (!r.ep_id) continue;
		out.push({
			tvdbSeriesId: int(f, 's_id', r.s_id),
			tvdbEpisodeId: int(f, 'ep_id', r.ep_id),
			season: int(f, 's_no', r.s_no),
			episode: int(f, 'ep_no', r.ep_no),
			seriesName: r.series_name,
			watchedAt: toIso(r.created_at),
			isRewatch
		});
	}
	return out;
}

function parseMovies(dir: string): MovieRow[] {
	const f = 'tracking-prod-records.csv';
	const rows = readCsv(dir, f, ['uuid', 'type', 'entity_type', 'movie_name', 'release_date', 'created_at']);
	const out: MovieRow[] = [];
	for (const r of rows) {
		if (r.entity_type !== 'movie') continue;
		if (r.type !== 'watch' && r.type !== 'rewatch' && r.type !== 'towatch') continue;
		const year = /^(\d{4})/.exec(r.release_date)?.[1];
		const y = year ? Number(year) : 0;
		out.push({
			uuid: r.uuid,
			name: r.movie_name,
			releaseYear: y > 1 ? y : null,
			createdAt: toIso(r.created_at),
			type: r.type
		});
	}
	return out;
}

function parseShows(dir: string): ShowStatusRow[] {
	const map = new Map<number, ShowStatusRow>();
	const touch = (file: string, r: Rec): ShowStatusRow => {
		const id = int(file, 'tv_show_id', r.tv_show_id);
		const createdAt = toIso(r.created_at);
		let row = map.get(id);
		if (!row) {
			row = { tvdbId: id, name: '', followed: false, archived: false, forLater: false, createdAt };
			map.set(id, row);
		}
		if (!row.name && r.tv_show_name) row.name = r.tv_show_name;
		if (createdAt < row.createdAt) row.createdAt = createdAt;
		return row;
	};
	const cols = ['tv_show_id', 'tv_show_name', 'created_at'];
	let f = 'followed_tv_show.csv';
	for (const r of readCsv(dir, f, [...cols, 'active', 'archived'])) {
		const row = touch(f, r);
		if (r.active === '1') row.followed = true;
		if (r.archived === '1') row.archived = true;
	}
	f = 'user_tv_show_data.csv';
	for (const r of readCsv(dir, f, [...cols, 'is_followed'])) {
		const row = touch(f, r);
		if (r.is_followed === '1') row.followed = true;
	}
	f = 'user_show_special_status.csv';
	for (const r of readCsv(dir, f, [...cols, 'status'])) {
		const row = touch(f, r);
		if (r.status === 'for_later') row.forLater = true;
	}
	return [...map.values()];
}

export function parseExport(dir: string, source: 'tvtime1' | 'tvtime2'): ParsedExport {
	return { source, episodes: parseEpisodes(dir), movies: parseMovies(dir), shows: parseShows(dir) };
}
