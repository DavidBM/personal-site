/** Transitional TopicTransport for the existing fleet event adapters. Each event
 * has one service publication; this never republishes onto the legacy broker. */
import { FleetTopicNames } from '../../features/fleets/contracts.js';
import { FleetServices } from '../protocol/services.js';
export const FleetEventServices = { spawned: FleetServices.spawned, batch: FleetServices.batch,
    state: FleetServices.state, removed: FleetServices.removed };
const topics = [FleetTopicNames.fleetSpawned, FleetTopicNames.fleetsSpawnedBatch, FleetTopicNames.fleetState, FleetTopicNames.fleetRemoved];
const aliases = ['spawned', 'batch', 'state', 'removed'];
export function fleetServiceTopicConsumer(handles) {
    const subscriptions = new Map();
    const routes = new Map(topics.map((topic, index) => [topic, handles[aliases[index]]]));
    return {
        publish() { throw new Error('Fleet consumer cannot publish'); },
        subscribe(topic, handler) {
            const route = routes.get(topic);
            if (!route)
                throw new Error('Undeclared fleet event');
            let owned = subscriptions.get(topic);
            if (!owned) {
                owned = new Map();
                subscriptions.set(topic, owned);
            }
            if (owned.has(handler))
                return;
            owned.set(handler, route.subscribe(value => handler(value, { topic })));
        },
        unsubscribe(topic, handler) {
            const owned = subscriptions.get(topic);
            owned?.get(handler)?.();
            owned?.delete(handler);
            if (!owned?.size)
                subscriptions.delete(topic);
        },
    };
}
export function fleetServiceTopicPublisher(handles) {
    const routes = new Map(topics.map((topic, index) => [topic, handles[aliases[index]]]));
    return {
        publish(topic, value) { const route = routes.get(topic); if (!route)
            throw new Error('Undeclared fleet event'); route.publish(value); },
        subscribe() { throw new Error('Fleet publisher cannot subscribe'); },
        unsubscribe() { },
    };
}
//# sourceMappingURL=fleet-service-adapter.js.map