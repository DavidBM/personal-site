/** Local authority's small event vocabulary. A backend can author these same
 * actions and target classes without owning any individual visual trajectory. */
export function battleTactics(phase) {
    const reaction = phase === 'pincer' || phase === 'evade' ? 'pursue' : phase === 'pursue' ? 'evade' : phase;
    return [{ manoeuvre: phase, targetClass: 5, bomberTargetClass: 1 },
        { manoeuvre: reaction, targetClass: 1, bomberTargetClass: 2 }];
}
//# sourceMappingURL=script.js.map