import {MAX_SHIP_CAPACITY} from './ship-capacity.mjs';

// Budget-fixed reserve: physical slots grow/repack without moving this table.
// Advice is disposable and serial-validated; it is not another pose owner.
export const PILOT_ADVICE_BYTES = 128;
export const pilotAdviceBytes = (enabled, capacity = MAX_SHIP_CAPACITY, fleets=0, bodies=0) => enabled ? capacity * PILOT_ADVICE_BYTES + 32 + Math.ceil(capacity/4)*16 + fleets*64 + bodies*32 : 0;
export const PILOT_ADVICE_DECL = `struct PilotAdvice { state:vec4<u32>, stamp:vec4<f32>, correction:vec4<f32>, spacing:vec4<f32>, broad:vec4<f32>, contacts:vec4<u32>, serials:vec4<u32>, schedule:vec4<u32> }
struct FleetPilotCache {limits:vec4<f32>,tag:vec4<u32>,capture:vec4<f32>,reserved:vec4<f32>}
struct PilotBody {position:vec4<f32>,velocity:vec4<f32>} `;
export const pilotAdviceField = (capacity = MAX_SHIP_CAPACITY, fleets=0,bodies=0) => `,pilotAdvice:array<PilotAdvice,${capacity}>,pilotDispatch:array<atomic<u32>,8>,pilotWork:array<u32,${Math.ceil(capacity/4)*4}>,pilotFleetCache:array<FleetPilotCache,${fleets}>,pilotBodies:array<PilotBody,${bodies}>`;
