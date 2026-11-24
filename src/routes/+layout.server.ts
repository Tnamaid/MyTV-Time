import { eq, sql } from 'drizzle-orm';
import { importIssue } from '#lib/server/db/schema.ts';
import type { LayoutServerLoad } from './$types';

/** Open import issues, for the badge on the Settings tab. */
export const load: LayoutServerLoad = ({ locals }) => ({
	openIssues:
		locals.db
			.select({ n: sql<number>`count(*)` })
			.from(importIssue)
			.where(eq(importIssue.resolved, false))
			.get()?.n ?? 0
});
