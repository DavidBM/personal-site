export function createMapFrameEncoder(ports) {
    const { bootstrap, surface, attachments, galaxy, fleets, solar, schematics, overlay } = ports;
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
    function encodeColor(encoder, frame) {
        const pass = encoder.beginRenderPass({ label: "map-color", colorAttachments: [{
                    view: attachments.msaaColorView, clearValue: bootstrap.clearColor, loadOp: "clear", storeOp: "store",
                }] });
        galaxy.encode(pass, frame);
        schematics.encodeSceneSchematicsViewRel(pass);
        solar.encodeColor(pass);
        if (!frame.sceneOpen)
            fleets.encodeShips(pass, frame);
        overlay.encode(pass, surface.width, surface.height, ports.coordinates);
        pass.end();
    }
    function encodeResolve(encoder, frame, target) {
        const wantDepth = frame.sceneOpen || frame.hullsOn || frame.bandC;
        lastResolveHadDepth = !!(wantDepth && attachments.msaaDepthView);
        const depth = lastResolveHadDepth ? {
            view: attachments.msaaDepthView, depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "discard",
        } : undefined;
        const pass = encoder.beginRenderPass({ label: "map-depth-resolve", colorAttachments: [{
                    view: attachments.msaaColorView, resolveTarget: target, loadOp: "load", storeOp: "discard",
                }], depthStencilAttachment: depth });
        if (lastResolveHadDepth)
            solar.encodeDepth(pass);
        if (frame.sceneOpen) {
            fleets.encodeShips(pass, frame);
            fleets.encodeStrategicTrails(pass, frame);
        }
        fleets.encodeModels(pass, frame);
        fleets.encodeDebug?.(pass, frame);
        if (lastResolveHadDepth)
            solar.encodeAtmosphere(pass);
        pass.end();
    }
    function encode(frame, profiler) {
        const target = resolveTarget();
        fleets.prepare(frame);
        const encoder = createEncoder("webgpu-map-frame", profiler);
        fleets.integrate(encoder, frame);
        ports.tickWarmFleets();
        fleets.prepareVisibility(encoder, frame);
        // Body uniforms land before the render pass, never mid-pass.
        solar.prepare(frame, surface.height);
        encodeColor(encoder, frame);
        encodeResolve(encoder, frame, target);
        submit(encoder, profiler);
        ports.commitDirectedTick();
    }
    return { encode, lastResolveHadDepth: () => lastResolveHadDepth };
}
//# sourceMappingURL=frame-encoder.js.map