// Scene-only tagged word: ordinal bits 0–7 + 14–23, type 8–12, tag 13,
// group 24–31. Legacy population words never set bit 13 and keep their ABI.
// Neither storage slots nor this packed word are persistent follow handles.

export const SCENE_ORDINAL_CAPACITY = 262144;
export const SCENE_ORDINAL_MASK = SCENE_ORDINAL_CAPACITY - 1;
export const SCENE_IDENTITY_TAG = 8192;

export function packSceneIdentity(index, type, groupId) {
  const ordinal = (index | 0) & SCENE_ORDINAL_MASK;
  return (
    (ordinal & 255) |
    ((type & 31) << 8) |
    SCENE_IDENTITY_TAG | ((ordinal >> 8) << 14) |
    ((groupId & 255) << 24)
  ) >>> 0;
}

export function sceneOrdinalOf(identity) {
  const id = identity >>> 0;
  return (id & 255) | ((id & SCENE_IDENTITY_TAG ? (id >>> 14) & 1023 : (id >>> 13) & 31) << 8);
}

export function sceneGroupOf(identity) { return (identity >>> 0) >>> 24; }

export const SCENE_IDENTITY_WGSL = `
fn sceneIdentity(id:u32)->bool {return (id&8192u)!=0u;}
fn sceneOrdinal(id:u32)->u32 {return (id&255u)|(select((id>>13u)&31u,(id>>14u)&1023u,sceneIdentity(id))<<8u);}
fn identityGroup(id:u32)->u32 {return select(id>>18u,id>>24u,sceneIdentity(id));}
`;

export function sceneTypeOf(identity) {
  return (identity >>> 8) & 31;
}
