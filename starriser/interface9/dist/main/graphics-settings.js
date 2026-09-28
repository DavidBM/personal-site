import { simulationRate, DEFAULT_SIMULATION_RATE } from '../contracts/simulation-rate.js';
import { bindText, setText } from '../ui/dom-bindings.js';
const HIGH_FX_KEY = 'galaxy.highFx';
export function readHighFx() {
    try {
        return globalThis.localStorage?.getItem(HIGH_FX_KEY) === 'true';
    }
    catch {
        return false;
    }
}
export function writeHighFx(enabled) {
    try {
        globalThis.localStorage?.setItem(HIGH_FX_KEY, String(enabled));
    }
    catch { /* The current session still applies when storage is unavailable. */ }
}
let highFx = null;
function bindHighFx() {
    const box = document.getElementById('high-fx');
    highFx = box ? { box, parent: box.parentElement, label: box.nextElementSibling ? bindText(box.nextElementSibling, { width: 'calc(100% - 18px)' }) : null,
        title: box.parentElement?.title ?? '' } : null;
}
/** Worker status is authoritative, including device capability fallback. */
export function paintHighFx(enabled, supported) {
    if (!highFx?.box.isConnected)
        bindHighFx();
    if (!highFx)
        return;
    const { box, label } = highFx;
    if (box.checked !== enabled)
        box.checked = enabled;
    if (box.disabled !== !supported)
        box.disabled = !supported;
    if (label)
        setText(label, supported ? 'High FX · 50K ships' : 'High FX unavailable');
    const title = supported ? highFx.title : 'This GPU cannot bind the ship storage needed for 50K visible ships.';
    paintTitle(highFx.parent, title);
}
export function readFleetPaths() {
    try {
        return globalThis.localStorage?.getItem('galaxy.fleetPaths') === 'true';
    }
    catch {
        return false;
    }
}
export function writeFleetPaths(enabled) {
    try {
        globalThis.localStorage?.setItem('galaxy.fleetPaths', String(enabled));
    }
    catch { /* Session preference still applies. */ }
}
function paintTitle(parent, title) {
    if (parent && parent.title !== title)
        parent.title = title;
}
export function readSimulationRate() {
    try {
        const saved = globalThis.localStorage?.getItem('galaxy.simulationHz');
        return saved == null ? DEFAULT_SIMULATION_RATE : simulationRate(Number(saved));
    }
    catch {
        return DEFAULT_SIMULATION_RATE;
    }
}
export function writeSimulationRate(hz) {
    try {
        globalThis.localStorage?.setItem('galaxy.simulationHz', String(simulationRate(hz)));
    }
    catch { /* Session setting still applies. */ }
}
export function readSelectiveMsaa() {
    try {
        return globalThis.localStorage?.getItem('galaxy.selectiveMsaa') !== 'false';
    }
    catch {
        return true;
    }
}
export function writeSelectiveMsaa(on) {
    try {
        globalThis.localStorage?.setItem('galaxy.selectiveMsaa', String(on));
    }
    catch { /* Session storage unavailable. */ }
}
export function readHalfGlow() { try {
    return globalThis.localStorage?.getItem('galaxy.halfGlow') !== 'false';
}
catch {
    return true;
} }
export function writeHalfGlow(on) { try {
    localStorage.setItem('galaxy.halfGlow', String(on));
}
catch { /* Storage unavailable. */ } }
export function readStarField() {
    try {
        return localStorage.getItem('galaxy.starField') !== 'false';
    }
    catch {
        return true;
    }
}
export function writeStarField(on) {
    try {
        localStorage.setItem('galaxy.starField', String(on));
    }
    catch { /* Session setting remains available. */ }
}
export function readRenderScale() {
    try {
        return localStorage.getItem('galaxy.renderScale') === '0.5' ? 0.5 : 1;
    }
    catch {
        return 1;
    }
}
export function writeRenderScale(scale) {
    try {
        localStorage.setItem('galaxy.renderScale', String(scale === 0.5 ? 0.5 : 1));
    }
    catch { /* Session applies. */ }
}
//# sourceMappingURL=graphics-settings.js.map