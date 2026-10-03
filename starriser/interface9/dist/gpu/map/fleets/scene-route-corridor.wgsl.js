/** Small overlay only; shares the accepted route segment buffer with its line. */
export const ROUTE_CORRIDOR_SHADER = /* wgsl */ `
struct U { vp:mat4x4<f32>, selected:f32, hovered:f32, phase:f32, allPaths:f32, viewport:vec4<f32> }
@group(0) @binding(0) var<uniform> u:U;
struct V { @builtin(position) p:vec4<f32>, @location(0) color:vec3<f32>, @location(1) edge:vec2<f32> }
fn unit(v:vec3<f32>)->vec3<f32>{return v/max(length(v),1e-12);}
@vertex fn vs(@builtin(vertex_index) i:u32, @location(0) previous:vec4<f32>,
 @location(1) start:vec4<f32>, @location(2) end:vec4<f32>, @location(3) next:vec4<f32>, @location(4) color:vec4<f32>)->V {
  let corner=i%6u;
  let atEnd=array<u32,6>(0u,1u,0u,0u,1u,1u)[corner];
  let side=array<u32,6>(0u,0u,1u,1u,0u,1u)[corner];
  let angle=f32(i/6u+side)*6.28318530718/12.0;
  let point=select(start.xyz,end.xyz,atEnd==1u);
  let direction=unit(end.xyz-start.xyz);
  let a=unit(start.xyz-previous.xyz)+direction;
  let b=unit(next.xyz-end.xyz)+direction;
  let tangent=unit(select(a,b,atEnd==1u));
  let up=select(vec3<f32>(0,1,0),vec3<f32>(1,0,0),abs(tangent.y)>.9);
  let right=unit(cross(tangent,up));let normal=cross(right,tangent);
  let offset=(right*cos(angle)+normal*sin(angle))*next.w;
  var out:V;out.p=u.vp*vec4<f32>(point+offset,1);
  out.color=color.rgb;out.edge=vec2<f32>(f32(side),f32(atEnd));return out;
}
@fragment fn fs(v:V)->@location(0) vec4<f32>{
  // A faint skin and fine longitudinal ribs read as a volume from any camera.
  let edge=min(v.edge.x,1.0-v.edge.x)/max(fwidth(v.edge.x),.0001);
  return vec4<f32>(v.color,.035+.11*(1.0-smoothstep(0.0,1.0,edge)));
}
`;
//# sourceMappingURL=scene-route-corridor.wgsl.js.map