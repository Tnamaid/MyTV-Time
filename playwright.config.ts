import { defineConfig } from '@playwright/test';

const PORT = 4173;
/** Throwaway database, deleted and re-seeded by tests/e2e/seed.ts on every run. */
const DB_PATH = '.e2e/tracker.db';

export default defineConfig({
	testDir: 'tests/e2e',
	fullyParallel: false,
	workers: 1,
	use: {
		browserName: 'chromium',
		baseURL: `http://localhost:${PORT}`,
		viewport: { width: 390, height: 844 }
	},
	webServer: {
		command: 'tsx tests/e2e/seed.ts && vite build && node build',
		url: `http://localhost:${PORT}`,
		reuseExistingServer: false,
		timeout: 180_000,
		// adapter-node assumes https unless ORIGIN says otherwise; without it every POST is a 403.
		env: { DB_PATH, TMDB_FAKE: '1', PORT: String(PORT), HOST: '127.0.0.1', ORIGIN: `http://localhost:${PORT}` }
	}
});
