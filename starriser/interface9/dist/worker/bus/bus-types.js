/**
 * Bus message shapes, priorities, and type guards.
 * Shared by Bus facade and focused bus-* modules.
 */
export const isRecord = (value) => typeof value === "object" && value !== null;
export const isBusMessage = (value) => {
    if (!isRecord(value))
        return false;
    return (value.b === true &&
        typeof value.t === "string" &&
        typeof value.p === "number" &&
        typeof value.e === "number");
};
/**
 * Micro-optimized message serializer. Always call this to construct messages.
 */
export function serializeBusMessage(t, d, p, e, i) {
    if (i !== undefined) {
        return { b: true, t, d, p, e, i };
    }
    return { b: true, t, d, p, e };
}
//# sourceMappingURL=bus-types.js.map