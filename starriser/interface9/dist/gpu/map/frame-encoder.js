import { HalfGlow } from './half-glow.js';
import { SelectiveMsaa } from './selective-msaa.js';
import { MAP_MSAA_SAMPLES, MAP_SELECTIVE_MSAA, MAP_HALF_GLOW } from '../map-msaa.js';
import { resetSceneCamera } from '../scene-camera.js';
import { WarpEffect } from './warp-effect.js';
export function createMapFrameEncoder(ports) {
    const { bootstrap, surface, attachments, galaxy, fleets, solar, schematics, overlay } = ports;
    const warp = new WarpEffect(bootstrap, ports.coordinates);
    const selective = MAP_SELECTIVE_MSAA ? new SelectiveMsaa(bootstrap) : null;
    const glow = MAP_HALF_GLOW ? new HalfGlow(bootstrap) : null;
    let lastResolveHadDepth = false;
    function createEncoder(label, profiler) {
        const descriptor = { label };
        return profiler ? profiler.createEncoder(bootstrap.device, descriptor) : bootstrap.device.createCommandEncoder(descriptor);
    }
    function submit(encoder, profiler) {
        bootstrap.device.queue.submit([profiler ? profiler.finish(encoder) : encoder.finish()]);
    }
    function resolveTarget() {
        const texture = attachments.resolveReadback ? null : bootstrap.context.getCurrentTexture();
        attachments.ensureMsaaColor(texture?.width ?? surface.width, texture?.height ?? surface.height);
        if (attachments.resolveReadback) {
            attachments.ensureResolveColor(attachments.msaaW, attachments.msaaH);
            return attachments.resolveColorView;
        }
        return texture.createView();
    }
    function encodeColor(encoder, frame, target) {
        const pass = encoder.beginRenderPass({ label: "map-color", colorAttachments: [{
                    view: MAP_MSAA_SAMPLES === 1 ? target : attachments.msaaColorView, clearValue: bootstrap.clearColor, loadOp: "clear", storeOp: "store",
                }] });
        galaxy.encode(pass, frame);
        schematics.encodeSceneSchematicsViewRel(pass);
        solar.encodeColor(pass);
        // Cluster survey totals replace individual strategic fleet triangles.
        overlay.encode(pass, surface.width, surface.height, ports.coordinates);
        pass.end();
    }
    function encodeResolve(encoder, frame, target, preserveDepth) {
        const splitGlow = !!(glow && frame.sceneOpen && frame.hullsOn);
        const wantDepth = frame.sceneOpen || frame.hullsOn || frame.bandC;
        lastResolveHadDepth = !!(wantDepth && attachments.msaaDepthView);
        const depth = lastResolveHadDepth ? {
            view: attachments.msaaDepthView, depthClearValue: attachments.depth.clearValue, depthLoadOp: "clear", depthStoreOp: preserveDepth ? "store" : "discard",
        } : undefined;
        const pass = encoder.beginRenderPass({ label: "map-depth-resolve", colorAttachments: [{
                    view: MAP_MSAA_SAMPLES === 1 ? target : attachments.msaaColorView,
                    resolveTarget: MAP_MSAA_SAMPLES === 1 || splitGlow ? undefined : target, loadOp: "load",
                    storeOp: MAP_MSAA_SAMPLES === 1 || splitGlow ? "store" : "discard",
                }], depthStencilAttachment: depth });
        if (lastResolveHadDepth)
            solar.encodeDepth(pass);
        if (frame.sceneOpen) {
            fleets.encodeShips(pass, frame);
            fleets.encodeStrategicTrails(pass, frame);
        }
        fleets.encodeModels(pass, frame, !splitGlow);
        fleets.encodeDebug?.(pass, frame);
        if (lastResolveHadDepth && !selective)
            solar.encodeAtmosphere(pass);
        pass.end();
        if (splitGlow) {
            selective.resolveOpaqueDepth(encoder);
            const core = encoder.beginRenderPass({ label: 'trail-cores-msaa', colorAttachments: [{ view: attachments.msaaColorView, resolveTarget: target, loadOp: 'load', storeOp: 'discard' }],
                depthStencilAttachment: { view: attachments.msaaDepthView, depthReadOnly: true } });
            fleets.encodeHullTrails(core, frame, 1, selective.depthView);
            core.end();
            glow.ensure(attachments.msaaW, attachments.msaaH, selective.depthView);
            const broad = encoder.beginRenderPass({ label: 'trail-glow-half-resolution', colorAttachments: [{ view: glow.view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
            broad.setViewport(0, 0, attachments.msaaW / 2, attachments.msaaH / 2, 0, 1);
            fleets.encodeHullTrails(broad, frame, 2, selective.depthView);
            broad.end();
            glow.composite(encoder, target);
        }
    }
    function encodeSelective(encoder, frame, target) {
        const split = selective;
        split.ensure(attachments.msaaW, attachments.msaaH, attachments.msaaDepthView);
        // Lines resolve under the self-softened body color. Avoid binding a texture
        // as both attachment and sampled input in any pass.
        const underlay = encoder.beginRenderPass({ label: 'selective-lines', colorAttachments: [{
                    view: attachments.msaaColorView, resolveTarget: split.colorView, clearValue: bootstrap.clearColor, loadOp: 'clear', storeOp: 'discard'
                }] });
        galaxy.encodeLines(underlay, frame);
        schematics.encodeSceneSchematicsViewRel(underlay);
        underlay.end();
        const bodies = encoder.beginRenderPass({ label: 'selective-bodies-1x', colorAttachments: [{ view: split.colorView, loadOp: 'load', storeOp: 'store' }] });
        galaxy.encodePoints(bodies, frame);
        solar.encodeColor(bodies);
        bodies.end();
        // Cheap color broadcast replaces multisampling the expensive body shaders.
        // Kept opt-in because the full-resolution copy adds bandwidth on tile GPUs.
        split.seedColor(encoder, attachments.msaaColorView);
        const overlays = encoder.beginRenderPass({ label: 'selective-map-overlay', colorAttachments: [{ view: attachments.msaaColorView, loadOp: 'load', storeOp: 'store' }] });
        // Strategic fleets are represented by survey totals.
        overlay.encode(overlays, surface.width, surface.height, ports.coordinates);
        overlays.end();
        encodeResolve(encoder, frame, target, true);
        if (lastResolveHadDepth) {
            if (!(glow && frame.sceneOpen && frame.hullsOn))
                split.resolveOpaqueDepth(encoder);
            const atmosphere = encoder.beginRenderPass({ label: 'selective-atmosphere-1x', colorAttachments: [{ view: target, loadOp: 'load', storeOp: 'store' }],
                depthStencilAttachment: { view: split.depthView, depthReadOnly: true } });
            solar.encodeAtmosphere(atmosphere);
            atmosphere.end();
        }
    }
    function encode(frame, profiler) {
        const target = resolveTarget();
        const warped = warp.prepare(frame, attachments.msaaW, attachments.msaaH, attachments.msaaDepthView);
        resetSceneCamera(bootstrap.device, frame.sceneOpen ? ports.coordinates.hulls.rotationViewProj : undefined, frame.sceneOpen ? ports.coordinates.system.eye : undefined);
        fleets.prepare(frame);
        galaxy.prepare(frame);
        const encoder = createEncoder("webgpu-map-frame", profiler);
        fleets.integrate(encoder, frame);
        ports.tickWarmFleets();
        fleets.prepareVisibility(encoder, frame);
        // Body uniforms land before the render pass, never mid-pass.
        solar.prepare(frame, surface.height);
        if (selective)
            encodeSelective(encoder, frame, warped ?? target);
        else {
            encodeColor(encoder, frame, warped ?? target);
            encodeResolve(encoder, frame, warped ?? target, warped !== null);
        }
        if (warped)
            warp.encode(encoder, target);
        ports.encodeDirectedMaintenance?.(encoder);
        submit(encoder, profiler);
        ports.commitDirectedTick();
    }
    return { encode, dispose: () => { warp.dispose(); selective?.dispose(); glow?.dispose(); }, lastResolveHadDepth: () => lastResolveHadDepth };
}
//# sourceMappingURL=frame-encoder.js.map