const defaults = Object.freeze({ ownFleets: true, ownRoutes: false, ownPlanets: true, systemColors: true, planetOwners: true });
export const DEFAULT_MAP_LAYERS = Object.freeze({ galaxy: defaults, cluster: defaults, system: defaults });
export function mapLayers(value) {
    const input = value;
    const section = (key) => {
        const v = input?.[key] ?? input;
        return Object.fromEntries(Object.entries(defaults).map(([k, d]) => [k, typeof v?.[k] === 'boolean' ? v[k] : d]));
    };
    return { galaxy: section('galaxy'), cluster: section('cluster'), system: section('system') };
}
export function anyMapLayer(options, key) { return options.galaxy[key] || options.cluster[key] || options.system[key]; }
//# sourceMappingURL=map-layers.js.map