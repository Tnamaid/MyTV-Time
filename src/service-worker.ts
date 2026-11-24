/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
// Minimal service worker: it exists so the app can be installed to the home screen.
// No fetch handler and no caching — offline use is a non-goal; every request goes to the server.
const sw = self as unknown as ServiceWorkerGlobalScope;

sw.addEventListener('install', () => {
	void sw.skipWaiting();
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(sw.clients.claim());
});
