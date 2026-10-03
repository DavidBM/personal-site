/** Per-device render correction. Identity in standalone viewers and free camera.
 * The owner dispatches one invocation after presentation; draw passes only read.
 */
export const SCENE_CAMERA_WGSL = /* wgsl */ `
struct SceneCameraFrame { clip: mat4x4<f32>, world: mat4x4<f32>, relativeViewProj:mat4x4<f32>, cameraHigh:vec4<f32>, cameraLow:vec4<f32> }
@group(2) @binding(0) var<uniform> sceneCamera: SceneCameraFrame;
fn sceneCameraEye(fallback:vec3<f32>)->vec3<f32>{
  return select(fallback,sceneCamera.cameraHigh.xyz/560.0+sceneCamera.cameraLow.xyz,sceneCamera.cameraHigh.w>0.0);
}
fn sceneCameraAxis(axis:vec3<f32>)->vec3<f32>{
  let inverseRotation=mat3x3<f32>(sceneCamera.world[0].xyz,sceneCamera.world[1].xyz,sceneCamera.world[2].xyz);
  return transpose(inverseRotation)*axis;
}
`;
const frames = new WeakMap();
const groups = new WeakMap();
export function sceneCameraBuffer(device) {
    let buffer = frames.get(device);
    if (!buffer) {
        buffer = device.createBuffer({ label: 'scene-camera-frame', size: 224,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        const identity = new Float32Array(32);
        for (let m = 0; m < 2; m++)
            for (let i = 0; i < 4; i++)
                identity[m * 16 + i * 5] = 1;
        device.queue.writeBuffer(buffer, 0, identity);
        frames.set(device, buffer);
    }
    return buffer;
}
/** Specialize only map-layer shaders. Exported standalone shaders stay unchanged. */
export function sceneCameraShader(source, matrices) {
    for (const matrix of matrices)
        source = source.split(`${matrix} *`).join(`sceneCamera.clip * ${matrix} *`).split(`${matrix}*`).join(`sceneCamera.clip * ${matrix}*`);
    // Solar billboards and their depth rays must use the corrected camera too.
    source = source.split('frame.eyePos.xyz').join('sceneCameraEye(frame.eyePos.xyz)')
        .split('body.camRight.xyz').join('sceneCameraAxis(body.camRight.xyz)')
        .split('body.camUp.xyz').join('sceneCameraAxis(body.camUp.xyz)');
    return SCENE_CAMERA_WGSL + source;
}
export function bindSceneCamera(device, pass, pipeline) {
    let pair = groups.get(pipeline);
    if (!pair) {
        pair = [device.createBindGroup({ layout: pipeline.getBindGroupLayout(1), entries: [] }),
            device.createBindGroup({ layout: pipeline.getBindGroupLayout(2), entries: [{ binding: 0, resource: { buffer: sceneCameraBuffer(device) } }] })];
        groups.set(pipeline, pair);
    }
    pass.setBindGroup(1, pair[0]);
    pass.setBindGroup(2, pair[1]);
}
const identityFrame = new Float32Array(56);
for (let matrix = 0; matrix < 3; matrix++)
    for (let i = 0; i < 4; i++)
        identityFrame[matrix * 16 + i * 5] = 1;
export function resetSceneCamera(device, viewProj, eye) {
    identityFrame.fill(0, 48);
    if (viewProj && eye) {
        identityFrame.set(viewProj, 32);
        const x = Math.floor(eye.x * 560), y = Math.floor(eye.y * 560), z = Math.floor(eye.z * 560);
        identityFrame.set([x, y, z, 2, eye.x - x / 560, eye.y - y / 560, eye.z - z / 560, 0], 48);
    }
    device.queue.writeBuffer(sceneCameraBuffer(device), 0, identityFrame);
}
/** Mesh offsets and lighting remain small even when the CPU camera sample lags. */
export function sceneHullShader(source) {
    return sceneCameraShader(source, [])
        .replace('let rel = pose.centerRel + worldOff;', 'var rel = pose.centerRel + worldOff;')
        .replace('out.clip = u.viewProj * vec4<f32>(rel, 1.0);', `
      if(sceneCamera.cameraHigh.w>0.0 && (ship.targetKind & 4096u)!=0u){
        let center=(vec3<f32>(ship.orbitPhase,ship.orbitOmega,ship.omegaMax)-sceneCamera.cameraHigh.xyz)/560.0
          +(vec3<f32>(ship.accel,ship.cruiseV,ship.orbitR)/560.0-sceneCamera.cameraLow.xyz);
        if((ship.targetKind & 8192u)!=0u && u.pixelGain>0.0){
          let depth=abs((sceneCamera.relativeViewProj*vec4<f32>(center,1.0)).w);
          let pixels=u.pixelGain*pose.hullScale/max(depth,1e-9);
          worldOff*=max(1.0,1.5/max(pixels,1e-9));
        }
        rel=center+worldOff;
        out.clip=sceneCamera.relativeViewProj*vec4<f32>(rel,1.0);
      }else{out.clip=sceneCamera.clip*u.viewProj*vec4<f32>(rel,1.0);}`)
        .replace('let eyeRel = u.eyeWorld - u.origin;', 'let eyeRel = select(u.eyeWorld-u.origin,vec3<f32>(0.0),sceneCamera.cameraHigh.w>0.0);');
}
/** Selection corners read the same split pose and camera as the hull. */
export function sceneSelectionShader(source) {
    return SCENE_CAMERA_WGSL + source.replace('let clip=u.vp*vec4<f32>(s.p.xyz,1);', `
    var clip=sceneCamera.clip*u.vp*vec4<f32>(s.p.xyz,1);
    if(sceneCamera.cameraHigh.w>0.0 && (flags&4096u)!=0u){
      // Draw ABI words 17/21/22 = anchor, 18/19/20 = local; flags share word 16.
      let anchor=vec3<f32>(bitcast<f32>(s.control.y),s.orbit.y,s.orbit.z);
      let local=vec3<f32>(bitcast<f32>(s.control.z),bitcast<f32>(s.control.w),s.orbit.x);
      let center=(anchor-sceneCamera.cameraHigh.xyz)/560.0
        +(local/560.0-sceneCamera.cameraLow.xyz);
      clip=sceneCamera.relativeViewProj*vec4<f32>(center,1.0);
    }`);
}
/** Trail expansion and ribbon joins use the same camera-relative frame as hulls. */
export function sceneTrailExpandShader(source) {
    return SCENE_CAMERA_WGSL + source
        .replace('let camera=floor(u.origin*560.0);', `if(sceneCamera.cameraHigh.w>0.0){
      return (anchor-sceneCamera.cameraHigh.xyz)/560.0+(local/560.0-sceneCamera.cameraLow.xyz);
    }
  let camera=floor(u.origin*560.0);`)
        .replace('fn expandedTrailSample(s:', 'fn legacyExpandedTrailSample(s:')
        .replace('fn trailEyePlane() -> vec4<f32> {', `fn trailEyePlane() -> vec4<f32> {
  if(sceneCamera.cameraHigh.w>0.0){return transpose(sceneCamera.relativeViewProj)[3];}`)
        .replace('fn trailClipPlane(i:u32) -> vec4<f32> {', `fn trailClipPlane(i:u32) -> vec4<f32> {
  if(sceneCamera.cameraHigh.w>0.0){
    let rows=transpose(sceneCamera.relativeViewProj);
    var plane=rows[2];
    if(i<4u){plane=rows[3]+select(rows[i/2u],-rows[i/2u],(i&1u)!=0u);}
    if(i==5u){plane=rows[3]-rows[2];}
    return plane/max(length(plane.xyz),1e-20);
  }`) + `
fn expandedTrailSample(s:vec4<f32>,baseY:f32,worldOff:vec3<f32>,pathEnd:vec3<f32>,stableScene:bool)->vec3<f32>{
  let point=legacyExpandedTrailSample(s,baseY,worldOff,pathEnd,stableScene);
  if(sceneCamera.cameraHigh.w>0.0){return point+u.origin-sceneCamera.cameraHigh.xyz/560.0-sceneCamera.cameraLow.xyz;}
  return point;
}`;
}
export function sceneTrailDrawShader(source) {
    return SCENE_CAMERA_WGSL + source
        .replace('u.modelView * vec4<f32>(input.instanceStart - u.origin, 1.0)', 'sceneTrailView(input.instanceStart)')
        .replace('u.modelView * vec4<f32>(input.instanceEnd - u.origin, 1.0)', 'sceneTrailView(input.instanceEnd)')
        .replace('u.modelView * vec4<f32>(select(input.instanceNext, input.instancePrev, atStart) - u.origin, 1.0)', 'sceneTrailView(select(input.instanceNext,input.instancePrev,atStart))')
        .replace('out.clip = clip;', 'out.clip=clip; if(sceneCamera.cameraHigh.w==0.0){out.clip=sceneCamera.clip*out.clip;}')
        .replace('out.clip = u.projection * vec4<f32>(viewPos, 1.0);', `out.clip=u.projection*vec4<f32>(viewPos,1.0);
      if(sceneCamera.cameraHigh.w==0.0){out.clip=sceneCamera.clip*out.clip;}`) + `
fn sceneTrailView(point:vec3<f32>)->vec4<f32>{
  if(sceneCamera.cameraHigh.w>0.0){
    let r=mat3x3<f32>(u.modelView[0].xyz,u.modelView[1].xyz,u.modelView[2].xyz);
    let d=mat3x3<f32>(sceneCamera.world[0].xyz,sceneCamera.world[1].xyz,sceneCamera.world[2].xyz);
    return vec4<f32>(r*d*point,1.0);
  }
  return u.modelView*vec4<f32>(point-u.origin,1.0);
}`;
}
//# sourceMappingURL=scene-camera.js.map