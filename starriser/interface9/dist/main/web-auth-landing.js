import { AuthError, authMessage, fetchAuthConfig, getSession, logout, redeemAccess } from './web-auth-client.js';
const status = document.querySelector('#auth-status');
const providers = document.querySelector('#auth-providers');
const signedIn = document.querySelector('#signed-in');
const playerName = document.querySelector('#player-name');
const enter = document.querySelector('#enter-galaxy');
const admin = document.querySelector('#admin-link');
const signOut = document.querySelector('#sign-out');
const retry = document.querySelector('#auth-retry');
let session = null;
function message(text, error = false) {
    status.textContent = text;
    status.dataset.tone = error ? 'error' : 'normal';
}
function displaySession(value) {
    session = value;
    providers.hidden = value !== null;
    signedIn.hidden = value === null;
    if (!value)
        return;
    playerName.textContent = value.user.name || value.user.email || 'Commander';
    enter.hidden = value.user.status !== 'active' || !value.user.playerId;
    admin.hidden = value.user.role !== 'admin' || value.user.status !== 'active';
    if (value.user.status === 'pending')
        message('Your account is waiting for an invitation. The team will activate your access when a place is available.');
    else if (value.user.status === 'disabled')
        message('Access to this account is disabled. Please contact the team.', true);
    else if (!value.user.playerId)
        message('You are signed in. A player profile has not been assigned yet.');
    else
        message('Your galaxy is ready.');
}
async function load(signInFailed = false) {
    retry.hidden = true;
    message('Connecting to the galaxy…');
    try {
        const config = await fetchAuthConfig();
        if (!config.enabled)
            throw new AuthError('Sign-in is not enabled on this server yet. Please contact the team.', 503);
        for (const provider of ['google', 'apple']) {
            const link = document.querySelector(`#sign-in-${provider}`);
            const enabled = config.providers[provider];
            link.setAttribute('aria-disabled', String(!enabled));
            if (enabled)
                link.href = `./auth/${provider}/start`;
            else
                link.removeAttribute('href');
        }
        displaySession(await getSession());
        if (!session)
            message(config.providers.google || config.providers.apple
                ? 'Access is currently by invitation. Sign in with the account you want to use.'
                : 'Use your personal invitation link to enter. Google and Apple sign-in are not available yet.');
        if (signInFailed)
            message('Sign-in could not be completed. Please try again, or use your personal tester invitation.', true);
    }
    catch (error) {
        providers.hidden = true;
        message(authMessage(error), true);
        retry.hidden = false;
    }
}
async function redeem(token) {
    providers.hidden = true;
    message('Opening your invitation…');
    try {
        const value = await redeemAccess(token);
        displaySession(value);
        if (value.user.status === 'active' && value.user.playerId)
            window.location.replace('./galaxy.html');
        else if (value.user.status === 'active' && value.user.role === 'admin')
            window.location.replace('./admin.html');
    }
    catch (error) {
        message(`${authMessage(error)} If your invitation has expired or been revoked, ask the team for a new link.`, true);
        retry.hidden = false;
    }
}
signOut.addEventListener('click', () => {
    if (!session)
        return;
    signOut.disabled = true;
    void logout(session).then(() => load()).catch((error) => message(authMessage(error), true))
        .finally(() => { signOut.disabled = false; });
});
retry.addEventListener('click', () => { void load(); });
// The head script has already removed the token from the address and history.
(() => {
    const accessToken = window.__galaxyAccessToken;
    const signInFailed = window.__galaxyAuthError === true;
    delete window.__galaxyAccessToken;
    delete window.__galaxyAuthError;
    if (accessToken !== undefined)
        void redeem(accessToken);
    else
        void load(signInFailed);
})();
//# sourceMappingURL=web-auth-landing.js.map