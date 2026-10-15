/** Project a sun-local destination with the same tilted camera as the scene. */
export function incomingScreen(matrix, position, width, height, out) {
    const [x, y, z] = position, w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
    if (w <= 0)
        return false;
    const px = (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w;
    const py = (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w;
    if (Math.abs(px) > 1.15 || Math.abs(py) > 1.15)
        return false;
    out.x = (px * .5 + .5) * width;
    out.y = (.5 - py * .5) * height;
    return true;
}
//# sourceMappingURL=incoming-markers.js.map