/** Worker-owned render composition. The same production runtime is usable in isolated scenarios. */
import { enableFrameDebug } from "../gpu/frame-debug.js";
import { Galaxy } from "../galaxy.js";
import { GalaxyMetrics } from "../galaxy-metrics.js";
import { createWebGpuViewHooks } from "../render/topology-view-bridge.js";
import { createSystemFocusController } from "../render/system-focus.js";
import { createCameraDirectorHost } from "../render/camera-director-host.js";
import { WebGpuMapView } from "../gpu/map-renderer-core.js";
import { WebGpuCameraController } from "../gpu/camera-controller-core.js";
import { createRenderFleetQueue } from "./fleet-queue.js";
import { renderSnapshot } from "./runtime-state.js";
import { queryRenderRuntime } from "./runtime-queries.js";
import { applyRenderCommand } from "./runtime-commands.js";
import { createRuntimeProjection } from './remote/runtime-projection.js';
import { isProjectionQuery } from './remote/protocol.js';
/** Preserve the previous UI projection's bounded bulk packing allowance. */
const FLEET_PACK_BUDGET_MS = 8;
const FLEET_PACK_MAX_PER_FRAME = 256;
const OBSERVATION_INTERVAL_MS = 1000 / 30;
export async function createRenderRuntime(options) {
    enableFrameDebug(options.frameDebug === true);
    let runtime;
    const view = await WebGpuMapView.createForSurface(options.canvas, {
        ...options.viewport, skipShipModel: options.skipShipModel,
        onDeviceLost: (info) => { runtime?.dispose(); options.onError(`WebGPU device lost: ${info.reason}: ${info.message}`); },
        onRenderError: (error) => options.onError(`WebGPU frame failed: ${String(error)}`),
    });
    try {
        runtime = wireRuntime(view, options);
        return runtime;
    }
    catch (error) {
        view.dispose();
        throw error;
    }
}
function wireRuntime(view, options) {
    let state;
    const camera = new WebGpuCameraController(view, {
        controls: { isEditModeActive: () => state.editMode },
        reducedMotion: options.reducedMotion,
        setCursor: (cursor) => { if (state)
            state.cursor = cursor; },
    });
    const galaxy = new Galaxy(createWebGpuViewHooks(view, () => galaxy), new GalaxyMetrics());
    view.setFleetPositionProvider((node) => galaxy.getSolarSystemById(node.clusterId, node.solarSystemId)?.position ?? null);
    const fleets = createRenderFleetQueue((fleet) => {
        view.addFleet(fleet.id, fleet.counts, fleet.state);
        state.fleetIds.add(fleet.id);
    });
    state = {
        view, camera, galaxy, fleets, fleetIds: new Set(),
        director: createCameraDirectorHost({ applyPose: (pose) => camera.applyDirectorPose(pose) }),
        sequence: 0, frame: 0, running: false, cursor: "grab", edit: null, editMode: false,
        sceneFleetIds: new Set(), sceneFleetRenderIds: new Map(), selectedFleetId: null,
    };
    const focus = createSystemFocusController({
        view, camera,
        toBufferPx: (x, y) => {
            const c = view.getCameraState();
            return { x: x * c.bufferW / c.viewportW, y: y * c.bufferH / c.viewportH };
        },
    });
    const context = { state, focus, dragStarts: new Map(), maxSolarSystemId: 0 };
    const remote = createRuntimeProjection(state, options.onError, () => {
        state.camera.setFollowShip(null);
        state.view.setFollowShipIndex(null);
        state.camera.setSystemOrbitFree();
        state.selectedFleetId = null;
    });
    let disposed = false;
    let lastObservation = 0;
    const observe = () => {
        const now = performance.now();
        if (now - lastObservation < OBSERVATION_INTERVAL_MS)
            return;
        lastObservation = now;
        options.onState(renderSnapshot(state, remote.sceneFleets(256), remote.sceneFleetCount()));
    };
    view.setBeforeFrame((dtMs) => {
        fleets.drain(FLEET_PACK_BUDGET_MS, FLEET_PACK_MAX_PER_FRAME);
        if (state.director.isPlaying()) {
            if (!state.director.tick(performance.now()))
                camera.releaseDirectorPose();
        }
        else
            camera.update(dtMs);
        focus.tick();
        view.setGalaxyFade(camera.getGalaxyFade());
    });
    view.setAfterFrame(() => { state.frame++; observe(); });
    return {
        attachProjection(attachment) {
            if (disposed)
                throw new Error('Render runtime is disposed');
            return remote.attach(attachment);
        },
        apply(sequence, commands) {
            if (disposed)
                throw new Error("Render runtime is disposed");
            if (sequence <= state.sequence)
                throw new Error(`Render sequence ${sequence} follows ${state.sequence}`);
            for (const command of commands) {
                if (command.type === 'clear' || command.type === 'clearFleets')
                    remote.dispose();
                applyRenderCommand(context, command);
            }
            state.sequence = sequence;
            observe();
        },
        query(query) {
            if (disposed)
                return Promise.reject(new Error("Render runtime is disposed"));
            if (isProjectionQuery(query))
                return remote.query(query);
            const refs = query.type === "snapshot" ? remote.sceneFleets(256) : remote.sceneFleets();
            return queryRenderRuntime(state, query, refs);
        },
        snapshot: () => renderSnapshot(state, remote.sceneFleets(256), remote.sceneFleetCount()),
        dispose() {
            if (disposed)
                return;
            disposed = true;
            remote.dispose();
            fleets.clear();
            camera.dispose();
            view.setBeforeFrame(null);
            view.setAfterFrame(null);
            state.running = false;
            galaxy.clear();
            view.dispose();
        },
    };
}
//# sourceMappingURL=runtime.js.map