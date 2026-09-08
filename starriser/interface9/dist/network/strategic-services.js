import { defineCommand, defineQuery } from '../worker/protocol/services.js';
export const StrategicServices = {
    replace: defineCommand('strategic.replace', { capacity: 2, ordered: 'strategicInterest' }),
    query: defineQuery('strategic.cached', { capacity: 2 }),
    refresh: defineCommand('strategic.refresh', { capacity: 2 }),
};
//# sourceMappingURL=strategic-services.js.map