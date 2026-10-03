import { defineTopic } from '../../worker/protocol/feature-topics.js';
export const MAX_BATTLES = 8;
export const BATTLE_RADIUS = .018;
export const BattleTopics = {
    fight: defineTopic('battle_fight'),
    observe: defineTopic('battle_observe'),
    end: defineTopic('battle_end'),
    changed: defineTopic('battle_changed'),
    rejected: defineTopic('battle_rejected'),
};
export function battleOrder(event, side) {
    return { ...event, side, opponent: side === 0 ? event.defender : event.attacker };
}
//# sourceMappingURL=contracts.js.map