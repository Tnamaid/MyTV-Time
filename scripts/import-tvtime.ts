/**
 * Import two TV Time GDPR exports into the tracker db.
 *   npm run import -- --dir1 <path> --dir2 <path> [--dry-run]
 * Env: TMDB_API_KEY (required), DB_PATH (default ./data/tracker.db). Run from repo root.
 */
import { existsSync, statSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { openDb } from '../src/lib/server/db/client';
import { mergeExports } from '../src/lib/server/import/merge';
import { parseExport } from '../src/lib/server/import/parse';
import { formatSanity, runImport } from '../src/lib/server/import/resolve';
import { TmdbClient, TmdbError } from '../src/lib/server/tmdb/client';

const USAGE = 'Usage: npm run import -- --dir1 <path> --dir2 <path> [--dry-run]';

function fail(msg: string): never {
	console.error(msg);
	process.exit(1);
}

let values: { dir1?: string; dir2?: string; 'dry-run'?: boolean };
try {
	({ values } = parseArgs({
		options: { dir1: { type: 'string' }, dir2: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } }
	}));
} catch (e) {
	fail(`${e instanceof Error ? e.message : e}\n${USAGE}`);
}
if (!values.dir1 || !values.dir2) fail(`--dir1 and --dir2 are required.\n${USAGE}`);
for (const d of [values.dir1, values.dir2]) {
	if (!existsSync(d) || !statSync(d).isDirectory()) fail(`Not a directory: ${d}`);
}

const apiKey = process.env.TMDB_API_KEY;
if (!apiKey) fail('TMDB_API_KEY is not set. Export it (see docs/INSTALL.md) and re-run.');

const dryRun = values['dry-run'] === true;
let bundle;
try {
	bundle = mergeExports(parseExport(values.dir1, 'tvtime1'), parseExport(values.dir2, 'tvtime2'));
} catch (e) {
	fail(`Could not read the TV Time export: ${e instanceof Error ? e.message : e}\nNothing was written.`);
}
const db = openDb(process.env.DB_PATH || './data/tracker.db');
let report;
try {
	report = await runImport(db, new TmdbClient(apiKey), bundle, { dryRun });
} catch (e) {
	db.$client.close();
	if (e instanceof TmdbError && (e.status === 401 || e.status === 403))
		fail(`TMDB rejected the API key (${e.status}) — check TMDB_API_KEY. Nothing was written.`);
	if (e instanceof TmdbError && e.status === 0)
		fail(`Could not reach TMDB, even after retries (${e.message}). Check the internet connection and re-run. Nothing was written.`);
	console.error('Import aborted, nothing was written:', e);
	process.exit(1);
}
console.log(dryRun ? 'DRY RUN — nothing was written.' : 'Import complete.');
const { sanity: _sanity, ...counts } = report;
console.table(counts);
console.log(formatSanity(report).join('\n'));
db.$client.close();
