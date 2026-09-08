const BLOCK_SIZE = 256;
const createBlock = () => ({ values: [], next: null });
/** O(1) FIFO removal and payload release; no whole-backlog copies during a drain. */
export function createBusMessageQueue() {
    let head = createBlock();
    let tail = head;
    let readIndex = 0;
    let writeIndex = 0;
    let length = 0;
    const clear = () => {
        head = tail;
        head.values.length = 0;
        head.next = null;
        readIndex = 0;
        writeIndex = 0;
        length = 0;
    };
    return {
        get length() { return length; },
        peek() { return head.values[readIndex]; },
        push(message) {
            if (writeIndex === BLOCK_SIZE) {
                const next = createBlock();
                tail.next = next;
                tail = next;
                writeIndex = 0;
            }
            tail.values[writeIndex++] = message;
            length++;
        },
        take() {
            if (length === 0)
                return undefined;
            const message = head.values[readIndex];
            head.values[readIndex++] = undefined;
            length--;
            if (length === 0)
                clear();
            else if (readIndex === BLOCK_SIZE) {
                head = head.next;
                readIndex = 0;
            }
            return message;
        },
        clear,
    };
}
//# sourceMappingURL=bus-message-queue.js.map