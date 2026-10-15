import { watchGameplay } from '../features/http-worker/client.js';
import { requestIndustry, IndustryRequestError } from '../lib/industry-content/client.js';
import { quantities, validateOperation } from '../lib/industry-content/contracts.js';
import { bindOptions, bindText, setText } from '../ui/dom-bindings.js';
const resources = ['Ore (kg)', 'Metal (kg)', 'Contained slag (kg)', 'Components (kg)', 'Contained scrap (kg)', 'Energy (Wh)'];
/** One retained panel per online session. Only confirmed server projections patch
 * stocks. Changing body, permission epoch or session retires pending reads. */
export function createOnlineIndustry(parent, options = {}) {
    const panel = document.createElement('section');
    panel.style.cssText = 'width:100%;min-width:0;max-width:44em;overflow-wrap:anywhere';
    const title = document.createElement('h3');
    title.textContent = 'Planet industry';
    const help = document.createElement('p');
    help.textContent = 'Build on surveyed ground using local stock. Factories process whole batches; byproducts need storage. Shipments cost energy and take time.';
    const context = document.createElement('p'), contextText = bindText(context, { height: '2.8em', wrap: true });
    setText(contextText, 'Select a planet and exact surface pixel.');
    const source = select('Industry source facility'), destination = select('Industry destination facility'), kind = select('Factory type');
    const sourceOptions = bindOptions(source), destinationOptions = bindOptions(destination);
    kind.append(option('1', 'Refinery'), option('2', 'Fabricator'));
    kind.value = '1';
    const refresh = button('Load facilities'), next = button('Next facilities'), view = button('View source inventory'), build = button('Build factory here'), start = button('Start one batch');
    const cargo = document.createElement('input');
    cargo.setAttribute('aria-label', 'Cargo: ore, metal, slag, components, scrap, energy');
    cargo.placeholder = 'Cargo: 10,0,0,0,0,5';
    cargo.value = '10,0,0,0,0,5';
    cargo.style.width = '22em';
    const ship = button('Send shipment'), retry = button('Retry same request'), dismiss = button('Clear invalid request');
    const table = document.createElement('table'), header = document.createElement('tr');
    for (const name of ['Resource', 'Available', 'Reserved', 'Capacity']) {
        const cell = document.createElement('th');
        cell.textContent = name;
        header.append(cell);
    }
    table.append(header);
    table.style.cssText = 'width:100%;min-width:66ch;table-layout:fixed;overflow-wrap:normal';
    const inventoryScroll = document.createElement('div');
    inventoryScroll.style.cssText = 'max-width:100%;overflow-x:auto';
    inventoryScroll.tabIndex = 0;
    inventoryScroll.setAttribute('aria-label', 'Facility inventory');
    inventoryScroll.append(table);
    const stockNodes = resources.map(name => { const row = document.createElement('tr'), label = document.createElement('td'); label.textContent = name; row.append(label); const cells = [0, 1, 2].map(() => { const cell = document.createElement('td'), leaf = document.createElement('span'), text = bindText(leaf, { width: '14ch' }); setText(text, '—'); cell.append(leaf); row.append(cell); return text; }); table.append(row); return cells; });
    const inventoryTitle = document.createElement('p'), inventoryText = bindText(inventoryTitle, { height: '2.8em', wrap: true });
    setText(inventoryText, 'No confirmed inventory selected.');
    const output = document.createElement('output'), outputText = bindText(output, { height: '4.2em', wrap: true });
    setText(outputText, 'Awaiting current permission.');
    output.setAttribute('aria-live', 'polite');
    output.style.display = 'block';
    const timing = document.createElement('p'), timingText = bindText(timing, { height: '2.8em', wrap: true });
    panel.append(title, help, context, refresh, next, source, destination, view, inventoryTitle, inventoryScroll, kind, build, start, cargo, ship, retry, dismiss, timing, output);
    parent.append(panel);
    let welcome, selection, scope;
    let epoch = 0n, closed = false, pending, last, rejectConfirmed = false;
    let lastScope, detailSystem = '', detailRequest = 0n;
    let sourceRows = [];
    let intent, pageAfter, scopeSerial = 0, restorationSerial = -1, freshSelection = false;
    let cursor = null, revision, facility, latest, receivedAt = 0;
    let dirty = false;
    const unwatch = watchGameplay(16, () => { if (pending)
        dirty = true;
    else
        refreshCurrent(); });
    function refreshCurrent() { if (!scope || closed)
        return; void perform(source.value ? { action: 'read', facilityId: source.value } : { action: 'list', after: pageAfter }); }
    const ticker = setInterval(() => progress(), 1000);
    function controls() {
        const unavailable = !scope || !!pending, locked = unavailable || !!last;
        refresh.disabled = locked;
        next.disabled = locked || !cursor;
        view.disabled = locked || !source.value;
        constructionControls(locked);
        productionControls(locked);
        retry.disabled = unavailable || !last || !matchingLastScope();
        dismiss.disabled = unavailable || !rejectConfirmed;
        source.disabled = destination.disabled = cargo.disabled = kind.disabled = !!pending || !!last;
    }
    function matchingLastScope() {
        return !!scope && !!lastScope && scope.worldId === lastScope.worldId
            && scope.systemId === lastScope.systemId && scope.bodyId === lastScope.bodyId;
    }
    function constructionControls(locked) {
        build.disabled = locked || !selection?.pixel || !source.value || revision === undefined;
    }
    function productionControls(locked) {
        start.disabled = locked || !facility?.kind || !!facility.batch || facility.id !== source.value;
        ship.disabled = locked || !source.value || !destination.value || source.value === destination.value;
    }
    function rememberFacilities() {
        if (!scope || !source.value || restorationSerial === scopeSerial)
            return;
        intent = { worldId: scope.worldId, systemId: scope.systemId, bodyId: scope.bodyId, epoch: scope.visibilityEpoch, sourceId: source.value, destinationId: destination.value, after: pageAfter };
    }
    function clear() {
        rememberFacilities();
        scopeSerial++;
        freshSelection = false;
        pageAfter = undefined;
        pending?.abort();
        pending = undefined;
        scope = undefined;
        cursor = null;
        revision = undefined;
        facility = undefined;
        latest = undefined;
        rejectConfirmed = false;
        sourceRows = [];
        sourceOptions.clear();
        destinationOptions.clear();
        setText(inventoryText, 'No confirmed inventory selected.');
        setText(timingText, '');
        for (const row of stockNodes)
            for (const text of row)
                setText(text, '—');
        setText(outputText, 'Industry controls await current permission.');
        controls();
    }
    function install() {
        if (!canInstall())
            return;
        scope = { worldId: welcome.worldId, visibilityEpoch: epoch.toString(), systemId: selection.systemId, bodyId: selection.bodyId };
        controls();
        resumeFacilities();
    }
    function canInstall() {
        return !!selection && !!welcome && epoch > 0n && selection.systemId === detailSystem;
    }
    function matchingIntent(value) {
        return !!scope && value.worldId === scope.worldId && value.systemId === scope.systemId
            && value.bodyId === scope.bodyId && value.epoch === scope.visibilityEpoch;
    }
    function resumeFacilities() {
        if (!intent || !freshSelection || last || pending || restorationSerial === scopeSerial)
            return;
        if (!matchingIntent(intent)) {
            intent = undefined;
            return;
        }
        restorationSerial = scopeSerial;
        void restoreFacilities(intent, scopeSerial);
    }
    async function restoreFacilities(value, serial) {
        const result = await perform({ action: 'list', after: value.after });
        if (serial !== scopeSerial || result?.kind !== 'page')
            return;
        if (result.facilities.some(row => row.id === value.sourceId))
            source.value = value.sourceId;
        if (result.facilities.some(row => row.id === value.destinationId))
            destination.value = value.destinationId;
        await perform({ action: 'read', facilityId: value.sourceId });
        if (serial === scopeSerial) {
            intent = undefined;
            restorationSerial = -1;
        }
    }
    function show(value) {
        revision = value.planetRevision;
        latest = value;
        receivedAt = Date.now();
        if (value.kind === 'page')
            showPage(value.facilities, value.after);
        else if (value.kind === 'facility')
            showFacility(value.facility);
        else if (value.kind === 'rejected')
            setText(outputText, rejectionMessage(value.reason));
        else
            setText(outputText, `Shipment ${value.shipment.id} confirmed. ${value.shipment.energyWh} Wh transport cost. Cargo remains reserved until delivery.`);
        progress();
    }
    function showPage(values, after) {
        clearInventory();
        cursor = after;
        const oldSource = source.value, oldDestination = destination.value;
        sourceRows = values;
        sourceOptions.update(values, v => v.id, label);
        destinationOptions.update(values, v => v.id, label);
        source.value = values.some(v => v.id === oldSource) ? oldSource : values[0]?.id ?? '';
        destination.value = values.some(v => v.id === oldDestination) ? oldDestination : values[1]?.id ?? '';
        setText(outputText, values.length ? `${values.length} owned facilities loaded. Choose a source and view its stock.` : 'No industry is provisioned on this owned planet yet.');
    }
    function showFacility(value) {
        if (!sourceRows.some(row => row.id === value.id)) {
            sourceRows = [value, ...sourceRows.slice(0, 7)];
            sourceOptions.update(sourceRows, v => v.id, label);
        }
        source.value = value.id;
        facility = value;
        setText(inventoryText, `Confirmed inventory: ${label(value)}`);
        stockNodes.forEach((row, i) => { setText(row[0], String(value.amounts[i])); setText(row[1], String(value.reserved[i])); setText(row[2], String(value.capacity[i])); });
        setText(outputText, `Factory or inventory state confirmed. Revision ${value.revision}. Reload facilities after construction to select the new factory.`);
    }
    function clearInventory() {
        facility = undefined;
        setText(inventoryText, 'No confirmed inventory selected.');
        setText(timingText, '');
        for (const row of stockNodes)
            for (const text of row)
                setText(text, '—');
    }
    function progress() {
        if (!latest)
            return;
        const accepted = latest.kind === 'shipment' ? latest.shipment : facility?.batch;
        if (!accepted) {
            setText(timingText, '');
            return;
        }
        const now = latest.serverNowMs + BigInt(Math.max(0, Date.now() - receivedAt)), remaining = accepted.deadlineMs - now;
        setText(timingText, remaining > 0n ? `${latest.kind === 'shipment' ? 'Shipment' : 'Production batch'}: ${((remaining + 999n) / 1000n)} seconds until its accepted deadline.` : 'Accepted deadline reached. Waiting for confirmed completion.');
    }
    function current(owner) { return !closed && pending === owner && !owner.signal.aborted; }
    async function perform(operation) {
        if (!scope || closed || pending)
            return;
        const owner = new AbortController(), acceptedScope = scope;
        pending = owner;
        if (!['read', 'list'].includes(operation.action)) {
            last = structuredClone(operation);
            lastScope = { worldId: acceptedScope.worldId, systemId: acceptedScope.systemId, bodyId: acceptedScope.bodyId };
            rejectConfirmed = false;
        }
        controls();
        setText(outputText, 'Waiting for server confirmation…');
        try {
            const value = await requestIndustry(acceptedScope, operation, owner.signal, options.call);
            if (current(owner)) {
                confirmed(operation, value);
                return value;
            }
        }
        catch (error) {
            if (current(owner))
                failure(error);
        }
        finally {
            if (pending === owner) {
                pending = undefined;
                controls();
                if (dirty) {
                    dirty = false;
                    refreshCurrent();
                }
            }
        }
    }
    function confirmed(operation, value) {
        if (operation.action !== 'read' && operation.action !== 'list') {
            last = undefined;
            rejectConfirmed = false;
        }
        if (operation.action === 'list')
            pageAfter = operation.after;
        show(value);
    }
    function failure(error) {
        if (error instanceof IndustryRequestError && [401, 403, 412].includes(error.status)) {
            detailSystem = '';
            clear();
            intent = undefined;
        }
        rejectConfirmed = error instanceof IndustryRequestError && error.status === 400;
        setText(outputText, error instanceof Error ? error.message : 'Outcome unconfirmed. Retry the same request.');
    }
    function installDetail(next, systemId) {
        if (next !== epoch || detailSystem !== systemId)
            clear();
        epoch = next;
        detailSystem = systemId;
        install();
    }
    function currentDetail(status) {
        const token = status.displayed;
        return !!welcome && !!token && token.connection === welcome.generation
            && token.request === status.requestedGeneration && token.epoch > 0n && token.epoch >= epoch;
    }
    function retireDetail(status) {
        detailSystem = '';
        clear();
        const transient = status.state === 'loading' || status.state === 'unavailable';
        if (!transient || status.requested?.kind !== 'detail' || status.requested.systemId !== intent?.systemId)
            intent = undefined;
    }
    function detail(status) {
        if (status.slot !== 'detail' || status.requestedGeneration < detailRequest)
            return;
        if (status.requestedGeneration > detailRequest) {
            detailRequest = status.requestedGeneration;
            detailSystem = '';
            clear();
        }
        const requested = status.requested;
        if (status.state !== 'ready' || status.stale || !currentDetail(status)) {
            retireDetail(status);
            return;
        }
        if (requested?.kind !== 'detail') {
            detailSystem = '';
            clear();
            intent = undefined;
            return;
        }
        installDetail(status.displayed.epoch, requested.systemId);
    }
    function sameConnection(value) { return !welcome || !('generation' in value) || value.generation === welcome.generation; }
    function submit(make) { try {
        const operation = make();
        validateOperation(operation);
        void perform(operation);
    }
    catch (error) {
        setText(outputText, error instanceof Error ? error.message : 'Invalid industry command');
    } }
    refresh.addEventListener('click', () => { void perform({ action: 'list' }); });
    next.addEventListener('click', () => { if (cursor)
        void perform({ action: 'list', after: cursor }); });
    view.addEventListener('click', () => { void perform({ action: 'read', facilityId: source.value }); });
    build.addEventListener('click', () => submit(() => ({ action: 'build', commandId: identity(), facilityId: identity(), supplyId: source.value, planetRevision: String(revision), kind: Number(kind.value), x: selection.pixel.x, y: selection.pixel.y })));
    start.addEventListener('click', () => { if (facility)
        void perform({ action: 'batch', batchId: identity(), facilityId: facility.id }); });
    ship.addEventListener('click', () => submit(() => ({ action: 'ship', shipmentId: identity(), sourceId: source.value, destinationId: destination.value, cargo: quantities(cargo.value.split(',').map(v => Number(v.trim()))) })));
    retry.addEventListener('click', () => { if (last && matchingLastScope())
        void perform(last); });
    dismiss.addEventListener('click', () => { if (rejectConfirmed) {
        last = undefined;
        rejectConfirmed = false;
        controls();
    } });
    source.addEventListener('change', () => { clearInventory(); latest = undefined; controls(); });
    destination.addEventListener('change', controls);
    controls();
    return {
        reconnect() { clear(); welcome = undefined; detailSystem = ''; detailRequest = epoch = 0n; },
        event(value) {
            if (closed || !sameConnection(value))
                return;
            switch (value.type) {
                case 'welcome':
                    detailRequest = 0n;
                    detailSystem = '';
                    epoch = 0n;
                    clear();
                    intent = undefined;
                    welcome = value;
                    return;
                case 'viewBarrier':
                    if (value.epoch > epoch) {
                        detailSystem = '';
                        clear();
                        intent = undefined;
                        epoch = value.epoch;
                    }
                    return;
                case 'viewChanged':
                    detail(value.status);
                    return;
                case 'state':
                    if (value.state === 'closed') {
                        detailSystem = '';
                        clear();
                        intent = undefined;
                    }
                    return;
            }
        },
        setSelection(value) {
            if (closed)
                return;
            const changed = value?.bodyId !== selection?.bodyId || value?.systemId !== selection?.systemId;
            if (changed)
                clear();
            selection = value && structuredClone(value);
            freshSelection = !!value;
            setText(contextText, selectionLabel(value));
            install();
            controls();
        },
        dispose() { if (closed)
            return; closed = true; unwatch(); clearInterval(ticker); clear(); panel.remove(); },
        inspect: () => ({ pending: !!pending, last, latest, epoch, selection }),
    };
}
function label(value) { return `${['Warehouse', 'Refinery', 'Fabricator'][value.kind]} ${value.id.slice(-8)} · (${value.x}, ${value.y})`; }
function select(label) { const node = document.createElement('select'); node.setAttribute('aria-label', label); node.style.cssText = 'display:block;max-width:100%'; return node; }
function option(value, label) { const node = document.createElement('option'); node.value = value; node.textContent = label; return node; }
function button(label) { const node = document.createElement('button'); node.type = 'button'; node.textContent = label; return node; }
function identity() { return crypto.randomUUID().replace(/-/g, ''); }
function selectionLabel(value) {
    if (!value)
        return 'Select a planet and exact surface pixel.';
    return `Planet ${value.bodyId}${value.pixel ? ` · pixel (${value.pixel.x}, ${value.pixel.y})` : ' · choose an exact pixel to build'}`;
}
function rejectionMessage(reason) {
    const labels = ['unknown condition', 'ground has not been surveyed for construction', 'not enough local resources', 'storage or industry capacity is full', 'the requested facility is unavailable', 'the source is too far away', 'this factory already has a running batch', 'the footprint overlaps an existing complex', 'the planet changed; reload facilities', 'the request does not satisfy the current rules'];
    return `Request durably rejected: ${labels[reason]}. Check the condition, then submit a new request.`;
}
//# sourceMappingURL=online-industry.js.map