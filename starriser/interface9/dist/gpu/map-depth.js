/** Production map depth convention; independent layers keep forward depth by default. */
export const MAP_REVERSE_DEPTH = true;
const FORWARD_DEPTH = Object.freeze({
    format: "depth24plus", clearValue: 1,
    opaqueCompare: "less", transparentCompare: "less-equal",
});
const REVERSE_DEPTH = Object.freeze({
    format: "depth32float", clearValue: 0,
    opaqueCompare: "greater", transparentCompare: "greater-equal",
});
/** Shared immutable policy: no frame-time allocation or shader branch. */
export function depthPolicy(reverseDepth = false) {
    return reverseDepth ? REVERSE_DEPTH : FORWARD_DEPTH;
}
//# sourceMappingURL=map-depth.js.map