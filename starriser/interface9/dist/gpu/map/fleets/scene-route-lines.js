import { sceneCameraShader, bindSceneCamera } from '../../scene-camera.js';
import { MAP_MSAA_SAMPLES } from '../../map-msaa.js';
import { ROUTE_CORRIDOR_SHADER } from './scene-route-corridor.wgsl.js';
export const ROUTE_SHADER = /* wgsl */ `
override analyticEdges:bool=false;
struct U { vp:mat4x4<f32>, selected:f32, hovered:f32, phase:f32, allPaths:f32, viewport:vec4<f32> }
@group(0) @binding(0) var<uniform> u:U;
struct V {
  @builtin(position) p:vec4<f32>,
  @location(0) color:vec4<f32>,
  @location(1) distance:f32,
  @location(3) @interpolate(linear) edge:f32,
  @location(2) @interpolate(flat) selected:u32,
}
fn screen(p:vec4<f32>)->vec2<f32>{return p.xy/max(p.w,.000001)*u.viewport.xy;}
fn safeUnit(v:vec2<f32>)->vec2<f32>{return v/max(length(v),.000001);}
fn edgeNormal(a:vec2<f32>,b:vec2<f32>)->vec2<f32>{let d=safeUnit(b-a);return vec2<f32>(-d.y,d.x);}
fn joinOffset(previous:vec4<f32>,p:vec4<f32>,next:vec4<f32>,normal:vec2<f32>)->vec2<f32>{
  if(previous.w<=0.0 || next.w<=0.0){return normal;}
  let a=screen(previous);let b=screen(p);let c=screen(next);
  if(length(b-a)<.0001 || length(c-b)<.0001){return normal;}
  let miter=safeUnit(edgeNormal(a,b)+edgeNormal(b,c));
  return miter/min(1.0,max(.4,abs(dot(miter,normal))));
}
@vertex fn vs(@builtin(vertex_index) i:u32,@location(0) previous:vec4<f32>,
  @location(1) start:vec4<f32>,@location(2) end:vec4<f32>,@location(3) next:vec4<f32>,@location(4) color:vec4<f32>)->V {
  let endpoint=array<u32,6>(0u,1u,0u,0u,1u,1u)[i];
  let side=array<f32,6>(-1.0,-1.0,1.0,1.0,-1.0,1.0)[i];
  var a=u.vp*vec4<f32>(start.xyz,1.0);var b=u.vp*vec4<f32>(end.xyz,1.0);
  let da=min(a.w-a.z,a.w-.000001);let db=min(b.w-b.z,b.w-.000001);
  let invisible=(da<0.0 && db<0.0) || (u.allPaths<.5 && start.w!=u.selected && start.w!=u.hovered);
  var begin=previous.w;var finish=end.w;
  if(da<0.0 && db>=0.0){let t=da/(da-db);a=mix(a,b,t);begin=mix(begin,finish,t);}
  if(db<0.0 && da>=0.0){let t=db/(db-da);b=mix(b,a,t);finish=mix(finish,begin,t);}
  let normal=edgeNormal(screen(a),screen(b));
  let selected=start.w==u.selected;
  let fringe=1.0/max(u.viewport.z,1.0);
  let width=2.0+select(0.0,fringe,analyticEdges);
  var p=select(a,b,endpoint==1u);
  var offset=normal;
  if(endpoint==0u && da>=0.0){offset=joinOffset(u.vp*vec4<f32>(previous.xyz,1.0),a,b,normal);}
  if(endpoint==1u && db>=0.0){offset=joinOffset(a,b,u.vp*vec4<f32>(next.xyz,1.0),normal);}
  // NDC is twice CSS pixels / viewport, and width/2 is the half-width.
  p=vec4<f32>(p.xy+offset*side*width/u.viewport.xy*p.w,p.zw);
  if(invisible){p=vec4<f32>(2.0,2.0,0.0,1.0);}
  var out:V;out.p=p;out.edge=side*width*.5;
  out.color=vec4<f32>(color.rgb,select(select(.12,.55,start.w==u.hovered),.9,selected));
  out.distance=select(begin,finish,endpoint==1u);out.selected=select(select(0u,2u,color.a>0.0),1u,selected);return out;
}
@fragment fn fs(v:V)->@location(0) vec4<f32> {
  var color=v.color;
  if(v.selected==1u && v.distance>=0.0){
    // Arc length increases toward the destination. Advancing phase moves the
    // highlights forward while the uninterrupted base keeps the path legible.
    let phase=fract(v.distance/.003-u.phase);
    let pulse=1.0-smoothstep(.08,.22,abs(phase-.5));
    color.a=.6+.3*pulse;
  }
  if(analyticEdges){color.a*=clamp((1.0-abs(v.edge))*max(u.viewport.z,1.0)+.5,0.0,1.0);}
  return color;
}
`;
/** One sun-local overlay draw. Geometry changes only when a route changes. */
export class SceneRouteLines {
    constructor(device, format, depth) {
        this.vertexBytes = 128 * 32 * 32;
        this.corridors = new Map();
        this.data = new Float32Array(24);
        this.count = 0;
        this.device = device;
        this.vertices = this.createVertices();
        this.uniform = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        const module = device.createShaderModule({ code: sceneCameraShader(ROUTE_SHADER, ["u.vp"]) });
        this.pipeline = device.createRenderPipeline({
            layout: 'auto',
            vertex: { module, entryPoint: 'vs', constants: { analyticEdges: Number(MAP_MSAA_SAMPLES === 1) }, buffers: [{ arrayStride: 80, stepMode: 'instance', attributes: [0, 1, 2, 3, 4].map(shaderLocation => ({ shaderLocation, offset: shaderLocation * 16, format: 'float32x4' })),
                    }] },
            fragment: { module, entryPoint: 'fs', constants: { analyticEdges: Number(MAP_MSAA_SAMPLES === 1) }, targets: [{ format, blend: {
                            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
                            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
                        } }] },
            primitive: { topology: 'triangle-list' },
            depthStencil: { format: depth, depthWriteEnabled: false, depthCompare: 'always' },
            multisample: { count: MAP_MSAA_SAMPLES },
        });
        this.bind = device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: this.uniform } }] });
        const corridor = device.createShaderModule({ label: 'fleet-route-corridor', code: sceneCameraShader(ROUTE_CORRIDOR_SHADER, ['u.vp']) });
        this.corridorPipeline = device.createRenderPipeline({ label: 'fleet-route-corridor', layout: 'auto',
            vertex: { module: corridor, entryPoint: 'vs', buffers: [{ arrayStride: 80, stepMode: 'instance', attributes: [0, 1, 2, 3, 4].map(shaderLocation => ({ shaderLocation, offset: shaderLocation * 16, format: 'float32x4' })) }] },
            fragment: { module: corridor, entryPoint: 'fs', targets: [{ format, blend: {
                            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
                        } }] },
            primitive: { topology: 'triangle-list' }, depthStencil: { format: depth, depthWriteEnabled: false, depthCompare: 'always' },
            multisample: { count: MAP_MSAA_SAMPLES } });
        this.corridorBind = device.createBindGroup({ layout: this.corridorPipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: this.uniform } }] });
    }
    createVertices() {
        return this.device.createBuffer({ label: 'fleet-route-lines', size: this.vertexBytes,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    }
    update(routes) {
        const values = [];
        this.corridors.clear();
        for (const row of routes) {
            const first = values.length / 20;
            this.routeSegments(values, row);
            if ((row.corridorRadius ?? 0) > 0 && values.length / 20 > first)
                this.corridors.set(row.slot, { first, count: values.length / 20 - first });
            if (row.points.length === 0)
                this.destinationMark(values, row);
            if (row.waypoints?.length)
                this.destinationMark(values, { ...row, destination: row.waypoints[0], status: 'waypoint' });
        }
        this.count = values.length / 20;
        if (!this.count)
            return;
        const packed = new Float32Array(values);
        if (packed.byteLength > this.vertexBytes) {
            while (this.vertexBytes < packed.byteLength)
                this.vertexBytes *= 2;
            const old = this.vertices;
            this.vertices = this.createVertices();
            old.destroy();
        }
        this.device.queue.writeBuffer(this.vertices, 0, packed);
    }
    routeSegments(values, row) {
        const points = row.displayPoints ?? row.points; // Identical samples to the fleet navigation cache.
        let distance = 0;
        for (let i = 1; i < points.length; i++) {
            const start = points[i - 1], end = points[i];
            const before = distance;
            distance += Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
            values.push(...(points[i - 2] ?? start), before, ...start, row.slot, ...end, distance, ...(points[i + 1] ?? end), row.corridorRadius ?? 0, ...row.color, row.guide ? 1 : 0);
        }
    }
    destinationMark(values, row) {
        const [x = 0, y = 0, z = 0] = row.destination, r = .0005;
        const color = row.status === 'waypoint' ? [.3, 1, 1] : row.status === 'pending' ? [.6, .7, .8] : [1, .35, .22];
        // Negative distance marks status glyphs, which must not animate as route segments.
        for (const [a, b] of [[[x - r, y, z], [x + r, y, z]], [[x, y, z - r], [x, y, z + r]]])
            values.push(...a, -1, ...a, row.slot, ...b, -1, ...b, 0, ...color, 0);
    }
    encode(pass, vp, selected, hovered, timeSec = 0, width = 1, height = 1, allPaths = true, pixelRatio = 1) {
        if (!this.count)
            return;
        this.data.set(vp, 0);
        this.data[16] = selected;
        this.data[17] = hovered;
        // A complete pulse period is exactly 1.25 seconds; wrapping before f32 upload
        // preserves smooth phase even after long sessions, and frozen simulation time pauses it.
        this.data[18] = Number.isFinite(timeSec) ? ((timeSec % 1.25) + 1.25) % 1.25 / 1.25 : 0;
        this.data[19] = Number(allPaths);
        this.data[20] = Math.max(1, width);
        this.data[21] = Math.max(1, height);
        this.data[22] = Math.max(1, pixelRatio);
        this.device.queue.writeBuffer(this.uniform, 0, this.data);
        const corridor = this.corridors.get(selected);
        if (corridor) {
            pass.setPipeline(this.corridorPipeline);
            bindSceneCamera(this.device, pass, this.corridorPipeline);
            pass.setBindGroup(0, this.corridorBind);
            pass.setVertexBuffer(0, this.vertices);
            pass.draw(12 * 6, corridor.count, 0, corridor.first);
        }
        pass.setPipeline(this.pipeline);
        bindSceneCamera(this.device, pass, this.pipeline);
        pass.setBindGroup(0, this.bind);
        pass.setVertexBuffer(0, this.vertices);
        pass.draw(6, this.count);
    }
    destroy() { this.vertices.destroy(); this.uniform.destroy(); }
}
//# sourceMappingURL=scene-route-lines.js.map