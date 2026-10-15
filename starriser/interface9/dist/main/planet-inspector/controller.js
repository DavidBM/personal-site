import { openPlanetContent } from '../../lib/planet-content/consumer.js';
import { PlanetHttpError } from '../../lib/planet-content/http.js';
import { canonicalPixel, centeredPixel, initialField, planetPagePlan, planetWindow } from './view.js';
/** A single selected body owns the verified consumer and one bounded serial work loop. */
export function createPlanetInspectorController(observer, options = {}) {
    let context, key = '', disposed = false;
    let owner, work;
    let selectedBody = '', suspended, openingIntent;
    const open = options.open ?? openPlanetContent, pace = options.pace ?? (() => new Promise(resolve => setTimeout(resolve, 0)));
    function clear() {
        owner?.abort();
        owner = undefined;
        work = undefined;
        observer.clear();
        options.onSelection?.(undefined);
    }
    function fail(error, controller) {
        if (disposed || controller.signal.aborted || owner !== controller)
            return;
        const denied = error instanceof PlanetHttpError && [401, 403].includes(error.status);
        clear();
        if (denied) {
            context = undefined;
            key = '';
            suspended = undefined;
            selectedBody = '';
            observer.bodies([], '');
        }
        observer.status(denied ? 'Planet access changed. Select the system again to refresh access.' : 'Planet map could not be loaded. Select a planet to retry.');
    }
    async function readPixel(state) {
        const pixel = state.pixel, field = state.field, metadata = state.content.manifest.fields[field];
        const value = await state.content.readPixel(field, state.content.manifest.masterWidth, pixel.x, pixel.y);
        state.controller.signal.throwIfAborted();
        if (pixel.revision === state.pixelRevision && field === state.field) {
            state.pixel = undefined;
            observer.pixel(pixel.x, pixel.y, field, metadata, value);
            options.onSelection?.({ ...state.selection, pixel: { x: pixel.x, y: pixel.y } });
        }
    }
    async function renderPage(state) {
        if (state.render?.revision !== state.revision)
            state.render = { revision: state.revision, plan: planetPagePlan(state.view, state.content.manifest.fields[state.field]), index: 0 };
        const render = state.render, entry = render.plan[render.index];
        const values = await state.content.readPage(state.field, state.level, entry.page);
        state.controller.signal.throwIfAborted();
        if (render.revision !== state.revision)
            return;
        observer.page(values, entry.spans, ++render.index, render.plan.length);
        if (render.index === render.plan.length) {
            state.displayed = render.revision;
            observer.status('Map ready. Numeric surface is authoritative; 3D appearance is a visual template.');
        }
        await pace();
    }
    async function pump(state) {
        if (state.running)
            return;
        state.running = true;
        try {
            while (!state.controller.signal.aborted && (state.pixel || state.displayed !== state.revision)) {
                if (state.pixel)
                    await readPixel(state);
                else
                    await renderPage(state);
            }
        }
        catch (error) {
            fail(error, state.controller);
        }
        finally {
            state.running = false;
        }
    }
    function render(state) {
        state.revision++;
        state.view = planetWindow(state.content.manifest.masterWidth, state.level, state.centerX, state.centerY);
        observer.surface(state.content.manifest, state.field, state.level);
        observer.view(state.view, state.content.manifest.fields[state.field]);
        observer.status('Loading the visible planet region…');
        void pump(state);
    }
    async function load(body, current, controller, intent) {
        try {
            const content = await open({ endpoint: current.endpoint, credential: current.credential, visibilityEpoch: current.visibilityEpoch,
                identity: { worldId: current.worldId, systemId: current.systemId, bodyId: body.bodyId, profileVersion: body.surface.profileVersion },
                fetch: options.fetch, signal: controller.signal });
            controller.signal.throwIfAborted();
            if (content.version !== body.surface.version || content.manifest.planetClass !== body.planetClass)
                throw new Error('Planet catalog and manifest disagree');
            const view = restoredView(content.manifest, intent?.view);
            work = { controller, content, ...view, revision: 0, displayed: 0, running: false, pixelRevision: 0,
                selection: { systemId: current.systemId, bodyId: body.bodyId },
                view: planetWindow(content.manifest.masterWidth, view.level, view.centerX, view.centerY) };
            openingIntent = undefined;
            options.onSelection?.(work.selection);
            render(work);
            if (intent?.view?.pixel)
                inspect(intent.view.pixel.x, intent.view.pixel.y);
        }
        catch (error) {
            fail(error, controller);
        }
    }
    function selectBody(id, intent) {
        if (disposed)
            return;
        clear();
        suspended = undefined;
        openingIntent = intent;
        selectedBody = id;
        if (!context)
            return;
        const body = context.bodies.find(value => value.bodyId === id);
        observer.bodies(context.bodies, body ? body.bodyId : '');
        if (!body?.surface) {
            observer.status(body ? 'This planet has no published numeric map yet.' : 'Select a planet to inspect its map.');
            return;
        }
        owner = new AbortController();
        observer.status('Opening the planet map…');
        void load(body, context, owner, intent);
    }
    function setContext(next) {
        if (disposed)
            return;
        // A catalog refresh (e.g. adding catalogVersion) must not deselect the
        // planet. Only retain intent inside the same accepted authorization scope.
        const intent = suspended ?? (context && selectedBody ? {
            worldId: context.worldId, systemId: context.systemId, visibilityEpoch: context.visibilityEpoch, bodyId: selectedBody,
            view: work ? { field: work.field, level: work.level, centerX: work.centerX, centerY: work.centerY, pixel: work.pixelIntent } : openingIntent?.view,
        } : undefined);
        suspended = undefined;
        const signature = next ? JSON.stringify(next) : '';
        if (signature === key)
            return;
        clear();
        selectedBody = '';
        openingIntent = undefined;
        key = signature;
        context = next ? structuredClone(next) : undefined;
        observer.bodies(context?.bodies ?? [], '');
        observer.status(context?.bodies.length ? 'Select a planet to inspect its map.' : 'Select a discovered system with a published planet catalog.');
        if (intentMatches(intent, context) && context.bodies.some(body => body.bodyId === intent.bodyId))
            selectBody(intent.bodyId, intent);
    }
    function suspend() {
        if (disposed)
            return;
        if (context && selectedBody) {
            suspended = { worldId: context.worldId, systemId: context.systemId, visibilityEpoch: context.visibilityEpoch, bodyId: selectedBody,
                view: work ? { field: work.field, level: work.level, centerX: work.centerX, centerY: work.centerY, pixel: work.pixelIntent } : openingIntent?.view };
        }
        clear();
        context = undefined;
        openingIntent = undefined;
        key = '';
        observer.bodies([], '');
        observer.status('Refreshing planet access…');
    }
    function inspect(x, y) {
        const state = work;
        if (!state || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0
            || x >= state.content.manifest.masterWidth || y >= state.content.manifest.masterHeight)
            return;
        state.pixel = { x, y, revision: ++state.pixelRevision };
        state.pixelIntent = { x, y };
        // A pending exact read cannot leave a previously selected build anchor live.
        options.onSelection?.(state.selection);
        state.centerX = x;
        state.centerY = y;
        observer.pixel(x, y, state.field, state.content.manifest.fields[state.field], undefined);
        void pump(state);
    }
    function setField(name) {
        const state = work;
        if (!state || !Object.prototype.hasOwnProperty.call(state.content.manifest.fields, name))
            return;
        state.field = name;
        state.pixel = undefined;
        state.pixelRevision++;
        const levels = state.content.manifest.fields[name].levels;
        if (!levels.some(level => level.width === state.level))
            state.level = Math.min(...levels.map(level => level.width));
        render(state);
    }
    return { setContext, suspend, selectBody, setField, inspect,
        selectPlanet(systemId, bodyId) {
            if (disposed || context?.systemId !== systemId || !context.bodies.some(body => body.bodyId === bodyId))
                return false;
            selectBody(bodyId);
            return true;
        },
        setLevel(level) {
            const state = work;
            if (!state?.content.manifest.fields[state.field].levels.some(value => value.width === level))
                return;
            state.level = level;
            render(state);
        },
        pan(horizontal, vertical) {
            const state = work;
            if (!state)
                return;
            const center = centeredPixel(state.view, horizontal, vertical);
            state.centerX = center.x;
            state.centerY = center.y;
            render(state);
        },
        pick(x, y) {
            if (!work)
                return;
            const pixel = canonicalPixel(work.view, x, y);
            inspect(pixel.x, pixel.y);
            work.centerX = pixel.x;
            work.centerY = pixel.y;
        },
        dispose() { if (disposed)
            return; disposed = true; clear(); context = undefined; suspended = undefined; openingIntent = undefined; key = ''; observer.bodies([], ''); },
    };
}
function intentMatches(intent, context) {
    return !!intent && !!context && intent.worldId === context.worldId && intent.systemId === context.systemId && intent.visibilityEpoch === context.visibilityEpoch;
}
function restoredView(manifest, intent) {
    const field = intent && Object.prototype.hasOwnProperty.call(manifest.fields, intent.field) ? intent.field : initialField(manifest);
    const levels = manifest.fields[field].levels;
    const level = intent && levels.some(value => value.width === intent.level) ? intent.level : Math.min(...levels.map(value => value.width));
    return { field, level, centerX: Math.max(0, Math.min(manifest.masterWidth - 1, intent?.centerX ?? manifest.masterWidth / 2)),
        centerY: Math.max(0, Math.min(manifest.masterHeight - 1, intent?.centerY ?? manifest.masterHeight / 2)) };
}
//# sourceMappingURL=controller.js.map