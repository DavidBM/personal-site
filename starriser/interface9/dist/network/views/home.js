import { create } from '@bufbuild/protobuf';
import { ClientMessageSchema } from '../generated/galaxy/v1/galaxy_pb.js';
import { decodeServerMessage, encodeClientMessage } from '../codec.js';
import { connectTransport } from '../transport.js';
import { opaqueIdAt } from '../../contracts/opaque-id.js';
/** Initial authenticated placement uses the same TLS/pinned transport as play.
 * A credential-only login learns its realm from the first authenticated reply;
 * provisioned callers may supply an expected world/player before connecting.
 */
export async function openPlayerHome(options) {
    let endpoints = options.endpoints;
    const expected = { ...options.expected }, visited = new Set();
    for (let redirects = 0; redirects <= 3; redirects++) {
        const transport = await (options.factory ?? connectTransport)(endpoints, options.signal);
        try {
            const reply = await handshake(transport, options.credential, options.signal, options.gameplay);
            bindIdentity(expected, reply.value);
            if (reply.case === 'welcome')
                return { transport, welcome: reply.value, redirects, contentEndpoint: contentEndpoint(endpoints) };
            const home = reply.value;
            const host = opaqueIdAt(home.hostId);
            if (visited.has(host) || redirects === 3)
                throw new Error('Player home redirect limit');
            visited.add(host);
            endpoints = placementEndpoints(home);
            transport.close();
        }
        catch (error) {
            transport.close();
            throw error;
        }
    }
    throw new Error('Player home redirect limit');
}
/** Own one transport's authenticated greeting; redirect policy belongs above. */
async function handshake(transport, credential, signal, gameplay = false) {
    if (signal.aborted)
        throw new Error('Player home connection canceled');
    await transport.send(encodeClientMessage(create(ClientMessageSchema, { body: { case: 'hello', value: {
                minimumProtocolVersion: 1, maximumProtocolVersion: 1, supportedRuleVersions: [1], requiredCapabilities: [1, 4, 5, 7, 11, 12, 14, ...(gameplay ? [15] : [])], sessionCredential: credential,
            } } })));
    const bytes = await transport.receive();
    if (signal.aborted || !bytes)
        throw new Error('Player home handshake ended');
    const reply = decodeServerMessage(bytes).body;
    if (reply.case === 'failure')
        throw new Error(`Player protocol failure ${reply.value.code}`);
    if (reply.case !== 'welcome' && reply.case !== 'viewPlacement')
        throw new Error('Authenticated player home placement required');
    if (reply.case === 'welcome')
        validateCapabilities(reply.value, gameplay);
    return reply;
}
function validateCapabilities(welcome, gameplay) {
    const capabilities = welcome.capabilities;
    if (gameplay && !capabilities.includes(15))
        throw new Error('Gameplay channel capability required');
    if (![1, 4, 5, 7, 11, 12, 14].every(capability => capabilities.includes(capability)))
        throw new Error('Player views and XYZ capabilities are required');
}
function bindIdentity(expected, value) {
    const world = opaqueIdAt(value.worldId), player = opaqueIdAt(value.playerId);
    if (expected.worldId && expected.worldId !== world)
        throw new Error('Player home world changed');
    if (expected.playerId && expected.playerId !== player)
        throw new Error('Player home player changed');
    expected.worldId = world;
    expected.playerId = player;
}
function placementEndpoints(value) {
    return { webSocketUrl: value.websocketUrl, webTransportUrl: value.webtransportUrl,
        certificateHashes: value.certificateSha256.length ? [{ algorithm: 'sha-256', value: new Uint8Array(value.certificateSha256) }] : undefined };
}
/** Only the final authenticated transport origin receives content credentials.
 * The explicit literal-loopback development listener also serves these APIs. */
function contentEndpoint(endpoints) {
    // Content is on the TCP HTTPS gateway, not the separate WebTransport QUIC port.
    const value = endpoints.webSocketUrl;
    if (!value)
        return;
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash)
        return;
    if (url.protocol === 'wss:')
        url.protocol = 'https:';
    else if (url.protocol === 'ws:' && url.hostname === '127.0.0.1')
        url.protocol = 'http:';
    else
        return;
    return new URL('./world-content', url).href;
}
//# sourceMappingURL=home.js.map