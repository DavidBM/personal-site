/** Transfer the final height array to an authoring consumer. Caller owns its lifetime. */
export function retainPlanetSurface(height, planetClass) {
    const name = planetClass === "gas" ? "atmosphericVariation" : "elevation";
    return {
        width: height.width,
        height: height.height,
        planetClass,
        fields: { [name]: { kind: "scalar", units: "normalized-generator", values: height.data } },
    };
}
function isEquirectangularGrid(source) {
    return Number.isSafeInteger(source.width) && source.width >= 2 && source.width <= 8192
        && source.height === source.width / 2 && Number.isSafeInteger(source.height);
}
function checkGrid(source, width) {
    if (!isEquirectangularGrid(source) || !Number.isSafeInteger(width)
        || width < 2 || width % 2 !== 0 || width > source.width || source.width % width !== 0) {
        throw new Error("Surface derivation requires an even equirectangular grid and an integer downsample factor");
    }
    return source.width / width;
}
function validateCategories(field) {
    if (!(field.values instanceof Uint8Array) || !field.labels.length || field.labels.length > 256) {
        throw new Error("Invalid categorical surface field");
    }
    for (const value of field.values) {
        if (value >= field.labels.length)
            throw new Error("Unknown surface category");
    }
}
function validateField(field, count) {
    if (field.values.length !== count)
        throw new Error("Surface field length does not match grid");
    if (field.kind === "category")
        return validateCategories(field);
    if (!(field.values instanceof Float32Array))
        throw new Error("Invalid scalar surface field");
    for (const value of field.values) {
        if (!Number.isFinite(value))
            throw new Error("Non-finite surface scalar");
    }
}
/** Exact latitude-band area apart from the common radius/longitude factor. */
function rowWeights(height) {
    return Float64Array.from({ length: height }, (_, y) => Math.cos(Math.PI * y / height) - Math.cos(Math.PI * (y + 1) / height));
}
function categoryWinner(weights) {
    let winner = 0;
    for (let index = 1; index < weights.length; index++) {
        // Stable ties select the lower category ID, never an averaged/invented ID.
        if (weights[index] > weights[winner] + 1e-14)
            winner = index;
    }
    return winner;
}
function derivedValue(field, sourceWidth, x, y, factor, area, classes) {
    let weighted = 0, total = 0;
    classes?.fill(0);
    for (let sy = y * factor; sy < (y + 1) * factor; sy++) {
        for (let sx = x * factor; sx < (x + 1) * factor; sx++) {
            const value = field.values[sy * sourceWidth + sx];
            if (classes)
                classes[value] += area[sy];
            else
                weighted += value * area[sy];
            total += area[sy];
        }
    }
    return classes ? categoryWinner(classes) : weighted / total;
}
function deriveField(field, source, width, factor, area) {
    const values = field.kind === "scalar"
        ? new Float32Array(width * width / 2) : new Uint8Array(width * width / 2);
    const classes = field.kind === "category" ? new Float64Array(field.labels.length) : null;
    for (let y = 0; y < width / 2; y++) {
        for (let x = 0; x < width; x++) {
            values[y * width + x] = derivedValue(field, source.width, x, y, factor, area, classes);
        }
    }
    return field.kind === "scalar"
        ? { ...field, values: values }
        : { ...field, labels: [...field.labels], values: values };
}
/** Derived viewing products only. Always derive directly from the retained master. */
export function derivePlanetSurface(source, width) {
    const factor = checkGrid(source, width);
    const fields = {};
    const area = rowWeights(source.height);
    for (const [name, field] of Object.entries(source.fields)) {
        validateField(field, source.width * source.height);
        if (factor !== 1)
            fields[name] = deriveField(field, source, width, factor, area);
        else
            fields[name] = field.kind === "category"
                ? { ...field, labels: [...field.labels], values: field.values.slice() }
                : { ...field, values: field.values.slice() };
    }
    return { width, height: width / 2, planetClass: source.planetClass, fields };
}
/** Bounded authoring path: identical math to full derivation, without allocating a lower raster. */
function checkPageBytes(pageBytes, stride) {
    if (!Number.isSafeInteger(pageBytes) || pageBytes < stride || pageBytes > 4096 || pageBytes % stride) {
        throw new Error("Invalid numeric page budget");
    }
    return pageBytes / stride;
}
export function* iteratePlanetSurfaceFieldPages(source, name, width, pageBytes = 4096) {
    const factor = checkGrid(source, width);
    const field = source.fields[name];
    if (!field)
        throw new Error("Unknown surface field");
    validateField(field, source.width * source.height);
    const stride = field.kind === "scalar" ? 4 : 1;
    const pageValues = checkPageBytes(pageBytes, stride);
    const area = rowWeights(source.height);
    const classes = field.kind === "category" ? new Float64Array(field.labels.length) : null;
    const count = width * width / 2;
    for (let offset = 0; offset < count; offset += pageValues) {
        const length = Math.min(pageValues, count - offset);
        const values = field.kind === "scalar" ? new Float32Array(length) : new Uint8Array(length);
        for (let i = 0; i < length; i++) {
            const cell = offset + i;
            values[i] = factor === 1 ? field.values[cell]
                : derivedValue(field, source.width, cell % width, Math.floor(cell / width), factor, area, classes);
        }
        yield values;
    }
}
//# sourceMappingURL=surface-fields.js.map