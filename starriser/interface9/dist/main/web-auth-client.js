import { featureRequest, FeatureError } from '../features/http-worker/client.js';
export class AuthError extends Error {
    constructor(message, status) {
        super(message);
        this.name = 'AuthError';
        this.status = status;
    }
}
async function request(path, session, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        if (typeof window !== 'undefined')
            return await featureRequest('auth', [new URL(path, window.location.href).href, session?.csrfToken, body], controller.signal);
        return await directTestRequest(path, session, body, controller.signal);
    }
    catch (error) {
        if (error instanceof FeatureError && error.status !== undefined)
            throw new AuthError(error.message, error.status);
        if (error instanceof AuthError)
            throw error;
        throw new AuthError('The sign-in service is unavailable. Please try again shortly.', 0);
    }
    finally {
        clearTimeout(timeout);
    }
}
function errorMessage(value, status) {
    if (value && typeof value === 'object' && 'error' in value && typeof value.error === 'string') {
        return value.error.slice(0, 400);
    }
    if (status === 401)
        return 'Your session has ended. Please sign in again.';
    if (status === 403)
        return 'You do not have access to this action.';
    if (status === 429)
        return 'Too many attempts. Please wait a moment and try again.';
    return 'The request could not be completed. Please try again.';
}
export function fetchAuthConfig() { return request('./auth/config'); }
export async function getSession() {
    try {
        return await request('./auth/session');
    }
    catch (error) {
        if (error instanceof AuthError && error.status === 401)
            return null;
        throw error;
    }
}
export function redeemAccess(token) {
    return request('./auth/access', undefined, { token });
}
export function gameAccess(session) {
    return request('./auth/game', session, {});
}
export function logout(session) {
    return request('./auth/logout', session, {});
}
export function getAdminStats() { return request('./admin/api/stats'); }
export function getAdminUsers(after) {
    return request(`./admin/api/users${after ? `?after=${encodeURIComponent(after)}` : ''}`);
}
export function createTester(session, name, expiresInSeconds) {
    return request('./admin/api/testers', session, { name, expiresInSeconds });
}
export function updateUser(session, id, action) {
    return request(`./admin/api/users/${encodeURIComponent(id)}/${action}`, session, {});
}
export function createAccessLink(session, id, expiresInSeconds) {
    return request(`./admin/api/users/${encodeURIComponent(id)}/links`, session, { expiresInSeconds });
}
export function revokeAccessLinks(session, id) {
    return request(`./admin/api/users/${encodeURIComponent(id)}/revoke-links`, session, {});
}
export function authMessage(error) {
    return error instanceof AuthError ? error.message : 'Something went wrong. Please try again.';
}
export function setTesterPermission(session, id, enabled) {
    return request(`./admin/api/users/${encodeURIComponent(id)}/tester`, session, { enabled });
}
/** Injected Node fixtures use the same response semantics; browsers use the worker. */
async function directTestRequest(path, session, body, signal) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined)
        headers['Content-Type'] = 'application/json';
    if (session)
        headers['X-CSRF-Token'] = session.csrfToken;
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal });
    if (response.status === 204)
        return undefined;
    const value = await response.json().catch(() => null);
    if (!response.ok)
        throw new AuthError(errorMessage(value, response.status), response.status);
    if (value === null)
        throw new AuthError('Invalid authentication response', 502);
    return value;
}
//# sourceMappingURL=web-auth-client.js.map