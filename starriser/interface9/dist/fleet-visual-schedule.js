export const MIN_FLEET_UPDATE_CHUNK_MS = 20;
export const MIN_FLEET_UPDATE_FRAME_FRACTION = 0.05;
export const MAX_FLEET_UPDATE_FRAME_FRACTION = 1;
export function resolveFleetVisualUpdateConfig(current, options) {
    return {
        updateChunkMs: typeof options.updateChunkMs === "number"
            ? Math.max(MIN_FLEET_UPDATE_CHUNK_MS, options.updateChunkMs)
            : current.updateChunkMs,
        perFrameFraction: typeof options.perFrameFraction === "number"
            ? Math.max(MIN_FLEET_UPDATE_FRAME_FRACTION, Math.min(MAX_FLEET_UPDATE_FRAME_FRACTION, options.perFrameFraction))
            : current.perFrameFraction,
    };
}
export function shouldScheduleFleetVisualChunk(now, nextChunkTime) {
    return now >= nextChunkTime;
}
export function scheduleFleetVisualChunk(nonJumpingFleetIds, now, updateChunkMs) {
    return {
        scheduledFleetIds: nonJumpingFleetIds.slice(),
        scheduleCursor: 0,
        nextChunkTime: now + updateChunkMs,
    };
}
export function takeFleetVisualScheduledChunk(scheduledFleetIds, scheduleCursor, perFrameFraction) {
    if (scheduledFleetIds.length === 0) {
        return { startIndex: scheduleCursor, count: 0, nextCursor: scheduleCursor };
    }
    const remaining = scheduledFleetIds.length - scheduleCursor;
    if (remaining <= 0) {
        return { startIndex: scheduleCursor, count: 0, nextCursor: scheduleCursor };
    }
    const targetCount = Math.max(1, Math.ceil(scheduledFleetIds.length * perFrameFraction));
    const count = Math.min(remaining, targetCount);
    return {
        startIndex: scheduleCursor,
        count,
        nextCursor: scheduleCursor + count,
    };
}
//# sourceMappingURL=fleet-visual-schedule.js.map