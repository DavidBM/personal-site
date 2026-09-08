import { isRecord, serializeBusMessage } from './bus-types.js';
export async function publishAdmitted(bus, senderId, payload, priority, recipients, signal) {
    if (!isRecord(payload) || typeof payload.topic !== 'string')
        throw new Error('Invalid publication');
    const required = requiredRecipients(payload.requiredSubscribers);
    const targets = recipients(payload.topic, required).sort((a, b) => a.id.localeCompare(b.id));
    const message = { ...serializeBusMessage('pub_message', { topic: payload.topic, data: payload.data, senderId }, priority, 0),
        x: typeof payload.expiresAt === 'number' ? payload.expiresAt : undefined };
    const held = [];
    try {
        // Every publication reserves recipients in the same order. No payload is
        // posted until the complete current recipient set has credit.
        const measured = await acquire(bus, targets, message, held, signal);
        if (!measured)
            return;
        signal.throwIfAborted();
        for (const target of targets)
            if (!target.current())
                throw new Error(`Subscriber ${target.id} disconnected`);
        // Grants can take arbitrarily long, so verify the shared payload again.
        // All postMessage calls below clone synchronously in this same turn.
        const verified = bus._measureForAdmission(message);
        const outcomes = await Promise.allSettled(held.map(reservation => reservation.send(verified)));
        const failed = outcomes.find(outcome => outcome.status === 'rejected');
        if (failed?.status === 'rejected')
            throw failed.reason;
    }
    finally {
        for (const reservation of held)
            reservation.cancel();
    }
}
async function acquire(bus, targets, message, held, signal) {
    if (!targets.length)
        return;
    const measured = bus._measureForAdmission(message);
    for (const target of targets) {
        if (!target.current())
            throw new Error(`Subscriber ${target.id} disconnected`);
        const reservation = await bus._reserveTo(target.target, message, signal, measured);
        if (!reservation)
            return;
        held.push(reservation);
    }
    return measured;
}
function requiredRecipients(value) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value) || value.some(id => typeof id !== 'string'))
        throw new Error('Invalid required subscriber list');
    return value;
}
//# sourceMappingURL=broker-publication.js.map