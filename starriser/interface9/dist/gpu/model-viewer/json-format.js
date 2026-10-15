/**
 * JSON for files people read and diff: an object or array stays on one line
 * when it fits in `width` characters, otherwise it gets one member per line.
 * `lead` is how many characters precede the value on its line (its key).
 */
export function compactJson(value, width = 120, indent = "", lead = 0) {
    const flat = inlineJson(value);
    if (value === null || typeof value !== "object" || indent.length + lead + flat.length <= width)
        return flat;
    const inner = `${indent}  `;
    const lines = Array.isArray(value)
        ? value.map((item) => inner + compactJson(item, width, inner))
        : Object.entries(value).map(([key, item]) => `${inner}${JSON.stringify(key)}: ${compactJson(item, width, inner, JSON.stringify(key).length + 2)}`);
    const [open, close] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
    return lines.length ? `${open}\n${lines.join(",\n")}\n${indent}${close}` : `${open}${close}`;
}
function inlineJson(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value) ?? "null";
    if (Array.isArray(value))
        return `[${value.map(inlineJson).join(", ")}]`;
    return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${inlineJson(item)}`).join(", ")}}`;
}
//# sourceMappingURL=json-format.js.map