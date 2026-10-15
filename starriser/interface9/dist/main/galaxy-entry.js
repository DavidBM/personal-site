import { onlineWebAuth } from './online-web-auth.js';
import { parseLauncherEndpoints } from './online-login.js';
import { BACKEND_RUNTIME, MOCK_RUNTIME, requestedRuntime } from './runtime-profile.js';
async function hasLocalServer() {
    if (location.hostname !== '127.0.0.1')
        return false;
    try {
        const response = await fetch('./dist/galaxy-launcher.json', { cache: 'no-store' });
        return response.ok && !!parseLauncherEndpoints(await response.json(), location.href);
    }
    catch {
        return false;
    }
}
async function start() {
    const requested = requestedRuntime(location.search);
    const offline = requested === 'mock';
    const session = offline ? undefined : await onlineWebAuth();
    const online = !offline && (requested === 'backend' || session || location.pathname.endsWith('/online.html') || window.__galaxyDevLoginFragment || await hasLocalServer());
    if (online) {
        const { startOnline } = await import('./online-runtime.js');
        startOnline(session, BACKEND_RUNTIME);
    }
    else {
        const { App } = await import('../app.js');
        await new App({ runtime: MOCK_RUNTIME }).initialize();
        document.getElementById('app-loader')?.remove();
    }
}
void start().catch(error => {
    console.error('Galaxy could not start', error);
    const status = document.getElementById('loading-status');
    if (status)
        status.textContent = 'Could not connect. Reload to try again.';
});
//# sourceMappingURL=galaxy-entry.js.map