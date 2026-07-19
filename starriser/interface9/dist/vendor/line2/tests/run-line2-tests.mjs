/**
 * Line2 pure-CPU test runner (no GPU).
 *
 * Run after `./build.sh`:
 *   node js/vendor/line2/tests/run-line2-tests.mjs
 */

import { runAttrStateTests } from "./attr-state.test.mjs";
import { runExpandRefTests } from "./expand-ref.test.mjs";
import { runGeometryMaterialTests } from "./geometry-material.test.mjs";

let failed = 0;
let passed = 0;

console.log("=== line2 expand-ref ===");
const expand = runExpandRefTests();
failed += expand.failed;
passed += expand.passed;

console.log("\n=== line2 geometry-material ===");
const geo = runGeometryMaterialTests();
failed += geo.failed;
passed += geo.passed;

console.log("\n=== line2 attr-state ===");
const attr = runAttrStateTests();
failed += attr.failed;
passed += attr.passed;

if (failed > 0) {
  console.error(`\nline2 tests: ${failed} failure(s), ${passed} passed`);
  process.exitCode = 1;
} else {
  console.log(
    `\nline2 tests: all passed (${passed} checks: ` +
      `${expand.passed} expand-ref + ${geo.passed} geometry-material + ` +
      `${attr.passed} attr-state)`,
  );
}
