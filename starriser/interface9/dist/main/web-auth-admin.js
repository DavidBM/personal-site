import { AuthError, authMessage, createAccessLink, createTester, getAdminStats, getAdminUsers, getSession, logout, revokeAccessLinks, updateUser, setTesterPermission, } from './web-auth-client.js';
import { markTester } from '../ui/tester-badge.js';
function node(id) { return document.getElementById(id); }
const dashboard = node('dashboard');
const status = node('admin-status');
const refresh = node('refresh');
const more = node('load-more');
const table = node('users');
const linkCard = node('access-link-card');
const linkInput = node('access-link');
const copy = node('copy-link');
const expiry = node('link-expiry');
const form = node('tester-form');
const signOut = node('admin-sign-out');
const rows = new Map();
let session = null;
let cursor;
let busy = false;
let linkUserId = null;
function message(text, error = false) {
    status.textContent = text;
    status.dataset.tone = error ? 'error' : 'normal';
}
function gate(title, detail) {
    dashboard.hidden = true;
    refresh.hidden = true;
    node('access-gate').hidden = false;
    node('gate-title').textContent = title;
    node('gate-message').textContent = detail;
    clearLink();
}
function clearLink() {
    linkInput.value = '';
    linkUserId = null;
    linkCard.hidden = true;
    copy.textContent = 'Copy link';
}
function showLink(link, user) {
    // This is the only copy of the secret held by the page; never persisted.
    const url = new URL(link.url, window.location.href);
    if (url.origin !== window.location.origin || url.protocol !== 'https:') {
        throw new AuthError('The server returned an invalid invitation address.', 502);
    }
    linkInput.value = url.href;
    linkUserId = user.id;
    node('access-link-description').textContent = `${user.name} · Expires ${new Date(link.expiresAt).toLocaleString()}`;
    copy.textContent = 'Copy link';
    linkCard.hidden = false;
    linkInput.focus();
    linkInput.select();
}
function showStats(stats) {
    for (const key of Object.keys(stats)) {
        const target = document.getElementById(`stat-${key}`);
        if (target)
            target.textContent = stats[key].toLocaleString();
    }
}
function makeRow() {
    const row = document.createElement('tr');
    const identity = document.createElement('td');
    const name = document.createElement('div');
    name.className = 'user-name';
    const detail = document.createElement('div');
    detail.className = 'user-detail';
    identity.append(name, detail);
    const statusCell = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'status-badge';
    statusCell.append(badge);
    const role = document.createElement('td');
    role.className = 'user-role';
    const actionCell = document.createElement('td');
    const actions = document.createElement('div');
    actions.className = 'user-actions';
    actionCell.append(actions);
    row.append(identity, statusCell, role, actionCell);
    return { row, name, detail, role, badge, actions };
}
function action(label, operation, danger = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    if (danger)
        button.className = 'danger';
    button.addEventListener('click', () => { void operate(operation); });
    return button;
}
async function changeUser(user, change) {
    if (!session)
        return;
    const updated = await updateUser(session, user.id, change);
    renderUser(updated);
    if (change === 'disable' && linkUserId === user.id)
        clearLink();
    showStats(await getAdminStats());
    const result = change === 'disable' ? 'account disabled'
        : user.status === 'disabled' ? 'account reactivated; sign in again or create a new invitation link'
            : 'access approved';
    message(`${updated.name}: ${result}.`);
}
async function newLink(user) {
    if (!session)
        return;
    showLink(await createAccessLink(session, user.id, Number(expiry.value)), user);
    showStats(await getAdminStats());
    message('A new personal invitation is ready to share privately.');
}
async function revokeLinks(user) {
    if (!session)
        return;
    await revokeAccessLinks(session, user.id);
    if (linkUserId === user.id)
        clearLink();
    showStats(await getAdminStats());
    message(`All tester links for ${user.name} have been revoked and their sessions ended.`);
}
function renderUser(user) {
    let item = rows.get(user.id);
    if (!item) {
        item = makeRow();
        rows.set(user.id, item);
        table.append(item.row);
    }
    item.name.textContent = user.name;
    item.detail.textContent = user.email || `ID ${user.id}`;
    item.role.textContent = user.role === 'admin' ? 'Administrator' : 'Player';
    item.badge.textContent = user.status === 'pending' ? 'Pending approval' : user.status === 'active' ? 'Active' : 'Disabled';
    item.badge.dataset.status = user.status;
    renderActions(user, item.actions);
}
function renderActions(user, container) {
    const key = `${user.id}:${user.status}:${user.role}:${user.tester === true}`;
    if (container.dataset.actions === key)
        return;
    container.dataset.actions = key;
    container.replaceChildren();
    if (user.id === session?.user.id || user.role === 'admin')
        return;
    if (user.status === 'pending')
        container.append(action('Approve', () => changeUser(user, 'approve')));
    if (user.status === 'disabled')
        container.append(action('Reactivate', () => changeUser(user, 'approve')));
    if (user.status === 'active') {
        container.append(action('New link', () => newLink(user)));
        const toggle = action(user.tester ? 'Remove tester powers' : 'Grant tester powers', async () => { if (!session)
            return; renderUser(await setTesterPermission(session, user.id, !user.tester)); message('Tester permission updated; existing gameplay grants ended.'); });
        markTester(toggle);
        container.append(toggle);
    }
    container.append(action('Revoke links', () => revokeLinks(user)));
    if (user.status !== 'disabled')
        container.append(action('Disable', () => changeUser(user, 'disable'), true));
}
function updatePagination() {
    more.hidden = !cursor;
    node('users-count').textContent = `${rows.size.toLocaleString()} users shown`;
    node('users-empty').hidden = rows.size !== 0;
}
async function loadUsers(append = false) {
    const page = await getAdminUsers(append ? cursor : undefined);
    if (!append) {
        const included = new Set(page.users.map((user) => user.id));
        for (const [id, item] of rows) {
            if (!included.has(id)) {
                item.row.remove();
                rows.delete(id);
            }
        }
    }
    for (const user of page.users) {
        renderUser(user);
        // Keep the server's page order when refreshing retained rows.
        table.append(rows.get(user.id).row);
    }
    cursor = page.nextCursor;
    updatePagination();
}
async function reload() {
    const [stats] = await Promise.all([getAdminStats(), loadUsers()]);
    showStats(stats);
    message(`Updated ${new Date().toLocaleTimeString()}.`);
}
function setBusy(value) {
    busy = value;
    for (const button of dashboard.querySelectorAll('button'))
        button.disabled = value;
    refresh.disabled = value;
}
async function operate(operation) {
    if (busy)
        return;
    setBusy(true);
    try {
        await operation();
    }
    catch (error) {
        message(authMessage(error), true);
        if (error instanceof AuthError && (error.status === 401 || error.status === 403)) {
            gate('Administrator access required', 'Your session has ended or your access has changed. Sign in again to continue.');
        }
    }
    finally {
        setBusy(false);
    }
}
async function start() {
    try {
        session = await getSession();
        if (!session) {
            gate('Sign in to continue', 'Administration is available to authorized administrators only.');
            message('');
            return;
        }
        signOut.hidden = false;
        node('admin-account').textContent = session.user.name;
        if (session.user.role !== 'admin' || session.user.status !== 'active') {
            gate('Administrator access required', 'This account does not have access to administration.');
            message('');
            return;
        }
        dashboard.hidden = false;
        refresh.hidden = false;
        await operate(reload);
    }
    catch (error) {
        gate('Administration is unavailable', authMessage(error));
        message('');
    }
}
form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = node('tester-name').value.trim();
    if (!name || !session)
        return;
    const currentSession = session;
    void operate(async () => {
        const result = await createTester(currentSession, name, Number(expiry.value));
        showLink(result, result.user);
        node('tester-name').value = '';
        await reload();
        message(`Invitation created for ${result.user.name}.`);
    });
});
refresh.addEventListener('click', () => { void operate(reload); });
more.addEventListener('click', () => { void operate(() => loadUsers(true)); });
node('dismiss-link').addEventListener('click', clearLink);
copy.addEventListener('click', () => {
    void navigator.clipboard.writeText(linkInput.value).then(() => { copy.textContent = 'Copied'; })
        .catch(() => { linkInput.focus(); linkInput.select(); message('Select and copy the invitation from the field above.'); });
});
signOut.addEventListener('click', () => {
    if (!session)
        return;
    const currentSession = session;
    void operate(async () => { await logout(currentSession); clearLink(); window.location.replace('./'); });
});
// Do not leave an invitation in a page restored from the back-forward cache.
window.addEventListener('pagehide', clearLink);
window.addEventListener('pageshow', (event) => { if (event.persisted)
    window.location.reload(); });
void start();
//# sourceMappingURL=web-auth-admin.js.map