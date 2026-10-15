/* tslint:disable */
/* eslint-disable */

export class PlanetaryModel {
    free(): void;
    [Symbol.dispose](): void;
    constructor(version: number, epoch_ms: number, origin: Float64Array, bodies: Float64Array);
    phase_records(time_ms: number): Float64Array;
    /**
     * Shared bounded local corridor planner; warp corridors are not queried.
     */
    plan_route(frame_body: number, at_ms: number, duration_seconds: number, start: Float64Array, destination: Float64Array, capability: Float64Array): Float64Array;
    route_is_clear(frame_body: number, at_ms: number, duration_seconds: number, points: Float64Array, clearance: number): boolean;
    sample(time_ms: number): Float64Array;
}

/**
 * An immutable permitted topology, built once and released with its worker or
 * topology generation. Packed IDs and index pairs avoid a JSON object bridge.
 */
export class RuleRoutes {
    free(): void;
    [Symbol.dispose](): void;
    constructor(system_ids: Uint8Array, edge_indices: Uint32Array);
    select(source_id: Uint8Array, destination_id: Uint8Array): Uint8Array;
}

/**
 * An offline authority or preview instance, never a second online authority.
 * One pending change prevents accidental publication across an async commit.
 */
export class RuleSystem {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Only confirmed durable commit or an explicit offline host calls this.
     */
    commit(): number;
    committed_time_ms(): bigint;
    discard(): void;
    identities(): Uint8Array;
    /**
     * Shared authoritative gate geometry, kept inside the domain worker.
     */
    jump_gate(direction: Float64Array): Float64Array;
    /**
     * Columns per fleet: identities = fleet/owner/order IDs (48 bytes; zero order
     * means idle); positions = x,z,targetX,targetZ (legacy) or
     * x,y,z,targetX,targetY,targetZ; times = departure,arrival,transfer-ready.
     * Revisions are u64, exposed as BigUint64Array. Rows restore in any order.
     */
    constructor(system_id: Uint8Array, revision: bigint, committed_time_ms: bigint, identities: Uint8Array, revisions: BigUint64Array, positions: Float64Array, times: BigUint64Array);
    next_deadline_ms(): bigint | undefined;
    orbit_bytes(): Uint8Array;
    orbit_offsets(): Uint32Array;
    path_offsets(): Uint32Array;
    path_points(): Float64Array;
    /**
     * Event row = kind (1 started, 2 arrived), departure (0 for arrival), arrival.
     */
    pending_events(): BigUint64Array;
    pending_identities(): Uint8Array;
    /**
     * Empty means no proposal; otherwise base revision, new revision, server ms.
     */
    pending_meta(): BigUint64Array;
    pending_orbit_bytes(): Uint8Array;
    pending_orbit_offsets(): Uint32Array;
    /**
     * Event row = original order ID (16 bytes); times are in pending_events.
     */
    pending_order_ids(): Uint8Array;
    pending_path_offsets(): Uint32Array;
    pending_path_points(): Float64Array;
    pending_positions(): Float64Array;
    pending_revisions(): BigUint64Array;
    pending_times(): BigUint64Array;
    /**
     * Source/destination/fleet/owner full IDs, 64 bytes, or empty for no export.
     */
    pending_transfer_ids(): Uint8Array;
    /**
     * Base/new system revision, command time, departure, arrival, fleet revision.
     */
    pending_transfer_meta(): BigUint64Array;
    /**
     * Source and destination in sun-local units: XZ pairs or XYZ triples.
     */
    pending_transfer_positions(): Float64Array;
    /**
     * Effective jump, cooldown, configuration/modifier revisions and ready time.
     * Historical exports return an empty column, never reinterpret new policy.
     */
    pending_transfer_timing(): BigUint64Array;
    positions(): Float64Array;
    revision(): bigint;
    revisions(): BigUint64Array;
    /**
     * Authoritative catalog and policy; the catalog itself is compiled into the
     * same Rust core as the server. Version/epoch mismatches fail closed.
     */
    set_movement_context(catalog_id: string, geometry_version: number, epoch_ms: bigint, speed: number, clearance: number, extent: number, sun_clearance: number): number;
    /**
     * Via offsets count XYZ points, not scalar words. Rows follow the original
     * constructor input order; output getters use identities() canonical order.
     * All rows are validated before replacing state, so failure is atomic.
     */
    set_movement_paths(offsets: Uint32Array, points: Float64Array): number;
    set_orbits(offsets: Uint32Array, bytes: Uint8Array): number;
    stage_due(now_ms: bigint, limit: number): number;
    /**
     * Stages the same sealed export as native. Route permission and receipt
     * dedup belong to the host; online preview callers discard this proposal.
     */
    stage_export(actor_id: Uint8Array, fleet_id: Uint8Array, destination_id: Uint8Array, target_x: number, target_z: number, now_ms: bigint, arrival_ms: bigint, expected_revision?: bigint | null): number;
    /**
     * Source-scoped preview of the new accepted-policy contract. Timing values
     * here are observations; the server never accepts them in a player command.
     */
    stage_export_with_policy(actor_id: Uint8Array, fleet_id: Uint8Array, destination_id: Uint8Array, target_x: number, target_y: number, target_z: number, now_ms: bigint, jump_ms: bigint, cooldown_ms: bigint, configuration_revision: bigint, modifier_revision: bigint, expected_revision?: bigint | null): number;
    stage_export_xyz(actor_id: Uint8Array, fleet_id: Uint8Array, destination_id: Uint8Array, target_x: number, target_y: number, target_z: number, now_ms: bigint, arrival_ms: bigint, expected_revision?: bigint | null): number;
    stage_move(actor_id: Uint8Array, order_id: Uint8Array, fleet_id: Uint8Array, target_x: number, target_z: number, now_ms: bigint, expected_revision?: bigint | null): number;
    /**
     * XYZ command ingress; the planar method remains compatible with old fixtures.
     */
    stage_move_xyz(actor_id: Uint8Array, order_id: Uint8Array, fleet_id: Uint8Array, target_x: number, target_y: number, target_z: number, now_ms: bigint, expected_revision?: bigint | null): number;
    stage_orbit(actor_id: Uint8Array, order_id: Uint8Array, fleet_id: Uint8Array, body_index: number, now_ms: bigint, expected_fleet_revision: bigint): number;
    /**
     * Opt-in per-fleet edit contract. Callers first commit due work explicitly;
     * an online preview never silently advances authoritative state.
     */
    stage_retarget_xyz(actor_id: Uint8Array, order_id: Uint8Array, fleet_id: Uint8Array, target_x: number, target_y: number, target_z: number, now_ms: bigint, expected_fleet_revision: bigint): number;
    times(): BigUint64Array;
}

export function default_transfer_policy(): BigUint64Array;

export function ephemeris_version(): number;

/**
 * Geometric preview only. Ownership, occupancy and production costs require
 * the authoritative construction command; this function grants none of them.
 */
export function planet_footprint(class_name: string, kind: number, x: number, y: number): Uint32Array;

export function planet_pixel_area_m2(x: number, y: number, radius_m: number): number;

export function planet_surface_distance_m(x1: number, y1: number, x2: number, y2: number, radius_m: number): number;

export function route_arrival_ms(now: bigint, legs: number): bigint;

export function route_arrival_with_policy(now: bigint, legs: number, jump_ms: bigint, cooldown_ms: bigint, configuration_revision: bigint, modifier_revision: bigint): bigint;

export function rule_version(): number;

export function transfer_travel_ms(): bigint;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_planetarymodel_free: (a: number, b: number) => void;
    readonly __wbg_ruleroutes_free: (a: number, b: number) => void;
    readonly __wbg_rulesystem_free: (a: number, b: number) => void;
    readonly default_transfer_policy: () => [number, number];
    readonly ephemeris_version: () => number;
    readonly planet_footprint: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly planet_pixel_area_m2: (a: number, b: number, c: number) => [number, number, number];
    readonly planet_surface_distance_m: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly planetarymodel_new: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly planetarymodel_phase_records: (a: number, b: number) => [number, number, number, number];
    readonly planetarymodel_plan_route: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number, number];
    readonly planetarymodel_route_is_clear: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly planetarymodel_sample: (a: number, b: number) => [number, number, number, number];
    readonly route_arrival_ms: (a: bigint, b: number) => [bigint, number, number];
    readonly route_arrival_with_policy: (a: bigint, b: number, c: bigint, d: bigint, e: bigint, f: bigint) => [bigint, number, number];
    readonly rule_version: () => number;
    readonly ruleroutes_new: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly ruleroutes_select: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly rulesystem_commit: (a: number) => number;
    readonly rulesystem_committed_time_ms: (a: number) => bigint;
    readonly rulesystem_discard: (a: number) => void;
    readonly rulesystem_identities: (a: number) => [number, number];
    readonly rulesystem_jump_gate: (a: number, b: number, c: number) => [number, number, number, number];
    readonly rulesystem_new: (a: number, b: number, c: bigint, d: bigint, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => [number, number, number];
    readonly rulesystem_next_deadline_ms: (a: number) => [number, bigint];
    readonly rulesystem_orbit_bytes: (a: number) => [number, number];
    readonly rulesystem_orbit_offsets: (a: number) => [number, number];
    readonly rulesystem_path_offsets: (a: number) => [number, number];
    readonly rulesystem_path_points: (a: number) => [number, number];
    readonly rulesystem_pending_events: (a: number) => [number, number];
    readonly rulesystem_pending_identities: (a: number) => [number, number];
    readonly rulesystem_pending_meta: (a: number) => [number, number];
    readonly rulesystem_pending_orbit_bytes: (a: number) => [number, number];
    readonly rulesystem_pending_orbit_offsets: (a: number) => [number, number];
    readonly rulesystem_pending_order_ids: (a: number) => [number, number];
    readonly rulesystem_pending_path_offsets: (a: number) => [number, number];
    readonly rulesystem_pending_path_points: (a: number) => [number, number];
    readonly rulesystem_pending_positions: (a: number) => [number, number];
    readonly rulesystem_pending_revisions: (a: number) => [number, number];
    readonly rulesystem_pending_times: (a: number) => [number, number];
    readonly rulesystem_pending_transfer_ids: (a: number) => [number, number];
    readonly rulesystem_pending_transfer_meta: (a: number) => [number, number];
    readonly rulesystem_pending_transfer_positions: (a: number) => [number, number];
    readonly rulesystem_pending_transfer_timing: (a: number) => [number, number];
    readonly rulesystem_positions: (a: number) => [number, number];
    readonly rulesystem_revision: (a: number) => bigint;
    readonly rulesystem_revisions: (a: number) => [number, number];
    readonly rulesystem_set_movement_context: (a: number, b: number, c: number, d: number, e: bigint, f: number, g: number, h: number, i: number) => number;
    readonly rulesystem_set_movement_paths: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly rulesystem_set_orbits: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly rulesystem_stage_due: (a: number, b: bigint, c: number) => number;
    readonly rulesystem_stage_export: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: bigint, k: bigint, l: number, m: bigint) => number;
    readonly rulesystem_stage_export_with_policy: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: bigint, l: bigint, m: bigint, n: bigint, o: bigint, p: number, q: bigint) => number;
    readonly rulesystem_stage_export_xyz: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: bigint, l: bigint, m: number, n: bigint) => number;
    readonly rulesystem_stage_move: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: bigint, k: number, l: bigint) => number;
    readonly rulesystem_stage_move_xyz: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: bigint, l: number, m: bigint) => number;
    readonly rulesystem_stage_orbit: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: bigint, j: bigint) => number;
    readonly rulesystem_stage_retarget_xyz: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: bigint, l: bigint) => number;
    readonly rulesystem_times: (a: number) => [number, number];
    readonly transfer_travel_ms: () => bigint;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
