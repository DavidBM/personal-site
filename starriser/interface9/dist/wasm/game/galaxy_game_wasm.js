/* @ts-self-types="./galaxy_game_wasm.d.ts" */

export class PlanetaryModel {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PlanetaryModelFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_planetarymodel_free(ptr, 0);
    }
    /**
     * @param {number} version
     * @param {number} epoch_ms
     * @param {Float64Array} origin
     * @param {Float64Array} bodies
     */
    constructor(version, epoch_ms, origin, bodies) {
        const ptr0 = passArrayF64ToWasm0(origin, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(bodies, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.planetarymodel_new(version, epoch_ms, ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        PlanetaryModelFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {number} time_ms
     * @returns {Float64Array}
     */
    phase_records(time_ms) {
        const ret = wasm.planetarymodel_phase_records(this.__wbg_ptr, time_ms);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * Shared bounded local corridor planner; warp corridors are not queried.
     * @param {number} frame_body
     * @param {number} at_ms
     * @param {number} duration_seconds
     * @param {Float64Array} start
     * @param {Float64Array} destination
     * @param {Float64Array} capability
     * @returns {Float64Array}
     */
    plan_route(frame_body, at_ms, duration_seconds, start, destination, capability) {
        const ptr0 = passArrayF64ToWasm0(start, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(destination, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF64ToWasm0(capability, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.planetarymodel_plan_route(this.__wbg_ptr, frame_body, at_ms, duration_seconds, ptr0, len0, ptr1, len1, ptr2, len2);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v4 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v4;
    }
    /**
     * @param {number} frame_body
     * @param {number} at_ms
     * @param {number} duration_seconds
     * @param {Float64Array} points
     * @param {number} clearance
     * @returns {boolean}
     */
    route_is_clear(frame_body, at_ms, duration_seconds, points, clearance) {
        const ptr0 = passArrayF64ToWasm0(points, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.planetarymodel_route_is_clear(this.__wbg_ptr, frame_body, at_ms, duration_seconds, ptr0, len0, clearance);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
    /**
     * @param {number} time_ms
     * @returns {Float64Array}
     */
    sample(time_ms) {
        const ret = wasm.planetarymodel_sample(this.__wbg_ptr, time_ms);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
}
if (Symbol.dispose) PlanetaryModel.prototype[Symbol.dispose] = PlanetaryModel.prototype.free;

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
     * Shared authoritative gate geometry, kept inside the domain worker.
     * @param {Float64Array} direction
     * @returns {Float64Array}
     */
    jump_gate(direction) {
        const ptr0 = passArrayF64ToWasm0(direction, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.rulesystem_jump_gate(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v2;
    }
    /**
     * Columns per fleet: identities = fleet/owner/order IDs (48 bytes; zero order
     * means idle); positions = x,z,targetX,targetZ (legacy) or
     * x,y,z,targetX,targetY,targetZ; times = departure,arrival,transfer-ready.
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
     * @returns {Uint8Array}
     */
    orbit_bytes() {
        const ret = wasm.rulesystem_orbit_bytes(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {Uint32Array}
     */
    orbit_offsets() {
        const ret = wasm.rulesystem_orbit_offsets(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Uint32Array}
     */
    path_offsets() {
        const ret = wasm.rulesystem_path_offsets(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    path_points() {
        const ret = wasm.rulesystem_path_points(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
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
     * @returns {Uint8Array}
     */
    pending_orbit_bytes() {
        const ret = wasm.rulesystem_pending_orbit_bytes(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {Uint32Array}
     */
    pending_orbit_offsets() {
        const ret = wasm.rulesystem_pending_orbit_offsets(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
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
     * @returns {Uint32Array}
     */
    pending_path_offsets() {
        const ret = wasm.rulesystem_pending_path_offsets(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    pending_path_points() {
        const ret = wasm.rulesystem_pending_path_points(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
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
     * Source/destination/fleet/owner full IDs, 64 bytes, or empty for no export.
     * @returns {Uint8Array}
     */
    pending_transfer_ids() {
        const ret = wasm.rulesystem_pending_transfer_ids(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Base/new system revision, command time, departure, arrival, fleet revision.
     * @returns {BigUint64Array}
     */
    pending_transfer_meta() {
        const ret = wasm.rulesystem_pending_transfer_meta(this.__wbg_ptr);
        var v1 = getArrayU64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * Source and destination in sun-local units: XZ pairs or XYZ triples.
     * @returns {Float64Array}
     */
    pending_transfer_positions() {
        const ret = wasm.rulesystem_pending_transfer_positions(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * Effective jump, cooldown, configuration/modifier revisions and ready time.
     * Historical exports return an empty column, never reinterpret new policy.
     * @returns {BigUint64Array}
     */
    pending_transfer_timing() {
        const ret = wasm.rulesystem_pending_transfer_timing(this.__wbg_ptr);
        var v1 = getArrayU64FromWasm0(ret[0], ret[1]).slice();
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
     * Authoritative catalog and policy; the catalog itself is compiled into the
     * same Rust core as the server. Version/epoch mismatches fail closed.
     * @param {string} catalog_id
     * @param {number} geometry_version
     * @param {bigint} epoch_ms
     * @param {number} speed
     * @param {number} clearance
     * @param {number} extent
     * @param {number} sun_clearance
     * @returns {number}
     */
    set_movement_context(catalog_id, geometry_version, epoch_ms, speed, clearance, extent, sun_clearance) {
        const ptr0 = passStringToWasm0(catalog_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.rulesystem_set_movement_context(this.__wbg_ptr, ptr0, len0, geometry_version, epoch_ms, speed, clearance, extent, sun_clearance);
        return ret >>> 0;
    }
    /**
     * Via offsets count XYZ points, not scalar words. Rows follow the original
     * constructor input order; output getters use identities() canonical order.
     * All rows are validated before replacing state, so failure is atomic.
     * @param {Uint32Array} offsets
     * @param {Float64Array} points
     * @returns {number}
     */
    set_movement_paths(offsets, points) {
        const ptr0 = passArray32ToWasm0(offsets, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(points, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.rulesystem_set_movement_paths(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return ret >>> 0;
    }
    /**
     * @param {Uint32Array} offsets
     * @param {Uint8Array} bytes
     * @returns {number}
     */
    set_orbits(offsets, bytes) {
        const ptr0 = passArray32ToWasm0(offsets, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.rulesystem_set_orbits(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return ret >>> 0;
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
     * @param {Uint8Array} fleet_id
     * @param {Uint8Array} destination_id
     * @param {number} target_x
     * @param {number} target_z
     * @param {bigint} now_ms
     * @param {bigint} arrival_ms
     * @param {bigint | null} [expected_revision]
     * @returns {number}
     */
    stage_export(actor_id, fleet_id, destination_id, target_x, target_z, now_ms, arrival_ms, expected_revision) {
        const ptr0 = passArray8ToWasm0(actor_id, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(fleet_id, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(destination_id, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.rulesystem_stage_export(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, target_x, target_z, now_ms, arrival_ms, !isLikeNone(expected_revision), isLikeNone(expected_revision) ? BigInt(0) : expected_revision);
        return ret >>> 0;
    }
    /**
     * Source-scoped preview of the new accepted-policy contract. Timing values
     * here are observations; the server never accepts them in a player command.
     * @param {Uint8Array} actor_id
     * @param {Uint8Array} fleet_id
     * @param {Uint8Array} destination_id
     * @param {number} target_x
     * @param {number} target_y
     * @param {number} target_z
     * @param {bigint} now_ms
     * @param {bigint} jump_ms
     * @param {bigint} cooldown_ms
     * @param {bigint} configuration_revision
     * @param {bigint} modifier_revision
     * @param {bigint | null} [expected_revision]
     * @returns {number}
     */
    stage_export_with_policy(actor_id, fleet_id, destination_id, target_x, target_y, target_z, now_ms, jump_ms, cooldown_ms, configuration_revision, modifier_revision, expected_revision) {
        const ptr0 = passArray8ToWasm0(actor_id, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(fleet_id, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(destination_id, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.rulesystem_stage_export_with_policy(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, target_x, target_y, target_z, now_ms, jump_ms, cooldown_ms, configuration_revision, modifier_revision, !isLikeNone(expected_revision), isLikeNone(expected_revision) ? BigInt(0) : expected_revision);
        return ret >>> 0;
    }
    /**
     * @param {Uint8Array} actor_id
     * @param {Uint8Array} fleet_id
     * @param {Uint8Array} destination_id
     * @param {number} target_x
     * @param {number} target_y
     * @param {number} target_z
     * @param {bigint} now_ms
     * @param {bigint} arrival_ms
     * @param {bigint | null} [expected_revision]
     * @returns {number}
     */
    stage_export_xyz(actor_id, fleet_id, destination_id, target_x, target_y, target_z, now_ms, arrival_ms, expected_revision) {
        const ptr0 = passArray8ToWasm0(actor_id, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(fleet_id, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(destination_id, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.rulesystem_stage_export_xyz(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, target_x, target_y, target_z, now_ms, arrival_ms, !isLikeNone(expected_revision), isLikeNone(expected_revision) ? BigInt(0) : expected_revision);
        return ret >>> 0;
    }
    /**
     * @param {Uint8Array} actor_id
     * @param {Uint8Array} order_id
     * @param {Uint8Array} fleet_id
     * @param {number} target_x
     * @param {number} target_z
     * @param {bigint} now_ms
     * @param {bigint | null} [expected_revision]
     * @returns {number}
     */
    stage_move(actor_id, order_id, fleet_id, target_x, target_z, now_ms, expected_revision) {
        const ptr0 = passArray8ToWasm0(actor_id, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(order_id, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(fleet_id, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.rulesystem_stage_move(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, target_x, target_z, now_ms, !isLikeNone(expected_revision), isLikeNone(expected_revision) ? BigInt(0) : expected_revision);
        return ret >>> 0;
    }
    /**
     * XYZ command ingress; the planar method remains compatible with old fixtures.
     * @param {Uint8Array} actor_id
     * @param {Uint8Array} order_id
     * @param {Uint8Array} fleet_id
     * @param {number} target_x
     * @param {number} target_y
     * @param {number} target_z
     * @param {bigint} now_ms
     * @param {bigint | null} [expected_revision]
     * @returns {number}
     */
    stage_move_xyz(actor_id, order_id, fleet_id, target_x, target_y, target_z, now_ms, expected_revision) {
        const ptr0 = passArray8ToWasm0(actor_id, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(order_id, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(fleet_id, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.rulesystem_stage_move_xyz(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, target_x, target_y, target_z, now_ms, !isLikeNone(expected_revision), isLikeNone(expected_revision) ? BigInt(0) : expected_revision);
        return ret >>> 0;
    }
    /**
     * @param {Uint8Array} actor_id
     * @param {Uint8Array} order_id
     * @param {Uint8Array} fleet_id
     * @param {number} body_index
     * @param {bigint} now_ms
     * @param {bigint} expected_fleet_revision
     * @returns {number}
     */
    stage_orbit(actor_id, order_id, fleet_id, body_index, now_ms, expected_fleet_revision) {
        const ptr0 = passArray8ToWasm0(actor_id, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(order_id, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(fleet_id, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.rulesystem_stage_orbit(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, body_index, now_ms, expected_fleet_revision);
        return ret >>> 0;
    }
    /**
     * Opt-in per-fleet edit contract. Callers first commit due work explicitly;
     * an online preview never silently advances authoritative state.
     * @param {Uint8Array} actor_id
     * @param {Uint8Array} order_id
     * @param {Uint8Array} fleet_id
     * @param {number} target_x
     * @param {number} target_y
     * @param {number} target_z
     * @param {bigint} now_ms
     * @param {bigint} expected_fleet_revision
     * @returns {number}
     */
    stage_retarget_xyz(actor_id, order_id, fleet_id, target_x, target_y, target_z, now_ms, expected_fleet_revision) {
        const ptr0 = passArray8ToWasm0(actor_id, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(order_id, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(fleet_id, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.rulesystem_stage_retarget_xyz(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, target_x, target_y, target_z, now_ms, expected_fleet_revision);
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
 * @returns {BigUint64Array}
 */
export function default_transfer_policy() {
    const ret = wasm.default_transfer_policy();
    var v1 = getArrayU64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v1;
}

/**
 * @returns {number}
 */
export function ephemeris_version() {
    const ret = wasm.ephemeris_version();
    return ret >>> 0;
}

/**
 * Geometric preview only. Ownership, occupancy and production costs require
 * the authoritative construction command; this function grants none of them.
 * @param {string} class_name
 * @param {number} kind
 * @param {number} x
 * @param {number} y
 * @returns {Uint32Array}
 */
export function planet_footprint(class_name, kind, x, y) {
    const ptr0 = passStringToWasm0(class_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.planet_footprint(ptr0, len0, kind, x, y);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v2;
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} radius_m
 * @returns {number}
 */
export function planet_pixel_area_m2(x, y, radius_m) {
    const ret = wasm.planet_pixel_area_m2(x, y, radius_m);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @param {number} radius_m
 * @returns {number}
 */
export function planet_surface_distance_m(x1, y1, x2, y2, radius_m) {
    const ret = wasm.planet_surface_distance_m(x1, y1, x2, y2, radius_m);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

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
 * @param {bigint} now
 * @param {number} legs
 * @param {bigint} jump_ms
 * @param {bigint} cooldown_ms
 * @param {bigint} configuration_revision
 * @param {bigint} modifier_revision
 * @returns {bigint}
 */
export function route_arrival_with_policy(now, legs, jump_ms, cooldown_ms, configuration_revision, modifier_revision) {
    const ret = wasm.route_arrival_with_policy(now, legs, jump_ms, cooldown_ms, configuration_revision, modifier_revision);
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
        __wbindgen_generic_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
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

const PlanetaryModelFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_planetarymodel_free(ptr, 1));
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

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
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

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
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

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
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
