// @vitest-environment node
/** Independent prospective global-envelope refusals; trusted literal loopback peers only. */
import { afterEach, describe, expect, it } from 'vitest';
import { createTransparentHold } from './transparent-hold.mjs';
import { openLiteralClient, openLiteralPeer, waitFor } from './__fixtures__/transport-probe.mjs';

const GET = Buffer.from('GET /literal/ping HTTP/1.1\r\nHost: board.fixture.invalid:8080\r\nConnection: close\r\n\r\n');
const PONG = Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 11\r\nConnection: close\r\n\r\nAPP-PONG-01');
const cleanup: Array<() => Promise<unknown> | unknown> = [];
type Client = Awaited<ReturnType<typeof openLiteralClient>>;

afterEach(async () => {
  const failures = [];
  for (const close of cleanup.splice(0).reverse()) {
    try { await close(); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'Owned supplemental literal cleanup failed');
});

async function literalPeer() {
  const app = await openLiteralPeer(connection => {
    let replied = false;
    connection.socket.on('data', () => {
      if (!replied && connection.received.equals(GET)) {
        replied = true;
        connection.socket.end(PONG);
      }
    });
  });
  cleanup.push(() => app.close());
  return app;
}

async function nativeClient(address: Parameters<typeof openLiteralClient>[0]) {
  const client = await openLiteralClient(address);
  cleanup.push(() => client.socket.destroy());
  return client;
}

async function liveControl(app: Awaited<ReturnType<typeof literalPeer>>) {
  const direct = await nativeClient(app.address);
  direct.socket.end(GET);
  await waitFor(() => direct.ended || direct.closed);
  expect(direct.received.length).toBe(PONG.length);
  expect(direct.received.equals(PONG)).toBe(true);
}

describe('prospective fatal envelope admission refuses all later work', () => {
  for (const mode of ['semantic-event-limit', 'whole-case-deadline'] as const) {
    it(`${mode}: a live upstream remains reachable only by its authorized control after global refusal`, async () => {
      const app = await literalPeer();
      await liveControl(app);
      const beforeProxyConnections = app.connections.length;
      const hold = await createTransparentHold({
        upstream: app.address,
        limits: mode === 'semantic-event-limit'
          ? { maxSemanticEventsPerCase: 1 }
          : { wholeCaseDeadlineMs: 60, operationDeadlineMs: 50 },
      });
      cleanup.push(() => hold.close());

      if (mode === 'semantic-event-limit') {
        const first = await nativeClient(hold.address);
        first.write(GET);
        await waitFor(() => first.closed);
      }
      await waitFor(() => hold.snapshot().status === 'BLOCKED');
      expect(hold.snapshot().reasons).toContain(mode === 'semantic-event-limit' ? 'event_limit' : 'whole_case_deadline');

      // Public labels cannot reopen a private capability after its global envelope ended.
      const lateArm = await hold.arm({ armId: 'late-arm', method: 'POST', target: '/literal/save' });
      const lateRelease = await hold.release({ armId: 'late-arm', connectionId: 'connection-1', requestId: 'request-1', heldOrdinal: 2 });
      let later: Client | null = null;
      let connectFailure: string | null = null;
      try { later = await nativeClient(hold.address); }
      catch (error) { connectFailure = (error as NodeJS.ErrnoException).code ?? 'UNKNOWN'; }
      if (later) {
        later.socket.end(GET);
        await waitFor(() => later!.ended || later!.closed);
      }
      const proxyBytes = Buffer.concat(app.connections.slice(beforeProxyConnections).map(connection => connection.received));
      const laterResponse = later?.received ?? Buffer.alloc(0);
      await liveControl(app); // A stopped listener cannot explain an apparently denied upstream effect.

      expect(proxyBytes.length).toBe(0);
      expect(laterResponse.length).toBe(0);
      if (connectFailure !== null) expect(connectFailure).toBe('ECONNREFUSED');
      expect(lateArm.ok).toBe(false);
      expect(lateRelease.ok).toBe(false);
      expect(hold.snapshot().status).toBe('BLOCKED');
      expect(await hold.close()).toEqual({ closed: true, remainingSockets: 0 });
      // The lowered real timer tests refusal semantics, not original45s native capacity.
      if (mode === 'whole-case-deadline') expect(hold.snapshot().limits.wholeCaseDeadlineMs).toBe(60);
    });
  }
});
