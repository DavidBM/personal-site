/** One overlap-safe relocation toward a packed layout with room for growth.
 * Keep physical fleet order: different arrival histories need not sort by ID.
 * Destinations may overlap their own source, never another live fleet.
 */
export function pickRangeRecovery(ranges, capacity, requested = null) {
  const rows = [...ranges].sort((a, b) => a[1].start - b[1].start);
  const targets = []; let at = 0;
  for (const [slot, range] of rows) {
    const cap = Math.max(range.cap, requested?.get(slot) ?? range.cap);
    targets.push({ slot, oldStart: range.start, newStart: at, cap: range.cap,
      overlap: at < range.start + range.cap && range.start < at + range.cap });
    at += cap;
  }
  if (at > capacity) return null;
  for (const move of targets) {
    if (move.oldStart === move.newStart) continue;
    const blocked = rows.some(([slot, r]) => slot !== move.slot &&
      move.newStart < r.start + r.cap && r.start < move.newStart + move.cap);
    if (!blocked) return move;
  }
  return null;
}

/** Source rows no longer owned after a same-size move. At most one tail. */
export function retiredMoveRange({ oldStart, newStart, cap }) {
  if (newStart < oldStart) {
    const start = Math.max(oldStart, newStart + cap);
    return { start, cap: oldStart + cap - start };
  }
  return { start: oldStart, cap: Math.min(cap, newStart - oldStart) };
}
