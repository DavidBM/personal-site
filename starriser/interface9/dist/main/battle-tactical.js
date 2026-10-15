import { bindText, setHidden, setText } from '../ui/dom-bindings.js';
export const battleStatuses = ['Engaged', 'Retreating under fire', 'Escaped', 'Destroyed', 'Released'];
export const battleRoles = ['Interceptor', 'Fighter', 'Bomber', 'Frigate', 'Battleship', 'Colossus'];
/** Sixteen retained aggregate cards; no per-ship visuals or DOM replacement. */
export function createBattleTactical(parent) {
    const cards = Array.from({ length: 16 }, () => mount(parent));
    return {
        clear() { for (const card of cards)
            card.clear(); },
        show(value) {
            for (let slot = 0; slot < cards.length; slot++) {
                const row = value.fleets[slot];
                if (row)
                    cards[slot].show(row, value.groups.filter(group => group[0] === slot));
                else
                    cards[slot].clear();
            }
        },
    };
}
function mount(parent) {
    const card = document.createElement('div'), heading = document.createElement('strong'), counts = document.createElement('p');
    const bar = document.createElement('div'), composition = document.createElement('p');
    card.style.cssText = 'border:1px solid #52657c;padding:8px;border-radius:6px;min-width:0';
    bar.style.cssText = 'height:8px;border-radius:3px';
    const headingText = bindText(heading, { height: '2.8em', wrap: true }), countsText = bindText(counts);
    const compositionText = bindText(composition, { height: '4.2em', wrap: true });
    card.append(heading, counts, bar, composition);
    parent.append(card);
    setHidden(card, true);
    let last = '';
    return {
        clear() {
            setHidden(card, true);
            setText(headingText, '');
            setText(countsText, '');
            setText(compositionText, '');
            if (last) {
                bar.setAttribute('aria-label', '');
                bar.style.background = '';
                last = '';
            }
        },
        show(row, groups) {
            setHidden(card, false);
            const key = JSON.stringify([row, groups]);
            if (key === last)
                return;
            last = key;
            const count = groups.reduce((sum, group) => sum + group[3], 0), lost = groups.reduce((sum, group) => sum + group[4], 0);
            const retreating = row[2] === 1;
            setText(headingText, `${row[4] ? 'Your fleet' : `Side ${row[1] + 1} fleet`} ${row[0] + 1} · ${battleStatuses[row[2]]}${retreating ? ` → ${row[3]} exposed turns` : ''}`);
            setText(countsText, `${count.toLocaleString()} remaining · ${lost.toLocaleString()} lost${lost ? ' ✕' : ''}`);
            setText(compositionText, groups.map(g => `${battleRoles[g[2] - 1]}: ${g[3]} (${g[4]} lost)`).join(' · '));
            card.style.borderColor = retreating ? '#ffb45a' : '#52657c';
            bar.setAttribute('aria-label', `${count} ships remaining, ${lost} destroyed`);
            const percent = count + lost > 0 ? count / (count + lost) * 100 : 0;
            bar.style.background = `linear-gradient(to right,#72adc9 ${percent}%,#923c47 0)`;
        },
    };
}
//# sourceMappingURL=battle-tactical.js.map