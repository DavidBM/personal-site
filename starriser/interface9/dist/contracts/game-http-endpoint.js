/** Game bearer APIs use TLS, except the explicit IPv4 loopback demo listener.
 * Cookie authentication is separate and always requires its HTTPS origin. */
export function gameHttpEndpoint(url, allowLoopback = false) {
    const scheme = url.protocol === 'https:' || (allowLoopback && url.protocol === 'http:' && url.hostname === '127.0.0.1');
    return scheme && !url.username && !url.password && !url.search && !url.hash;
}
//# sourceMappingURL=game-http-endpoint.js.map