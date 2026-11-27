/** Trusted literal TCP fixtures only. No candidate, HTTP agent, browser, or oracle imports. */
import net from 'node:net';

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** @param {() => boolean} predicate @param {{timeoutMs?: number}} [options] */
export async function waitFor(predicate, { timeoutMs = 2500 } = {}) {
  const started = performance.now();
  for (;;) {
    if (predicate()) return;
    if (performance.now() - started >= timeoutMs) throw new Error('Literal socket observation deadline');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

/** @param {import('node:net').Socket} socket */
function observe(socket) {
  const chunks = [], errors = [], events = [];
  let ended = false, closed = false, ordinal = 0, writes = 0;
  const record = type => events.push({ ordinal: ++ordinal, type });
  socket.on('data', chunk => { chunks.push(Buffer.from(chunk)); record('data'); });
  socket.on('end', () => { ended = true; record('end'); });
  socket.on('close', () => { closed = true; record('close'); });
  socket.on('error', error => { errors.push(error.code ?? 'UNKNOWN'); record('error'); });
  socket.on('drain', () => record('drain'));
  return {
    socket, chunks, errors, events,
    get received() { return Buffer.concat(chunks); },
    get ended() { return ended; },
    get closed() { return closed; },
    get writes() { return writes; },
    write(bytes) {
      writes++;
      const accepted = socket.write(bytes);
      if (!accepted) record('write_false');
      return accepted;
    },
  };
}

/** @param {(connection: ReturnType<typeof observe>) => void} [handler] @param {{pauseOnConnect?: boolean}} [options] */
export async function openLiteralPeer(handler = () => {}, { pauseOnConnect = false } = {}) {
  const connections = [], failures = [];
  const server = net.createServer({ allowHalfOpen: true, pauseOnConnect, highWaterMark: 256 }, socket => {
    const connection = observe(socket);
    connections.push(connection);
    try { handler(connection); }
    catch (error) { failures.push(error); socket.destroy(); }
  });
  server.on('error', error => failures.push(error));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string' || address.address !== '127.0.0.1') {
    throw new Error('Literal peer must bind ephemeral loopback');
  }
  /** @type {{host: '127.0.0.1', port: number}} */
  const endpoint = { host: '127.0.0.1', port: address.port };
  return {
    address: endpoint, connections, failures,
    async close() {
      for (const connection of connections) connection.socket.destroy();
      await new Promise(resolve => server.close(() => resolve()));
      return { closed: !server.listening, remainingSockets: connections.filter(c => !c.socket.destroyed).length };
    },
  };
}

/** @param {{host: '127.0.0.1', port: number}} address @param {{pauseRead?: boolean}} [options] */
export async function openLiteralClient(address, { pauseRead = false } = {}) {
  if (address.host !== '127.0.0.1' || !Number.isInteger(address.port) || address.port <= 0) {
    throw new Error('Literal client permits explicit loopback only');
  }
  const socket = net.createConnection({ host: address.host, port: address.port, allowHalfOpen: true, highWaterMark: 256 });
  const connection = observe(socket);
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  if (pauseRead) socket.pause();
  return connection;
}
