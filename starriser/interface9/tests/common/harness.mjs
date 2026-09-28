/**
 * Browser harness protocol for Galaxy scenario tests.
 * Exposes window.__galaxyTest for CDP / agents.
 */

import { assert, assertEq, assertApprox, approxEq, AssertionError } from "./assert.mjs";
import { getUrlParams, isTruthyParam } from "./url-params.mjs";

/**
 * @typedef {'idle' | 'ready' | 'running' | 'done' | 'error'} HarnessStatus
 *
 * @typedef {{
 *   name: string,
 *   ok: boolean,
 *   durationMs: number,
 *   assertions: Array<{ name: string, ok: boolean, detail?: string }>,
 *   metrics?: Record<string, number | string>,
 *   steps?: Array<Record<string, unknown>>,
 *   error?: string,
 *   logs?: string[],
 * }} HarnessResults
 *
 * @typedef {{
 *   params: Record<string, string>,
 *   assert: typeof assert,
 *   assertEq: typeof assertEq,
 *   assertApprox: typeof assertApprox,
 *   approxEq: typeof approxEq,
 *   log: (...args: unknown[]) => void,
 *   metric: (name: string, value: number | string) => void,
 *   recordStep: (obj: Record<string, unknown>) => void,
 *   check: (name: string, cond: unknown, detail?: string) => void,
 * }} HarnessContext
 *
 * @typedef {{
 *   name: string,
 *   run: (ctx: HarnessContext) => Promise<void> | void,
 *   step?: (ctx: HarnessContext) => Promise<unknown> | unknown,
 *   getState?: () => unknown,
 * }} HarnessOptions
 */

/**
 * @param {HarnessOptions} options
 */
export function createHarness(options) {
  const name = options?.name || "unnamed";
  if (typeof options?.run !== "function") {
    throw new Error("createHarness: options.run is required");
  }

  /** @type {HarnessStatus} */
  let status = "idle";
  /** @type {HarnessResults | null} */
  let results = null;
  /** @type {string[]} */
  const logs = [];
  /** @type {Array<{ name: string, ok: boolean, detail?: string }>} */
  let assertions = [];
  /** @type {Record<string, number | string>} */
  let metrics = {};
  /** @type {Array<Record<string, unknown>>} */
  let steps = [];

  const params = getUrlParams();

  function setStatus(next) {
    status = next;
    renderUi();
  }

  /**
   * @param {...unknown} args
   */
  function log(...args) {
    const line = args.map((a) => (typeof a === "string" ? a : safeStringify(a))).join(" ");
    logs.push(line);
    try {
      console.log(`[${name}]`, ...args);
    } catch {
      /* ignore */
    }
    renderUi();
  }

  /**
   * @param {string} key
   * @param {number | string} value
   */
  function metric(key, value) {
    metrics[key] = value;
    renderUi();
  }

  /**
   * @param {Record<string, unknown>} obj
   */
  function recordStep(obj) {
    steps.push(obj && typeof obj === "object" ? { ...obj } : { value: obj });
    renderUi();
  }

  /**
   * Soft check that records without throwing.
   * @param {string} checkName
   * @param {unknown} cond
   * @param {string} [detail]
   */
  function check(checkName, cond, detail) {
    const ok = Boolean(cond);
    /** @type {{ name: string, ok: boolean, detail?: string }} */
    const entry = { name: checkName, ok };
    if (detail != null) entry.detail = detail;
    if (!ok && detail == null) entry.detail = "check failed";
    assertions.push(entry);
    renderUi();
    return ok;
  }

  function buildCtx() {
    /** @type {HarnessContext} */
    const ctx = {
      params,
      assert: (cond, msg) => {
        try {
          assert(cond, msg);
          assertions.push({ name: msg || "assert", ok: true });
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          assertions.push({ name: msg || "assert", ok: false, detail });
          throw e;
        }
      },
      assertEq: (a, b, msg) => {
        try {
          assertEq(a, b, msg);
          assertions.push({ name: msg || "assertEq", ok: true });
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          assertions.push({ name: msg || "assertEq", ok: false, detail });
          throw e;
        }
      },
      assertApprox: (a, b, eps, msg) => {
        try {
          assertApprox(a, b, eps, msg);
          assertions.push({ name: msg || "assertApprox", ok: true });
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          assertions.push({ name: msg || "assertApprox", ok: false, detail });
          throw e;
        }
      },
      approxEq,
      log,
      metric,
      recordStep,
      check,
    };
    return ctx;
  }

  /**
   * @returns {Promise<HarnessResults>}
   */
  async function start() {
    if (status === "running") {
      throw new Error("harness already running");
    }
    if (status === "done" || status === "error") {
      // allow re-run
      results = null;
      assertions = [];
      metrics = {};
      steps = [];
    }

    setStatus("running");
    const t0 = performance.now();
    const ctx = buildCtx();

    try {
      await options.run(ctx);
      const durationMs = Math.round(performance.now() - t0);
      const failed = assertions.filter((a) => !a.ok);
      const ok = failed.length === 0;
      results = {
        ok,
        name,
        durationMs,
        assertions: assertions.slice(),
        metrics: { ...metrics },
        steps: steps.slice(),
        logs: logs.slice(),
      };
      if (!ok) {
        results.error = `${failed.length} soft assertion(s) failed`;
      }
      setStatus(ok ? "done" : "error");
      return results;
    } catch (e) {
      const durationMs = Math.round(performance.now() - t0);
      const errMsg =
        e instanceof AssertionError
          ? e.message
          : e instanceof Error
            ? e.stack || e.message
            : String(e);
      // ensure last hard failure is in assertions if not already
      if (!assertions.some((a) => !a.ok && a.detail === errMsg)) {
        assertions.push({
          name: e instanceof AssertionError ? "assert" : "error",
          ok: false,
          detail: errMsg,
        });
      }
      results = {
        ok: false,
        name,
        durationMs,
        assertions: assertions.slice(),
        metrics: { ...metrics },
        steps: steps.slice(),
        error: errMsg,
        logs: logs.slice(),
      };
      setStatus("error");
      return results;
    }
  }

  function getResults() {
    return results;
  }

  function getStatus() {
    return status;
  }

  /** @type {Record<string, unknown>} */
  const api = {
    name,
    get status() {
      return status;
    },
    get results() {
      return results;
    },
    start,
    getResults,
    getStatus,
  };

  if (typeof options.step === "function") {
    api.step = async () => {
      const ctx = buildCtx();
      return options.step(ctx);
    };
  }
  if (typeof options.getState === "function") {
    api.getState = () => options.getState();
  }

  // Expose for CDP
  if (typeof window !== "undefined") {
    window.__galaxyTest = api;
  }

  ensureUiRoot();
  setStatus("ready");

  // Auto-start if ?run=1 or ?autorun=1
  if (isTruthyParam(params.run) || isTruthyParam(params.autorun)) {
    // Defer so page modules finish wiring and agents can attach listeners
    queueMicrotask(() => {
      start().catch((e) => {
        console.error(`[${name}] start failed`, e);
      });
    });
  }

  return api;
}

function safeStringify(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function ensureUiRoot() {
  if (typeof document === "undefined") return null;
  let root = document.getElementById("galaxy-test-ui");
  if (root) return root;
  root = document.createElement("div");
  root.id = "galaxy-test-ui";
  root.style.cssText = [
    "font: 14px/1.45 system-ui, sans-serif",
    "max-width: 52rem",
    "margin: 1rem",
    "padding: 1rem 1.25rem",
    "background: #111",
    "color: #e8e8e8",
    "border: 1px solid #333",
    "border-radius: 8px",
  ].join(";");
  // Prefer: title → canvas/view → live results → docs (explanation last).
  const view =
    document.getElementById("view") ||
    document.getElementById("c") ||
    document.querySelector("canvas");
  const docs = document.querySelector(".doc");
  if (view && view.parentNode) {
    view.parentNode.insertBefore(root, view.nextSibling);
  } else if (docs && docs.parentNode) {
    docs.parentNode.insertBefore(root, docs);
  } else {
    document.body.appendChild(root);
  }
  return root;
}

function renderUi() {
  if (typeof document === "undefined") return;
  const api = window.__galaxyTest;
  if (!api) return;
  const root = ensureUiRoot();
  if (!root) return;

  const st = api.status;
  const res = api.results;
  const color =
    st === "done" && res?.ok
      ? "#3dd68c"
      : st === "error" || (res && !res.ok)
        ? "#f07178"
        : st === "running"
          ? "#ffcc66"
          : "#89b4fa";

  const assertions = res?.assertions || [];
  const assertionHtml = assertions
    .map((a) => {
      const mark = a.ok ? "✓" : "✗";
      const c = a.ok ? "#3dd68c" : "#f07178";
      const det = a.detail ? ` <span style="opacity:.75">${escapeHtml(a.detail)}</span>` : "";
      return `<li style="color:${c}">${mark} ${escapeHtml(a.name)}${det}</li>`;
    })
    .join("");

  const metrics = res?.metrics || {};
  const metricHtml = Object.keys(metrics)
    .map((k) => `<li><code>${escapeHtml(k)}</code> = ${escapeHtml(String(metrics[k]))}</li>`)
    .join("");

  const errHtml = res?.error
    ? `<pre style="color:#f07178;white-space:pre-wrap">${escapeHtml(res.error)}</pre>`
    : "";

  root.innerHTML = `
    <h1 style="margin:0 0 .5rem;font-size:1.15rem">Galaxy Test: ${escapeHtml(api.name)}</h1>
    <p style="margin:.25rem 0">Status: <strong style="color:${color}">${escapeHtml(st)}</strong>
      ${res ? ` · ${res.ok ? "PASS" : "FAIL"} · ${res.durationMs} ms` : ""}
    </p>
    ${errHtml}
    ${
      assertionHtml
        ? `<h2 style="font-size:1rem;margin:1rem 0 .35rem">Assertions</h2><ul style="margin:0;padding-left:1.2rem">${assertionHtml}</ul>`
        : ""
    }
    ${
      metricHtml
        ? `<h2 style="font-size:1rem;margin:1rem 0 .35rem">Metrics</h2><ul style="margin:0;padding-left:1.2rem">${metricHtml}</ul>`
        : ""
    }
    <p style="margin:1rem 0 0;opacity:.65;font-size:12px">
      CDP: <code>window.__galaxyTest.start()</code> ·
      <code>?run=1</code> auto-starts
    </p>
  `;
}

/**
 * @param {string} s
 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
