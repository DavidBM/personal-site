import { FLEET_TRAILS_WGSL } from './fleet-trails.wgsl.js';
import { GLOW_DEPTH_WGSL } from './glow-depth.wgsl.js';
/** Complementary emission split; same atlas, tint, endpoints and age as baseline. */
export const SPLIT_TRAIL_WGSL = GLOW_DEPTH_WGSL + '\noverride glowMode:u32=1u;\n' + FLEET_TRAILS_WGSL
    .replace('  out.vThin = 0u;', `  if(glowMode==2u&&input.instanceAlphaStart<0.0){out.clip=vec4<f32>(2.0,2.0,0.0,1.0);return out;}
  out.vThin = 0u;`)
    .replace('  // Strategic 2D (screen widthMode)', `
  // At depth discontinuities keep the complete effect in the full-res pass.
  // Else its narrow core + complementary broad glow sum to baseline emission.
  let fullPixel=vec2<i32>(input.clip.xy*select(1.0,2.0,glowMode==2u));
  let depths=blockRange(fullPixel);
  let edge=blockEdge(depths);
  let core=1.0-smoothstep(.06,.12,abs(vTex-.5));
  var splitWeight=select(core,1.0,edge);
  if(glowMode==2u){
    if(edge||u.widthMode<.5||input.clip.z<depths.y){discard;}
    splitWeight=1.0-core;
  }
  if(splitWeight<=.001&&u.widthMode>=.5){discard;}
  // Strategic 2D (screen widthMode)`)
    .replace('return vec4<f32>(rgb * alpha, alpha);', 'return vec4<f32>(rgb * alpha * splitWeight, alpha * splitWeight);');
//# sourceMappingURL=trail-glow.wgsl.js.map