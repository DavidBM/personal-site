import { notifyObserver } from '../lib/notify-observer.js';
import { createOnlineIncoming } from './online-incoming.js';
import { featureControl } from '../features/http-worker/client.js';
import { createOnlineTesterFleets } from './online-tester-fleets.js';
import { createOnlineEncounters } from './online-encounters.js';
import { createOnlineJourneys } from './online-journeys.js';
import { createOnlineBattles } from './online-battles.js';
import { createOnlineIndustry } from './online-industry.js';
import { createOnlinePlanets } from './online-planets.js';
/** Page-owned command ledgers; every connection replaces their authenticated read scopes. */
export function createOnlineGameplay(parent, inspector, credential, observe = {}) {
    const incoming = createOnlineIncoming((system, rows) => observe.incoming?.(system, rows));
    const tester = createOnlineTesterFleets(parent, observe.tester === true);
    const journeys = createOnlineJourneys(parent, { onProjection: observe.journey, onPath: observe.journeyPath });
    const battles = createOnlineBattles(parent, { onProjection: observe.battle });
    const encounters = createOnlineEncounters(parent, (systemId, fleetId) => { battles.setFleet({ systemId, fleetId }); battles.refresh(); });
    const industry = createOnlineIndustry(parent);
    const planets = createOnlinePlanets({
        setContext(value) { notifyObserver('planet inspector', () => inspector.setContext(value)); observe.planets?.(value); },
        suspend() { notifyObserver('planet inspector', () => inspector.suspend()); observe.planets?.(undefined); },
    }, credential);
    let pinnedJourney = false;
    let battleFleet;
    function selectBattle(value, explicit) {
        if (!value) {
            battles.setFleet(undefined);
            return;
        }
        if (!explicit && battleFleet?.systemId === value.systemId && battleFleet.fleetId !== value.fleetId)
            return;
        battleFleet = value;
        battles.setFleet(value);
    }
    return {
        reconnect(value, testerAllowed) {
            incoming.reconnect();
            tester.reconnect(testerAllowed);
            encounters.reconnect();
            planets.reconnect(value);
            journeys.reconnect();
            battles.reconnect();
            industry.reconnect();
        },
        refreshIncoming: incoming.refresh,
        createFleet: tester.create,
        fleetOwners: tester.owners,
        attack: encounters.attack,
        event(value) { notifyObserver('incoming', () => incoming.event(value)); notifyObserver('tester', () => tester.event(value)); notifyObserver('encounters', () => encounters.event(value)); notifyObserver('planets', () => planets.event(value)); notifyObserver('journeys', () => journeys.event(value)); notifyObserver('battles', () => battles.event(value)); notifyObserver('industry', () => industry.event(value)); },
        setFleet(value, explicit = false) {
            if (explicit)
                pinnedJourney = false;
            selectBattle(value, explicit);
            if (!pinnedJourney)
                journeys.setFleet(value ? { id: value.fleetId } : undefined);
        },
        previewRoute: journeys.previewRoute,
        setRoute(value) {
            if (value)
                pinnedJourney = true;
            journeys.setRoute(value);
        },
        async startRoute(value) { pinnedJourney = true; journeys.reveal(); await journeys.startRoute(value); void incoming.refresh(); },
        recoverJourney(fleetId) { pinnedJourney = true; journeys.setFleet({ id: fleetId }); journeys.reveal(); },
        setPlanet(value) { industry.setSelection(value); },
        dispose() { incoming.dispose(); featureControl('clearBattles'); tester.dispose(); encounters.dispose(); planets.dispose(); journeys.dispose(); battles.dispose(); industry.dispose(); },
    };
}
//# sourceMappingURL=online-gameplay.js.map