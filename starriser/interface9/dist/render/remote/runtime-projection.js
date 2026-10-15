import { createBattleScenes } from './battle-scenes.js';
import { createJourneyScenes } from './journey-scenes.js';
import { createRemoteTargetLifetime } from './target-lifetime.js';
import { createProjectionConsumer } from './projection-consumer.js';
import { createProjectionReceiver } from './transfer-receiver.js';
import { createRemoteFleetAdapter } from './fleet-adapter.js';
import { remotePresentationPath } from './presentation-clock.js';
import { validateServerClock } from '../../contracts/server-clock.js';
import { readShipSim } from '../../gpu/ship-sim-layout.js';
import { readGpuBuffer } from '../../gpu/buffer-readback.js';
import { FLEET_GPU_STRIDE, FleetGpuFields } from '../../gpu/fleet-layout.js';
import { createWorkerTraces, emptyTraces, workerClock } from '../../debug/worker-traces.js';
import { progressCursor } from '../../debug/projection-progress.js';
import { createCarriedVisuals } from './carried-visuals.js';
export function createRuntimeProjection(state, onError, onFollowRetired = () => state.camera.setFollowShip(null), onTarget) {
    let attached = null;
    let generation = 0;
    const pendingJourneys = new Map();
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
        let closed = false, resetVersion = 0, battleVersion = 0;
        const slots = state.view.createRemoteFleetSlots(() => { if (!targets.waiting())
            onFollowRetired(); });
        const journeys = createJourneyScenes(state, () => clock, id => adapter.visual(id), visual => slots.release(visual));
        const battles = createBattleScenes(id => adapter.visual(id), v => slots.release(v), ids => {
            const version = resetVersion;
            void serial(async () => {
                if (closed || resetVersion !== version)
                    return;
                const upserts = ids.map(id => consumer.fleet(id)).filter((f) => !!f);
                // The ships still alive on screen are the survivors: keep them, never rebuild.
                adapter.adopt(upserts);
                await adapter.apply({ upserts, removed: [] }, new AbortController().signal);
            }).catch(error => onError(`Battle completion: ${error.message}`));
        }, () => state.view.remoteClockReference().wallMs);
        const carried = createCarriedVisuals(v => slots.release(v), battles.protects);
        let presentation = Promise.resolve();
        function serial(job) { const next = presentation.then(job); presentation = next.catch(() => { }); return next; }
        const targets = createRemoteTargetLifetime(id => adapter.visual(id) ?? journeys.visual(id) ?? battles.visual(id));
        // Camera intent can precede acceptance of a journey. Keep its lease scoped
        // to connection/permission, while ordinary viewport targets remain revocable.
        const ownedTargets = createRemoteTargetLifetime(id => {
            const visual = adapter.visual(id) ?? journeys.visual(id);
            return visual?.relationship === 'own' ? visual : undefined;
        });
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
        const makeAdapter = () => createRemoteFleetAdapter(slots, fleet => {
            if (!clock)
                throw new Error('Projection has no server clock anchor');
            system(attachment);
            return battles.path(fleet, remotePresentationPath(fleet, attachment.node, clock, state.view.remoteClockReference()));
        }, `remote:${attachment.generation}`, (id, v, appearance) => battles.handoff(id, v) || journeys.handoff(id, v) || carried.carry(id, v, appearance), (id, appearance) => battles.restore(id) ?? journeys.restore(id) ?? carried.take(id, appearance), battles.protects);
        let adapter = makeAdapter();
        const sink = () => {
            const owner = adapter;
            return { apply: (change, signal) => serial(() => owner.apply(change, signal)),
                replace: (fleets, signal) => serial(async () => { try {
                    await owner.replace(fleets, signal);
                }
                finally {
                    carried.releaseAll();
                } }) };
        };
        let consumer = createProjectionConsumer(attachment.identity, sink());
        function reset(value) {
            resetVersion++;
            if (!value?.preserveTargets) {
                battleVersion++;
                battles.clear();
            }
            targets.reset(value?.preserveTargets === true);
            if (!value?.preserveJourney)
                ownedTargets.reset(value?.preserveTargets === true);
            if (!value?.preserveTargets && !value?.preserveJourney)
                journeys.clear();
            carried.releaseAll();
            // Only a same-scope disposal hands visuals off; carrying accepts them.
            consumer.dispose();
            carried.during(() => adapter.dispose(value?.preserveTargets || value?.preserveJourney));
            if (!value?.preserveTargets && !value?.preserveJourney)
                clock = undefined;
            if (value)
                resetIdentity(value);
            adapter = makeAdapter();
            consumer = createProjectionConsumer(attachment.identity, sink());
        }
        function resetIdentity(value) {
            if (value.identity && value.node) {
                if (value.identity.worldId !== attachment.identity.worldId || value.identity.subscriptionId !== attachment.identity.subscriptionId)
                    throw new Error('Projection reset identity changed');
                if (value.preserveTargets && value.identity.systemId !== attachment.identity.systemId)
                    throw new Error('Tracking recovery changed system');
                system({ ...attachment, node: value.node });
                attachment = { ...attachment, identity: value.identity, node: value.node };
            }
        }
        function appliedBatch(batch, signal) {
            const applied = consumer.inspect().applied;
            return !signal.aborted && applied?.streamGeneration === batch.streamGeneration && applied.sequence === batch.sequence;
        }
        function projectionClock(batch) {
            if (!batch.clock)
                throw new Error('Projection has no server clock anchor');
            validateServerClock(batch.clock);
            clock = { ...batch.clock };
            state.view.setRemotePlanetClock(clock);
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
                    if (appliedBatch(batch, signal)) {
                        battles.sync(attachment.node, state.view.remoteClockReference().wallMs);
                        targets.ready();
                        ownedTargets.ready();
                    }
                    if (trace)
                        trace.finish(appliedBatch(batch, signal) ? 'ok' : 'unknown');
                }
                catch (error) {
                    trace?.finish('error', 'projection_apply');
                    throw error;
                }
            },
            onError(error) { dispose(); onError(`Remote projection: ${error.message}`); },
        });
        function dispose() {
            if (closed)
                return;
            closed = true;
            targets.reset(false);
            ownedTargets.reset(false);
            battles.clear();
            journeys.clear();
            receiver.dispose();
            consumer.dispose();
            adapter.dispose();
            carried.releaseAll();
        }
        function inspect() {
            const model = consumer.inspect(), buffers = receiver.inspect(), slots = adapter.inspect();
            return { generation: attachment.generation, ...model, retainedBytes: buffers.retainedBytes, retainedBatches: buffers.retainedBatches,
                allocatedSlots: slots.allocated, lastCommitMs: slots.lastCommitMs };
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
        async function battleQuery(query) {
            if (query.generation !== attachment.generation)
                throw new Error('Battle connection changed');
            if (query.value && query.value.systemId !== attachment.identity.systemId)
                throw new Error('Battle system changed');
            const version = battleVersion;
            await serial(async () => {
                if (closed || version !== battleVersion)
                    throw new Error('Battle scene changed before presentation');
                battles.set(query.value, query.battleId);
                const fleets = battles.ids().map(id => consumer.fleet(id)).filter((f) => !!f);
                await adapter.apply({ upserts: fleets, removed: [] }, new AbortController().signal);
                if (version === battleVersion)
                    battles.sync(attachment.node, state.view.remoteClockReference().wallMs);
            });
            return inspect();
        }
        async function movementQuery(query) {
            if (query.type === 'remotePlanetClock') {
                validateServerClock(query.clock);
                state.view.setRemotePlanetClock(query.clock);
                return inspect();
            }
            if (query.type === 'remoteMovementContext') {
                await consumer.waitFor(query.required);
                const c = query.context;
                if (c.version !== 3 || ![c.clearance, c.sunClearance].every(n => Number.isFinite(n) && n >= 0))
                    throw new Error('Invalid movement context');
                state.view.setRemoteMovementClearance(c.clearance);
                return inspect();
            }
            if (query.type === 'clearRemoteMove') {
                const visual = adapter.visual(query.id);
                if (visual?.pendingMove?.commandId === query.commandId)
                    visual.pendingMove = undefined;
                return inspect();
            }
            return previewQuery(query);
        }
        async function previewQuery(query) {
            await consumer.waitFor(query.required);
            const fleet = consumer.fleet(query.id), visual = adapter.visual(query.id);
            if (!fleet || !visual || !clock || fleet.relationship !== 'own' || fleet.revision !== query.fleet.revision)
                throw new Error('Movement preview is stale');
            validatePreview(query);
            visual.pendingMove = { commandId: query.commandId, baseRevision: fleet.revision,
                path: remotePresentationPath({ ...query.fleet, appearance: fleet.appearance, relationship: fleet.relationship }, attachment.node, clock, state.view.remoteClockReference()) };
            return inspect();
        }
        function validatePreview(query) {
            const f = query.fleet;
            if (f.id !== query.id || !f.moving || (f.via?.length ?? 0) > 14)
                throw new Error('Movement preview is stale');
            if (![f.x, f.y, f.z, f.targetX, f.targetY, f.targetZ, ...(f.via ?? []).flatMap(p => [p.x, p.y, p.z])].every(Number.isFinite) || f.arrivalMs <= f.departureMs)
                throw new Error('Invalid movement preview');
        }
        async function trackingQuery(query) {
            const after = query.type === 'remoteFleet' ? query.after : query.required;
            if (after)
                await consumer.waitFor(after);
            const result = await observeFleet(query.id, query.type === 'remoteFleet' && query.readback === true);
            if (query.type === 'followRemoteFleet')
                target(query.id, result.fleet.revision, 'follow');
            if (query.type === 'focusRemoteFleet')
                target(query.id, result.fleet.revision, 'focus');
            return result;
        }
        async function query(query) {
            if (closed)
                throw new Error('Projection attachment is closed');
            if (query.type === 'remoteBattle')
                return battleQuery(query);
            if (query.type === 'selectedJourney')
                return inspect();
            if (query.type === 'remoteJourney')
                return journeyQuery(query);
            if (query.type === 'remotePlanetClock' || query.type === 'remoteMovementContext' || query.type === 'clearRemoteMove' || query.type === 'previewRemoteMove')
                return movementQuery(query);
            if (query.type === 'projectionStatus')
                return inspect();
            if (query.type === 'projectionBarrier') {
                await consumer.waitFor(query.required, { timeoutMs: query.timeoutMs });
                return inspect();
            }
            return trackingQuery(query);
        }
        function journeyQuery(query) {
            if (query.generation !== attachment.generation)
                throw new Error('Journey connection changed');
            return { ...inspect(), journeyArrival: journeys.accept(query.value, query.fleetId) };
        }
        function target(id, revision, mode) {
            const visual = adapter.visual(id);
            if (!visual)
                throw new Error('Remote fleet is no longer visible');
            assertObservationCurrent(id, visual, revision);
            const scene = state.view.getSceneFleetNode();
            if (state.director.isPlaying() || scene?.clusterId !== attachment.node.clusterId || scene?.solarSystemId !== attachment.node.solarSystemId) {
                throw new Error('Fleet system scene is not ready for follow');
            }
            // Persistent ID resolves and camera ownership changes in one worker turn.
            if (!onTarget)
                throw new Error('Fleet camera selection is unavailable');
            onTarget(id, visual.id, mode);
        }
        function takeDiagnostics() {
            const status = inspect();
            return { ...(traces?.take() ?? emptyTraces()), progress: { owner: 'render', connectionGeneration: attachment.generation,
                    received: progressCursor(status.received), applied: progressCursor(status.applied),
                    queuedBytes: status.retainedBytes, queuedBatches: status.retainedBatches, inFlightBytes: 0, inFlightBatches: 0 } };
        }
        return { query, inspect, dispose, takeDiagnostics, journeyQuery, visual: (id) => closed ? undefined : adapter.visual(id) ?? journeys.visual(id) ?? battles.visual(id), tracking: (id) => ownedTargets.acquire(id) ?? targets.acquire(id), invalidate() { receiver.invalidate(); reset(); }, adapterEntries: function* () { yield* adapter.entries(); yield* journeys.entries(); yield* battles.entries(); },
            adapterCount: () => adapter.inspect().active + journeys.entries().length + [...battles.entries()].length };
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
            for (const value of pendingJourneys.values())
                if (value.generation === generation)
                    next.journeyQuery(value);
            return next.inspect();
        },
        query(query) {
            if (query.type === 'selectedJourney') {
                if (query.generation < generation || attached && query.generation !== generation)
                    return Promise.reject(new Error('Journey connection changed'));
                state.travel?.accept(query.value);
                return Promise.resolve(attached?.inspect() ?? { generation: query.generation, received: null, applied: null, entities: 0, snapshotEntities: 0, retainedBytes: 0, retainedBatches: 0, allocatedSlots: 0, lastCommitMs: 0 });
            }
            if (query.type === 'remoteJourney') {
                if (query.generation < generation || attached && query.generation !== generation)
                    return Promise.reject(new Error('Journey connection changed'));
                if (query.value) {
                    if (['completed', 'cancelled', 'failed'].includes(query.value.phase))
                        pendingJourneys.delete(query.value.fleetId);
                    else {
                        if (!pendingJourneys.has(query.value.fleetId) && pendingJourneys.size >= 512)
                            return Promise.reject(new Error('Journey scene capacity reached'));
                        pendingJourneys.set(query.value.fleetId, query);
                    }
                    state.travel?.accept(query.value);
                }
                else if (query.fleetId)
                    pendingJourneys.delete(query.fleetId);
                else {
                    pendingJourneys.clear();
                    state.travel?.accept(undefined);
                }
                if (!attached)
                    return Promise.resolve({ generation: query.generation, received: null, applied: null, entities: 0, snapshotEntities: 0, retainedBytes: 0, retainedBatches: 0, allocatedSlots: 0, lastCommitMs: 0 });
            }
            if (query.type === 'projectionDiagnostics')
                return Promise.resolve(attached?.takeDiagnostics() ?? emptyTraces());
            if (!attached)
                return Promise.reject(new Error('No projection port is attached'));
            return attached.query(query);
        },
        inspect: () => attached?.inspect() ?? null,
        visual: (id) => attached?.visual(id),
        tracking: (id) => attached?.tracking(id),
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
        invalidate() { pendingJourneys.clear(); attached?.invalidate(); },
        dispose() { pendingJourneys.clear(); attached?.dispose(); attached = null; },
    };
}
//# sourceMappingURL=runtime-projection.js.map