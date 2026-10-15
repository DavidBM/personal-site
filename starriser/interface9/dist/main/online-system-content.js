/** Two small authorized records: the inspected system and the next journey hop.
 * Promotion joins an in-flight read; it never races a duplicate cache request. */
export function createOnlineSystemContent(ports) {
    let selected, destination;
    const entries = new Map();
    async function publish(id, entry) {
        if (entry.abort.signal.aborted || !entry.record)
            return;
        const role = id === selected ? 'selected' : 'preview';
        if (entry.published === role)
            return;
        entry.published = role;
        await ports[role](entry.record);
    }
    async function read(id, entry) {
        try {
            entry.record = await ports.load(id, entry.abort.signal);
            await publish(id, entry);
        }
        catch (error) {
            if (!entry.abort.signal.aborted && entries.get(id) === entry)
                entries.delete(id);
            ports.failed(error, entry.abort.signal);
        }
        finally {
            entry.pending = false;
            // A fast A -> B -> A must wait for the cancelled cache read to retire.
            if (entry.abort.signal.aborted && entries.get(id) === entry) {
                entries.delete(id);
                sync();
            }
        }
    }
    function sync() {
        for (const [id, entry] of entries)
            if (id !== selected && id !== destination) {
                entry.abort.abort();
                if (!entry.pending)
                    entries.delete(id);
            }
        for (const id of new Set([selected, destination])) {
            if (id === undefined)
                continue;
            const previous = entries.get(id);
            if (previous) {
                void publish(id, previous).catch(error => ports.failed(error, previous.abort.signal));
                continue;
            }
            const entry = { abort: new AbortController(), pending: true };
            entries.set(id, entry);
            void read(id, entry);
        }
    }
    return {
        select(id) { selected = id; sync(); },
        prefetch(id) { destination = id; sync(); },
        reset() {
            selected = destination = undefined;
            for (const entry of entries.values())
                entry.abort.abort();
            entries.clear();
        },
    };
}
//# sourceMappingURL=online-system-content.js.map