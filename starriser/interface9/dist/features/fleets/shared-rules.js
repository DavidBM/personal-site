const initializations = new WeakMap();
function initialize(module, input) {
    const identity = input instanceof URL ? input.href : input;
    const previous = initializations.get(module);
    if (previous) {
        if (previous.input !== identity)
            throw new Error('Shared rules module already has a different WASM source');
        return previous.ready;
    }
    // Register before initialization can suspend or re-enter. Generated bindings
    // hold module-global memory: a second instance would invalidate live pointers.
    const ready = Promise.resolve().then(async () => {
        await module.default({ module_or_path: input });
        return { rule_version: module.rule_version, RuleSystem: validatedSystem(module.RuleSystem), RuleRoutes: module.RuleRoutes,
            transfer_travel_ms: module.transfer_travel_ms,
            route_arrival_ms(now, legs) {
                requireU64(now);
                requireU32(legs);
                return module.route_arrival_ms(now, legs);
            } };
    });
    initializations.set(module, { input: identity, ready });
    return ready;
}
function requireU64(value) {
    if (typeof value !== 'bigint' || value < 0n || value > 0xffffffffffffffffn) {
        throw new RangeError('Rule time/revision must be an unsigned 64-bit bigint');
    }
}
function requireU32(value) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
        throw new RangeError('Rule work limit must be a u32');
}
/** wasm-bindgen lowers scalar bigints modulo 2^64. Guard the JS ingress before
 * that conversion, using generated signatures instead of mirroring game rules. */
function validatedSystem(Base) {
    return class extends Base {
        constructor(...args) {
            requireU64(args[1]);
            requireU64(args[2]);
            super(...args);
        }
        stage_move(...args) {
            requireU64(args[5]);
            if (args[6] != null)
                requireU64(args[6]);
            return super.stage_move(...args);
        }
        stage_due(nowMs, limit) {
            requireU64(nowMs);
            requireU32(limit);
            return super.stage_due(nowMs, limit);
        }
        stage_export(...args) {
            requireU64(args[5]);
            requireU64(args[6]);
            if (args[7] != null)
                requireU64(args[7]);
            return super.stage_export(...args);
        }
    };
}
export async function loadSharedRules(options = {}) {
    const moduleUrl = options.moduleUrl ?? new URL('../../wasm/game/galaxy_game_wasm.js', import.meta.url);
    const wasmUrl = options.wasmUrl ?? new URL('./galaxy_game_wasm_bg.wasm', moduleUrl);
    const module = await import(moduleUrl.href);
    // Success and failure are retained for this imported module. Restart its worker
    // to recover from initialization failure; never replace an instance in place.
    return initialize(module, options.wasm ?? wasmUrl);
}
//# sourceMappingURL=shared-rules.js.map