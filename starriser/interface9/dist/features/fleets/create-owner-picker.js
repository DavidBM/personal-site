import { bindText, setText } from '../../ui/dom-bindings.js';
import { markTester } from '../../ui/tester-badge.js';
/** One cold page at a time. Native select options are retained, never a frame loop. */
export function createOwnerPicker(parent, load) {
    const label = document.createElement('label');
    label.textContent = 'Owner';
    label.style.cssText = 'display:block;margin:5px 0';
    markTester(label);
    const select = document.createElement('select');
    select.name = 'ownerId';
    select.className = 'ui-select';
    select.setAttribute('aria-label', 'Fleet owner');
    select.style.cssText = 'display:block;width:100%;height:28px;font:inherit';
    const own = document.createElement('option');
    own.value = '';
    own.textContent = 'You';
    select.append(own);
    label.append(select);
    parent.append(label);
    const options = Array.from({ length: 32 }, () => { const option = document.createElement('option'), text = document.createTextNode(''); option.append(text); option.hidden = option.disabled = true; select.append(option); return { option, text }; });
    const status = document.createElement('div'), text = bindText(status, { width: '224px', height: '32px', wrap: true });
    parent.append(status);
    function button(title) { const b = document.createElement('button'); b.type = 'button'; b.className = 'micro-btn'; b.textContent = title; markTester(b); parent.append(b); return b; }
    const first = button('First players'), more = button('More players');
    let at, pending, next;
    function cancel() { pending?.abort(); pending = undefined; }
    function reset() { select.value = ''; for (const row of options) {
        row.option.hidden = row.option.disabled = true;
        row.option.value = '';
        row.text.data = '';
    } next = undefined; first.disabled = more.disabled = true; }
    async function page(after) {
        if (!at)
            return;
        cancel();
        reset();
        select.disabled = true;
        const owner = new AbortController();
        pending = owner;
        setText(text, 'Loading players in this system…');
        try {
            const result = await load(at, after, owner.signal);
            if (pending !== owner)
                return;
            for (let i = 0; i < result.owners.length; i++) {
                const row = options[i], id = result.owners[i];
                row.option.value = id;
                row.text.data = `Player ${id.slice(-8)} · neutral`;
                row.option.hidden = row.option.disabled = false;
            }
            next = result.next;
            first.disabled = after === undefined;
            more.disabled = !next;
            setText(text, result.owners.length ? 'Other players’ fleets remain neutral and under their control.' : 'No other players currently have fleets here.');
        }
        catch (e) {
            if (pending === owner)
                setText(text, e instanceof Error ? e.message : 'Players unavailable');
        }
        finally {
            if (pending === owner) {
                pending = undefined;
                select.disabled = false;
            }
        }
    }
    first.onclick = () => { void page(); };
    more.onclick = () => { if (next)
        void page(next); };
    return { open(node) { at = node; void page(); }, value: () => select.value || undefined, close() { cancel(); at = undefined; } };
}
//# sourceMappingURL=create-owner-picker.js.map