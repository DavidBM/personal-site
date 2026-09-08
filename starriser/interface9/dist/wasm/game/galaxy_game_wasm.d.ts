/* tslint:disable */
/* eslint-disable */

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
     * Columns per ship: identities = ship/owner/order IDs (48 bytes; zero order
     * means idle); positions = x,z,targetX,targetZ; times = departure,arrival.
     * Revisions are u64, exposed as BigUint64Array. Rows restore in any order.
     */
    constructor(system_id: Uint8Array, revision: bigint, committed_time_ms: bigint, identities: Uint8Array, revisions: BigUint64Array, positions: Float64Array, times: BigUint64Array);
    next_deadline_ms(): bigint | undefined;
    /**
     * Event row = kind (1 started, 2 arrived), departure (0 for arrival), arrival.
     */
    pending_events(): BigUint64Array;
    pending_identities(): Uint8Array;
    /**
     * Empty means no proposal; otherwise base revision, new revision, server ms.
     */
    pending_meta(): BigUint64Array;
    /**
     * Event row = original order ID (16 bytes); times are in pending_events.
     */
    pending_order_ids(): Uint8Array;
    pending_positions(): Float64Array;
    pending_revisions(): BigUint64Array;
    pending_times(): BigUint64Array;
    /**
     * Source/destination/ship/owner full IDs, 64 bytes, or empty for no export.
     */
    pending_transfer_ids(): Uint8Array;
    /**
     * Base/new system revision, command time, departure, arrival, ship revision.
     */
    pending_transfer_meta(): BigUint64Array;
    /**
     * Source x,z and destination x,z in each system's sun-local scene units.
     */
    pending_transfer_positions(): Float64Array;
    positions(): Float64Array;
    revision(): bigint;
    revisions(): BigUint64Array;
    stage_due(now_ms: bigint, limit: number): number;
    /**
     * Stages the same sealed export as native. Route permission and receipt
     * dedup belong to the host; online preview callers discard this proposal.
     */
    stage_export(actor_id: Uint8Array, ship_id: Uint8Array, destination_id: Uint8Array, target_x: number, target_z: number, now_ms: bigint, arrival_ms: bigint, expected_revision?: bigint | null): number;
    stage_move(actor_id: Uint8Array, order_id: Uint8Array, ship_id: Uint8Array, target_x: number, target_z: number, now_ms: bigint, expected_revision?: bigint | null): number;
    times(): BigUint64Array;
}

export function route_arrival_ms(now: bigint, legs: number): bigint;

export function rule_version(): number;

export function transfer_travel_ms(): bigint;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_ruleroutes_free: (a: number, b: number) => void;
    readonly __wbg_rulesystem_free: (a: number, b: number) => void;
    readonly route_arrival_ms: (a: bigint, b: number) => [bigint, number, number];
    readonly rule_version: () => number;
    readonly ruleroutes_new: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly ruleroutes_select: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly rulesystem_commit: (a: number) => number;
    readonly rulesystem_committed_time_ms: (a: number) => bigint;
    readonly rulesystem_discard: (a: number) => void;
    readonly rulesystem_identities: (a: number) => [number, number];
    readonly rulesystem_new: (a: number, b: number, c: bigint, d: bigint, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => [number, number, number];
    readonly rulesystem_next_deadline_ms: (a: number) => [number, bigint];
    readonly rulesystem_pending_events: (a: number) => [number, number];
    readonly rulesystem_pending_identities: (a: number) => [number, number];
    readonly rulesystem_pending_meta: (a: number) => [number, number];
    readonly rulesystem_pending_order_ids: (a: number) => [number, number];
    readonly rulesystem_pending_positions: (a: number) => [number, number];
    readonly rulesystem_pending_revisions: (a: number) => [number, number];
    readonly rulesystem_pending_times: (a: number) => [number, number];
    readonly rulesystem_pending_transfer_ids: (a: number) => [number, number];
    readonly rulesystem_pending_transfer_meta: (a: number) => [number, number];
    readonly rulesystem_pending_transfer_positions: (a: number) => [number, number];
    readonly rulesystem_positions: (a: number) => [number, number];
    readonly rulesystem_revision: (a: number) => bigint;
    readonly rulesystem_revisions: (a: number) => [number, number];
    readonly rulesystem_stage_due: (a: number, b: bigint, c: number) => number;
    readonly rulesystem_stage_export: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: bigint, k: bigint, l: number, m: bigint) => number;
    readonly rulesystem_stage_move: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: bigint, k: number, l: bigint) => number;
    readonly rulesystem_times: (a: number) => [number, number];
    readonly transfer_travel_ms: () => bigint;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
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
