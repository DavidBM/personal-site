import { SURVEY_RELATIONSHIP_COLORS } from '../../../contracts/survey-signals.js';
export const CLUSTER_MARKER_MIN_RADIUS = 13, CLUSTER_MARKER_MAX_RADIUS = 26;
export const CLUSTER_LABEL_WIDTH = 278, CLUSTER_LABEL_HEIGHT = 112;
export const CLUSTER_DOT_RADIUS = 2;
const INK = [0.65, 0.83, 0.94], TEXT = [0.8, 0.88, 0.93], MUTED = [0.48, 0.63, 0.73];
const PLANETS = [0.4, 0.9, 0.66], OWN_ALERT = [1, 0.3, 0.32], ALLY_ALERT = [1, 0.75, 0.25];
export const clusterMarkerRadius = (span) => Math.min(CLUSTER_MARKER_MAX_RADIUS, CLUSTER_MARKER_MIN_RADIUS + span * 0.04);
/** Camera height matches Stats. Preserve the approved 155k–200k decluttering range. */
export function clusterMarkerDetail(zoom) {
    const t = Math.max(0, Math.min(1, (zoom - 155000) / 45000));
    return 1 - t * t * (3 - 2 * t);
}
export const markerReveal = (span, start) => Math.max(0, Math.min(1, (span - start) / 40));
export const markerPulse = (seconds, reducedMotion = false) => reducedMotion ? 1 : 0.82 + 0.18 * Math.sin(seconds * Math.PI / 2) ** 2;
const DATA = { fleets: 0, ships: 0, relationships: [], systems: 0, planets: 0, inbound: 0, outbound: 0, alert: null };
function markerData(a, totals, signals) {
    const id = a.meta.clusterId, system = a.systemId;
    const counts = system === undefined ? clusterCounts(totals, id) : totals.getSystem(system);
    const ships = totals.ships.get(system ?? id, system !== undefined);
    DATA.fleets = counts.fleets;
    DATA.inbound = counts.inbound;
    DATA.outbound = counts.outbound;
    DATA.ships = ships.count;
    DATA.relationships = ships.count ? ships.relationships : totals.getRelationships(system ?? id, system !== undefined);
    DATA.systems = system === undefined ? a.meta.systemIds.length : 0;
    DATA.planets = signals?.planetCount(id, system) ?? 0;
    DATA.alert = alertKind(signals?.alerts(id, system));
    return DATA;
}
const CLUSTER_COUNTS = { fleets: 0, inbound: 0, outbound: 0 };
function clusterCounts(totals, id) {
    const c = totals.get(id);
    CLUSTER_COUNTS.fleets = c.fleets + c.transit;
    CLUSTER_COUNTS.inbound = c.inbound;
    CLUSTER_COUNTS.outbound = totals.getOutbound(id);
    return CLUSTER_COUNTS;
}
function alertKind(alerts) { return alerts?.own ? 'own' : alerts?.ally ? 'ally' : null; }
function alertColor(kind) { return kind === 'own' ? OWN_ALERT : kind === 'ally' ? ALLY_ALERT : INK; }
/** Same six faces at both scopes; empty data never reserves ink or a hit target. */
export function drawClusterMarker(a, totals, ink, detail = 1, signals, pulse = 1, tint) {
    const data = markerData(a, totals, signals), color = data.alert ? alertColor(data.alert) : (tint ?? INK);
    const base = a.label ? Math.max(22, a.radius) : a.radius;
    const radius = CLUSTER_DOT_RADIUS + (base - CLUSTER_DOT_RADIUS) * detail;
    if (detail < 1)
        ink.dot(a.x, a.y, CLUSTER_DOT_RADIUS, color, 1 - detail);
    if (detail <= 0)
        return;
    if (a.label)
        drawRibbons(a, data, ink, radius, detail);
    ink.icon(a.x, a.y, radius, color, detail, data.alert ? 4 : 0);
    drawFaces(a, data, ink, radius, detail * pulse);
    if (data.alert)
        ink.alertHit?.(a.x, a.y, radius, detail, a.meta.clusterId, a.systemId);
}
function dominant(relationships) {
    let index = -1, count = 0;
    for (let i = 0; i < relationships.length; i++)
        if (relationships[i] > count) {
            count = relationships[i];
            index = i;
        }
    return index < 0 ? MUTED : SURVEY_RELATIONSHIP_COLORS[index];
}
function drawRibbons(a, d, ink, r, detail) {
    const h = r * 0.8660254, height = Math.max(18, h), early = markerReveal(a.span, 32) * detail;
    if (d.fleets) {
        sideRibbon(a, ink, r, h, 1, -1, d.ships ? `${d.ships} SHIPS` : `${d.fleets} FLEETS`, 'fleets', dominant(d.relationships), early);
        mixLine(ink, a.x + r + 8, a.y - 3, a.x + r + 96, a.y - 3, d.relationships, early, 2, d.ships);
    }
    if (d.planets)
        sideRibbon(a, ink, r, h, -1, -1, `${d.planets} PLANETS`, 'planets', PLANETS, early);
    if (d.inbound)
        sideRibbon(a, ink, r, h, 1, 1, `${d.inbound} INBOUND`, 'inbound', INK, markerReveal(a.span, 72) * detail);
    if (d.outbound)
        sideRibbon(a, ink, r, h, -1, 1, `${d.outbound} OUTBOUND`, 'outbound', INK, markerReveal(a.span, 72) * detail);
    if (d.systems)
        flatRibbon(a, ink, a.y + h + 1, 108, height, `${d.systems} SYSTEMS`, 'systems', INK, markerReveal(a.span, 96) * detail);
    flatRibbon(a, ink, a.y - h - height - 1, 146, height, a.meta.name.toUpperCase().slice(0, 22), 'details', INK, markerReveal(a.span, 48) * detail);
}
function drawFaces(a, d, ink, r, alpha) {
    const x = a.x, y = a.y, h = r * 0.8660254;
    if (d.fleets) {
        mixLine(ink, x + r / 2, y - h, x + r, y, d.relationships, alpha, 2.8, d.ships);
        ink.faceTriangle(x + r * 0.75, y - h / 2, 0.8660254, -0.5, dominant(d.relationships), alpha);
    }
    if (d.planets)
        face(ink, x - r, y, x - r / 2, y - h, PLANETS, alpha);
    if (d.inbound)
        face(ink, x + r, y, x + r / 2, y + h, INK, alpha);
    if (d.outbound)
        face(ink, x - r / 2, y + h, x - r, y, INK, alpha);
}
function face(ink, ax, ay, bx, by, color, alpha) {
    ink.edge(ax, ay, bx, by, color, alpha, 2.8);
    // Faces are clockwise in screen space: the right-hand normal points outside.
    const length = Math.hypot(bx - ax, by - ay);
    ink.faceTriangle((ax + bx) / 2, (ay + by) / 2, (by - ay) / length, (ax - bx) / length, color, alpha);
}
function mixLine(ink, ax, ay, bx, by, relationships, alpha, thickness, count = 0) {
    const total = Math.max(count, relationships.reduce((sum, n) => sum + n, 0));
    if (!total) {
        ink.edge(ax, ay, bx, by, MUTED, alpha, thickness);
        return;
    }
    let start = 0;
    for (let i = 0; i < 4; i++) {
        const end = start + relationships[i] / total;
        if (end > start)
            ink.edge(ax + (bx - ax) * start, ay + (by - ay) * start, ax + (bx - ax) * end, ay + (by - ay) * end, SURVEY_RELATIONSHIP_COLORS[i], alpha, thickness);
        start = end;
    }
    if (start < 1)
        ink.edge(ax + (bx - ax) * start, ay + (by - ay) * start, bx, by, MUTED, alpha, thickness);
}
function sideRibbon(a, ink, r, h, side, vertical, label, section, color, alpha) {
    if (alpha <= 0)
        return;
    const width = 108 + r / 2, height = h - 1, x = a.x + (side > 0 ? r / 2 : -r - 108);
    const y = a.y + (vertical < 0 ? -h : 1), slope = vertical < 0 ? r / 2 : -r / 2;
    const inset = vertical < 0 ? 0 : r / 2;
    ink.ribbon(x, y, width, height, side, inset, slope, color, alpha, a.meta.clusterId, section, a.systemId);
    ink.text(label, side > 0 ? a.x + r + 8 : a.x - r - 16 - label.length * 6, y + (height - 16) / 2 - (section === 'fleets' ? 1 : 0), TEXT, alpha);
}
function flatRibbon(a, ink, y, width, height, label, section, color, alpha) {
    if (alpha <= 0)
        return;
    ink.ribbon(a.x - width / 2, y, width, height, 0, 0, 0, color, alpha, a.meta.clusterId, section, a.systemId);
    ink.text(label, a.x - label.length * 3, y + (height - 16) / 2, TEXT, alpha);
}
//# sourceMappingURL=cluster-marker.js.map