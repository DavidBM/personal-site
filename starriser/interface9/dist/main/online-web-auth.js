import { AuthError, fetchAuthConfig, getSession } from './web-auth-client.js';
/** A missing auth route supports existing standalone development pages only. */
export async function onlineWebAuth() {
    let enabled;
    try {
        enabled = (await fetchAuthConfig()).enabled;
    }
    catch (error) {
        if (error instanceof AuthError && error.status === 404)
            return undefined;
        return leaveForLogin();
    }
    if (!enabled)
        return undefined;
    try {
        const session = await getSession();
        if (!session || session.user.status !== 'active')
            return leaveForLogin();
        if (!session.user.playerId)
            return leaveForLogin(session.user.role === 'admin' ? './admin.html' : './');
        return session;
    }
    catch {
        return leaveForLogin();
    }
}
function leaveForLogin(path = './') {
    location.replace(path);
    // Navigation owns the next page. Do not initialize the GPU or game connection.
    return new Promise(() => { });
}
//# sourceMappingURL=online-web-auth.js.map