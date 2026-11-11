// @vitest-environment node
/** Independent prospective identity/causality negatives; owned literal loopback peers only. */
import { afterEach, describe, expect, it } from 'vitest';
import { assessTransparentHoldEvents, createTransparentHold } from './transparent-hold.mjs';
import { openLiteralClient, openLiteralPeer, waitFor } from './__fixtures__/transport-probe.mjs';

const GET = Buffer.from('GET /literal/ping HTTP/1.1\r\nHost: board.fixture.invalid:8080\r\nConnection: close\r\n\r\n');
const SAVE = Buffer.from('POST /literal/save HTTP/1.1\r\nHost: board.fixture.invalid:8080\r\nContent-Length: 9\r\nConnection: close\r\n\r\nSAVE-A-01');
const ACK = Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\nACK-A-01');
const A = Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\nA-01');
const B = Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\nB-01');
const cleanup: Array<() => Promise<unknown> | unknown> = [];
type Address = Parameters<typeof openLiteralClient>[0];
type Proxy = Awaited<ReturnType<typeof createTransparentHold>>;
type Peer = Awaited<ReturnType<typeof openLiteralPeer>>;
type PrivateStep = {
  controlOrdinal: number; operation: 'arm' | 'held' | 'release'; eventOrdinal: number;
  armId: string; connectionId?: string; requestId?: string;
};

afterEach(async () => {
  const failures = [];
  for (const close of cleanup.splice(0).reverse()) {
    try { await close(); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'Owned identity fixture cleanup failed');
});

function exact(actual: Buffer, expected: Buffer) {
  expect(actual.length).toBe(expected.length);
  expect(actual.equals(expected)).toBe(true);
}

async function peer(request: Buffer, response: Buffer) {
  const result = await openLiteralPeer(connection => {
    let replied = false;
    connection.socket.on('data', () => {
      if (!replied && connection.received.equals(request)) {
        replied = true;
        connection.socket.end(response);
      }
    });
  });
  cleanup.push(() => result.close());
  return result;
}

async function client(address: Address) {
  const result = await openLiteralClient(address);
  cleanup.push(() => result.socket.destroy());
  return result;
}

async function directControl(app: Peer, response: Buffer) {
  const browser = await client(app.address);
  browser.socket.end(GET);
  await waitFor(() => browser.ended || browser.closed);
  exact(browser.received, response);
}

async function admittedProxy(input: Parameters<typeof createTransparentHold>[0]) {
  const hold = await createTransparentHold(input);
  cleanup.push(() => hold.close());
  return hold;
}

async function retainedExchange(hold: Proxy, a: Peer, b: Peer, beforeA: number, beforeB: number) {
  const browser = await client(hold.address);
  browser.socket.end(GET);
  await waitFor(() => browser.ended || browser.closed);
  await waitFor(() => hold.snapshot().requests[0]?.terminal === 'complete');
  const admittedBytes = Buffer.concat(a.connections.slice(beforeA).map(connection => connection.received));
  const redirectedBytes = Buffer.concat(b.connections.slice(beforeB).map(connection => connection.received));
  const response = browser.received;
  await directControl(a, A);
  await directControl(b, B);
  exact(admittedBytes, GET);
  exact(redirectedBytes, Buffer.alloc(0));
  exact(response, A);
  expect(hold.snapshot().status).toBe('COMPLETE');
}

describe('prospective private identity and receipt causality', () => {
  it('an endpoint object changed after admission cannot redirect actual forwarding to a second live owned peer', async () => {
    const a = await peer(GET, A), b = await peer(GET, B);
    await directControl(a, A);
    await directControl(b, B);
    const beforeA = a.connections.length, beforeB = b.connections.length;
    const input = { upstream: { ...a.address } };
    const hold = await admittedProxy(input);
    input.upstream.port = b.address.port;
    await retainedExchange(hold, a, b, beforeA, beforeB);
  });

  it('upstream, host and port getters are read once before validation and the admitted values are retained', async () => {
    const a = await peer(GET, A), b = await peer(GET, B);
    await directControl(a, A);
    await directControl(b, B);
    const beforeA = a.connections.length, beforeB = b.connections.length;
    let upstreamReads = 0, hostReads = 0, portReads = 0;
    const endpoint = Object.defineProperties({}, {
      host: { enumerable: true, get: () => { hostReads++; return '127.0.0.1'; } },
      port: { enumerable: true, get: () => { portReads++; return portReads === 1 ? a.address.port : b.address.port; } },
    });
    const input = Object.defineProperty({}, 'upstream', {
      enumerable: true,
      get: () => { upstreamReads++; return upstreamReads === 1 ? endpoint : b.address; },
    }) as Parameters<typeof createTransparentHold>[0];
    const hold = await admittedProxy(input);
    await retainedExchange(hold, a, b, beforeA, beforeB);
    expect({ upstreamReads, hostReads, portReads }).toEqual({ upstreamReads: 1, hostReads: 1, portReads: 1 });
  });

  it('private control ordinals1/2/3 map delivered arm/held/release receipts to unchanged global events', async () => {
    const app = await peer(SAVE, ACK), hold = await admittedProxy({ upstream: app.address });
    const sequence = () => (hold.snapshot() as unknown as { privateControlSequence: PrivateStep[] }).privateControlSequence;
    const armed = await hold.arm({ armId: 'ARM-0001', method: 'POST', target: '/literal/save' });
    expect(armed.ok).toBe(true);
    const browser = await client(hold.address);
    browser.write(SAVE);
    await waitFor(() => hold.events().some(event => event.type === 'held'));
    const nativeHeld = hold.events().find(event => event.type === 'held')!;
    exact(Buffer.concat(app.connections.map(connection => connection.received)), Buffer.alloc(0));
    // A producer-held event is not a delivered private acknowledgment yet.
    expect(sequence()).toEqual([{ controlOrdinal: 1, operation: 'arm', eventOrdinal: armed.ordinal, armId: 'ARM-0001' }]);
    const held = await hold.waitHeld({ armId: 'ARM-0001' });
    expect(held.ok).toBe(true);
    expect(held.ordinal).toBe(nativeHeld.ordinal);
    expect(sequence()).toEqual([
      { controlOrdinal: 1, operation: 'arm', eventOrdinal: armed.ordinal, armId: 'ARM-0001' },
      { controlOrdinal: 2, operation: 'held', eventOrdinal: held.ordinal, armId: 'ARM-0001', connectionId: held.connectionId, requestId: held.requestId },
    ]);
    const released = await hold.release({ armId: held.armId!, connectionId: held.connectionId!, requestId: held.requestId!, heldOrdinal: held.ordinal });
    expect(released.ok).toBe(true);
    await waitFor(() => browser.ended || browser.closed);
    await waitFor(() => hold.snapshot().requests[0]?.terminal === 'complete');
    exact(browser.received, ACK);
    exact(Buffer.concat(app.connections.map(connection => connection.received)), SAVE);
    expect(sequence()).toEqual([
      { controlOrdinal: 1, operation: 'arm', eventOrdinal: armed.ordinal, armId: 'ARM-0001' },
      { controlOrdinal: 2, operation: 'held', eventOrdinal: held.ordinal, armId: 'ARM-0001', connectionId: held.connectionId, requestId: held.requestId },
      { controlOrdinal: 3, operation: 'release', eventOrdinal: released.ordinal, armId: 'ARM-0001', connectionId: held.connectionId, requestId: held.requestId },
    ]);
    for (const step of sequence()) {
      const event = hold.events()[step.eventOrdinal - 1];
      expect(event.ordinal).toBe(step.eventOrdinal);
      expect(event.armId).toBe(step.armId);
      expect(event.type).toBe({ arm: 'armed', held: 'held', release: 'released' }[step.operation]);
    }
    expect(armed.ordinal).toBeGreaterThan(1); // capture_started still occupies its original global index.
    expect(hold.snapshot().status).toBe('COMPLETE');
  });

  it('held request pressure before private release is contradictory while otherwise identical released pressure remains replayable', () => {
    const start = [
      { type: 'capture_started', protocol: 'HTTP/1.1' },
      { type: 'armed', armId: 'ARM-0001' },
      { type: 'connection_opened', connectionId: 'connection-1' },
      { type: 'request_identified', connectionId: 'connection-1', requestId: 'request-1' },
      { type: 'held', connectionId: 'connection-1', requestId: 'request-1', armId: 'ARM-0001' },
    ];
    const release = { type: 'released', connectionId: 'connection-1', requestId: 'request-1', armId: 'ARM-0001' };
    const pressure = [
      { type: 'write_false', connectionId: 'connection-1', requestId: 'request-1', direction: 'request' },
      { type: 'drain', connectionId: 'connection-1', requestId: 'request-1', direction: 'request' },
    ];
    const end = [
      { type: 'terminal', connectionId: 'connection-1', requestId: 'request-1', terminal: 'complete' },
      { type: 'capture_closed' },
    ];
    const transcript = (events: unknown[]) => events.map((event, index) => ({ ...(event as object), schemaVersion: 1, ordinal: index + 1 }));
    const valid = assessTransparentHoldEvents(transcript([...start, release, ...pressure, ...end]));
    const invalid = assessTransparentHoldEvents(transcript([...start, ...pressure, release, ...end]));
    expect(valid).toEqual({ status: 'COMPLETE', authority: 'IMPORTED_EVENTS_UNTRUSTED', reasons: [] });
    expect(invalid.status).toBe('BLOCKED');
    expect(invalid.authority).toBe('IMPORTED_EVENTS_UNTRUSTED');
    expect(invalid.reasons.length).toBeGreaterThan(0);
  });
});
