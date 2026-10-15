const INK = [.35, .88, 1], ALERT = [1, .35, .32], HOVER = [.9, .98, 1];
export const FLEET_PIN_SYMBOL = { ready: 2, move: 5, jump: 6, cooldown: 7, orbit: 8, battle: 9 };
let previousCount, label = '-- SHIPS';
/** Constant-size edge pin remains discoverable even when its fleet is offscreen. */
export function projectFleetPin(matrix, x, y, z, width, height, out) {
    const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
    const denominator = Math.max(.00001, Math.abs(w));
    let px = (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / denominator;
    let py = (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / denominator;
    if (w <= 0 && Math.abs(px) + Math.abs(py) < .001)
        py = -1;
    const mx = Math.max(.1, 1 - 48 / width), my = Math.max(.1, 1 - 112 / height);
    const scale = Math.max(1, Math.abs(px) / mx, Math.abs(py) / my);
    out.edge = scale > 1 || w <= 0;
    px /= scale;
    py /= scale;
    out.x = (px * .5 + .5) * width;
    out.y = (.5 - py * .5) * height;
}
export function drawFleetPin(p, state, ships, ink, viewportWidth, hovered = false, hit) {
    const color = hovered ? HOVER : state === 'battle' ? ALERT : INK, x = p.x, y = p.y;
    ink.dot(x, y, 3, color, 1, 1.5);
    ink.edge(x, y - 5, x, y - 19, color, 1, 1.5);
    const symbol = FLEET_PIN_SYMBOL[state];
    if (ships !== previousCount) {
        previousCount = ships;
        label = ships === undefined ? '-- SHIPS' : `${ships.toLocaleString('en-US')} SHIPS`;
    }
    const width = label.length * 6 + 18, left = x + width + 15 > viewportWidth - 8;
    const start = left ? x - 9 - width : x + 9;
    if (hit) {
        hit.left = Math.min(x - 16, start);
        hit.right = Math.max(x + 16, start + width);
        hit.top = y - 46;
        hit.bottom = y - 18;
    }
    ink.plate(start, y - 42, width, 20, color);
    ink.text(label, start + (left ? 6 : 12), y - 40, color, 1);
    ink.icon(x, y - 32, 15, color, 1, symbol);
    if (p.edge) {
        ink.edge(x - 4, y - 4, x, y, color, 1, 1.5);
        ink.edge(x + 4, y - 4, x, y, color, 1, 1.5);
    }
}
//# sourceMappingURL=fleet-pin.js.map