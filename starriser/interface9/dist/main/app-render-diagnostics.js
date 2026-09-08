/** CPU snapshots are synchronous; worker/GPU observations are explicitly async. */
export function installAppRenderDiagnostics(app) {
    const snapshot = () => app.renderClient?.snapshot();
    const send = (command) => app.renderClient?.send(command);
    globalThis.__galaxyApp = {
        generateFleetsBulk: (n) => app.generateFleetsBulk(n),
        generateGalaxy: (params) => app.generateGalaxy(params),
        generateFleet: () => app.generateFleet(), clearGalaxy: () => app.clearGalaxy(),
        getFleetCount: () => snapshot()?.metrics.fleetCount ?? 0,
        getClusterCount: () => app.galaxy.clusters.length,
        getShipHighWater: () => snapshot()?.metrics.shipHighWater ?? 0,
        getBulkShipBudgetHint: () => snapshot()?.metrics.bulkShipBudgetHint ?? null,
        getPendingApplyCount: () => snapshot()?.metrics.pendingFleets ?? 0,
        isDeviceLost: () => app.renderClient?.isDeviceLost() ?? true,
        beginFrameCpuSample: () => send({ type: "sampleFrames" }),
        getFrameCpuSampleAvg: () => snapshot()?.metrics.cpuAverageMs ?? 0,
        getFrameCpuSampleCount: () => snapshot()?.metrics.cpuSamples ?? 0,
        getFrameGpuSampleAvg: () => snapshot()?.metrics.gpuAverageMs ?? 0,
        getFrameGpuSampleCount: () => snapshot()?.metrics.gpuSamples ?? 0,
        getLastFrameCpuMs: () => snapshot()?.metrics.lastCpuMs ?? 0,
        getLastFrameGpuMs: () => snapshot()?.metrics.lastGpuMs ?? 0,
        measureOneGpuFrameMs: () => app.renderClient?.query({ type: "measureFrame" }) ?? Promise.resolve(0),
        measureOneFrameEndToEndMs: () => app.renderClient?.query({ type: "measureFrame" }) ?? Promise.resolve(0),
        measureFrameTimings: () => measureFrameTimings(app),
        stopRenderLoop: () => send({ type: "stop" }), startRenderLoop: () => send({ type: "start" }),
        setCameraLookAt: (eyeX, eyeY, eyeZ, targetX, targetZ) => send({ type: "cameraPose", camera: { eyeX, eyeY, eyeZ, targetX, targetY: 0, targetZ } }),
        focusOnPoint: (x, z, height) => send({ type: "focusPoint", x, z, height }),
        resizeView: (w, h) => app.renderClient?.resize(w, h),
        pickFirstSystem: () => {
            const system = app.galaxy.clusters[0]?.solarSystems[0];
            return system ? { id: system.id, x: system.position.x, z: system.position.z, bufferIndex: -1 } : null;
        },
        lockBody: (index) => app.selectSceneBody(index),
        selectSceneBody: (index) => app.selectSceneBody(index),
        pumpHiLoad: () => send({ type: "pumpHiLoad" }),
        directorGoToSystemWithShips: (opts) => app.directorGoToSystemWithShips(opts),
        directorGoToRandomSystem: (opts) => app.directorGoToRandomSystem(opts),
        directorFlyTo: (opts) => app.directorFlyTo(opts),
        directorStatus: () => app.directorStatus(),
        directorArrivalShipsPresent: () => app.directorArrivalShipsPresent(),
        getCameraState: () => snapshot()?.camera ?? null,
        pickNonJumpSystem: () => app.pickNonJumpSystem(),
        observeJewel: () => app.observeJewel(),
        pickRandomShipPose: () => app.renderClient?.query({ type: "pickShip" }) ?? Promise.resolve(null),
        observeYear1: () => observeYear1(app),
        renderSnapshot: () => app.renderClient?.query({ type: "snapshot" }),
        readbackColor: () => app.renderClient?.query({ type: "colorReadback" }),
        dispose: () => app.dispose(),
    };
}
async function measureFrameTimings(app) {
    if (!app.renderClient)
        throw new Error("Renderer is unavailable");
    return await app.renderClient.query({ type: "measureFrameTimings" });
}
async function observeYear1(app) {
    const client = app.renderClient;
    if (!client)
        return { ok: false };
    const data = await client.query({ type: "sceneDiagnostics" });
    const s = data.snapshot;
    const parked = data.fleets.find((fleet) => (fleet.slot.flags & 128) !== 0) ?? data.fleets[0];
    const park = parked ? {
        id: parked.id, ...parked.slot,
        off: Math.hypot(parked.slot.pathEndX, parked.slot.pathEndZ),
    } : null;
    const bodies = s.bodies.map((body) => ({ i: body.index, sun: Number(body.isSun), r: body.radius, id: body.catalogId }));
    return {
        ok: true, fleets: s.metrics.fleetCount, shipHw: s.metrics.shipHighWater,
        clusters: app.galaxy.clusters.length, sceneIds: s.systemId == null ? [] : [s.systemId],
        sceneId: s.systemId, spanPx: s.sceneSpanPx, bandBDraws: s.bandBDraws, bandCDraws: s.bandCDraws,
        ...pointDiagnostics(app, data),
        sunR: bodies.find((body) => body.sun)?.r ?? null, park,
        near: s.camera.near, fovyDeg: s.camera.fovyDeg, bufferH: s.camera.bufferH,
        eyeX: s.camera.eyeX, eyeY: s.camera.eyeY, eyeZ: s.camera.eyeZ,
        targetX: s.camera.targetX, targetY: s.camera.targetY, targetZ: s.camera.targetZ,
        originX: s.origin.x, originY: s.origin.y, originZ: s.origin.z,
        focusIndex: s.focusIndex, hiCatalogId: s.hiCatalogId, bodies, bodyN: bodies.length,
    };
}
function pointDiagnostics(app, data) {
    const systems = app.galaxy.clusters[0]?.solarSystems ?? [];
    const first = systems[0];
    const second = systems[1];
    const point = data.points.find((entry) => entry.systemId === first?.id);
    const neighbor = data.points.find((entry) => entry.systemId === second?.id);
    return {
        hidden5px: point ? point.hidden : false,
        neighborHidden: neighbor ? neighbor.hidden : null,
        bufferIndex: point ? point.bufferIndex : -1,
        ...firstSystemIdentity(first),
    };
}
function firstSystemIdentity(first) {
    return first ? { systemId: first.id, sysX: first.position.x, sysZ: first.position.z }
        : { systemId: null, sysX: 0, sysZ: 0 };
}
//# sourceMappingURL=app-render-diagnostics.js.map