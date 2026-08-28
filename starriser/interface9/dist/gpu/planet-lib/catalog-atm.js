/**
 * Climate-tinted atmosphere presets for catalog planets.
 *
 * Does not change `defaultAtmForBodyId` (shared Azure paste preset).
 * Showcase main uses this for initial / reset / URL-missing bodies.
 */
import { catalogById } from "./planet-catalog.js";
import { clampAtmParams, cloneAtmParams, PLANET_ATM_DEFAULTS, } from "./planet-atm-params.js";
export function catalogAtmForBodyId(bodyId) {
    const p = cloneAtmParams(PLANET_ATM_DEFAULTS);
    const entry = catalogById(bodyId);
    if (!entry)
        return p;
    switch (entry.preset) {
        case "lava-world":
            p.colorR = 22;
            p.colorG = 7;
            p.colorB = 2;
            p.cloudAmount = 0.05;
            p.nightLights = 1.2;
            p.specStrength = 0.35;
            p.intensity = 8;
            p.atmThick = 0.16;
            p.texIntensity = 1.25;
            break;
        case "rocky-mars":
            p.intensity = entry.id === "ember" ? 5 : entry.id === "dune" ? 4.2 : 4.6;
            p.atmThick = 0.12;
            p.cloudAmount = 0.05;
            p.nightLights = 0;
            p.colorR = 14;
            p.colorG = 6.5;
            p.colorB = 2.5;
            p.atmGain = 0.5;
            p.specStrength = 0.25;
            break;
        case "azure-ocean":
        case "temperate":
            // Shared Azure defaults (cloudAmount 0.86, nightLights 1.15).
            break;
        case "gas-jupiter":
            p.intensity = 9;
            p.atmThick = 0.28;
            p.cloudAmount = 0;
            p.nightLights = 0;
            p.specStrength = 0.45;
            p.mieEmit = 22;
            if (entry.id === "nimbus") {
                p.colorR = 14;
                p.colorG = 10;
                p.colorB = 6;
            }
            else {
                p.colorR = 18;
                p.colorG = 10;
                p.colorB = 4;
            }
            break;
        case "gas-ice-giant":
            p.intensity = entry.id === "haze" ? 9 : 10;
            p.atmThick = 0.32;
            p.colorR = 3;
            p.colorG = 12;
            p.colorB = 42;
            p.cloudAmount = 0;
            p.nightLights = 0;
            p.extScale = 0.06;
            break;
        case "exotic-methane":
            p.colorR = 28;
            p.colorG = 12;
            p.colorB = 3;
            p.cloudAmount = 0.4;
            p.nightLights = 0;
            p.intensity = 7;
            p.atmThick = 0.24;
            p.mieEmit = 20;
            break;
        case "ice-world":
            p.colorR = 6;
            p.colorG = 16;
            p.colorB = 32;
            p.nightLights = 0;
            p.cloudAmount = 0.5;
            p.intensity = entry.id === "terminus" ? 7 : 7.5;
            p.atmThick = 0.2;
            p.extScale = 0.06;
            p.atmGain = 0.75;
            break;
        default:
            break;
    }
    return clampAtmParams(p);
}
//# sourceMappingURL=catalog-atm.js.map