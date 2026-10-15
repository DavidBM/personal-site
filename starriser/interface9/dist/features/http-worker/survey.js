import { GameplayOperation as Op, gameplayPayload } from '../../contracts/gameplay.js';
import { callGameplay } from './live.js';
import { featureRequest, FeatureError } from './client.js';
import { identifier, decimal } from '../../lib/battle-content/contracts.js';
export async function requestSurvey(scope, query, signal) {
    if (typeof window !== 'undefined')
        return featureRequest('survey', [scope, query], signal);
    identifier(scope.worldId);
    if (decimal(scope.visibilityEpoch) < 1n)
        throw new Error('Invalid survey scope');
    const body = JSON.stringify({ worldId: scope.worldId, visibilityEpoch: scope.visibilityEpoch, ...query });
    if (body.length > 1024)
        throw new Error('Survey request exceeds budget');
    const response = await (callGameplay)(Op.SURVEY, body, signal);
    if (response.status !== 200) {
        throw new FeatureError('Survey unavailable', response.status);
    }
    if (response.visibilityEpoch !== scope.visibilityEpoch) {
        throw new Error('Survey permission changed');
    }
    return parseSurvey(await read(response, signal), query);
}
export function parseSurvey(bytes, query) {
    if (bytes.length > 3072)
        throw new Error('Survey response exceeds budget');
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (query.action === 'battleScene')
        return battleScene(value, query.system);
    if (query.action === 'planetPresence')
        return presencePage(value, query.system);
    if (query.action === 'systems')
        return systems(value, query.systems);
    if (query.action === 'ownedPlanets')
        return planetPage(value);
    return alertPage(value);
}
function alertPage(value) {
    if (!Array.isArray(value.alerts) || value.alerts.length > 16)
        throw new Error('Invalid alert page');
    for (const row of value.alerts) {
        if (!Array.isArray(row) || row.length !== 4)
            throw new Error('Invalid alert row');
        for (const id of row.slice(0, 3))
            identifier(id);
        decimal(row[3]);
    }
    if (value.next !== null && (typeof value.next !== 'string' || !/^[a-f0-9]{32}:(?:[a-f0-9]{32}|0)$/.test(value.next)))
        throw new Error('Invalid alert cursor');
    return { alerts: value.alerts, next: value.next };
}
function systems(value, ids) {
    if (!Array.isArray(value.systems) || value.systems.length !== ids.length)
        throw new Error('Invalid discovery page');
    for (let i = 0; i < ids.length; i++)
        systemRow(value.systems[i], ids[i]);
    return { systems: value.systems };
}
function systemRow(row, id) {
    if (!Array.isArray(row) || row.length !== 3 || row[0] !== id)
        throw new Error('Wrong discovery system');
    if (row[1] === null) {
        if (row[2] !== null)
            throw new Error('Invalid unavailable catalog');
        return;
    }
    if (!Number.isInteger(row[1]) || row[1] < 0 || row[1] > 64 || !validVersion(row[2]))
        throw new Error('Invalid catalog summary');
}
function read(response, signal) { return gameplayPayload(response, signal, 3072); }
function validVersion(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function planetPage(value) {
    if (!Array.isArray(value.planets) || value.planets.length > 16)
        throw new Error('Invalid owned planet page');
    for (const row of value.planets) {
        if (!Array.isArray(row) || row.length !== 5)
            throw new Error('Invalid owned planet row');
        for (const id of row.slice(0, 3))
            identifier(id);
        if (!Number.isFinite(row[3]) || !Number.isFinite(row[4]))
            throw new Error('Invalid planet position');
    }
    if (value.next !== null && (typeof value.next !== 'string' || !/^[a-f0-9]{32}:(?:[a-f0-9]{32}|0)$/.test(value.next)))
        throw new Error('Invalid planet cursor');
    return { planets: value.planets, next: value.next };
}
function presencePage(value, system) {
    identifier(value.cluster);
    if (value.system !== system || typeof value.direct !== 'boolean' || !Array.isArray(value.owners) || value.owners.length > 8 || !Array.isArray(value.stationed) || value.stationed.length > 15)
        throw new Error('Invalid planet presence');
    for (const row of value.owners) {
        if (!Array.isArray(row) || row.length !== 4)
            throw new Error('Invalid planet owner');
        identifier(row[0]);
        identifier(row[1]);
        if (typeof row[2] !== 'string' || [...row[2]].length > 32 || /[\x00-\x1f\x7f]/.test(row[2]) || !['own', 'neutral', 'enemy'].includes(row[3]))
            throw new Error('Invalid planet owner name');
    }
    const seen = new Set();
    for (const row of value.stationed) {
        if (!value.direct || !Array.isArray(row) || row.length !== 3 || !Number.isInteger(row[0]) || row[0] < 1 || row[0] > 15 || seen.has(row[0]) || row.slice(1).some((n) => !Number.isSafeInteger(n) || n < 0 || n > 4096000000))
            throw new Error('Invalid stationed ships');
        seen.add(row[0]);
    }
    if (value.next !== null)
        identifier(value.next);
    return { presence: { system, cluster: value.cluster, direct: value.direct, owners: value.owners, stationed: value.stationed }, next: value.next };
}
function battleScene(value, system) {
    if (value.system !== system || !Array.isArray(value.battles) || value.battles.length > 16)
        throw new Error('Invalid scene battle page');
    let previous = '';
    for (const row of value.battles) {
        if (!Array.isArray(row) || row.length !== 3)
            throw new Error('Invalid scene battle');
        identifier(row[0]);
        identifier(row[1]);
        decimal(row[2]);
        if (row[0] <= previous)
            throw new Error('Unordered scene battles');
        previous = row[0];
    }
    if (value.next !== null && (identifier(value.next) !== previous || !previous))
        throw new Error('Invalid scene battle cursor');
    return { battles: value.battles, next: value.next };
}
//# sourceMappingURL=survey.js.map