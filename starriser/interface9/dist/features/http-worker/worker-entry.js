import { attachJourneyScene } from './journey-scene.js';
import { attachBattleScene } from './battle-scene.js';
import { requestOwnedPlanets } from './owned-planets.js';
import { attachLiveGameplay } from './live.js';
import { attachMapLayers } from './map-layers.js';
import { requestDevelopment } from '../../lib/development-content/client.js';
import { requestJourneyPath } from '../../lib/journey-content/path.js';
import { requestIncoming } from '../../lib/journey-content/incoming.js';
import { requestAuth } from './auth.js';
import { requestCompleteBattle, clearBattleCache } from '../../lib/battle-content/complete.js';
import { attachPlanetInspector } from './planet-inspector.js';
import { loadSharedRules } from '../../lib/shared-rules/loader.js';
import { worldRequest, disposeWorld } from './world.js';
import { requestBattle } from '../../lib/battle-content/client.js';
import { requestBattleHistory } from '../../lib/battle-content/history.js';
import { requestIndustry } from '../../lib/industry-content/client.js';
import { requestJourney } from '../../lib/journey-content/client.js';
import { requestRoute } from '../../lib/journey-content/navigation.js';
import { loadPlanetCatalog } from '../../lib/planet-content/catalog.js';
import { requestTesterFleet, requestFleetOwners } from './tester-fleet.js';
import { requestSurvey } from './survey.js';
import { requestEncounter } from '../../lib/encounter-content/client.js';
const scope = self;
const inflight = new Map();
scope.addEventListener('message', event => {
    const { id, abort, operation, args, control } = event.data;
    if (control === 'gameplayPort') {
        clearBattleCache();
        attachLiveGameplay(event.data.port, (topics, fleetIds) => scope.postMessage({ gameplayChanged: topics, fleetIds }));
        return;
    }
    if (control === 'worldDispose') {
        void disposeWorld(args[0], args[1] === true).catch(() => { });
        return;
    }
    if (control === 'clearBattles') {
        clearBattleCache();
        return;
    }
    if (abort) {
        inflight.get(id)?.abort();
        return;
    }
    if (!Number.isSafeInteger(id) || inflight.has(id) || inflight.size >= 8) {
        scope.postMessage({ id, error: { message: 'Feature worker capacity reached' } });
        return;
    }
    const owner = new AbortController();
    inflight.set(id, owner);
    void run(operation, args, owner.signal).then(value => { if (!owner.signal.aborted)
        scope.postMessage({ id, value }, ArrayBuffer.isView(value) && value.byteLength >= 1024 ? [value.buffer] : []); }, error => {
        if (!owner.signal.aborted)
            scope.postMessage({ id, error: { message: error instanceof Error ? error.message : typeof error === 'string' ? error.slice(0, 512) : 'Feature request failed', status: error?.status } });
    }).finally(() => inflight.delete(id));
});
async function run(operation, args, signal) {
    if (operation === 'journeyScene') {
        attachJourneyScene(args[0]);
        return;
    }
    if (operation === 'battleScene') {
        attachBattleScene(args[0]);
        return;
    }
    if (operation === 'ownedPlanets')
        return requestOwnedPlanets(args[0], args[1], signal);
    if (operation === 'mapLayers') {
        attachMapLayers(args[0]);
        return;
    }
    if (operation === 'planetInspector') {
        attachPlanetInspector(args[0], args[1]);
        return;
    }
    if (operation === 'footprint') {
        const rules = await loadSharedRules();
        return rules.planet_footprint(args[0], args[1], args[2], args[3]);
    }
    if (operation === 'auth')
        return requestAuth(args[0], args[1], args[2], signal);
    if (operation === 'world')
        return worldRequest(args, signal);
    if (operation === 'testerFleetOwners')
        return requestFleetOwners(args[0], args[1], args[2], signal);
    if (operation === 'testerFleet')
        return requestTesterFleet(args[0], args[1], signal);
    return dataRequest(operation, args, signal);
}
function battleRequest(operation, args, signal) {
    if (operation === 'battleComplete')
        return requestCompleteBattle(args[0], args[1], args[2], signal);
    if (operation === 'battle')
        return requestBattle(args[0], args[1], args[2], signal);
    if (operation === 'battleHistory')
        return requestBattleHistory(args[0], args[1], args[2], args[3], signal);
    throw new Error('Unknown feature operation');
}
async function dataRequest(operation, args, signal) {
    if (operation === 'development')
        return requestDevelopment(args[0], args[1], args[2], signal);
    if (operation.startsWith('battle'))
        return battleRequest(operation, args, signal);
    if (operation === 'industry')
        return requestIndustry(args[0], args[1], signal);
    if (operation === 'journey')
        return requestJourney(args[0], args[1], signal);
    if (operation === 'journeyIncoming')
        return requestIncoming(args[0], args[1], args[2], signal);
    if (operation === 'journeyPath')
        return requestJourneyPath(args[0], args[1], signal);
    if (operation === 'journeyRoute')
        return requestRoute(args[0], args[1], signal);
    if (operation === 'planetCatalog')
        return loadPlanetCatalog({ ...args[0], signal });
    if (operation === 'survey')
        return requestSurvey(args[0], args[1], signal);
    if (operation === 'encounter')
        return requestEncounter(args[0], args[1], signal);
    throw new Error('Unknown feature operation');
}
//# sourceMappingURL=worker-entry.js.map