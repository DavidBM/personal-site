import { computeConnectionGradient } from "./business-state.js";
import { decideTapInteraction, planTapInteractionEffects, planTapInteractionPublications, } from "./interaction/tap-selection.js";
export function planBusinessTapInteraction({ hitClusterId, withinSelectThreshold, selectedId, currentlyEditingClusterId, connections, maxJumps = 10, }) {
    const decision = decideTapInteraction({
        hitClusterId,
        withinSelectThreshold,
        selectedId,
        currentlyEditingClusterId,
    });
    const effects = planTapInteractionEffects(decision);
    const connectionColors = effects.connectionColorAction.type === "gradient"
        ? computeConnectionGradient(effects.connectionColorAction.clusterId, maxJumps, connections)
        : {};
    return {
        effects,
        nextEditingClusterId: effects.nextEditingClusterId,
        setSelectedId: effects.setSelectedId,
        connectionColors,
    };
}
export function planBusinessTapInteractionPublications({ plan, handles, }) {
    return planTapInteractionPublications({
        effects: plan.effects,
        handles,
        connectionColors: plan.connectionColors,
    });
}
//# sourceMappingURL=business-tap-flow.js.map