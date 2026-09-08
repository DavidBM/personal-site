function localPage(value) {
    const page = new URL(value);
    return page.protocol === 'http:' && page.hostname === '127.0.0.1';
}
function localEndpoint(value) {
    const endpoint = new URL(value);
    if (endpoint.protocol !== 'ws:' || endpoint.hostname !== '127.0.0.1' || endpoint.pathname !== '/session')
        return;
    if ([endpoint.username, endpoint.password, endpoint.search, endpoint.hash].some(Boolean))
        return;
    return endpoint.href;
}
export function parseDevLogin(fragment, page) {
    if (!fragment || fragment.length > 2048)
        return;
    try {
        if (!localPage(page))
            return;
        const fields = new URLSearchParams(fragment.replace(/^#/, ''));
        if (fields.get('galaxy-login') !== '1')
            return;
        const [credential, systemId, address] = ['credential', 'system', 'ws'].map(key => fields.get(key) ?? '');
        if (!/^[0-9a-f]{64}$/i.test(credential) || !/^[0-9a-f]{32}$/i.test(systemId))
            return;
        const endpoint = localEndpoint(address);
        if (endpoint)
            return { credential, endpoint, systemId };
    }
    catch {
        return;
    }
}
export function consumeDevLogin(source) {
    const fragment = source.__galaxyDevLoginFragment;
    delete source.__galaxyDevLoginFragment;
    return parseDevLogin(fragment ?? '', source.location.href);
}
//# sourceMappingURL=online-login.js.map