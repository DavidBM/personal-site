/** A displayed detail page and its outstanding reads share one scope lifetime. */
export function createOnlineFleetList(render) {
    let generation = 0, offset = 0, next;
    function invalidate() { generation++; offset = 0; next = undefined; render(undefined, 0); }
    async function read(query, more) {
        const cursor = more ? next : { offset };
        if (!cursor)
            return;
        const ticket = ++generation;
        let page;
        try {
            page = await query({ ...cursor, limit: 256 });
        }
        catch (error) {
            if (ticket !== generation)
                return;
            throw error;
        }
        if (ticket !== generation)
            return;
        offset = cursor.offset;
        next = page.nextOffset === null ? undefined : { offset: page.nextOffset, required: page.seed.token };
        render(page, offset);
    }
    return { invalidate, read, first() { invalidate(); }, hasNext: () => !!next };
}
//# sourceMappingURL=online-fleet-list.js.map