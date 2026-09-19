/** Player views cross the service boundary as bounded product data, never wire DTOs. */
import { defineCommand, defineQuery, defineEvent } from '../../worker/protocol/services.js';
export const PlayerViews = {
    replace: defineCommand('playerViews.replace', { capacity: 8, ordered: 'playerViewControls' }),
    status: defineQuery('playerViews.status', { capacity: 8 }),
    owned: defineQuery('playerViews.owned', { capacity: 4 }),
    changed: defineEvent('playerViews.changed', { capacity: 16, ordered: 'playerViewEvents' }),
};
//# sourceMappingURL=service-contracts.js.map