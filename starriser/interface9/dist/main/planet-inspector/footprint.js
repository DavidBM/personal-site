/** Display coarse cells only; the accepted footprint always uses global pixels. */
export function footprintCells(view, pixels) {
    const cells = new Map();
    for (const pixel of pixels) {
        const x = (Math.floor(pixel.x / view.scale) - view.x + view.level) % view.level;
        const y = Math.floor(pixel.y / view.scale) - view.y;
        if (x < view.width && y >= 0 && y < view.height)
            cells.set(y * view.width + x, { x, y });
    }
    return [...cells.values()];
}
export function drawFootprint(context, view, pixels) {
    context.save();
    context.fillStyle = 'rgba(255,220,80,0.65)';
    context.strokeStyle = '#fff1a3';
    context.lineWidth = 0.5;
    for (const p of footprintCells(view, pixels)) {
        context.fillRect(p.x, p.y, 1, 1);
        context.strokeRect(p.x + 0.25, p.y + 0.25, 0.5, 0.5);
    }
    context.restore();
}
//# sourceMappingURL=footprint.js.map