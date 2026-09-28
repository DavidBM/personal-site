import {MAX_SHIP_CAPACITY} from './ship-capacity.mjs';

// Fixed scene reserve: physical slots may grow/repack without moving this table.
// Advice is disposable and serial-validated; it is not another pose owner.
export const PILOT_ADVICE_BYTES = 80;
export const pilotAdviceBytes = enabled => enabled ? MAX_SHIP_CAPACITY * PILOT_ADVICE_BYTES : 0;
export const PILOT_ADVICE_DECL = `struct PilotAdvice { state:vec4<u32>, stamp:vec4<f32>, correction:vec4<f32>, spacing:vec4<f32>, broad:vec4<f32> }`;
export const PILOT_ADVICE_FIELD = `,pilotAdvice:array<PilotAdvice,${MAX_SHIP_CAPACITY}>`;
