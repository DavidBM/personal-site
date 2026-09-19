import { create } from '@bufbuild/protobuf';
import { MoveCommandSchema, TransferCommandSchema, CommandUnknownReason } from '../generated/galaxy/v1/galaxy_pb.js';
import { openPlayerHome } from './home.js';
import { createViewAdmissions } from './admissions.js';
import { createPlayerViewBridge } from './bridge.js';
import { createProjectionOutput } from '../projection-output.js';
import { createSessionClock } from '../session-clock.js';
import { createCommandTracker } from '../command-tracker.js';
import { decodeServerMessage, encodeClientMessage } from '../codec.js';
import { clientMessage, moveCommand, transferCommand } from '../messages.js';
import { opaqueIdAt } from '../../contracts/opaque-id.js';
import { emptyTraces } from '../../debug/worker-traces.js';
export function createPlayerSession(options) {
    const { bootstrap, emit } = options, controller = new AbortController();
    const now = options.now ?? (() => performance.now()), clock = createSessionClock(now, options.timeOriginMs ?? performance.timeOrigin);
    const tracker = createCommandTracker(emit);
    let closed = false, transport, welcome, views, admissions;
    let resolveReady, rejectReady;
    const ready = new Promise((yes, no) => { resolveReady = yes; rejectReady = no; });
    void ready.catch(() => { });
    const output = createProjectionOutput(bootstrap.renderPort, bootstrap.generation, fail);
    const deadline = setTimeout(() => fail(new Error('Player home handshake timed out')), 15000);
    function dispose(error = new Error('Network session disposed')) {
        if (closed)
            return;
        closed = true;
        clearTimeout(deadline);
        controller.abort();
        transport?.close();
        admissions?.dispose();
        views?.dispose();
        output.dispose();
        tracker.dispose();
        rejectReady(error);
        void emit({ type: 'state', generation: bootstrap.generation, state: 'closed' });
    }
    function fail(value) { const error = value instanceof Error ? value : new Error(String(value)); if (closed)
        return; void emit({ type: 'error', message: error.message }); dispose(error); }
    async function send(body) { if (closed || !welcome || !transport)
        throw new Error('Player session unavailable'); await transport.send(encodeClientMessage(clientMessage(welcome.connectionGeneration, body))); }
    async function start() {
        void emit({ type: 'state', generation: bootstrap.generation, state: 'connecting' });
        const sentAt = now();
        const home = await openPlayerHome({ endpoints: bootstrap.endpoints, credential: bootstrap.credential, expected: bootstrap.playerViews, signal: controller.signal, factory: options.transportFactory });
        if (closed) {
            home.transport.close();
            return;
        }
        transport = home.transport;
        welcome = home.welcome;
        clearTimeout(deadline);
        const world = opaqueIdAt(welcome.worldId), player = opaqueIdAt(welcome.playerId);
        void emit({ type: 'welcome', generation: bootstrap.generation, worldId: world, playerId: player, connectionGeneration: welcome.connectionGeneration, clock: clock.sample(welcome.serverTimeMs, sentAt) });
        admissions = createViewAdmissions({ world, serverNow: clock.serverNow, send: value => send({ case: 'renewAdmission', value }) });
        const subscription = bootstrap.discovery?.subscriptionId ?? bootstrap.subscription.subscriptionId;
        views = createPlayerViewBridge({ interests: bootstrap.viewInterests, world, player, connection: welcome.connectionGeneration, generation: bootstrap.generation, subscriptionId: subscription, preferred: bootstrap.discovery?.preferredSystemId ?? bootstrap.subscription?.systemId,
            send: value => send({ case: 'viewRequest', value }), emit, output, clock: clock.anchor, policy: () => admissions.invalidate() });
        await views.start();
        resolveReady();
        void emit({ type: 'state', generation: bootstrap.generation, state: 'ready', transport: transport.kind });
        await readMessages();
    }
    async function readMessages() {
        while (!closed) {
            const bytes = await transport.receive();
            if (closed)
                return;
            if (!bytes)
                throw new Error('Player transport ended');
            const message = decodeServerMessage(bytes);
            if (message.connectionGeneration !== welcome.connectionGeneration)
                continue;
            switch (message.body.case) {
                case 'viewEvent':
                    views.receive(message.body.value, bytes.byteLength);
                    break;
                case 'admissionRenewed':
                    admissions.receive(message.body.value);
                    break;
                case 'receipt':
                    receipt(message.body.value);
                    break;
                case 'failure': throw new Error(`Player protocol failure ${message.body.value.code}`);
                default: throw new Error('Legacy observation is not valid on a player-view session');
            }
        }
    }
    function receipt(value) {
        if (value.key && value.result.case === 'unknown' && value.result.value.reason === CommandUnknownReason.EXPIRED)
            admissions?.expired(value.key);
        tracker.receipt(value);
    }
    async function submit(message) {
        if (!welcome || !views || !admissions || !transport)
            throw new Error('Player session unavailable');
        let command;
        if (message.type === 'retry') {
            command = message.command.$typeName === 'galaxy.v1.TransferCommand' ? create(TransferCommandSchema, message.command) : create(MoveCommandSchema, message.command);
            if (opaqueIdAt(command.scope.worldId) !== opaqueIdAt(welcome.worldId))
                throw new Error('Retry world changed');
        }
        else {
            command = await freshCommand(message);
        }
        const body = command.$typeName === 'galaxy.v1.TransferCommand' ? { case: 'transfer', value: command } : { case: 'move', value: command };
        const bytes = encodeClientMessage(clientMessage(welcome.connectionGeneration, body));
        await tracker.beforeSend(message.requestId, command);
        if (closed)
            throw new Error('Session closed before command submission');
        await transport.send(bytes);
    }
    async function freshCommand(message) {
        if (!views || !admissions)
            throw new Error('Player session unavailable');
        const before = views.detail.current();
        if (!before)
            throw new Error('Complete authorized detail required');
        const admitted = await admissions.ensure(opaqueIdAt(before.scope.systemId));
        const current = views.detail.current();
        if (!current || current.generation !== before.generation || current.request !== before.request)
            throw new Error('Command detail was superseded');
        requireSameAuthority(admitted.scope, before.scope);
        return message.type === 'move' ? moveCommand(message, before.scope, [admitted.grant], clock.serverNow()) : transferCommand(message, before.scope, [admitted.grant], clock.serverNow());
    }
    async function control(message) {
        if (message.type === 'disconnect' || message.type === 'dispose') {
            dispose();
            return;
        }
        if (closed || !welcome)
            throw new Error('Player session unavailable');
        if (message.type === 'refreshPlayback')
            return;
        if (message.type === 'strategicInterest') {
            await replaceStrategic(message.interest);
            return;
        }
        if (message.type === 'queryReceipt') {
            await send({ case: 'receiptQuery', value: { $typeName: 'galaxy.v1.ReceiptQuery', worldId: welcome.worldId, key: message.key } });
            return;
        }
        await submit(message);
    }
    async function replaceStrategic(value) { if (!views || value.connectionGeneration !== bootstrap.generation)
        throw new Error('View owner changed'); views.overview.interest(value.systemIds, value.interestGeneration); void emit({ type: 'strategic', frontier: views.overview.frontier() }); }
    void start().catch(fail);
    return { ready, control, dispose: () => dispose(), get views() { return views; }, replaceStrategic,
        strategicSnapshot() { if (!views)
            throw new Error('Overview unavailable'); return views.overview.snapshot(); },
        ownedFleets(query) { if (!views)
            throw new Error('Detail seed unavailable'); return views.detail.page(query, clock.serverNow()); },
        takeDiagnostics: () => emptyTraces(), inspect: () => ({ closed, connectionGeneration: welcome?.connectionGeneration, pendingCommands: tracker.inspect(), projection: output.inspect(), views: views?.inspect() }) };
}
function requireSameAuthority(a, b) {
    if (a.ownerEpoch !== b.ownerEpoch || a.recoveryGeneration !== b.recoveryGeneration || opaqueIdAt(a.shardId) !== opaqueIdAt(b.shardId))
        throw new Error('Command source authority changed');
}
//# sourceMappingURL=session.js.map