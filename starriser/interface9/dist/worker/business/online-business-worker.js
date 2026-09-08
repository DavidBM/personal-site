import { busConstructor as createBusinessWorker } from './business-worker.js';
/** The observer retains picking/selection without an editor authority path. */
export function busConstructor(bus) { return createBusinessWorker(bus, false); }
//# sourceMappingURL=online-business-worker.js.map