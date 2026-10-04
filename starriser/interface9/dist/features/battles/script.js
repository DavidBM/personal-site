/** Local authority's small event vocabulary. A backend can author these same
 * actions and target classes without owning any individual visual trajectory. */
export function battleTactics(phase) {
    const reaction = { pincer: 'evade', pass: 'orbit', pursue: 'evade', evade: 'pursue', orbit: 'pass', regroup: 'pursue' }[phase];
    return [{ manoeuvre: phase, targetClass: 1, bomberTargetClass: 5, coordination: 'combined' },
        { manoeuvre: reaction, targetClass: 1, bomberTargetClass: 4, coordination: 'combined' }];
}
//# sourceMappingURL=script.js.map