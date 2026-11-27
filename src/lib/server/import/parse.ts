import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';

export type EpisodeWatchRow = {
	tvdbSeriesId: number;
	/** null when the export's ep_id is empty: the watch is then linked by (season, episode) only. */
	tvdbEpisodeId: number | null;
	/** null when s_no is empty (seen in real exports): the watch is then linked by tvdbEpisodeId only. */
	season: number | null;
	/** null when ep_no is empty. */
	episode: number | null;
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
	/** '' when no show file has a tv_show_name; merge falls back to the episode rows' series_name. */
	name: string;
	followed: boolean;
	archived: boolean;
	forLater: boolean;
	/** Earliest created_at across the show files, null if none has one (unused downstream). */
	createdAt: string | null;
	/** TV Time's own count from user_tv_show_data.csv (optional column), for the import sanity check. */
	nbEpisodesSeen: number | null;
};
export type ParsedExport = {
	source: 'tvtime1' | 'tvtime2';
	episodes: EpisodeWatchRow[];
	movies: MovieRow[];
	shows: ShowStatusRow[];
	rowStats: EpisodeRowStats;
};
/** Counts of incomplete watch-/rewatch- rows in tracking-prod-records-v2.csv, for the import report. */
export type EpisodeRowStats = {
	/** Empty s_id: no show to attach the watch to, so the row is skipped (the only rows dropped). */
	noShowId: number;
	/** Empty ep_id: imported, linked by s_no/ep_no only. */
	noEpisodeId: number;
	/** Empty s_no or ep_no: imported, linked by ep_id only (or left for Fix imports). */
	noNumbers: number;
};

type Rec = Record<string, string | undefined>;
/** A CSV record with its 1-based line number in the file (for error messages). */
type Row = { r: Rec; line: number };

const DATE_RE =
	/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}(?::?\d{2})?)?$/;

/**
 * A TV Time timestamp -> 'YYYY-MM-DDTHH:MM:SSZ' (UTC, whole seconds; fractions are dropped).
 * Accepts 'YYYY-MM-DD HH:MM:SS' or ISO 'YYYY-MM-DDTHH:MM:SS', with optional fractional
 * seconds, and either no zone (taken as UTC, like the export's plain timestamps), 'Z', or a
 * numeric offset (±HH, ±HHMM, ±HH:MM) which is converted to UTC. Anything else throws.
 */
export function toIso(value: string, file: string): string {
	const m = DATE_RE.exec(value.trim());
	const bad = () => new Error(`Unrecognised date "${value}" in ${file}`);
	if (!m) throw bad();
	const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
	const zone = m[7];
	const local = Date.UTC(y, mo - 1, d, h, mi, s);
	const check = new Date(local);
	// Reject impossible dates/times that Date.UTC would silently roll over (2020-02-30, 25:00).
	if (
		check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d ||
		check.getUTCHours() !== h || check.getUTCMinutes() !== mi || check.getUTCSeconds() !== s
	)
		throw bad();
	let offsetMin = 0;
	if (zone && zone !== 'Z') {
		const digits = zone.slice(1).replace(':', '');
		const oh = Number(digits.slice(0, 2));
		const om = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
		if (oh > 23 || om > 59) throw bad();
		offsetMin = (zone[0] === '-' ? -1 : 1) * (oh * 60 + om);
	}
	return new Date(local - offsetMin * 60_000).toISOString().slice(0, 19) + 'Z';
}

/**
 * Reads a CSV by trimmed header name. A missing file is [] unless `mustExist`. Throws if a
 * required column is absent from the header, if a row has more fields than the header (an
 * unquoted comma would shift every later column), or if a short row lacks a required field.
 */
function readCsv(dir: string, file: string, required: string[], mustExist = false): Row[] {
	const path = join(dir, file);
	if (!existsSync(path)) {
		if (mustExist) throw new Error(`${path} not found — is --dir pointing at the export folder?`);
		return [];
	}
	let header: string[] = [];
	let records: { record: Rec; info: { lines: number } }[];
	try {
		records = parse(readFileSync(path), {
			columns: (h: string[]) => (header = h.map((c) => c.trim())),
			trim: true,
			skip_empty_lines: true,
			bom: true,
			relax_column_count_less: true,
			info: true
		});
	} catch (e) {
		throw new Error(`${file}: ${e instanceof Error ? e.message : String(e)}`);
	}
	for (const col of required) {
		if (!header.includes(col)) throw new Error(`${file}: missing required column "${col}"`);
	}
	return records.map(({ record, info }) => {
		for (const col of required) {
			if (record[col] === undefined)
				throw new Error(`${file} line ${info.lines}: row is too short, it has no "${col}" field`);
		}
		return { r: record, line: info.lines };
	});
}

function int(file: string, line: number, col: string, v: string | undefined): number {
	const s = v ?? '';
	if (!/^-?\d+$/.test(s)) throw new Error(`${file} line ${line}: column "${col}" is not an integer: "${s}"`);
	return Number(s);
}

/** Like int(), but an empty field is null (TV Time leaves s_no/ep_no/ep_id empty on some rows). */
function optInt(file: string, line: number, col: string, v: string | undefined): number | null {
	return v ? int(file, line, col, v) : null;
}

/**
 * Every watch-/rewatch- row that names a show (s_id) is kept, even with an empty ep_id,
 * s_no or ep_no: linking uses whichever identity is there, and what cannot be linked ends
 * up in Fix imports with its raw fields, so no history is lost. A non-empty field that is
 * not an integer still throws (it usually means the columns are shifted).
 */
function parseEpisodes(dir: string): { episodes: EpisodeWatchRow[]; stats: EpisodeRowStats } {
	const f = 'tracking-prod-records-v2.csv';
	const rows = readCsv(dir, f, ['key', 's_id', 'ep_id', 's_no', 'ep_no', 'series_name', 'created_at'], true);
	const episodes: EpisodeWatchRow[] = [];
	const stats: EpisodeRowStats = { noShowId: 0, noEpisodeId: 0, noNumbers: 0 };
	for (const { r, line } of rows) {
		const key = r.key!;
		const isRewatch = key.startsWith('rewatch-');
		if (!isRewatch && !key.startsWith('watch-')) continue;
		if (!r.s_id) {
			stats.noShowId++; // reported in the import's sanity section
			continue;
		}
		const row: EpisodeWatchRow = {
			tvdbSeriesId: int(f, line, 's_id', r.s_id),
			tvdbEpisodeId: optInt(f, line, 'ep_id', r.ep_id),
			season: optInt(f, line, 's_no', r.s_no),
			episode: optInt(f, line, 'ep_no', r.ep_no),
			seriesName: r.series_name!,
			watchedAt: toIso(r.created_at!, f),
			isRewatch
		};
		if (row.tvdbEpisodeId === null) stats.noEpisodeId++;
		if (row.season === null || row.episode === null) stats.noNumbers++;
		episodes.push(row);
	}
	return { episodes, stats };
}

function parseMovies(dir: string): MovieRow[] {
	const f = 'tracking-prod-records.csv';
	const rows = readCsv(dir, f, ['uuid', 'type', 'entity_type', 'movie_name', 'release_date', 'created_at']);
	const out: MovieRow[] = [];
	for (const { r } of rows) {
		if (r.entity_type !== 'movie') continue;
		const type = r.type;
		if (type !== 'watch' && type !== 'rewatch' && type !== 'towatch') continue;
		const year = /^(\d{4})/.exec(r.release_date!)?.[1];
		const y = year ? Number(year) : 0;
		out.push({
			uuid: r.uuid!,
			name: r.movie_name!,
			releaseYear: y > 1 ? y : null,
			createdAt: toIso(r.created_at!, f),
			type
		});
	}
	return out;
}

/**
 * Show flags from the three show files. Only tv_show_id and the flag columns each file is
 * used for are required; tv_show_name, created_at and nb_episodes_seen are read when present.
 */
function parseShows(dir: string): ShowStatusRow[] {
	const map = new Map<number, ShowStatusRow>();
	const touch = (file: string, { r, line }: Row): ShowStatusRow => {
		const id = int(file, line, 'tv_show_id', r.tv_show_id);
		const createdAt = r.created_at ? toIso(r.created_at, file) : null;
		let row = map.get(id);
		if (!row) {
			row = { tvdbId: id, name: '', followed: false, archived: false, forLater: false, createdAt, nbEpisodesSeen: null };
			map.set(id, row);
		}
		if (!row.name && r.tv_show_name) row.name = r.tv_show_name;
		if (createdAt && (row.createdAt === null || createdAt < row.createdAt)) row.createdAt = createdAt;
		return row;
	};
	let f = 'followed_tv_show.csv';
	for (const x of readCsv(dir, f, ['tv_show_id', 'active', 'archived'])) {
		const row = touch(f, x);
		if (x.r.active === '1') row.followed = true;
		if (x.r.archived === '1') row.archived = true;
	}
	f = 'user_tv_show_data.csv';
	for (const x of readCsv(dir, f, ['tv_show_id', 'is_followed'])) {
		const row = touch(f, x);
		if (x.r.is_followed === '1') row.followed = true;
		if (x.r.nb_episodes_seen) {
			const n = int(f, x.line, 'nb_episodes_seen', x.r.nb_episodes_seen);
			row.nbEpisodesSeen = Math.max(row.nbEpisodesSeen ?? 0, n);
		}
	}
	f = 'user_show_special_status.csv';
	for (const x of readCsv(dir, f, ['tv_show_id', 'status'])) {
		const row = touch(f, x);
		if (x.r.status === 'for_later') row.forLater = true;
	}
	return [...map.values()];
}

/** Parse one TV Time GDPR export folder. tracking-prod-records-v2.csv is required; the other files are optional. */
export function parseExport(dir: string, source: 'tvtime1' | 'tvtime2'): ParsedExport {
	const { episodes, stats } = parseEpisodes(dir);
	return { source, episodes, movies: parseMovies(dir), shows: parseShows(dir), rowStats: stats };
}
