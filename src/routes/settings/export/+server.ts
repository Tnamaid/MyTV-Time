import { exportAll } from '#lib/server/export.ts';
import { today } from '#lib/server/time.ts';
import type { RequestHandler } from './$types';

/** Full JSON dump of the database as a download (the "get my data out" path). */
export const GET: RequestHandler = ({ locals }) =>
	new Response(JSON.stringify(exportAll(locals.db), null, 2), {
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			'Content-Disposition': `attachment; filename="watch-tracker-export-${today()}.json"`,
			'Cache-Control': 'no-store'
		}
	});
