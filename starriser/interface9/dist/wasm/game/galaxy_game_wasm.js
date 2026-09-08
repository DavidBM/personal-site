/* @ts-self-types="./galaxy_game_wasm.d.ts" */

/**
 * An immutable permitted topology, built once and released with its worker or
 * topology generation. Packed IDs and index pairs avoid a JSON object bridge.
 */
export class RuleRoutes {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        RuleRoutesFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_ruleroutes_free(ptr, 0);
    }
    /**
     * @param {Uint8Array} system_ids
     * @param {Uint32Array} edge_indices
     */
    constructor(system_ids, edge_indices) {
        const ptr0 = passArray8ToWasm0(system_ids, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray32ToWasm0(edge_indices, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.ruleroutes_new(ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        RuleRoutesFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {Uint8Array} source_id
     * @param {Uint8Array} destination_id
     * @returns {Uint8Array}
     */
    select(source_id, destination_id) {
        const ptr0 = passArray8ToWasm0(source_id, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(destination_id, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.ruleroutes_select(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v3;
    }
}
if (Symbol.dispose) RuleRoutes.prototype[Symbol.dispose] = RuleRoutes.prototype.free;

/**
 * An offline authority or preview instance, never a second online authority.
 * One pending change prevents accidental publication across an async commit.
 */
export class RuleSystem {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        RuleSystemFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_rulesystem_free(ptr, 0);
    }
    /**
     * Only confirmed durable commit or an explicit offline host calls this.
     * @returns {number}
     */
    commit() {
        const ret = wasm.rulesystem_commit(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {bigint}
     */
    committed_time_ms() {
        const ret = wasm.rulesystem_committed_time_ms(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    discard() {
        wasm.rulesystem_discard(this.__wbg_ptr);
    }
    /**
     * @returns {Uint8Array}
     */
    identities() {
        const ret = wasm.rulesystem_identities(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Columns per ship: identities = ship/owner/order IDs (48 bytes; zero order
     * means idle); positions = x,z,targetX,targetZ; times = departure,arrival.
     * Revisions are u64, exposed as BigUint64Array. Rows restore in any order.
     * @param {Uint8Array} system_id
     * @param {bigint} revision
     * @param {bigint} committed_time_ms
     * @param {Uint8Array} identities
     * @param {BigUint64Array} revisions
     * @param {Float64Array} positions
     * @param {BigUint64Array} times
     */
    constructor(system_id, revision, committed_time_ms, identities, revisions, positions, times) {
        const ptr0 = passArray8ToWasm0(system_id, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(identities, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray64ToWasm0(revisions, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayF64ToWasm0(positions, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passArray64ToWasm0(times, wasm.__wbindgen_malloc);
        const len4 = WASM_VECTOR_LEN;
        const ret = wasm.rulesystem_new(ptr0, len0, revision, committed_time_ms, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        RuleSystemFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {bigint | undefined}
     */
    next_deadline_ms() {
        const ret = wasm.rulesystem_next_deadline_ms(this.__wbg_ptr);
        return ret[0] === 0 ? undefined : BigInt.asUintN(64, ret[1]);
    }
    /**
     * Event row = kind (1 started, 2 arrived), departure (0 for arrival), arrival.
     * @returns {BigUint64Array}
     */
    pending_events() {
        const ret = wasm.rulesystem_pending_events(this.__wbg_ptr);
        var v1 = getArrayU64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Uint8Array}
     */
    pending_identities() {
        const ret = wasm.rulesystem_pending_identities(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Empty means no proposal; otherwise base revision, new revision, server ms.
     * @returns {BigUint64Array}
     */
    pending_meta() {
        const ret = wasm.rulesystem_pending_meta(this.__wbg_ptr);
        var v1 = getArrayU64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * Event row = original order ID (16 bytes); times are in pending_events.
     * @returns {Uint8Array}
     */
    pending_order_ids() {
        const ret = wasm.rulesystem_pending_order_ids(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    pending_positions() {
        const ret = wasm.rulesystem_pending_positions(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {BigUint64Array}
     */
    pending_revisions() {
        const ret = wasm.rulesystem_pending_revisions(this.__wbg_ptr);
        var v1 = getArrayU64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {BigUint64Array}
     */
    pending_times() {
        const ret = wasm.rulesystem_pending_times(this.__wbg_ptr);
        var v1 = getArrayU64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * Source/destination/ship/owner full IDs, 64 bytes, or empty for no export.
     * @returns {Uint8Array}
     */
    pending_transfer_ids() {
        const ret = wasm.rulesystem_pending_transfer_ids(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Base/new system revision, command time, departure, arrival, ship revision.
     * @returns {BigUint64Array}
     */
    pending_transfer_meta() {
        const ret = wasm.rulesystem_pending_transfer_meta(this.__wbg_ptr);
        var v1 = getArrayU64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * Source x,z and destination x,z in each system's sun-local scene units.
     * @returns {Float64Array}
     */
    pending_transfer_positions() {
        const ret = wasm.rulesystem_pending_transfer_positions(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    positions() {
        const ret = wasm.rulesystem_positions(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {bigint}
     */
    revision() {
        const ret = wasm.rulesystem_revision(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * @returns {BigUint64Array}
     */
    revisions() {
        const ret = wasm.rulesystem_revisions(this.__wbg_ptr);
        var v1 = getArrayU64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {bigint} now_ms
     * @param {number} limit
     * @returns {number}
     */
    stage_due(now_ms, limit) {
        const ret = wasm.rulesystem_stage_due(this.__wbg_ptr, now_ms, limit);
        return ret >>> 0;
    }
    /**
     * Stages the same sealed export as native. Route permission and receipt
     * dedup belong to the host; online preview callers discard this proposal.
     * @param {Uint8Array} actor_id
     * @param {Uint8Array} ship_id
     * @param {Uint8Array} destination_id
     * @param {number} target_x
     * @param {number} target_z
     * @param {bigint} now_ms
     * @param {bigint} arrival_ms
     * @param {bigint | null} [expected_revision]
     * @returns {number}
     */
    stage_export(actor_id, ship_id, destination_id, target_x, target_z, now_ms, arrival_ms, expected_revision) {
        const ptr0 = passArray8ToWasm0(actor_id, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(ship_id, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(destination_id, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.rulesystem_stage_export(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, target_x, target_z, now_ms, arrival_ms, !isLikeNone(expected_revision), isLikeNone(expected_revision) ? BigInt(0) : expected_revision);
        return ret >>> 0;
    }
    /**
     * @param {Uint8Array} actor_id
     * @param {Uint8Array} order_id
     * @param {Uint8Array} ship_id
     * @param {number} target_x
     * @param {number} target_z
     * @param {bigint} now_ms
     * @param {bigint | null} [expected_revision]
     * @returns {number}
     */
    stage_move(actor_id, order_id, ship_id, target_x, target_z, now_ms, expected_revision) {
        const ptr0 = passArray8ToWasm0(actor_id, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(order_id, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(ship_id, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.rulesystem_stage_move(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, target_x, target_z, now_ms, !isLikeNone(expected_revision), isLikeNone(expected_revision) ? BigInt(0) : expected_revision);
        return ret >>> 0;
    }
    /**
     * @returns {BigUint64Array}
     */
    times() {
        const ret = wasm.rulesystem_times(this.__wbg_ptr);
        var v1 = getArrayU64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
}
if (Symbol.dispose) RuleSystem.prototype[Symbol.dispose] = RuleSystem.prototype.free;

/**
 * @param {bigint} now
 * @param {number} legs
 * @returns {bigint}
 */
export function route_arrival_ms(now, legs) {
    const ret = wasm.route_arrival_ms(now, legs);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return BigInt.asUintN(64, ret[0]);
}

/**
 * @returns {number}
 */
export function rule_version() {
    const ret = wasm.rule_version();
    return ret >>> 0;
}

/**
 * @returns {bigint}
 */
export function transfer_travel_ms() {
    const ret = wasm.transfer_travel_ms();
    return BigInt.asUintN(64, ret);
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_5d9e815e6fdf150f: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_generic_0000000000000001: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./galaxy_game_wasm_bg.js": import0,
    };
}

const RuleRoutesFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_ruleroutes_free(ptr, 1));
const RuleSystemFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_rulesystem_free(ptr, 1));

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayU64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getBigUint64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedBigUint64ArrayMemory0 = null;
function getBigUint64ArrayMemory0() {
    if (cachedBigUint64ArrayMemory0 === null || cachedBigUint64ArrayMemory0.byteLength === 0) {
        cachedBigUint64ArrayMemory0 = new BigUint64Array(wasm.memory.buffer);
    }
    return cachedBigUint64ArrayMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getBigUint64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedBigUint64ArrayMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('galaxy_game_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
