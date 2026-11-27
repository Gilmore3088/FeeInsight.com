// @vitest-environment node
/** Independent trusted-loopback infrastructure tests; no candidate/app/PDF/DB/browser execution. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { createTransparentHold, assessTransparentHoldEvents } from './transparent-hold.mjs';
import { openLiteralClient, openLiteralPeer, waitFor } from './__fixtures__/transport-probe.mjs';

const INVENTORY_SHA = '243c3b8d5eb3eb247624f6625220b15208ce5093a6eefd0953367ed5a75db0e8';
const AMENDMENT_SHA = 'b4237e9d2c856b00b6234daf7917bef16a16d6193c9fcc6015bdd5ac18924448';
const LIMITS = {
  operationDeadlineMs: 5000, wholeCaseDeadlineMs: 45000,
  maxHeaderBytes: 8192, maxBodyBytesPerDirection: 65536, maxWireBytesPerDirection: 73728,
  maxConcurrentClientFlows: 2, maxConcurrentUpstreamLegs: 2, maxConcurrentPhysicalDataConnections: 4,
  maxProxyDataSocketHandles: 4, maxAllFixtureDataSocketHandles: 8,
  maxEligibleHeldRequests: 1, maxControlOperations: 8,
  maxSemanticEventsPerCase: 256, maxProxyQueuedBytesPerDirection: 8192,
  maxAllRawArtifactBytesPerCase: 2097152,
};
// This is a coverage ledger, not a passing verdict for unimplemented topology.
export const PUBLIC_COVERAGE = {
  NET01: 'REQUIRED_BLOCKED_FULL_TOPOLOGY', NET02: 'REQUIRED_BLOCKED_FULL_TOPOLOGY',
  NET03: 'REQUIRED_BLOCKED_FULL_TOPOLOGY', NET04: 'REQUIRED_BLOCKED_FULL_TOPOLOGY',
  NET05: 'REQUIRED_BLOCKED_FULL_TOPOLOGY', NET06: 'REQUIRED_BLOCKED_FULL_TOPOLOGY',
  HTTP01: 'SCOPED_SOCKET_TESTS', HTTP02: 'SCOPED_SOCKET_TESTS', HTTP03: 'SCOPED_SOCKET_TESTS',
  HTTP04: 'REQUIRED_BLOCKED_UNLESS_NATIVE_PRESSURE_OBSERVED', HTTP05: 'SCOPED_SOCKET_TESTS',
  HOLD01: 'SCOPED_SOCKET_TESTS', HOLD02: 'SCOPED_SOCKET_TESTS', HOLD03: 'SCOPED_SOCKET_TESTS',
  HOLD04: 'SCOPED_SOCKET_TESTS', HOLD05: 'SCOPED_SOCKET_AND_UNTRUSTED_REPLAY_TESTS',
  ABORT01: 'SCOPED_SOCKET_TESTS', ABORT02: 'SCOPED_SOCKET_TESTS',
  ABORT03: 'SCOPED_SOCKET_TESTS', ABORT04: 'SCOPED_SOCKET_TESTS',
  BOUND01: 'SCOPED_SOCKET_TESTS', BOUND02: 'SCOPED_SOCKET_TESTS',
  BOUND03: 'PARTIAL_REAL_DEADLINES_UNACCEPTED_TCP_NOT_MEASURED', BOUND04: 'UNTRUSTED_EVENT_REPLAY_TESTS',
  EVID01: 'REQUIRED_BLOCKED_FULL_TOPOLOGY', EVID02: 'REQUIRED_BLOCKED_FULL_TOPOLOGY',
  CLEAN01: 'REQUIRED_BLOCKED_FULL_TOPOLOGY', CLEAN02: 'REQUIRED_BLOCKED_FULL_TOPOLOGY',
  CLEAN03: 'REQUIRED_BLOCKED_FULL_TOPOLOGY',
} as const;

const HOST = 'board.fixture.invalid:8080';
const ORIGIN = 'http://board.fixture.invalid:8080';
const SAVE = Buffer.from('POST /literal/save HTTP/1.1\r\nHost: board.fixture.invalid:8080\r\nContent-Length: 9\r\nConnection: close\r\n\r\nSAVE-A-01');
const ACK = Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\nACK-A-01');
const GET = Buffer.from('GET /literal/ping HTTP/1.1\r\nHost: board.fixture.invalid:8080\r\nConnection: close\r\n\r\n');
const PONG = Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 11\r\nConnection: close\r\n\r\nAPP-PONG-01');
const cleanup: Array<() => Promise<unknown> | unknown> = [];
type Proxy = Awaited<ReturnType<typeof createTransparentHold>>;
type Client = Awaited<ReturnType<typeof openLiteralClient>>;
type Peer = Awaited<ReturnType<typeof openLiteralPeer>>;

afterEach(async () => {
  const failures = [];
  for (const close of cleanup.splice(0).reverse()) {
    try { await close(); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'Owned literal socket cleanup failed');
});

function exact(actual: Buffer, expected: Buffer) {
  expect(Buffer.isBuffer(actual)).toBe(true);
  expect(actual.length).toBe(expected.length);
  expect(actual.equals(expected)).toBe(true);
}
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const received = (peer: Peer) => Buffer.concat(peer.connections.map(c => c.received));
async function peer(handler: Parameters<typeof openLiteralPeer>[0] = () => {}, options = {}) {
  const result = await openLiteralPeer(handler, options);
  cleanup.push(() => result.close());
  return result;
}
async function proxy(upstream: Peer) {
  const result = await createTransparentHold({ upstream: upstream.address, limits: LIMITS });
  cleanup.push(() => result.close());
  expect(result.address.host).toBe('127.0.0.1');
  return result;
}
async function client(controller: Proxy, options = {}) {
  const result = await openLiteralClient(controller.address, options);
  cleanup.push(() => result.socket.destroy());
  return result;
}
async function endObserved(connection: Client) {
  await waitFor(() => connection.ended || connection.closed);
}
async function sendChunks(connection: Client | Peer['connections'][number], bytes: Buffer) {
  for (let offset = 0; offset < bytes.length && !connection.socket.destroyed; offset += 256) {
    connection.write(bytes.subarray(offset, offset + 256));
    await new Promise<void>(resolve => setImmediate(resolve));
  }
}
function upstreamResponds(request: Buffer, response: Buffer) {
  return (connection: Peer['connections'][number]) => {
    let responded = false;
    connection.socket.on('data', () => {
      if (!responded && connection.received.length >= request.length) {
        responded = true;
        connection.socket.end(response);
      }
    });
  };
}
async function roundTrip(request: Buffer, response: Buffer) {
  const app = await peer(upstreamResponds(request, response));
  const hold = await proxy(app), browser = await client(hold);
  browser.write(request);
  browser.socket.end(); // A complete request half-close must still receive the response.
  await endObserved(browser);
  exact(received(app), request);
  exact(browser.received, response);
  await waitFor(() => hold.snapshot().requests[0]?.terminal === 'complete');
  const closed = await hold.close();
  expect(closed).toEqual({ closed: true, remainingSockets: 0 });
  const snapshot = hold.snapshot();
  expect(snapshot.status).toBe('COMPLETE');
  expect(snapshot.authority).toBe('TRUSTED_LOOPBACK_INFRASTRUCTURE_ONLY');
  expect(snapshot.queue.kernelBuffers).toBe('UNOBSERVED');
  expect(snapshot.requests).toHaveLength(1);
  expect(snapshot.connections.active).toEqual({ clientFlows: 0, upstreamLegs: 0, physicalConnections: 0, proxySocketHandles: 0 });
  expect(snapshot.connections.maxObserved.clientFlows).toBe(1);
  expect(snapshot.connections.maxObserved.upstreamLegs).toBe(1);
  expect(snapshot.connections.maxObserved.physicalConnections).toBe(2);
  expect(snapshot.connections.maxObserved.proxySocketHandles).toBe(2);
  expect(snapshot.connections.allFixtureDataSocketHandles).toBe('UNOBSERVED');
  for (const [direction, bytes] of [['request', request.length], ['response', response.length]] as const) {
    expect(snapshot.traffic[direction].readBytes).toBe(bytes);
    expect(snapshot.traffic[direction].writeBytes).toBe(bytes);
    expect(snapshot.traffic[direction].readChunks).toBeGreaterThan(0);
    expect(snapshot.traffic[direction].writeChunks).toBeGreaterThan(0);
  }
  const events = hold.events();
  expect(events.length).toBeLessThanOrEqual(256);
  expect(events.map(event => event.ordinal)).toEqual(events.map((_, index) => index + 1));
  expect(events[0]).toEqual(expect.objectContaining({ type: 'capture_started', protocol: 'HTTP/1.1' }));
  return { app, hold, browser, row: snapshot.requests[0] };
}
async function heldExchange() {
  const app = await peer(upstreamResponds(SAVE, ACK)), hold = await proxy(app);
  const armed = await hold.arm({ armId: 'ARM-0001', method: 'POST', target: '/literal/save' });
  expect(armed.ok).toBe(true);
  const browser = await client(hold);
  browser.write(SAVE);
  const held = await hold.waitHeld({ armId: 'ARM-0001' });
  expect(held.ok).toBe(true);
  expect(held.ordinal).toBeGreaterThan(armed.ordinal);
  expect(held.armId).toBe('ARM-0001');
  exact(received(app), Buffer.alloc(0));
  exact(browser.received, Buffer.alloc(0));
  return { app, hold, browser, held };
}
const releaseFields = (held: Awaited<ReturnType<Proxy['waitHeld']>>) => ({
  armId: held.armId!, connectionId: held.connectionId!, requestId: held.requestId!, heldOrdinal: held.ordinal,
});
async function blocked(hold: Proxy) {
  await waitFor(() => hold.snapshot().status === 'BLOCKED');
  expect(hold.snapshot().reasons.length).toBeGreaterThan(0);
  expect(hold.snapshot().requests.every(row => row.terminal !== 'complete')).toBe(true);
}

describe('public inventory and fixed literal scope', () => {
  it('preserves all29 public cases byte-exact and keeps full topology/native groups blocked', () => {
    const bytes = readFileSync(new URL('./__fixtures__/native-boundary-v1.json', import.meta.url));
    expect(sha(bytes)).toBe(INVENTORY_SHA);
    const inventory = JSON.parse(bytes.toString());
    expect(inventory.cases.map((row: { caseId: string }) => row.caseId)).toEqual(Object.keys(PUBLIC_COVERAGE));
    expect(Object.keys(PUBLIC_COVERAGE)).toHaveLength(29);
    expect(Object.values(PUBLIC_COVERAGE).filter(value => value === 'REQUIRED_BLOCKED_FULL_TOPOLOGY')).toHaveLength(11);
    expect(inventory.bounds.proposedFixtureOnlyFiniteBounds).toEqual({
      operationDeadlineMs: 5000, wholeCaseDeadlineMs: 45000, maxHeaderBytes: 8192,
      maxBodyBytesPerDirection: 65536, maxWireBytesPerDirection: 73728,
      maxConcurrentDataConnections: 2, maxEligibleHeldRequests: 1, maxControlOperations: 8,
      maxObservedEventsPerCase: 256, maxProxyQueuedBytesPerDirection: 8192, maxAllRawArtifactBytesPerCase: 2097152,
    });
    expect(inventory.scope.requiredNativeGroupsRemain).toEqual(['HBB-UI-UPDATE-PDF-OWNER', 'HBB-UI-LATE-ACK']);
    expect(inventory.scope.requiredNativeStatus).toBe('BLOCKED');
    const amendment = readFileSync(new URL('./__fixtures__/native-boundary-amendments-v1.json', import.meta.url));
    expect(sha(amendment)).toBe(AMENDMENT_SHA);
    expect(JSON.parse(amendment.toString()).originalInventorySha256).toBe(INVENTORY_SHA);
  });

  it('admits only finite lower overrides and reports the actual chosen lower cap', async () => {
    const app = await peer();
    const hold = await createTransparentHold({ upstream: app.address, limits: { maxHeaderBytes: 4096 } });
    cleanup.push(() => hold.close());
    expect(hold.snapshot().limits.maxHeaderBytes).toBe(4096);
    expect(await hold.close()).toEqual({ closed: true, remainingSockets: 0 });
  });

  for (const [name, limits] of [
    ['raised body', { maxBodyBytesPerDirection: 65537 }],
    ['raised deadline', { operationDeadlineMs: 5001 }],
    ['raised flows', { maxConcurrentClientFlows: 3 }],
    ['raised sockets', { maxProxyDataSocketHandles: 5 }],
    ['raised event cap', { maxSemanticEventsPerCase: 257 }],
    ['unknown key', { callerVerified: 1 }],
    ['NaN', { maxHeaderBytes: Number.NaN }],
    ['infinite', { maxHeaderBytes: Number.POSITIVE_INFINITY }],
    ['zero', { maxHeaderBytes: 0 }],
    ['negative', { maxHeaderBytes: -1 }],
    ['fraction', { maxHeaderBytes: 8.5 }],
    ['string', { maxHeaderBytes: '8192' }],
    ['boolean', { maxHeaderBytes: true }],
    ['array', []],
    ['null', null],
  ] as const) {
    it(`rejects ${name} limit configuration before any data socket`, async () => {
      const app = await peer();
      await expect(createTransparentHold({ upstream: app.address, limits: limits as unknown as Partial<typeof LIMITS> })).rejects.toThrow();
      expect(app.connections).toHaveLength(0);
    });
  }

  for (const [name, value] of Object.entries(LIMITS)) {
    it(`cannot raise the frozen ${name} cap even by one`, async () => {
      const app = await peer();
      await expect(createTransparentHold({ upstream: app.address, limits: { [name]: value + 1 } })).rejects.toThrow();
      expect(app.connections).toHaveLength(0);
    });
  }
});

describe('HTTP01–05 exact HTTP/1.1 transport', () => {
  it('HTTP01 preserves binary invalidUTF8 and all wire bytes in both directions', async () => {
    const request = Buffer.from('504f5354202f6c69746572616c2f6f70617175653f636173653d48545450303120485454502f312e310d0a486f73743a20626f6172642e666978747572652e696e76616c69643a383038300d0a4f726967696e3a20687474703a2f2f626f6172642e666978747572652e696e76616c69643a383038300d0a436f6e74656e742d547970653a206170706c69636174696f6e2f6f637465742d73747265616d0d0a436f6e74656e742d4c656e6774683a20390d0a436f6e6e656374696f6e3a20636c6f73650d0a0d0a00017f80ffc3280d0a', 'hex');
    const response = Buffer.from('485454502f312e3120323030204f4b0d0a436f6e74656e742d547970653a206170706c69636174696f6e2f6f637465742d73747265616d0d0a436f6e74656e742d4c656e6774683a2031300d0a436f6e6e656374696f6e3a20636c6f73650d0a0d0aff000d0a804142e282ac', 'hex');
    expect(sha(request)).toBe('bf5b509debf20007da505cd106fc46687ddcb23c1891569dae3e32a433b44fba');
    expect(sha(response)).toBe('1e3729fe4f6612de4042178386c2918b0c2e5f9df9aa8cb0fc27a33f218b7630');
    const { row } = await roundTrip(request, response);
    expect(row.request.wireHex).toBe(request.toString('hex'));
    expect(row.response.wireHex).toBe(response.toString('hex'));
    expect(row.request.bodyHex).toBe('00017f80ffc3280d0a');
    expect(row.response.bodyHex).toBe('ff000d0a804142e282ac');
    expect(row.request.bodyBytes).toBe(9);
    expect(row.response.bodyBytes).toBe(10);
    expect(row.request.framingComplete).toBe(true);
    expect(row.response.framingComplete).toBe(true);
  });

  it('HTTP02 preserves extensions/trailers and split multibyte entities without rechunking', async () => {
    const request = Buffer.from('504f5354202f6c69746572616c2f6368756e6b656420485454502f312e310d0a486f73743a20626f6172642e666978747572652e696e76616c69643a383038300d0a4f726967696e3a20687474703a2f2f626f6172642e666978747572652e696e76616c69643a383038300d0a5472616e736665722d456e636f64696e673a206368756e6b65640d0a547261696c65723a20582d466978747572652d547261696c65720d0a436f6e6e656374696f6e3a20636c6f73650d0a0d0a333b666978747572653d6f6e650d0a4100e20d0a350d0a82acff0d0a0d0a300d0a582d466978747572652d547261696c65723a20726571756573742d72657461696e65640d0a0d0a', 'hex');
    const response = Buffer.from('485454502f312e3120323030204f4b0d0a5472616e736665722d456e636f64696e673a206368756e6b65640d0a547261696c65723a20582d466978747572652d547261696c65720d0a436f6e6e656374696f6e3a20636c6f73650d0a0d0a333b666978747572653d6f6e650d0aefbbbf0d0a340d0aff0d0a000d0a340d0af09f92b30d0a300d0a582d466978747572652d547261696c65723a20726573706f6e73652d72657461696e65640d0a0d0a', 'hex');
    expect(sha(request)).toBe('b6ccd24de7d374713af52615445ba4cea6ea236dfe74d6589f764ad631b68b22');
    expect(sha(response)).toBe('45666716acf68ee51ceddf383f2eb92e021d98ed43e6a55cdaab4558295cdd24');
    const { row } = await roundTrip(request, response);
    expect(row.request.wireHex).toBe(request.toString('hex'));
    expect(row.response.wireHex).toBe(response.toString('hex'));
    expect(row.request.bodyHex).toBe('4100e282acff0d0a');
    expect(row.response.bodyHex).toBe('efbbbfff0d0a00f09f92b3');
    expect(sha(Buffer.from(row.request.bodyHex, 'hex'))).toBe('058a124475f323febd369d81955c661016f1a25bdbf119c7bf3d679e84106a85');
    expect(sha(Buffer.from(row.response.bodyHex, 'hex'))).toBe('ed7b290bd4b873e55e4ddebccc4030e747bf71fdcee5cdfa86f2aa1cb02c4a5c');
  });

  it('HTTP03 forwards a response prefix before the remaining request body is sent', async () => {
    const header = Buffer.from(`POST /literal/duplex HTTP/1.1\r\nHost: ${HOST}\r\nContent-Length: 8\r\nConnection: close\r\n\r\n`);
    const responseHeader = Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\n');
    const app = await peer(connection => {
      let first = false, last = false;
      connection.socket.on('data', () => {
        if (!first && connection.received.length >= header.length + 4) {
          first = true; connection.write(Buffer.concat([responseHeader, Buffer.from('1234')]));
        }
        if (!last && connection.received.length >= header.length + 8) {
          last = true; connection.socket.end('5678');
        }
      });
    });
    const hold = await proxy(app), browser = await client(hold);
    browser.write(Buffer.concat([header, Buffer.from('ABCD')]));
    await waitFor(() => browser.received.length === responseHeader.length + 4);
    exact(received(app), Buffer.concat([header, Buffer.from('ABCD')]));
    exact(browser.received, Buffer.concat([responseHeader, Buffer.from('1234')]));
    browser.socket.end('EFGH');
    await endObserved(browser);
    exact(received(app), Buffer.concat([header, Buffer.from('ABCDEFGH')]));
    exact(browser.received, Buffer.concat([responseHeader, Buffer.from('12345678')]));
    await waitFor(() => hold.snapshot().requests[0]?.terminal === 'complete');
  });

  for (const direction of ['request', 'response'] as const) {
    it(`HTTP04 ${direction}: retains exact64KiB and reports pressure as unmeasured unless held through native receiver release`, async () => {
      const body = Buffer.from(Array.from({ length: 65536 }, (_, index) => index % 256));
      expect(sha(body)).toBe('7daca2095d0438260fa849183dfc67faa459fdf4936e1bc91eec6b281b27e4c2');
      const requestHeader = Buffer.from(`POST /literal/pressure HTTP/1.1\r\nHost: ${HOST}\r\nContent-Length: ${direction === 'request' ? 65536 : 0}\r\nConnection: close\r\n\r\n`);
      const responseHeader = Buffer.from(`HTTP/1.1 200 OK\r\nContent-Length: ${direction === 'response' ? 65536 : 0}\r\nConnection: close\r\n\r\n`);
      const app = await peer(connection => {
        if (direction === 'request') connection.socket.pause();
        else connection.socket.on('data', () => {
          if (connection.received.length === requestHeader.length) {
            connection.write(responseHeader);
            for (let i = 0; i < 256; i++) connection.write(body.subarray(i * 256, (i + 1) * 256));
            connection.socket.end();
          }
        });
      });
      const hold = await proxy(app), browser = await client(hold, { pauseRead: direction === 'response' });
      browser.write(requestHeader);
      if (direction === 'request') for (let i = 0; i < 256; i++) browser.write(body.subarray(i * 256, (i + 1) * 256));
      await waitFor(() => app.connections.length === 1 || hold.snapshot().status === 'BLOCKED');
      // The peer has not been resumed: a drain already observed cannot prove receiver-held pressure.
      const beforeRelease = hold.events().at(-1)?.ordinal ?? 0;
      const heldPressure = hold.snapshot().backpressure.filter(row => row.direction === direction && row.drainOrdinal === null);
      if (direction === 'request' && app.connections.length === 1 && hold.snapshot().status !== 'BLOCKED') {
        app.connections[0].socket.resume();
        await waitFor(() => app.connections[0].received.length === requestHeader.length + body.length || hold.snapshot().status === 'BLOCKED');
        if (hold.snapshot().status !== 'BLOCKED') app.connections[0].socket.end(responseHeader);
      } else if (direction === 'response') browser.socket.resume();
      await waitFor(() => browser.ended || browser.closed || hold.snapshot().status === 'BLOCKED');
      const snapshot = hold.snapshot();
      const pressureQualified = heldPressure.length > 0 && snapshot.backpressure.some(row => row.direction === direction && row.writeFalseOrdinal <= beforeRelease && row.drainOrdinal !== null && row.drainOrdinal > beforeRelease);
      const capability = pressureQualified && snapshot.status !== 'BLOCKED' ? 'OBSERVED' : 'NOT_MEASURED_BLOCKED';
      const queue = snapshot.queue[direction];
      expect(queue.maxObservedBytes).toBe(queue.peakSample.total);
      expect(queue.peakSample.total).toBe(queue.peakSample.applicationPending + queue.peakSample.headerRetained + queue.peakSample.sourceReadable + queue.peakSample.destinationWritable);
      for (const key of ['applicationPending', 'headerRetained', 'sourceReadable', 'destinationWritable', 'total'] as const) {
        expect(queue.componentMaxima[key]).toBeGreaterThanOrEqual(queue.peakSample[key]);
      }
      expect(snapshot.queue.auditBuffersSeparate).toBe(true);
      expect(snapshot.queue.aliasAccounting.length).toBeGreaterThan(0);
      if (queue.maxObservedBytes > 8192) expect(snapshot.status).toBe('BLOCKED');
      expect(snapshot.queue.kernelBuffers).toBe('UNOBSERVED');
      if (snapshot.status !== 'BLOCKED') {
        exact(received(app), Buffer.concat([requestHeader, ...(direction === 'request' ? [body] : [])]));
        exact(browser.received, Buffer.concat([responseHeader, ...(direction === 'response' ? [body] : [])]));
      } else expect(snapshot.reasons.length).toBeGreaterThan(0);
      // A passing diagnostic is not an HTTP04 qualification. This bounded record must be retained.
      console.info('HTTP04_CAPABILITY', JSON.stringify({ caseId: 'HTTP04', direction, capability, qualified: capability === 'OBSERVED', beforeRelease, heldPressure, backpressure: snapshot.backpressure, queue, kernelBuffers: 'UNOBSERVED' }));
    });
  }

  it('HTTP05 preserves Host Origin and the deliberately untrusted forwardedHost without injection', async () => {
    const request = Buffer.from(`GET /literal/origin HTTP/1.1\r\nHost: ${HOST}\r\nOrigin: ${ORIGIN}\r\nX-Forwarded-Host: deliberately-untrusted.fixture.invalid\r\nConnection: close\r\n\r\n`);
    await roundTrip(request, PONG);
  });

  it('HTTP01 control: complete ContentLength request FIN is a halfclose, not an abort', async () => {
    const { row } = await roundTrip(SAVE, ACK);
    expect(row.terminal).toBe('complete');
    expect(row.request.bodyBytes).toBe(9);
  });
});

describe('HOLD01–05 private capability and causal release', () => {
  it('HOLD01 holds the exact native request until receipt-bound release then forwards once', async () => {
    const { app, hold, browser, held } = await heldExchange();
    const released = await hold.release(releaseFields(held));
    expect(released.ok).toBe(true);
    expect(released.ordinal).toBeGreaterThan(held.ordinal);
    await endObserved(browser);
    exact(received(app), SAVE); exact(browser.received, ACK);
    expect(app.connections).toHaveLength(1);
    expect(hold.events().filter(event => event.type === 'released')).toHaveLength(1);
  });

  it('HOLD02 completes a concurrent unrelated GET before the held POST release', async () => {
    const other = Buffer.from(`GET /literal/other HTTP/1.1\r\nHost: ${HOST}\r\nConnection: close\r\n\r\n`);
    const otherResponse = Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 11\r\nConnection: close\r\n\r\nOTHER-OK-01');
    const app = await peer(connection => {
      let replied = false;
      connection.socket.on('data', () => {
        if (!replied && connection.received.equals(other)) { replied = true; connection.socket.end(otherResponse); }
        else if (!replied && connection.received.equals(SAVE)) { replied = true; connection.socket.end(ACK); }
      });
    });
    const hold = await proxy(app);
    await hold.arm({ armId: 'ARM-0001', method: 'POST', target: '/literal/save' });
    const saved = await client(hold); saved.write(SAVE);
    const held = await hold.waitHeld({ armId: 'ARM-0001' });
    const unrelated = await client(hold); unrelated.socket.end(other);
    await endObserved(unrelated);
    exact(unrelated.received, otherResponse); exact(saved.received, Buffer.alloc(0));
    exact(received(app), other);
    expect((await hold.release(releaseFields(held))).ok).toBe(true);
    await endObserved(saved); exact(saved.received, ACK);
    expect(app.connections.filter(connection => connection.received.equals(SAVE))).toHaveLength(1);
    expect(hold.snapshot().connections.maxObserved.clientFlows).toBe(2);
    expect(hold.snapshot().connections.maxObserved.physicalConnections).toBeGreaterThanOrEqual(3);
    expect(hold.snapshot().connections.maxObserved.physicalConnections).toBeLessThanOrEqual(4);
  });

  it('HOLD03 rejects two same-route native requests as ambiguous and forwards neither', async () => {
    const { app, hold, browser, held } = await heldExchange();
    const second = await client(hold); second.write(SAVE);
    await waitFor(() => hold.snapshot().status === 'BLOCKED');
    expect((await hold.release(releaseFields(held))).ok).toBe(false);
    exact(received(app), Buffer.alloc(0));
    exact(browser.received, Buffer.alloc(0)); exact(second.received, Buffer.alloc(0));
  });

  it('HOLD04 wrong releases cannot forward; correct forwards once; duplicate stays rejected', async () => {
    const { app, hold, browser, held } = await heldExchange();
    expect((await hold.release({ ...releaseFields(held), armId: 'ARM-WRONG' })).ok).toBe(false);
    expect((await hold.release({ ...releaseFields(held), requestId: 'request-wrong' })).ok).toBe(false);
    exact(received(app), Buffer.alloc(0));
    expect((await hold.release(releaseFields(held))).ok).toBe(true);
    await endObserved(browser); exact(browser.received, ACK); exact(received(app), SAVE);
    expect((await hold.release(releaseFields(held))).ok).toBe(false);
    exact(received(app), SAVE);
    expect(hold.snapshot().status).toBe('BLOCKED');
  });

  it('HOLD05 release before arm or native held receipt cannot invent forwarding authority', async () => {
    const app = await peer(), hold = await proxy(app);
    expect((await hold.release({ armId: 'ARM-0001', connectionId: 'connection-1', requestId: 'request-1', heldOrdinal: 2 })).ok).toBe(false);
    await hold.arm({ armId: 'ARM-0001', method: 'POST', target: '/literal/save' });
    expect((await hold.release({ armId: 'ARM-0001', connectionId: 'connection-1', requestId: 'request-1', heldOrdinal: 2 })).ok).toBe(false);
    exact(received(app), Buffer.alloc(0)); expect(hold.snapshot().status).toBe('BLOCKED');
  });

  for (const field of ['connectionId', 'heldOrdinal'] as const) {
    it(`HOLD05 rejects contradictory native ${field} binding before exact release`, async () => {
      const { app, hold, held } = await heldExchange();
      const wrong = { ...releaseFields(held), [field]: field === 'heldOrdinal' ? held.ordinal + 1 : 'connection-wrong' };
      expect((await hold.release(wrong)).ok).toBe(false);
      exact(received(app), Buffer.alloc(0));
      expect(hold.snapshot().status).toBe('BLOCKED');
    });
  }

  it('HOLD05 data-plane control-like paths cannot arm or release the private controller', async () => {
    const app = await peer(connection => connection.socket.on('data', () => connection.socket.end(PONG))), hold = await proxy(app);
    for (const path of ['/__control/arm', '/__control/release', '/json/version']) {
      const browser = await client(hold);
      const request = Buffer.from(`${path === '/json/version' ? 'GET' : 'POST'} ${path} HTTP/1.1\r\nHost: ${HOST}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
      browser.socket.end(request); await endObserved(browser); exact(browser.received, PONG);
      await waitFor(() => browser.closed);
    }
    expect(hold.events().filter(event => ['armed', 'held', 'released'].includes(event.type))).toEqual([]);
    // This does not certify NET05 network reachability/isolation.
    expect(PUBLIC_COVERAGE.NET05).toBe('REQUIRED_BLOCKED_FULL_TOPOLOGY');
  });
});

describe('ABORT01–04 never synthesize completion', () => {
  it('ABORT01 forwards only the literal four-byte request prefix then propagates incomplete FIN', async () => {
    const app = await peer(), hold = await proxy(app), browser = await client(hold);
    const prefix = Buffer.from(`POST /literal/abort HTTP/1.1\r\nHost: ${HOST}\r\nContent-Length: 8\r\nConnection: close\r\n\r\nABCD`);
    browser.write(prefix); await waitFor(() => received(app).length === prefix.length);
    browser.socket.end();
    await blocked(hold); exact(received(app), prefix);
    await waitFor(() => app.connections[0].ended || app.connections[0].closed);
    expect(hold.snapshot().requests[0].request.framingComplete).toBe(false);
    expect(browser.received.length).toBe(0);
  });

  it('ABORT02 retains200 plus four response bytes without padding or successful EOF', async () => {
    const partial = Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\n1234');
    const app = await peer(connection => connection.socket.on('data', () => connection.socket.end(partial))), hold = await proxy(app), browser = await client(hold);
    browser.write(GET); await endObserved(browser); await blocked(hold);
    exact(browser.received, partial);
    expect(hold.snapshot().requests[0].response.bodyHex).toBe('31323334');
    expect(hold.snapshot().requests[0].response.framingComplete).toBe(false);
  });

  it('ABORT03 a canceled held request cannot be revived by a late exact release', async () => {
    const { app, hold, browser, held } = await heldExchange();
    browser.socket.resetAndDestroy(); // An actual RST; complete-request FIN is the positive halfclose control.
    await blocked(hold);
    expect((await hold.release(releaseFields(held))).ok).toBe(false);
    exact(received(app), Buffer.alloc(0));
  });

  it('ABORT04 upstream close before headers is an empty native failure, never synthetic200', async () => {
    const app = await peer(connection => connection.socket.destroy()), hold = await proxy(app), browser = await client(hold);
    browser.write(GET); await endObserved(browser); await blocked(hold);
    exact(browser.received, Buffer.alloc(0));
    expect(hold.snapshot().requests[0].response.framingComplete).toBe(false);
  });
});

describe('BOUND01–04 finite framing, deadlines and untrusted replay', () => {
  it('BOUND01 admits at most two logical client flows and four physical proxy legs', async () => {
    const { app, hold, held } = await heldExchange();
    const unrelated = await client(hold); unrelated.write(GET);
    await waitFor(() => received(app).length === GET.length);
    const third = await client(hold); third.write(GET);
    await waitFor(() => hold.snapshot().status === 'BLOCKED');
    expect(hold.snapshot().connections.maxObserved.clientFlows).toBeLessThanOrEqual(2);
    expect(hold.snapshot().connections.maxObserved.upstreamLegs).toBeLessThanOrEqual(2);
    expect(hold.snapshot().connections.maxObserved.physicalConnections).toBeLessThanOrEqual(4);
    expect(hold.snapshot().connections.maxObserved.proxySocketHandles).toBeLessThanOrEqual(4);
    expect(hold.snapshot().reasons.join(' ')).toMatch(/flow|connection|limit|bound/i);
    expect((await hold.release(releaseFields(held))).ok).toBe(false);
  });

  for (const direction of ['request', 'response'] as const) {
    it(`BOUND01 blocks65537 body bytes in ${direction} without manufacturing completion`, async () => {
      const over = Buffer.concat([Buffer.from(Array.from({ length: 65536 }, (_, index) => index % 256)), Buffer.from([0x5a])]);
      const request = Buffer.concat([Buffer.from(`POST /literal/overflow HTTP/1.1\r\nHost: ${HOST}\r\nContent-Length: ${direction === 'request' ? 65537 : 0}\r\nConnection: close\r\n\r\n`), ...(direction === 'request' ? [over] : [])]);
      const response = Buffer.concat([Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 65537\r\nConnection: close\r\n\r\n'), over]);
      const app = await peer(direction === 'response' ? connection => {
        let started = false;
        connection.socket.on('data', () => {
          if (!started && connection.received.length === request.length) {
            started = true;
            sendChunks(connection, response).then(() => connection.socket.end());
          }
        });
      } : () => {});
      const hold = await proxy(app), browser = await client(hold);
      // Bounded producer chunks do not authorize slicing away a larger observed Node buffer.
      await sendChunks(browser, request);
      browser.socket.end(); await blocked(hold);
      const snapshot = hold.snapshot(), row = snapshot.requests[0];
      expect(snapshot.reasons.join(' ')).toMatch(/bound|limit|overflow/i);
      expect(row[direction].wireBytes).toBeLessThanOrEqual(73728);
      expect(Buffer.from(row[direction].wireHex, 'hex').length).toBe(row[direction].wireBytes);
      expect(row[direction].framingComplete).toBe(false);
      expect(row.terminal).not.toBe('complete');
      expect(browser.received.equals(ACK)).toBe(false);
    });
  }

  for (const [name, headers] of [
    ['TE plus CL', 'Content-Length: 4\r\nTransfer-Encoding: chunked\r\n'],
    ['conflicting CL', 'Content-Length: 4\r\nContent-Length: 8\r\n'],
  ]) {
    it(`BOUND02 rejects ${name} without forwarding a normalized request`, async () => {
      const app = await peer(), hold = await proxy(app), browser = await client(hold);
      browser.socket.end(`POST /literal/framing HTTP/1.1\r\nHost: ${HOST}\r\n${headers}Connection: close\r\n\r\nABCD`);
      await blocked(hold); exact(received(app), Buffer.alloc(0)); exact(browser.received, Buffer.alloc(0));
    });
  }

  it('BOUND02 rejects an8193-byte header section including both CRLF delimiters', async () => {
    const start = `GET /literal/header HTTP/1.1\r\nHost: ${HOST}\r\nX-Pad: `;
    const header = Buffer.from(start + 'a'.repeat(8193 - Buffer.byteLength(start) - 4) + '\r\n\r\n');
    expect(header.length).toBe(8193);
    const app = await peer(), hold = await proxy(app), browser = await client(hold);
    browser.socket.end(header); await blocked(hold);
    exact(received(app), Buffer.alloc(0)); expect(hold.snapshot().reasons.join(' ')).toMatch(/header|bound|limit/i);
  });

  it('BOUND02 rejects protocolHTTP2 rather than translating it into HTTP1 success', async () => {
    const app = await peer(), hold = await proxy(app), browser = await client(hold);
    browser.socket.end('PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n');
    await blocked(hold); exact(received(app), Buffer.alloc(0));
  });

  for (const mode of ['no-eligible-request', 'held-never-released', 'headers-body-incomplete', 'accepted-no-response'] as const) {
    it(`BOUND03 actual5000ms deadline: ${mode}; cleanup budget is separate`, async () => {
      const app = await peer(), hold = await proxy(app);
      const started = performance.now();
      if (mode === 'no-eligible-request' || mode === 'held-never-released') {
        await hold.arm({ armId: 'ARM-0001', method: 'POST', target: '/literal/save' });
      }
      if (mode !== 'no-eligible-request') {
        const browser = await client(hold);
        browser.write(mode === 'headers-body-incomplete'
          ? Buffer.from(`POST /literal/slow HTTP/1.1\r\nHost: ${HOST}\r\nContent-Length: 8\r\n\r\nABCD`)
          : mode === 'held-never-released' ? SAVE : GET);
      }
      await waitFor(() => hold.snapshot().status === 'BLOCKED', { timeoutMs: 6500 });
      expect(performance.now() - started).toBeGreaterThanOrEqual(4900);
      expect(hold.snapshot().reasons.join(' ')).toMatch(/deadline|timeout/i);
      expect(hold.snapshot().requests.every(row => row.terminal !== 'complete')).toBe(true);
      expect(await hold.close()).toEqual({ closed: true, remainingSockets: 0 });
      // A live accepted/no-response socket is not proof of a TCP peer that never accepts.
      expect(PUBLIC_COVERAGE.BOUND03).toBe('PARTIAL_REAL_DEADLINES_UNACCEPTED_TCP_NOT_MEASURED');
    }, 8000);
  }

  it('BOUND04 positive transcript is replayable only as imported untrusted infrastructure evidence', async () => {
    const { hold } = await roundTrip(SAVE, ACK);
    const assessment = assessTransparentHoldEvents(hold.events(), { maxEvents: 256 });
    expect(assessment.status).toBe('COMPLETE');
    expect(assessment.authority).toBe('IMPORTED_EVENTS_UNTRUSTED');
  });

  it('BOUND04 exported snapshots/events cannot mutate the private source inventory', async () => {
    const { hold } = await roundTrip(SAVE, ACK);
    const before = JSON.stringify(hold.snapshot()), originalEvents = JSON.stringify(hold.events());
    const events = hold.events(); events.splice(0, events.length);
    const snapshot = hold.snapshot(); snapshot.requests[0].request.wireHex = '00';
    snapshot.reasons.push('caller-says-PASS');
    expect(JSON.stringify(hold.snapshot())).toBe(before);
    expect(JSON.stringify(hold.events())).toBe(originalEvents);
    expect(await hold.close()).toEqual({ closed: true, remainingSockets: 0 });
  });

  for (const mutation of ['missing-terminal', 'duplicate-terminal', 'contradictory-terminal', 'wrong-connection', 'duplicate-request-id', 'out-of-order', 'lost-observer', 'unknown-protocol', 'forged-PASS', 'event-overflow'] as const) {
    it(`BOUND04/HOLD05 ${mutation} cannot acquire completeness from an imported transcript`, async () => {
      const { hold } = await roundTrip(SAVE, ACK);
      let events = structuredClone(hold.events()) as Array<{ schemaVersion: number; ordinal: number; type: string; [key: string]: unknown }>;
      const terminal = events.find(row => row.type === 'terminal');
      expect(terminal).toBeDefined();
      if (mutation === 'missing-terminal') events = events.filter(row => row.type !== 'terminal');
      if (mutation === 'duplicate-terminal') events.splice(events.length - 1, 0, { ...terminal! });
      if (mutation === 'contradictory-terminal') events.splice(events.length - 1, 0, { ...terminal!, terminal: 'aborted' });
      if (mutation === 'wrong-connection') terminal!.connectionId = 'connection-unseen';
      if (mutation === 'duplicate-request-id') {
        const request = events.find(row => row.type === 'request_identified');
        expect(request).toBeDefined(); events.splice(events.length - 1, 0, { ...request! });
      }
      if (mutation === 'lost-observer') events.splice(events.length - 1, 0, { schemaVersion: 1, ordinal: 1, type: 'observer_lost' });
      if (mutation === 'unknown-protocol') events[0].protocol = 'HTTP/9.0';
      if (mutation === 'forged-PASS') events.splice(events.length - 1, 0, { schemaVersion: 1, ordinal: 1, type: 'PASS' });
      if (mutation === 'event-overflow') events = Array.from({ length: 257 }, () => ({ ...events[0] }));
      events.forEach((event, index) => { event.ordinal = index + 1; });
      if (mutation === 'out-of-order') events[1].ordinal = 1;
      const before = JSON.stringify(events);
      const assessment = assessTransparentHoldEvents(events, { maxEvents: 256 });
      expect(assessment.status).toBe('BLOCKED');
      expect(assessment.authority).toBe('IMPORTED_EVENTS_UNTRUSTED');
      expect(assessment.reasons.length).toBeGreaterThan(0);
      expect(JSON.stringify(events)).toBe(before);
    });
  }
});
