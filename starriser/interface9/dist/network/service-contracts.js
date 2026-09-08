/** Feature descriptors contain types/metadata only; importing them loads no codec. */
import { defineCommand, defineEvent, defineQuery } from '../worker/protocol/services.js';
const event = (kind) => defineEvent(`network.${kind}`, { capacity: 128, ordered: 'networkEvents' });
export const NetworkEvents = {
    state: event('state'), welcome: event('welcome'), topology: event('topology'), receipt: event('receipt'),
    unknown: event('unknown'), received: event('received'), resync: event('resync'), error: event('error'),
};
export const OwnedShips = defineQuery('shipOrders.ownedShips', { capacity: 4 });
export const NetworkPlayback = { refresh: defineCommand('network.playback.refresh', { capacity: 1 }) };
export const NetworkDiagnostics = defineQuery('network.diagnostics', { capacity: 1 });
/** Acknowledgement means the UI owns the full original key/intent before send. */
export const RememberIntent = defineCommand('shipOrders.rememberIntent', { capacity: 128, ordered: 'networkIntents' });
//# sourceMappingURL=service-contracts.js.map