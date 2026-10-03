import { HalfGlow } from './half-glow.js';
import { SelectiveMsaa } from './selective-msaa.js';
import { HullMsaa } from './hull-msaa.js';
import { MAP_MSAA_SAMPLES, MAP_SELECTIVE_MSAA, MAP_HALF_GLOW, MAP_HULL_MSAA } from '../map-msaa.js';
import { resetSceneCamera } from '../scene-camera.js';
import { frameDebugTime } from '../frame-debug.js';
import { WarpEffect } from './warp-effect.js';
export function createMapFrameEncoder(ports) {
    const { bootstrap, surface, attachments, galaxy, fleets, solar, schematics, overlay } = ports;
    const warp = new WarpEffect(bootstrap, ports.coordinates);
    const selective = MAP_SELECTIVE_MSAA ? new SelectiveMsaa(bootstrap) : null;
    const glow = MAP_HALF_GLOW ? new HalfGlow(bootstrap) : null;
    const hullMsaa = MAP_HULL_MSAA ? new HullMsaa(bootstrap) : null;
    let lastResolveHadDepth = false;
    let depthResolved = false;
    let lastSceneMs = -Infinity;
    let lastGlowMs = -Infinity;
    function createEncoder(label, profiler) {
        const descriptor = { label };
        return profiler ? profiler.createEncoder(bootstrap.device, descriptor) : bootstrap.device.createCommandEncoder(descriptor);
    }
    function submit(encoder, profiler) {
        const commands = frameDebugTime('command buffer finish', () => profiler ? profiler.finish(encoder) : encoder.finish());
        frameDebugTime('queue.submit', () => bootstrap.device.queue.submit([commands]));
    }
    function resolveTarget(needDepth) {
        const texture = attachments.resolveReadback ? null : bootstrap.context.getCurrentTexture();
        attachments.ensureMsaaColor(texture?.width ?? surface.width, texture?.height ?? surface.height, needDepth);
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
    function glowDrawFor(frame) {
        return glow && frame.sceneOpen && frame.hullsOn ? fleets.glowDrawArguments() : null;
    }
    function beginScenePass(encoder, frame, target, keepDepth, splitGlow) {
        lastResolveHadDepth = !!(needsScenePasses(frame) && attachments.msaaDepthView);
        const depth = lastResolveHadDepth ? {
            view: attachments.msaaDepthView, depthClearValue: attachments.depth.clearValue, depthLoadOp: "clear", depthStoreOp: keepDepth ? "store" : "discard",
        } : undefined;
        const single = MAP_MSAA_SAMPLES === 1;
        const keepColor = single || splitGlow;
        return encoder.beginRenderPass({ label: "map-depth-resolve", colorAttachments: [{
                    view: single ? target : attachments.msaaColorView,
                    resolveTarget: keepColor ? undefined : target, loadOp: "load",
                    storeOp: keepColor ? "store" : "discard",
                }], depthStencilAttachment: depth });
    }
    function encodeResolve(encoder, frame, target, preserveDepth) {
        const glowDraw = glowDrawFor(frame);
        const splitGlow = glowDraw !== null;
        depthResolved = false;
        const pass = beginScenePass(encoder, frame, target, preserveDepth || splitGlow, splitGlow);
        if (lastResolveHadDepth)
            solar.encodeDepth(pass);
        if (frame.sceneOpen) {
            fleets.encodeShips(pass, frame);
            fleets.encodeStrategicTrails(pass, frame);
        }
        fleets.encodeModels(pass, frame, !splitGlow);
        fleets.encodeDebug?.(pass, frame);
        if (lastResolveHadDepth && !selective && !splitGlow)
            solar.encodeAtmosphere(pass);
        pass.end();
        if (glowDraw) {
            encodeGlow(encoder, frame, target, glowDraw);
            if (!selective)
                encodeAtmosphere(encoder, target, attachments.msaaDepthView);
        }
    }
    function encodeGlow(encoder, frame, target, indirect) {
        if (selective) {
            selective.resolveOpaqueDepth(encoder);
            depthResolved = true;
        }
        const opaque = selective?.depthView ?? attachments.msaaDepthView;
        const single = MAP_MSAA_SAMPLES === 1;
        const core = encoder.beginRenderPass({ label: 'trail-cores', colorAttachments: [{
                    view: single ? target : attachments.msaaColorView, resolveTarget: single ? undefined : target, loadOp: 'load', storeOp: single ? 'store' : 'discard'
                }],
            depthStencilAttachment: { view: attachments.msaaDepthView, depthReadOnly: true } });
        // At 1x the attachment itself is sampled read-only; no color/depth bridges.
        fleets.encodeHullTrails(core, frame, 1, opaque);
        core.end();
        glow.ensure(attachments.msaaW, attachments.msaaH, opaque);
        const broad = encoder.beginRenderPass({ label: 'trail-glow-half-resolution', colorAttachments: [{ view: glow.view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
        broad.setViewport(0, 0, attachments.msaaW / 2, attachments.msaaH / 2, 0, 1);
        fleets.encodeHullTrails(broad, frame, 2, opaque);
        broad.end();
        glow.composite(encoder, target, indirect);
    }
    function encodeHullScene(encoder, frame, target) {
        encodeColor(encoder, frame, target);
        const pass = beginScenePass(encoder, frame, target, true, false);
        solar.encodeDepth(pass);
        fleets.encodeShips(pass, frame);
        fleets.encodeStrategicTrails(pass, frame);
        fleets.encodeModels(pass, frame, false, false);
        pass.end();
        if (frame.hullHighOn && fleets.hasHighHullCandidates()) {
            const indirect = fleets.highHullDrawArguments();
            const high = hullMsaa.begin(encoder, attachments.msaaW, attachments.msaaH);
            fleets.encodeHighModels(high, frame);
            high.end();
            hullMsaa.composite(encoder, target, attachments.msaaDepthView, indirect);
        }
        const glowDraw = glowDrawFor(frame);
        if (glowDraw)
            encodeGlow(encoder, frame, target, glowDraw);
        const effects = encoder.beginRenderPass({ label: 'scene-effects-1x', colorAttachments: [{ view: target, loadOp: 'load', storeOp: 'store' }],
            depthStencilAttachment: { view: attachments.msaaDepthView, depthReadOnly: true } });
        if (!glowDraw)
            fleets.encodeHullTrails(effects, frame);
        fleets.encodeDebug?.(effects, frame);
        solar.encodeAtmosphere(effects);
        effects.end();
    }
    function encodeAtmosphere(encoder, target, depth) {
        const pass = encoder.beginRenderPass({ label: 'selective-atmosphere-1x', colorAttachments: [{ view: target, loadOp: 'load', storeOp: 'store' }],
            depthStencilAttachment: { view: depth, depthReadOnly: true } });
        solar.encodeAtmosphere(pass);
        pass.end();
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
            if (!depthResolved)
                split.resolveOpaqueDepth(encoder);
            encodeAtmosphere(encoder, target, split.depthView);
        }
    }
    // Galaxy geometry has no solar depth consumers. Keep editor overlays above
    // single-sample markers; only that case needs the color bridge back into MSAA.
    function encodeGalaxy(encoder, frame, target) {
        lastResolveHadDepth = false;
        if (!selective) {
            encodeColor(encoder, frame, target);
            if (MAP_MSAA_SAMPLES > 1)
                encodeResolve(encoder, frame, target, false);
            return;
        }
        const withOverlay = overlay.hasContent?.() ?? true;
        if (withOverlay)
            selective.ensure(attachments.msaaW, attachments.msaaH, null);
        const color = withOverlay ? selective.colorView : target;
        const lines = encoder.beginRenderPass({ label: 'galaxy-lines', colorAttachments: [{
                    view: attachments.msaaColorView, resolveTarget: color, clearValue: bootstrap.clearColor, loadOp: 'clear', storeOp: 'discard'
                }] });
        galaxy.encodeLines(lines, frame);
        schematics.encodeSceneSchematicsViewRel(lines);
        lines.end();
        const points = encoder.beginRenderPass({ label: 'galaxy-points', colorAttachments: [{ view: color, loadOp: 'load', storeOp: 'store' }] });
        galaxy.encodePoints(points, frame);
        points.end();
        if (!withOverlay)
            return;
        selective.seedColor(encoder, attachments.msaaColorView);
        const overlays = encoder.beginRenderPass({ label: 'galaxy-overlay', colorAttachments: [{
                    view: attachments.msaaColorView, resolveTarget: target, loadOp: 'load', storeOp: 'discard'
                }] });
        overlay.encode(overlays, surface.width, surface.height, ports.coordinates);
        overlays.end();
    }
    function releaseIdleGlow(frame) {
        if (frame.sceneOpen && frame.hullsOn && fleets.glowDrawArguments())
            lastGlowMs = frame.nowMs;
        else if (frame.nowMs - lastGlowMs >= 1000)
            glow?.dispose();
    }
    function needsScenePasses(frame) {
        return frame.sceneOpen || frame.hullsOn || frame.bandC || frame.keplerEncode;
    }
    function releaseIdleTargets(frame, scene) {
        releaseIdleGlow(frame);
        if (scene) {
            lastSceneMs = frame.nowMs;
            return;
        }
        if (frame.nowMs - lastSceneMs < 1000)
            return;
        // Bind groups are rebuilt by their owners if the same-size depth is recreated.
        glow?.dispose();
        hullMsaa?.dispose();
        selective?.releaseDepth();
        attachments.releaseDepth();
        if (!(overlay.hasContent?.() ?? true))
            selective?.dispose();
    }
    function encode(frame, profiler) {
        resetSceneCamera(bootstrap.device, frame.sceneOpen ? ports.coordinates.hulls.rotationViewProj : undefined, frame.sceneOpen ? ports.coordinates.system.eye : undefined);
        fleets.prepare(frame);
        galaxy.prepare(frame);
        const encoder = createEncoder("webgpu-map-frame", profiler);
        frameDebugTime('fleet compute encoding', () => fleets.integrate(encoder, frame));
        frameDebugTime('warm fleets', () => ports.tickWarmFleets());
        frameDebugTime('hull visibility encoding', () => fleets.prepareVisibility(encoder, frame));
        // Body uniforms land before the render pass, never mid-pass.
        frameDebugTime('solar preparation', () => solar.prepare(frame, surface.height));
        // Preparation owns bandC; choose attachments from this frame, including
        // transition frames that still draw Kepler bodies outside an open scene.
        const scene = needsScenePasses(frame);
        releaseIdleTargets(frame, scene);
        const target = frameDebugTime('surface and attachments', () => resolveTarget(scene));
        const warped = warp.prepare(frame, attachments.msaaW, attachments.msaaH, attachments.msaaDepthView);
        frameDebugTime('color/depth/effects encoding', () => {
            if (!scene)
                encodeGalaxy(encoder, frame, target);
            else
                encodeScene(encoder, frame, warped ?? target, warped !== null);
            if (warped)
                warp.encode(encoder, target);
        });
        frameDebugTime('population compaction encoding', () => ports.encodeDirectedMaintenance?.(encoder));
        submit(encoder, profiler);
        frameDebugTime('post-submit fleet work', () => ports.commitDirectedTick());
    }
    function encodeScene(encoder, frame, target, preserveDepth) {
        if (hullMsaa)
            encodeHullScene(encoder, frame, target);
        else if (selective)
            encodeSelective(encoder, frame, target);
        else {
            encodeColor(encoder, frame, target);
            encodeResolve(encoder, frame, target, preserveDepth);
        }
    }
    return { encode, dispose: () => { warp.dispose(); selective?.dispose(); hullMsaa?.dispose(); glow?.dispose(); }, lastResolveHadDepth: () => lastResolveHadDepth };
}
//# sourceMappingURL=frame-encoder.js.map