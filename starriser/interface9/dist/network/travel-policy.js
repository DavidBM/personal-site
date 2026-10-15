/** Called only after the admission source has matched this page's authority. */
export function withTravelPolicy(page, grant) {
    const value = grant.travelPolicy;
    if (!value)
        throw new Error('Source authority does not provide configurable travel previews');
    const transferPolicy = { jumpMs: value.jumpMs, cooldownMs: value.cooldownMs,
        configurationRevision: value.configurationRevision, modifierRevision: value.modifierRevision };
    return { ...page, seed: { ...page.seed, transferPolicy } };
}
//# sourceMappingURL=travel-policy.js.map