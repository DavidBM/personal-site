import { isRecord } from "./bus-types.js";
import { createBusMessageQueue } from "./bus-message-queue.js";
import { createBusWakeup } from "./bus-wakeup.js";
import { createBusCapacity } from './bus-capacity.js';
import { estimateBusPayloadBytes, DEFAULT_BUS_BYTES } from './bus-payload-size.js';
const PRIORITY_ORDER = [0, 0, 0, 0, 1, 1, 1, 2];
/** Reserved traffic reuses its validated footprint; raw ingress is measured. */
function payloadBytes(delivery, options, reserved) {
    if (reserved?.bytes !== undefined)
        return reserved.bytes;
    const { t, d } = accountedMessage(delivery.message);
    const floor = Math.max(byteHint(delivery.message.k), byteHint(options.messageBytes?.(t, d)));
    const limit = options.maxQueuedBytes ?? DEFAULT_BUS_BYTES;
    const measured = 1024 + t.length * 2 + estimateBusPayloadBytes(d, limit);
    if (measured > limit)
        throw new Error('Bus payload exceeds queue byte capacity');
    return Math.max(measured, floor);
}
function byteHint(value) {
    if (value === undefined)
        return 0;
    if (!Number.isSafeInteger(value) || value < 0)
        throw new Error('Invalid Bus byte estimate');
    return value;
}
/** Unwrap only the known broker envelopes, never traverse arbitrary objects. */
function accountedMessage(message) {
    let value = message;
    if (message.t === "__broker_port_message" && isRecord(message.d) && isRecord(message.d.message)) {
        const nested = message.d.message;
        value = { t: String(nested.t), d: nested.d };
    }
    return value;
}
/** Bounded admission and cooperative scheduling, shared by every ingress path. */
export function createBusDispatcher(options, execute, failed) {
    const queues = [0, 1, 2, 3].map(() => createBusMessageQueue());
    const lanes = new Map();
    const capacity = createBusCapacity(options);
    let active = 0, expired = 0;
    let cursor = 0, turn = 0, draining = false, disposed = false;
    let admissionOrder = 0;
    const wake = createBusWakeup(drain);
    function ready(entry) {
        queues[entry.delivery.control ? 3 : entry.delivery.message.p].push(entry);
        wake.schedule();
    }
    async function enqueue(delivery, reservation) {
        const measured = payloadBytes(delivery, options, reservation);
        const size = { bytes: measured, control: Boolean(delivery.control) };
        const credit = reservation ?? capacity.tryReserve(size) ?? await pendingCredit(size, delivery.message.x);
        if (!credit) {
            expired++;
            return;
        }
        if (disposed) {
            credit.release();
            throw new Error('Bus destroyed');
        }
        validateCredit(credit, delivery, measured);
        credit.claim();
        const entry = { delivery, reservation: credit, order: ++admissionOrder };
        if (!delivery.ordered) {
            ready(entry);
            return;
        }
        let lane = lanes.get(delivery.ordered);
        if (!lane) {
            lane = { queue: createBusMessageQueue(), active: false };
            lanes.set(delivery.ordered, lane);
        }
        entry.lane = lane;
        if (lane.active)
            lane.queue.push(entry);
        else {
            lane.active = true;
            ready(entry);
        }
    }
    async function pendingCredit(size, deadline) {
        if (deadline === undefined)
            return capacity.reserve(size);
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), Math.max(0, deadline - performance.timeOrigin - performance.now()));
        try {
            return await capacity.reserve(size, abort.signal);
        }
        catch (error) {
            if (abort.signal.aborted)
                return undefined;
            throw error;
        }
        finally {
            clearTimeout(timer);
        }
    }
    function take() {
        if (turn++ % 4 === 0 && queues[3].length)
            return queues[3].take();
        for (let i = 0; i < PRIORITY_ORDER.length; i++) {
            const queue = queues[PRIORITY_ORDER[cursor++ % PRIORITY_ORDER.length]];
            const entry = queue.peek();
            if (entry)
                return takeAfterPrerequisites(queue, entry);
        }
        return queues[3].take();
    }
    function takeAfterPrerequisites(queue, entry) {
        const control = queues[3].peek();
        // A scheduler phase must never let publish pass an earlier subscribe/register.
        if (control && control.order < entry.order)
            return queues[3].take();
        return queue.take();
    }
    function finish(entry) {
        if (disposed)
            return;
        active--;
        entry.reservation.release();
        if (!entry.lane)
            return;
        const next = entry.lane.queue.take();
        if (next)
            ready(next);
        else {
            entry.lane.active = false;
            lanes.delete(entry.delivery.ordered);
        }
    }
    function run(entry) {
        active++;
        if (entry.delivery.message.x !== undefined && performance.timeOrigin + performance.now() >= entry.delivery.message.x) {
            expired++;
            finish(entry);
            return;
        }
        try {
            const result = execute(entry.delivery);
            if (result) {
                void result.finally(() => finish(entry)).catch(() => { });
                return;
            }
        }
        catch (error) {
            failed(entry.delivery, String(error));
            finish(entry);
            return;
        }
        finish(entry);
    }
    function drain() {
        if (disposed || draining)
            return;
        wake.cancel();
        draining = true;
        const deadline = performance.now() + 2;
        try {
            for (let n = 0; n < 256 && performance.now() < deadline; n++) {
                const entry = take();
                if (!entry)
                    break;
                run(entry);
                if (disposed)
                    break;
            }
        }
        finally {
            draining = false;
            if (queues.some(queue => queue.length > 0))
                wake.schedule();
        }
    }
    return {
        enqueue, drain, reserve: capacity.reserve,
        estimate: (message) => payloadBytes({ message }, options),
        stats: () => ({ ...capacity.stats(), activeMessages: active, expiredMessages: expired }),
        dispose() {
            disposed = true;
            capacity.dispose();
            wake.dispose();
            for (const queue of queues)
                queue.clear();
            for (const lane of lanes.values())
                lane.queue.clear();
            lanes.clear();
            active = 0;
        },
    };
}
function validateCredit(credit, delivery, measured) {
    if (credit.control !== Boolean(delivery.control) || measured > (credit.bytes ?? 0)) {
        credit.release();
        throw new Error('Bus payload exceeds its reservation');
    }
}
//# sourceMappingURL=bus-dispatcher.js.map