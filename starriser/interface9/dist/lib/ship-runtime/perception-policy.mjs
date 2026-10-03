/** Periods count physical simulation ticks; render frames never advance this clock. */
export const PERCEPTION_POLICY_WGSL = /* wgsl */ `
fn perceptionPeriod(pixels:f32, previous:u32)->u32 {
  // Direct jumps are intentional. Fresh owners use the entry thresholds.
  if(pixels>=65.0 || (previous==1u && pixels>=55.0)){return 1u;}
  if(pixels>=6.0 || ((previous==1u || previous==2u) && pixels>=3.0)){return 2u;}
  return 8u;
}
`;
