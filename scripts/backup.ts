/**
 * Safe online backup of the tracker database (works while the app is running).
 *   npm run backup -- <dest>
 * <dest> is a file path, or a folder (existing, or ending in / or \) — then tracker-YYYY-MM-DD.db
 * is written inside it.
 * Env: DB_PATH (default ./data/tracker.db).
 */
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';

const src = process.env.DB_PATH || './data/tracker.db';
const arg = process.argv[2];
if (!arg) {
	console.error('Usage: npm run backup -- <destination file or folder>');
	process.exit(1);
}
if (!existsSync(src)) {
	console.error(`Database not found: ${src}`);
	process.exit(1);
}

const isDir = /[\\/]$/.test(arg) || (existsSync(arg) && statSync(arg).isDirectory());
const dest = isDir
	? join(arg, `tracker-${new Date().toISOString().slice(0, 10)}.db`)
	: arg;
mkdirSync(dirname(dest), { recursive: true });

const db = new Database(src, { readonly: true, fileMustExist: true });
try {
	// SQLite's online backup API: a consistent snapshot even while the app is writing.
	await db.backup(dest);
	console.log(`Backed up ${src} -> ${dest}`);
} catch (e) {
	console.error(`Backup failed: ${e instanceof Error ? e.message : e}`);
	process.exitCode = 1;
} finally {
	db.close();
}
