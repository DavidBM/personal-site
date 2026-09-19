/** Page-directory base so fetch("models/…") works when the worker lives under dist/. */
let assetBase = "";
export function setAssetBase(href) {
    if (!href) {
        assetBase = "";
        return;
    }
    assetBase = href.endsWith("/") ? href : `${href}/`;
}
export function assetUrl(rel) {
    if (!rel || /^(?:https?:|blob:|data:)/.test(rel))
        return rel;
    if (!assetBase)
        return rel;
    return new URL(rel.replace(/^\//, ""), assetBase).href;
}
//# sourceMappingURL=asset-url.js.map