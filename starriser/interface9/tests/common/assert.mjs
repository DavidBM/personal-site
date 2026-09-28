/**
 * Browser-side assertions for scenario tests.
 * Hard-throw on failure; harness catches and records error.
 */

export class AssertionError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = "AssertionError";
  }
}

/**
 * @param {unknown} cond
 * @param {string} [msg]
 * @returns {asserts cond}
 */
export function assert(cond, msg) {
  if (!cond) {
    throw new AssertionError(msg || "assertion failed");
  }
}

/**
 * @param {unknown} a
 * @param {unknown} b
 * @param {string} [msg]
 */
export function assertEq(a, b, msg) {
  if (!Object.is(a, b)) {
    const detail = msg ? `${msg}: ` : "";
    throw new AssertionError(`${detail}expected ${format(b)}, got ${format(a)}`);
  }
}

/**
 * @param {number} a
 * @param {number} b
 * @param {number} [eps=1e-3]
 */
export function approxEq(a, b, eps = 1e-3) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return Object.is(a, b);
  }
  return Math.abs(a - b) <= eps;
}

/**
 * @param {number} a
 * @param {number} b
 * @param {number} [eps=1e-3]
 * @param {string} [msg]
 */
export function assertApprox(a, b, eps = 1e-3, msg) {
  if (!approxEq(a, b, eps)) {
    const detail = msg ? `${msg}: ` : "";
    throw new AssertionError(
      `${detail}expected ${format(b)} ± ${eps}, got ${format(a)} (Δ=${Math.abs(a - b)})`,
    );
  }
}

/**
 * @param {unknown} v
 */
function format(v) {
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean" || v == null) return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
