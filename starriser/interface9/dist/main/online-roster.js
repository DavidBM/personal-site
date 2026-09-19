import { createOwnedRoster } from '../ui/owned-roster.js';
export function createOnlineRoster(parent, query, onView) {
    const panel = createOwnedRoster(parent, onView);
    let generation = 0, closed = false, timer;
    let names = new Map(), page;
    function clear() { generation++; clearTimeout(timer); timer = undefined; page = undefined; panel.clear(); }
    async function read(value) {
        const ticket = ++generation;
        try {
            const result = await query(value);
            if (closed || ticket !== generation)
                return;
            page = result;
            panel.render(result, names);
        }
        catch {
            if (ticket === generation) {
                page = undefined;
                panel.clear();
            }
        }
    }
    function schedule() { if (closed || timer)
        return; timer = setTimeout(() => { timer = undefined; void read({ limit: 64 }); }, 100); }
    function topology(value) { names = new Map(value?.systems.map(s => [s.id, s.name])); if (page)
        panel.render(page, names); }
    function state(slot, ready) {
        if (slot === 'owned') {
            if (ready)
                schedule();
            else
                clear();
        }
        if (slot === 'overview' && !ready)
            topology();
    }
    function event(value) {
        switch (value.type) {
            case 'topology':
                topology(value.topology);
                return;
            case 'viewBarrier':
                topology();
                clear();
                return;
            case 'viewChanged':
                state(value.status.slot, value.status.state === 'ready');
                return;
            case 'state':
                if (value.state === 'closed') {
                    topology();
                    clear();
                }
                return;
        }
    }
    panel.first.onclick = () => { void read({ limit: 64 }); };
    panel.next.onclick = () => { if (page?.nextOffset != null)
        void read({ offset: page.nextOffset, required: page.token, limit: 64 }); };
    return { event, clear, dispose() { closed = true; clear(); panel.dispose(); } };
}
//# sourceMappingURL=online-roster.js.map