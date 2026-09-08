import { createPlaybackCorrections } from './playback-corrections.js';
import { createCorrectionSender } from '../render/remote/correction-sender.js';
import { unframeMessage } from './framing.js';
import { create } from '@bufbuild/protobuf';
import { Capability, CommandUnknownReason, MoveCommandSchema, StrategicEncoding, TransferCommandSchema } from './generated/galaxy/v1/galaxy_pb.js';
import { decodeServerMessage, encodeClientMessage } from './codec.js';
import { createProjectionOutput } from './projection-output.js';
import { createSystemStream } from './system-stream.js';
import { packDelta, packSnapshot } from './projection-pack.js';
import { createCommandTracker } from './command-tracker.js';
import { createSessionClock } from './session-clock.js';
import { clientMessage, hello, moveCommand, transferCommand, subscribeMessage } from './messages.js';
import { connectTransport } from './transport.js';
import { SESSION_LIMITS } from './session-contracts.js';
import { opaqueIdAt, opaqueIdBytes } from '../contracts/opaque-id.js';
import { topologyView } from './topology.js';
import { createOwnedProjection } from './owned-projection.js';
import { watermark } from '../render/remote/projection-state.js';
import { createWorkerTraces, emptyTraces, workerClock } from '../debug/worker-traces.js';
import { collectNativeTraces, localProjectionTrace, wireTrace } from './diagnostics.js';
import { progressCursor } from '../debug/projection-progress.js';
import { createAdmissionRenewal } from './admission-renewal.js';
import { createStrategicCache } from './strategic-cache.js';
function requireCapabilities(value, bootstrap) {
    const required = [[true, 1, 'Required negotiated'], [true, 2, 'Required negotiated'],
        [!!bootstrap.discovery, 3, 'Topology discovery'], [!!bootstrap.ownedProjection, 4, 'Owned rule seed'],
        [!!bootstrap.transfers, 5, 'Cross-system transfer'], [!!bootstrap.diagnostics, 6, 'Diagnostics'],
        [!!bootstrap.renewAdmissions, 7, 'Admission renewal'], [!!bootstrap.strategic, 8, 'Strategic summaries']];
    for (const [enabled, capability, label] of required) {
        if (enabled && !value.capabilities.includes(capability))
            throw new Error(`${label} capability is missing`);
    }
}
export function createNetworkSession(options) {
    const { bootstrap, emit } = options;
    const controller = new AbortController();
    const now = options.now ?? (() => performance.now());
    const clock = createSessionClock(now, options.timeOriginMs ?? performance.timeOrigin);
    const commands = createCommandTracker(emit);
    const traces = bootstrap.diagnostics ? createWorkerTraces(workerClock('network'), now) : undefined;
    let transport;
    let welcome;
    let scope;
    let owned;
    let received;
    let renewal;
    let closed = false;
    let sentAt = 0;
    let handshakeTimer;
    let snapshotTimer;
    let resolveReady;
    let rejectReady;
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    // The owner may dispose before it has attached its await continuation.
    void ready.catch(() => { });
    let corrections;
    const correctionOutput = createCorrectionSender(bootstrap.renderPort, bootstrap.generation);
    const output = createProjectionOutput(bootstrap.renderPort, bootstrap.generation, fail, () => corrections?.refresh());
    let subscription = bootstrap.subscription;
    let stream = subscription && createSystemStream(subscription, requestSnapshot);
    const strategic = bootstrap.strategic && createStrategicCache(bootstrap.generation, crypto.randomUUID().replace(/-/g, ''), frontier => { emit({ type: 'strategic', frontier }); });
    function dispose(error = new Error('Network session disposed')) {
        if (closed)
            return;
        closed = true;
        clearTimeout(handshakeTimer);
        clearTimeout(snapshotTimer);
        corrections?.dispose();
        correctionOutput.dispose();
        controller.abort();
        renewal?.dispose();
        transport?.close();
        output.dispose();
        commands.dispose();
        owned?.dispose();
        if (strategic)
            strategic.dispose();
        rejectReady(error);
        emit({ type: 'state', generation: bootstrap.generation, state: 'closed' });
    }
    function fail(reason) {
        if (closed)
            return;
        const error = reason instanceof Error ? reason : new Error(String(reason));
        emit({ type: 'error', message: error.message });
        dispose(error);
    }
    function snapshotDeadline() {
        if (snapshotTimer)
            return;
        snapshotTimer = setTimeout(() => fail(new Error('Snapshot/replay deadline exceeded')), SESSION_LIMITS.snapshotMs);
    }
    function requestSnapshot(resume) {
        if (!welcome || !subscription || closed)
            return;
        snapshotDeadline();
        emit({ type: 'resync', reason: resume ? 'stream gap: requested bounded replay' : 'baseline changed: requested replacement snapshot' });
        void send(subscribeMessage(welcome.connectionGeneration, subscription, resume)).catch(fail);
    }
    async function send(message) {
        if (closed || !transport)
            throw new Error('Network session is closed');
        await transport.send(encodeClientMessage(message));
    }
    function enableCorrections(value) {
        if (bootstrap.playbackCorrections && value.capabilities.includes(Capability.PLAYBACK_CLOCK_V1)) {
            corrections = createPlaybackCorrections({ now, timeOriginMs: options.timeOriginMs ?? performance.timeOrigin,
                baseline: () => { const state = stream?.inspect(); return state?.snapshotPending || state?.resyncPending ? undefined : received; },
                send: request => send(clientMessage(value.connectionGeneration, { case: 'playbackClock', value: request })),
                apply: correctionOutput.send });
        }
    }
    async function acceptWelcome(value) {
        if (welcome)
            throw new Error('Repeated welcome on an active connection');
        if (subscription && opaqueIdAt(value.worldId) !== subscription.worldId)
            throw new Error('Welcome belongs to a different world');
        requireCapabilities(value, bootstrap);
        welcome = value;
        enableCorrections(value);
        if (strategic)
            strategic.initialize(opaqueIdAt(value.worldId), value.capabilities.includes(Capability.STRATEGIC_SYSTEMS_COMPACT_V1) ? StrategicEncoding.COMPACT_V1 : StrategicEncoding.UNSPECIFIED);
        if (bootstrap.ownedProjection)
            owned = createOwnedProjection(bootstrap.generation, opaqueIdAt(value.playerId));
        clearTimeout(handshakeTimer);
        emit({ type: 'welcome', generation: bootstrap.generation, playerId: opaqueIdAt(value.playerId), worldId: opaqueIdAt(value.worldId),
            connectionGeneration: value.connectionGeneration, clock: clock.sample(value.serverTimeMs, sentAt) });
        if (bootstrap.renewAdmissions)
            renewal = createAdmissionRenewal({ grants: value.admissions, now, serverNow: clock.serverNow,
                sample: clock.sample,
                send: (home, requestId) => send(clientMessage(value.connectionGeneration, { case: 'renewAdmission',
                    value: { $typeName: 'galaxy.v1.RenewAdmission', receiptHomeShardId: opaqueIdBytes(home), requestId } })),
                accept(grant) {
                    const index = value.admissions.findIndex(item => opaqueIdAt(item.receiptHomeShardId) === opaqueIdAt(grant.receiptHomeShardId));
                    if (index < 0)
                        value.admissions.push(grant);
                    else
                        value.admissions[index] = grant;
                },
            });
        if (bootstrap.discovery) {
            snapshotDeadline();
            return;
        }
        await beginSubscription();
    }
    async function beginSubscription() {
        await send(subscribeMessage(welcome.connectionGeneration, subscription));
        if (closed)
            return;
        snapshotDeadline();
        resolveReady();
        emit({ type: 'state', generation: bootstrap.generation, state: 'ready', transport: transport.kind });
    }
    async function acceptTopology(value) {
        if (!bootstrap.discovery || subscription)
            throw new Error('Unexpected topology replacement');
        const topology = topologyView(value);
        if (topology.worldId !== opaqueIdAt(welcome.worldId))
            throw new Error('Topology belongs to a different world');
        const available = bootstrap.transfers || bootstrap.strategic ? topology.hostedSystemIds : topology.systems.map(system => system.id);
        const systemId = bootstrap.discovery.preferredSystemId ?? available[0];
        if (!topology.systems.some(system => system.id === systemId))
            throw new Error('No permitted requested system in topology');
        if (!available.includes(systemId))
            throw new Error('Requested system is served by another host');
        subscription = { worldId: topology.worldId, systemId: systemId, subscriptionId: bootstrap.discovery.subscriptionId };
        stream = createSystemStream(subscription, requestSnapshot);
        emit({ type: 'topology', generation: bootstrap.generation, topology, subscription });
        await beginSubscription();
    }
    function projection(message, bytes) {
        const parent = traces && localProjectionTrace(message.projectionTrace);
        const trace = traces?.begin('network.projection', parent);
        try {
            const batch = packProjection(message.body, bytes);
            if (!batch)
                return;
            output.enqueue({ ...batch, clock: clock.anchor(), trace: trace && { context: trace.context, commandId: trace.commandId } });
            trace?.finish('ok');
            projectionReceived(batch);
        }
        catch (error) {
            trace?.finish('error', 'projection_pack');
            throw error;
        }
    }
    function packProjection(body, bytes) {
        if (!stream)
            throw new Error('Projection arrived before topology discovery');
        let batch;
        if (body.case === 'snapshot') {
            if (!stream.snapshot(body.value, bytes))
                return;
            scope = body.value.scope;
            batch = packSnapshot(body.value);
            owned?.snapshot(body.value, watermark(batch));
        }
        else if (body.case === 'delta') {
            if (!stream.delta(body.value))
                return;
            batch = packDelta(body.value);
            owned?.delta(body.value, watermark(batch));
        }
        else {
            throw new Error('Unexpected projection body');
        }
        return batch;
    }
    function projectionReceived(batch) {
        const state = stream.inspect();
        received = watermark(batch);
        if (!state.snapshotPending && !state.resyncPending) {
            clearTimeout(snapshotTimer);
            snapshotTimer = undefined;
        }
        emit({ type: 'received', streamGeneration: batch.streamGeneration, sequence: batch.sequence,
            systemRevision: batch.systemRevision, snapshotComplete: !state.snapshotPending, watermark: received });
    }
    async function receive(message, bytes) {
        if (welcome && message.connectionGeneration !== welcome.connectionGeneration)
            return;
        if (message.body.case === 'welcome') {
            await acceptWelcome(message.body.value);
            return;
        }
        if (message.body.case === 'failure')
            throw new Error(`Server protocol failure (${message.body.value.code})`);
        if (!welcome)
            throw new Error('Session data arrived before welcome');
        return receiveActive(message, bytes);
    }
    function receiveActive(message, bytes) {
        if (message.body.case === 'playbackClock') {
            corrections?.receive(message.body.value);
            return;
        }
        if (message.body.case === 'admissionRenewed') {
            acceptRenewal(message.body.value);
            return;
        }
        if (message.body.case === 'strategic') {
            if (!strategic)
                throw new Error('Strategic summaries were not negotiated');
            strategic.receive(message.body.value);
            return;
        }
        if (traces)
            collectNativeTraces(traces, message.diagnostics);
        if (message.body.case === 'topology')
            return acceptTopology(message.body.value);
        if (message.body.case === 'receipt')
            acceptReceipt(message.body.value);
        else
            projection(message, bytes);
    }
    function acceptReceipt(value) {
        if (value.result.case === 'unknown' && value.result.value.reason === CommandUnknownReason.EXPIRED)
            renewal?.expired(value.key);
        commands.receipt(value);
    }
    function acceptRenewal(value) {
        if (!renewal)
            throw new Error('Admission renewal was not negotiated');
        renewal.receive(value);
    }
    function acceptDatagram(frame) {
        if (!corrections || frame.byteLength > 1200)
            return;
        try {
            const bytes = unframeMessage(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength));
            const message = decodeServerMessage(bytes);
            if (message.connectionGeneration === welcome?.connectionGeneration && message.body.case === 'playbackClock')
                corrections.receive(message.body.value);
        }
        catch { /* Malformed optional datagrams never fail reliable gameplay. */ }
    }
    async function datagramLoop() {
        try {
            while (!closed) {
                const frame = await transport.receiveDatagram();
                if (closed || !frame)
                    return;
                acceptDatagram(frame);
            }
        }
        catch { /* The reliable stream owns connection failure. */ }
    }
    async function readLoop() {
        while (!closed) {
            const bytes = await transport.receive();
            if (closed)
                return;
            if (!bytes)
                throw new Error('Network transport ended');
            await receive(decodeServerMessage(bytes), bytes.byteLength);
        }
    }
    async function start() {
        const greeting = hello(bootstrap.credential, { ...bootstrap, discovery: !!bootstrap.discovery });
        validateSubscription();
        emit({ type: 'state', generation: bootstrap.generation, state: 'connecting' });
        const opened = await (options.transportFactory ?? connectTransport)(bootstrap.endpoints, controller.signal);
        if (closed) {
            opened.close();
            return;
        }
        transport = opened;
        sentAt = now();
        handshakeTimer = setTimeout(() => fail(new Error('Session welcome timed out')), SESSION_LIMITS.handshakeMs);
        await send(greeting);
        if (transport.receiveDatagram)
            void datagramLoop();
        await readLoop();
    }
    function validateSubscription() {
        if (bootstrap.strategic && !bootstrap.discovery)
            throw new Error('Strategic summaries require topology discovery');
        if (subscription) {
            opaqueIdBytes(subscription.worldId);
            opaqueIdBytes(subscription.systemId);
            opaqueIdBytes(subscription.subscriptionId);
        }
        else if (bootstrap.discovery) {
            opaqueIdBytes(bootstrap.discovery.subscriptionId);
            if (bootstrap.discovery.preferredSystemId)
                opaqueIdBytes(bootstrap.discovery.preferredSystemId);
        }
        else
            throw new Error('Explicit subscription or discovery is required');
    }
    async function control(message) {
        if (message.type === 'disconnect' || message.type === 'dispose') {
            dispose();
            return;
        }
        if (closed || !welcome)
            throw new Error('Network session is not ready');
        if (message.type === 'refreshPlayback') {
            corrections?.refresh();
            return;
        }
        if (message.type === 'strategicInterest') {
            await replaceStrategic(message.interest);
            return;
        }
        if (message.type === 'queryReceipt') {
            await queryReceipt(message);
            return;
        }
        await freshCommand(message);
    }
    async function freshCommand(message) {
        if (renewal && scope && message.type !== 'retry')
            await renewal.ensure(opaqueIdAt(scope.shardId));
        await submitCommand(message, prepareCommand(message));
    }
    async function submitCommand(message, command) {
        const trace = traces?.begin('network.command', message.context && { context: message.context, commandId: opaqueIdAt(command.key.commandId) });
        // Validate and encode before publishing pending intent; submit only afterward.
        const envelope = commandEnvelope(command);
        envelope.traceContext = wireTrace(trace?.context);
        const bytes = encodeClientMessage(envelope);
        try {
            // Managed UI acknowledges retaining the immutable intent before submission.
            await commands.beforeSend(message.requestId, command);
            if (closed)
                throw new Error('Network session closed before submission');
            await transport.send(bytes);
            trace?.finish('ok');
        }
        catch (error) {
            trace?.finish('error', 'submission_failed');
            fail(error);
            throw error;
        }
    }
    async function queryReceipt(message) {
        const trace = traces?.begin('network.command', message.context && { context: message.context, commandId: opaqueIdAt(message.key.commandId) });
        const envelope = clientMessage(welcome.connectionGeneration, { case: 'receiptQuery', value: {
                $typeName: 'galaxy.v1.ReceiptQuery', worldId: welcome.worldId, key: message.key,
            } });
        envelope.traceContext = wireTrace(trace?.context);
        try {
            await send(envelope);
            trace?.finish('ok');
        }
        catch (error) {
            trace?.finish('error', 'submission_failed');
            throw error;
        }
    }
    function commandEnvelope(command) {
        const body = command.$typeName === 'galaxy.v1.TransferCommand' ? { case: 'transfer', value: command } : { case: 'move', value: command };
        if (body.case === 'transfer' && !bootstrap.transfers)
            throw new Error('Cross-system transfers were not negotiated');
        return clientMessage(welcome.connectionGeneration, body);
    }
    function prepareCommand(message) {
        if (message.type === 'retry') {
            const command = message.command.$typeName === 'galaxy.v1.TransferCommand'
                ? create(TransferCommandSchema, message.command) : create(MoveCommandSchema, message.command);
            if (opaqueIdAt(command.scope.worldId) !== opaqueIdAt(welcome.worldId))
                throw new Error('Retry belongs to a different world');
            return command;
        }
        if (!scope || !stream || stream.inspect().snapshotPending)
            throw new Error('Move needs a complete system snapshot');
        return message.type === 'transfer' ? transferCommand(message, scope, welcome.admissions, clock.serverNow())
            : moveCommand(message, scope, welcome.admissions, clock.serverNow());
    }
    void start().catch(fail);
    function takeDiagnostics() {
        const queue = output.inspect();
        return { ...(traces?.take() ?? emptyTraces()), progress: { owner: 'network', connectionGeneration: bootstrap.generation,
                received: progressCursor(received), queuedBytes: queue.queuedBytes, queuedBatches: queue.queuedBatches,
                inFlightBytes: queue.inFlightBytes, inFlightBatches: queue.inFlightBatches } };
    }
    async function replaceStrategic(interest) {
        if (closed || !welcome || !strategic)
            throw new Error('Strategic summaries are not available');
        const value = strategic.replace(interest);
        await send(clientMessage(welcome.connectionGeneration, { case: 'subscribeStrategic', value: { $typeName: 'galaxy.v1.SubscribeStrategic', ...value } }));
    }
    return { ready, control, dispose: () => dispose(), takeDiagnostics, replaceStrategic,
        strategicSnapshot() {
            if (!strategic)
                throw new Error('Strategic summaries were not negotiated');
            return strategic.snapshot();
        },
        ownedShips(query) {
            if (closed || !owned)
                throw new Error('Owned projection is not available');
            return owned.page(query, clock.serverNow());
        },
        inspect: () => ({ closed, connectionGeneration: welcome?.connectionGeneration,
            pendingCommands: commands.inspect(), projection: output.inspect(), stream: stream?.inspect(), owned: owned?.inspect() }) };
}
//# sourceMappingURL=session.js.map