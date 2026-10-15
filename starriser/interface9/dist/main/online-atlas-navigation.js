/** Retain small atlas labels; only one page has DOM nodes. System details stay
 * in the authorized view service and are fetched when a cluster is selected. */
export function createAtlasNavigation(parent, select) {
    const clusters = new Map();
    let page = 0;
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Find a cluster';
    search.setAttribute('aria-label', 'Find a cluster');
    const previous = document.createElement('button'), next = document.createElement('button'), count = document.createElement('span');
    previous.type = next.type = 'button';
    previous.textContent = 'Previous';
    next.textContent = 'Next';
    const list = document.createElement('ul');
    list.style.cssText = 'max-height:180px;overflow:auto;contain:layout paint;padding-left:18px';
    const rows = Array.from({ length: 32 }, () => {
        const item = document.createElement('li'), button = document.createElement('button'), text = document.createTextNode('');
        button.type = 'button';
        button.append(text);
        item.append(button);
        list.append(item);
        let id;
        button.onclick = () => { if (id !== undefined)
            select(`000000020000000000000000${id.toString(16).padStart(8, '0')}`); };
        return { update(value) { id = value?.id; item.hidden = !value; text.data = value?.name ?? ''; } };
    });
    parent.append(search, previous, count, next, list);
    function render() {
        const query = search.value.trim().toLowerCase();
        const values = [...clusters.values()].filter(c => c.name.toLowerCase().includes(query)).sort((a, b) => a.id - b.id);
        page = Math.min(page, Math.max(0, Math.ceil(values.length / rows.length) - 1));
        rows.forEach((row, i) => row.update(values[page * rows.length + i]));
        previous.disabled = page === 0;
        next.disabled = (page + 1) * rows.length >= values.length;
        count.textContent = ` ${values.length} clusters · page ${page + 1} `;
    }
    search.oninput = () => { page = 0; render(); };
    previous.onclick = () => { page--; render(); };
    next.onclick = () => { page++; render(); };
    render();
    return {
        accept(values) {
            for (const c of values) {
                if (!clusters.has(c.id) && clusters.size >= 8192)
                    throw new Error('Atlas navigation capacity');
                clusters.set(c.id, { id: c.id, name: c.name });
            }
            render();
        },
        reset() { clusters.clear(); page = 0; search.value = ''; render(); },
    };
}
//# sourceMappingURL=online-atlas-navigation.js.map