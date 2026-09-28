import { renderResolutionControl } from './render-resolution-control.js';
import { simulationRateControl } from './simulation-rate-control.js';
import { ensureMicroStyles, fieldInput, microButton } from "./micro.js";
import { mountSimPauseButton } from "./sim-pause-button.js";
const NORMAL_GALAXY = {
    numClusters: 15000,
    numSolarSystems: 80,
    maxConnections: 3,
    galaxySize: 300000,
    centerBias: 0.6,
    minDistance: 1500,
    heightVariation: 0,
};
const SMALL_GALAXY = {
    numClusters: 150,
    numSolarSystems: 80,
    maxConnections: 3,
    galaxySize: 3000,
    centerBias: 0.6,
    minDistance: 1500,
    heightVariation: 0,
};
export function buildEditorGenerationPanel(ctx, actions) {
    ensureMicroStyles();
    const controls = ctx.panel({
        id: "controls-panel",
        title: "Galaxy",
        width: 240,
        className: "micro",
    });
    const fields = document.createElement("div");
    fields.className = "micro-fields";
    const numClusters = addField(fields, "Clusters", "numClusters", NORMAL_GALAXY.numClusters, actions);
    const numSolarSystems = addField(fields, "Systems", "numSolarSystems", NORMAL_GALAXY.numSolarSystems, actions);
    const maxConnections = addField(fields, "Links", "maxConnections", NORMAL_GALAXY.maxConnections, actions);
    const galaxySize = addField(fields, "Size", "galaxySize", NORMAL_GALAXY.galaxySize, actions);
    const centerBias = addField(fields, "Bias", "centerBias", NORMAL_GALAXY.centerBias, actions);
    const minDistance = addField(fields, "Gap", "minDistance", NORMAL_GALAXY.minDistance, actions);
    controls.content.appendChild(fields);
    const read = () => ({
        numClusters: Number.parseInt(numClusters.value, 10),
        numSolarSystems: Number.parseInt(numSolarSystems.value, 10),
        maxConnections: Number.parseInt(maxConnections.value, 10),
        galaxySize: Number.parseFloat(galaxySize.value),
        centerBias: Number.parseFloat(centerBias.value),
        minDistance: Number.parseFloat(minDistance.value),
        heightVariation: 0,
    });
    const write = (preset) => {
        numClusters.value = String(preset.numClusters);
        numSolarSystems.value = String(preset.numSolarSystems);
        maxConnections.value = String(preset.maxConnections);
        galaxySize.value = String(preset.galaxySize);
        centerBias.value = String(preset.centerBias);
        minDistance.value = String(preset.minDistance);
    };
    const pause = document.createElement("div");
    pause.className = "micro-actions";
    pause.append(mountSimPauseButton(ctx, actions));
    controls.content.appendChild(pause);
    const generate = document.createElement("div");
    generate.className = "micro-actions";
    generate.append(microButton("Generate", "15k clusters · size 300k · 80 systems · 3 links", () => {
        write(NORMAL_GALAXY);
        actions.generateGalaxy();
    }, true), microButton("Small", "150 clusters · size 3k · 80 systems · 3 links", () => {
        write(SMALL_GALAXY);
        actions.generateGalaxy();
    }));
    controls.content.appendChild(generate);
    const fleet = document.createElement("div");
    fleet.className = "micro-actions";
    fleet.append(microButton("Fleet", "Create one fleet in the open system", () => actions.generateFleet()), microButton("1K", "Generate 1,000 fleets", () => actions.generateFleetsBulk(1000)), microButton("10K", "Generate 10,000 fleets", () => actions.generateFleetsBulk(10000)), microButton("50K", "Generate 50,000 fleets", () => actions.generateFleetsBulk(50000)));
    controls.content.appendChild(fleet);
    const view = document.createElement("div");
    view.className = "micro-actions";
    view.append(microButton("Follow", "Follow the selected fleet", () => actions.followSelectedFleet?.()), microButton("Random", "Follow a random ship", () => actions.followRandomShip()), microButton("Clear", "Clear the galaxy", () => actions.clearGalaxy()));
    controls.content.appendChild(view);
    controls.content.append(simulationRateControl(actions), renderResolutionControl(actions), check("Selective MSAA · reload", "selective-msaa", on => actions.setSelectiveMsaa?.(on), actions.isSelectiveMsaaEnabled?.() ?? true), check("½ glow · selective MSAA · reload", "half-glow", on => actions.setHalfGlow?.(on), actions.isHalfGlowEnabled?.() ?? true), check("GPU detail diagnostics", "quality-diagnostics", on => actions.setQualityDiagnostics?.(on), actions.isQualityDiagnosticsEnabled?.() ?? false), check("Star field", "star-field", on => actions.setStarField?.(on), actions.isStarFieldEnabled?.() ?? true), check("High FX · 50K ships", "high-fx", (on) => actions.setHighFx?.(on), actions.isHighFxEnabled?.() ?? false), check("All fleet paths", "fleet-paths", (on) => actions.setFleetPathsVisible?.(on), actions.isFleetPathsVisible?.() ?? false), check("Selected fleet debug", "fleet-debug", (on) => actions.setFleetDebugVisible?.(on), actions.isFleetDebugVisible?.() ?? false), check("Density", "debug-density-voxels", (on) => actions.setDebugDensityVoxels?.(on)), check("Repulsion", "debug-ship-repulsion", (on) => actions.setDebugRepulsion?.(on)));
    return { panel: controls, getGenerationParams: read };
}
function addField(parent, label, id, value, actions) {
    const name = document.createElement("span");
    name.className = "micro-k";
    name.textContent = label;
    const input = fieldInput(id, value);
    input.title = "Enter builds the column as shown";
    input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter")
            return;
        event.preventDefault();
        actions.generateGalaxy();
    });
    parent.append(name, input);
    return input;
}
function check(label, id, onChange, checked = false) {
    const row = document.createElement("label");
    row.className = "micro-check";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.id = id;
    box.checked = checked;
    if (id === 'selective-msaa')
        row.title = 'Antialias hulls and lines at 4× while planets and soft effects remain single-sampled. Uncheck for no MSAA. Applies on reload.';
    if (id === 'half-glow')
        row.title = 'Half-resolution broad trail glow with selective MSAA. Tiny trails and sharp cores remain full resolution. Applies on reload.';
    if (id === 'quality-diagnostics')
        row.title = 'Optional 5 Hz GPU summary and compact readbacks. Disabled means no new diagnostic work.';
    if (id === "high-fx")
        row.title = "Up to 50K ships and cinematic warp. Existing ships stay intact; added detail appears as fleets arrive or you enter a system.";
    box.addEventListener("change", () => onChange(box.checked));
    const text = document.createElement("span");
    text.textContent = label;
    row.append(box, text);
    return row;
}
//# sourceMappingURL=editor-generation-panel.js.map