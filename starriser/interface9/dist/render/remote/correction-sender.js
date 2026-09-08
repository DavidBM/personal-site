import { validatePlaybackCorrection } from './playback-correction.js';
/** One active port message and one replaceable pending observation. Credit is
 * returned only after serialized render consumption, including a stale drop. */
export function createCorrectionSender(port, generation) {
    let pending, active = 0, serial = 0, closed = false;
    function flush() {
        if (closed || active || !pending)
            return;
        if (serial === Number.MAX_SAFE_INTEGER) {
            pending = undefined;
            return;
        }
        const correction = pending;
        pending = undefined;
        active = ++serial;
        port.postMessage({ type: 'playbackCorrection', connectionGeneration: generation, ticket: active, correction });
    }
    function receive({ data }) {
        if (data?.type !== 'playbackConsumed' || data.connectionGeneration !== generation || !active || data.ticket !== active)
            return;
        active = 0;
        flush();
    }
    port.addEventListener('message', receive);
    return {
        send(value) { if (closed)
            return; validatePlaybackCorrection(value); pending = value; flush(); },
        inspect: () => ({ active: Number(!!active), pending: Number(!!pending) }),
        dispose() { closed = true; pending = undefined; active = 0; port.removeEventListener('message', receive); },
    };
}
//# sourceMappingURL=correction-sender.js.map