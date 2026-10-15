import { decimal, identifier, integer, object } from './contracts.js';
export function parsePage(input, fleet) {
    const value = object(input);
    if (value.systemId !== fleet.systemId || value.fleetId !== fleet.fleetId || typeof value.finished !== 'boolean')
        throw new Error('Wrong battle scope');
    const fleets = parseFleets(value.fleets), selectedSlot = integer(value.selectedSlot, 0, fleets.length - 1);
    if (!fleets[selectedSlot]?.[4])
        throw new Error('Selected battle fleet is not owned');
    const pages = integer(value.pages, 1, 32), page = integer(value.page, 0, pages - 1);
    const strategies = array(value.strategies, 6, 6).map(v => integer(v, 0, 8));
    const nextTurn = decimal(value.nextTurn);
    if (nextTurn < 1n)
        throw new Error('Invalid battle turn');
    const deadlineMs = value.deadlineMs === null ? null : decimal(value.deadlineMs);
    if (value.finished !== (deadlineMs === null))
        throw new Error('Invalid battle deadline');
    return { battleId: identifier(value.battleId), systemId: fleet.systemId, fleetId: fleet.fleetId, revision: decimal(value.revision), nextTurn,
        deadlineMs, tickMs: integer(value.tickMs, 1, 86400000), serverNowMs: decimal(value.serverNowMs), finished: value.finished,
        selectedSlot, planRevision: decimal(value.planRevision), strategies, page, pages, fleets, visuals: parseVisuals(value.visuals, fleets.length), groups: parseGroups(value.groups, fleets.length), receipt: parseReceipt(value.receipt) };
}
function array(value, min, max) { if (!Array.isArray(value) || value.length < min || value.length > max)
    throw new Error('Invalid battle rows'); return value; }
function parseFleets(input) {
    return array(input, 2, 16).map((row, index) => {
        const values = array(row, 5, 5), slot = integer(values[0], 0, 15), side = integer(values[1], 0, 1), status = integer(values[2], 0, 4), turns = integer(values[3], 0, 32), mine = integer(values[4], 0, 1);
        if (slot !== index || ((status === 1) !== (turns > 0)))
            throw new Error('Invalid battle fleet status');
        return [slot, side, status, turns, mine];
    });
}
function parseGroups(input, fleets) {
    let previous = -1;
    return array(input, 1, 8).map(row => {
        const values = array(row, 5, 5), fleet = integer(values[0], 0, fleets - 1), group = integer(values[1], 0, 15), role = integer(values[2], 1, 6), count = integer(values[3], 0, 1000000), lost = integer(values[4], 0, 1000000);
        const key = fleet * 16 + group;
        if (key <= previous || count + lost < 1 || count + lost > 1000000)
            throw new Error('Invalid battle group order');
        previous = key;
        return [fleet, group, role, count, lost];
    });
}
function parseReceipt(input) {
    if (input === undefined)
        return undefined;
    const value = object(input);
    return { commandId: identifier(value.commandId), effectiveTurn: decimal(value.effectiveTurn), planRevision: decimal(value.planRevision), cutoffMs: decimal(value.cutoffMs) };
}
function parseVisuals(input, count) {
    if (input === undefined)
        return;
    const seen = new Set();
    return array(input, count, count).map(row => {
        const pair = array(row, 2, 2), id = identifier(pair[0]);
        if (seen.has(id))
            throw new Error('Duplicate visual fleet');
        seen.add(id);
        const counts = array(pair[1], 6, 6).map(v => integer(v, 0, 1000000));
        if (counts.reduce((a, b) => a + b, 0) > 1000000)
            throw new Error('Invalid visual fleet counts');
        return [id, counts];
    });
}
//# sourceMappingURL=parse.js.map