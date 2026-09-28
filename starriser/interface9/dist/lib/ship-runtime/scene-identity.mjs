// Scene identity word. Type stays in bits 8–12. The fleet-local ordinal is
// 13 bits: the low byte, then bits 13–17. Group id stays at bit 18.
// Population ships still use the low 8 bits as their live-mask ordinal.

export const SCENE_ORDINAL_MASK = 8191;

export function packSceneIdentity(index, type, groupId) {
  const ordinal = (index | 0) & SCENE_ORDINAL_MASK;
  return (
    (ordinal & 255) |
    ((type & 31) << 8) |
    ((ordinal >> 8) << 13) |
    ((groupId >>> 0) << 18)
  ) >>> 0;
}

export function sceneOrdinalOf(identity) {
  const id = identity >>> 0;
  return (id & 255) | (((id >>> 13) & 31) << 8);
}

export function sceneTypeOf(identity) {
  return (identity >>> 8) & 31;
}
