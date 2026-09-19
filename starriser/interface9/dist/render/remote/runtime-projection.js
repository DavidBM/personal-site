import { matchesPlaybackBaseline } from './playback-correction.js';
import { createProjectionConsumer } from './projection-consumer.js';
import { createProjectionReceiver } from './transfer-receiver.js';
import { createRemoteFleetAdapter } from './fleet-adapter.js';
import { remotePathPosition } from '../../gpu/map/fleets/remote-path.js';
import { remotePresentationPath } from './presentation-clock.js';
import { validateServerClock } from '../../contracts/server-clock.js';
import { readShipSim } from '../../gpu/ship-sim-layout.js';
import { readGpuBuffer } from '../../gpu/buffer-readback.js';
import { FLEET_GPU_STRIDE, FleetGpuFields } from '../../gpu/fleet-layout.js';
import { createWorkerTraces, emptyTraces, workerClock } from '../../debug/worker-traces.js';
import { sameScope } from './projection-state.js';
import { progressCursor } from '../../debug/projection-progress.js';
export function createRuntimeProjection(state, onError, onFollowRetired = () => state.camera.setFollowShip(null)) {
    let attached = null;
    let generation = 0;
    function system(attachment) {
        const node = attachment.node;
        const value = state.galaxy.getSolarSystemById(node.clusterId, node.solarSystemId);
        if (!value)
            throw new Error('Projection attachment needs existing explicit topology');
        return value;
    }
    function attach(attachment) {
        system(attachment);
        let clock;
        let playback;
        let correctionSequence = 0n;
        let closed = false;
        let traces;
        function startTrace(batch) {
            try {
                if (batch.trace && !traces)
                    traces = createWorkerTraces(workerClock('render'));
                return traces?.begin('render.apply', batch.trace);
            }
            catch {
                return;
            }
        }
        const makeAdapter = () => createRemoteFleetAdapter(state.view.createRemoteFleetSlots(onFollowRetired), fleet => {
            if (!clock)
                throw new Error('Projection has no server clock anchor');
            system(attachment);
            return remotePresentationPath(fleet, attachment.node, clock, state.view.remoteClockReference());
        }, `remote:${attachment.generation}`);
        let adapter = makeAdapter();
        let consumer = createProjectionConsumer(attachment.identity, { apply: adapter.apply, replace: adapter.replace });
        function reset(value) {
            consumer.dispose();
            adapter.dispose();
            clock = undefined;
            playback = undefined;
            if (value?.identity && value.node) {
                if (value.identity.worldId !== attachment.identity.worldId || value.identity.subscriptionId !== attachment.identity.subscriptionId)
                    throw new Error('Projection reset identity changed');
                system({ ...attachment, node: value.node });
                attachment = { ...attachment, identity: value.identity, node: value.node };
            }
            adapter = makeAdapter();
            consumer = createProjectionConsumer(attachment.identity, { apply: adapter.apply, replace: adapter.replace });
        }
        function appliedBatch(batch, signal) {
            const applied = consumer.inspect().applied;
            return !signal.aborted && applied?.streamGeneration === batch.streamGeneration && applied.sequence === batch.sequence;
        }
        function projectionClock(batch) {
            if (!batch.clock)
                throw new Error('Projection has no server clock anchor');
            validateServerClock(batch.clock);
            if (playback && (playback.baseline.streamGeneration !== batch.streamGeneration
                || !sameScope(playback.baseline.scope, batch.scope)))
                playback = undefined;
            clock = { ...(playback?.clock ?? batch.clock) };
        }
        const receiver = createProjectionReceiver(attachment.port, {
            generation: attachment.generation,
            reset: attachment.dynamic ? reset : undefined,
            async apply(batch, signal) {
                const received = consumer.inspect().received;
                if (received && batch.streamGeneration < received.streamGeneration)
                    return;
                projectionClock(batch);
                const trace = startTrace(batch);
                try {
                    await consumer.consume(batch, signal);
                    if (trace)
                        trace.finish(appliedBatch(batch, signal) ? 'ok' : 'unknown');
                }
                catch (error) {
                    trace?.finish('error', 'projection_apply');
                    throw error;
                }
            },
            async correct(value, signal) {
                if (value.sequence <= correctionSequence || !matchesPlaybackBaseline(value.baseline, consumer.inspect().applied))
                    return;
                clock = { ...value.clock };
                await adapter.retime(consumer.fleet, signal);
                playback = value;
                correctionSequence = value.sequence;
            },
            onError(error) { dispose(); onError(`Remote projection: ${error.message}`); },
        });
        function dispose() {
            if (closed)
                return;
            closed = true;
            receiver.dispose();
            consumer.dispose();
            adapter.dispose();
        }
        function inspect() {
            const model = consumer.inspect(), buffers = receiver.inspect(), slots = adapter.inspect();
            return { generation: attachment.generation, ...model, retainedBytes: buffers.retainedBytes, retainedBatches: buffers.retainedBatches,
                allocatedSlots: slots.allocated, lastCommitMs: slots.lastCommitMs,
                ...(playback ? { playback: { sequence: correctionSequence, roundTripMs: playback.clock.roundTripMs } } : {}) };
        }
        async function observeFleet(id, readback) {
            const fleet = consumer.fleet(id), visual = adapter.visual(id);
            if (!fleet || !visual || closed)
                throw new Error('Remote fleet is no longer visible');
            const row = state.view.readFleetGpuSlot(visual.id);
            const result = { fleet: { ...fleet }, fleetSlot: row.fleetSlot, shipIndex: visual.instanceStart,
                pathStartX: row.pathStartX, pathStartZ: row.pathStartZ, pathEndX: row.pathEndX, pathEndZ: row.pathEndZ, flags: row.flags };
            if (readback) {
                const bytes = await state.view.fleetsLayer.readbackShipSimOne(visual.instanceStart);
                assertObservationCurrent(id, visual, fleet.revision);
                const gpu = readShipSim(new DataView(bytes), 0);
                result.gpu = { posX: gpu.posX, posY: gpu.posY ?? 0, posZ: gpu.posZ, mode: gpu.mode, fleetIndex: gpu.fleetIndex };
                result.gpuPath = await readPath(visual.fleetSlot);
                assertObservationCurrent(id, visual, fleet.revision);
            }
            return result;
        }
        function assertObservationCurrent(id, visual, revision) {
            if (closed || adapter.visual(id) !== visual || consumer.fleet(id)?.revision !== revision)
                throw new Error('Remote fleet readback was superseded');
        }
        async function readPath(slot) {
            const buffer = state.view.fleetsLayer.getFleetGpuBuffer();
            if (!buffer)
                throw new Error('Remote fleet GPU buffer is unavailable');
            const bytes = await readGpuBuffer(state.view.bootstrap.device, buffer, slot * FLEET_GPU_STRIDE, FLEET_GPU_STRIDE);
            const row = new DataView(bytes);
            return { pathStartX: row.getFloat32(FleetGpuFields.pathStartX, true), pathStartZ: row.getFloat32(FleetGpuFields.pathStartZ, true),
                pathEndX: row.getFloat32(FleetGpuFields.pathEndX, true), pathEndZ: row.getFloat32(FleetGpuFields.pathEndZ, true),
                t0: row.getFloat32(FleetGpuFields.t0, true), durationMs: row.getFloat32(FleetGpuFields.durationMs, true), flags: row.getUint32(FleetGpuFields.flags, true) };
        }
        async function query(query) {
            if (closed)
                throw new Error('Projection attachment is closed');
            if (query.type === 'projectionStatus')
                return inspect();
            if (query.type === 'projectionBarrier') {
                await consumer.waitFor(query.required, { timeoutMs: query.timeoutMs });
                return inspect();
            }
            const after = query.type === 'remoteFleet' ? query.after : query.required;
            if (after)
                await consumer.waitFor(after);
            const result = await observeFleet(query.id, query.type === 'remoteFleet' && query.readback === true);
            if (query.type === 'followRemoteFleet')
                follow(query.id, result.fleet.revision);
            if (query.type === 'focusRemoteFleet') {
                const sun = system(attachment).position;
                const visual = adapter.visual(query.id);
                const reference = state.view.remoteClockReference();
                const position = remotePathPosition(visual.remote, reference.wallMs - reference.frameEpochMs);
                state.camera.focusOnPoint(sun.x + position.x, sun.z + position.z, 0.15);
            }
            return result;
        }
        function follow(id, revision) {
            const visual = adapter.visual(id);
            if (!visual)
                throw new Error('Remote fleet is no longer visible');
            assertObservationCurrent(id, visual, revision);
            const scene = state.view.getSceneFleetNode();
            if (state.director.isPlaying() || scene?.clusterId !== attachment.node.clusterId || scene?.solarSystemId !== attachment.node.solarSystemId) {
                throw new Error('Fleet system scene is not ready for follow');
            }
            // Persistent ID resolves and camera ownership changes in one worker turn.
            state.view.setFollowShipIndex(visual.instanceStart);
            state.camera.setFollowShip(() => state.view.getLiveShipPose(visual.instanceStart));
        }
        function takeDiagnostics() {
            const status = inspect();
            return { ...(traces?.take() ?? emptyTraces()), progress: { owner: 'render', connectionGeneration: attachment.generation,
                    received: progressCursor(status.received), applied: progressCursor(status.applied),
                    queuedBytes: status.retainedBytes, queuedBatches: status.retainedBatches, inFlightBytes: 0, inFlightBatches: 0 } };
        }
        return { query, inspect, dispose, takeDiagnostics, invalidate() { receiver.invalidate(); reset(); }, adapterEntries: () => adapter.entries(),
            adapterCount: () => adapter.inspect().active };
    }
    return {
        attach(attachment) {
            if (!Number.isSafeInteger(attachment.generation) || attachment.generation <= generation)
                throw new Error('Projection connection generation must increase');
            system(attachment);
            attached?.dispose();
            attached = null;
            const next = attach(attachment);
            attached = next;
            generation = attachment.generation;
            return next.inspect();
        },
        query(query) {
            if (query.type === 'projectionDiagnostics')
                return Promise.resolve(attached?.takeDiagnostics() ?? emptyTraces());
            if (!attached)
                return Promise.reject(new Error('No projection port is attached'));
            return attached.query(query);
        },
        inspect: () => attached?.inspect() ?? null,
        sceneFleets(limit = Infinity) {
            if (!attached)
                return [];
            const out = [];
            for (const [id, visual] of attached.adapterEntries()) {
                out.push({ id, visual });
                if (out.length >= limit)
                    break;
            }
            return out;
        },
        sceneFleetCount: () => attached?.adapterCount() ?? 0,
        invalidate() { attached?.invalidate(); },
        dispose() { attached?.dispose(); attached = null; },
    };
}
//# sourceMappingURL=runtime-projection.js.map