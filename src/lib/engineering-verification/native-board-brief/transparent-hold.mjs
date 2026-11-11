import net from 'node:net';
import { createHttpFraming } from './http-framing.mjs';

const CAPS = Object.freeze({
  operationDeadlineMs: 5000, wholeCaseDeadlineMs: 45000, maxHeaderBytes: 8192,
  maxBodyBytesPerDirection: 65536, maxWireBytesPerDirection: 73728,
  maxConcurrentClientFlows: 2, maxConcurrentUpstreamLegs: 2,
  maxConcurrentPhysicalDataConnections: 4, maxProxyDataSocketHandles: 4,
  maxAllFixtureDataSocketHandles: 8, maxEligibleHeldRequests: 1,
  maxControlOperations: 8, maxSemanticEventsPerCase: 256,
  maxProxyQueuedBytesPerDirection: 8192, maxAllRawArtifactBytesPerCase: 2097152,
});
const clone = value => structuredClone(value);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
const positive = value => Number.isSafeInteger(value) && value > 0;
const armId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const zeroQueue = () => ({ applicationPending: 0, headerRetained: 0, sourceReadable: 0, destinationWritable: 0, total: 0 });
const zeroCounts = () => ({ clientFlows: 0, upstreamLegs: 0, physicalConnections: 0, proxySocketHandles: 0 });
const zeroTraffic = () => ({ readBytes: 0, readChunks: 0, writeBytes: 0, writeChunks: 0, writeFalseCount: 0, drainCount: 0 });
const REASONS = new Set([
  'invalid_control', 'control_limit', 'ambiguous_request', 'connection_limit', 'event_limit',
  'queue_limit', 'artifact_limit', 'operation_deadline', 'whole_case_deadline', 'client_abort',
  'upstream_abort', 'incomplete_request', 'incomplete_response', 'close_incomplete', 'observer_lost',
  'header_limit', 'chunk_framing_limit', 'malformed_headers', 'ambiguous_framing',
  'unsupported_protocol', 'unsupported_transfer_encoding', 'body_limit', 'wire_limit',
  'malformed_chunk', 'trailer_limit', 'malformed_trailer', 'multiple_messages_or_extra_bytes',
  'incomplete_message',
]);

/** Trusted literal loopback infrastructure only; no product/native acceptance authority. */
export async function createTransparentHold(input) {
  if (!exactKeys(input, ['upstream', 'limits'])) throw new Error('Invalid literal transport configuration');
  // Capture each caller-owned value once, then validate and retain that exact
  // endpoint. Later object mutation/getters cannot select a different peer.
  const requestedUpstream = input.upstream, requestedLimits = input.limits;
  if (!exactKeys(requestedUpstream, ['host', 'port'])) throw new Error('Invalid literal transport configuration');
  const upstream = Object.freeze({ host: requestedUpstream.host, port: requestedUpstream.port });
  if (upstream.host !== '127.0.0.1' || !positive(upstream.port) || upstream.port > 65535
    || (requestedLimits !== undefined && !exactKeys(requestedLimits, Object.keys(CAPS)))) throw new Error('Invalid literal transport configuration');
  const limits = { ...CAPS };
  for (const [key, value] of Object.entries(requestedLimits ?? {})) {
    if (!positive(value) || value > CAPS[key]) throw new Error('Invalid literal transport limit');
    limits[key] = value;
  }
  const history = [], privateControlSequence = [], reasons = new Set(), flows = [], sockets = new Set(), waiters = new Set();
  const queue = Object.fromEntries(['request', 'response'].map(direction => [direction, {
    maxObservedBytes: 0, currentSample: zeroQueue(), peakSample: zeroQueue(), componentMaxima: zeroQueue(),
  }]));
  const traffic = { request: zeroTraffic(), response: zeroTraffic() }, backpressure = [];
  const maxConnections = zeroCounts();
  let nextFlow = 0, controlCount = 0, armed = null, closed = false, closing = null, overflow = false, fatalReason = null;
  let wholeTimer;

  function emit(type, fields = {}) {
    if (history.length >= limits.maxSemanticEventsPerCase) {
      reasons.add('event_limit');
      // Refuse work synchronously, even before the queued socket cleanup runs.
      fatalReason ??= 'event_limit';
      if (!overflow) { overflow = true; queueMicrotask(() => abortAll('event_limit')); }
      return history.length;
    }
    const event = { schemaVersion: 1, ordinal: history.length + 1, type, ...fields };
    history.push(event);
    return event.ordinal;
  }
  function block(reason) {
    const code = REASONS.has(reason) ? reason : 'observer_lost';
    if (!reasons.has(code)) { reasons.add(code); emit('blocked', { reason: code }); }
  }
  function counts() {
    const active = zeroCounts();
    for (const flow of flows) {
      if (flow.clientOpen) active.clientFlows++;
      if (flow.upstreamOpen) active.upstreamLegs++;
      if (flow.clientOpen) active.physicalConnections++;
      if (flow.upstreamOpen && flow.upstreamConnected) active.physicalConnections++;
    }
    active.proxySocketHandles = sockets.size;
    for (const key of Object.keys(active)) maxConnections[key] = Math.max(maxConnections[key], active[key]);
    return active;
  }
  function notifyWaiters() {
    for (const waiter of [...waiters]) waiter();
  }
  function terminal(flow, value, reason) {
    if (flow.terminal !== 'unknown') return;
    flow.terminal = value;
    clearTimeout(flow.timer);
    if (reason) block(reason);
    emit('terminal', { connectionId: flow.connectionId, requestId: flow.requestId, terminal: value, ...(reason ? { reason } : {}) });
    notifyWaiters();
  }
  function destroy(socket) { if (socket && !socket.destroyed) socket.destroy(); }
  function abortFlow(flow, reason, value = 'failed') {
    terminal(flow, value, reason);
    flow.requestPending = []; flow.requestPendingBytes = 0;
    flow.responsePending = []; flow.responsePendingBytes = 0;
    destroy(flow.client); destroy(flow.upstream);
    sample('request'); sample('response');
  }
  function abortAll(reason, value = 'failed') {
    fatalReason ??= REASONS.has(reason) ? reason : 'observer_lost';
    block(reason);
    clearTimeout(wholeTimer);
    if (armed) clearTimeout(armed.timer);
    // End admission as well as the currently observed flows. A later client
    // cannot obtain a fresh forwarding window after the attempt has failed.
    if (server.listening) server.close(() => {});
    for (const flow of flows) if (flow.terminal === 'unknown') abortFlow(flow, reason, value);
    notifyWaiters();
  }
  function sample(direction) {
    const result = zeroQueue();
    for (const flow of flows) {
      const source = direction === 'request' ? flow.client : flow.upstream;
      const destination = direction === 'request' ? flow.upstream : flow.client;
      result.applicationPending += flow[`${direction}PendingBytes`];
      result.headerRetained += flow[`${direction}Parser`].headerRetained;
      result.sourceReadable += source?.readableLength ?? 0;
      result.destinationWritable += destination?.writableLength ?? 0;
    }
    result.total = result.applicationPending + result.headerRetained + result.sourceReadable + result.destinationWritable;
    const observed = queue[direction]; observed.currentSample = result;
    for (const key of Object.keys(result)) observed.componentMaxima[key] = Math.max(observed.componentMaxima[key], result[key]);
    if (result.total > observed.maxObservedBytes) { observed.maxObservedBytes = result.total; observed.peakSample = { ...result }; }
    if (result.total > limits.maxProxyQueuedBytesPerDirection) {
      fatalReason ??= 'queue_limit';
      block('queue_limit'); queueMicrotask(() => abortAll('queue_limit'));
      return false;
    }
    return true;
  }
  function artifactBound() {
    // Hex encoding is charged twice; request/response entity copies are charged separately.
    let bytes = 0;
    for (const flow of flows) for (const direction of ['request', 'response']) {
      const item = flow[`${direction}Parser`].observation(); bytes += 2 * (item.wireBytes + item.bodyBytes);
    }
    if (bytes > limits.maxAllRawArtifactBytesPerCase) { abortAll('artifact_limit'); return false; }
    return true;
  }
  function maybeComplete(flow) {
    if (flow.terminal !== 'unknown' || !flow.responseEnded || !flow.responseFinished) return;
    if (flow.requestParser.complete && flow.responseParser.complete) terminal(flow, 'complete');
    else abortFlow(flow, flow.requestParser.complete ? 'incomplete_response' : 'incomplete_request', 'aborted');
  }
  function finishDirection(flow, direction) {
    if (fatalReason || closed || closing) return;
    const destination = direction === 'request' ? flow.upstream : flow.client;
    if (!destination || destination.destroyed || !destination.writable || flow[`${direction}PendingBytes`] || flow[`${direction}Paused`]) return;
    if (direction === 'request') {
      if (flow.clientEnded && flow.requestParser.complete && !destination.writableEnded) destination.end();
    } else if (flow.responseEnded && flow.responseParser.complete && !destination.writableEnded) destination.end();
  }
  function pump(flow, direction) {
    if (fatalReason || closed || closing || flow.terminal !== 'unknown') return;
    if (direction === 'request' && (!flow.headersKnown || flow.held && !flow.released || !flow.upstreamConnected)) return;
    const destination = direction === 'request' ? flow.upstream : flow.client;
    const source = direction === 'request' ? flow.client : flow.upstream;
    if (!destination || destination.destroyed || flow[`${direction}Paused`]) return;
    while (flow[`${direction}Pending`].length && flow.terminal === 'unknown') {
      const bytes = flow[`${direction}Pending`].shift();
      flow[`${direction}PendingBytes`] -= bytes.length;
      let accepted;
      try { accepted = destination.write(bytes); }
      catch { abortFlow(flow, direction === 'request' ? 'upstream_abort' : 'client_abort', 'aborted'); return; }
      traffic[direction].writeBytes += bytes.length; traffic[direction].writeChunks++;
      if (!accepted) {
        traffic[direction].writeFalseCount++;
        const ordinal = emit('write_false', { connectionId: flow.connectionId, requestId: flow.requestId, direction });
        backpressure.push({ direction, writeFalseOrdinal: ordinal, drainOrdinal: null });
        flow[`${direction}Pressure`] = backpressure.at(-1);
        flow[`${direction}Paused`] = true; source?.pause();
      }
      if (!sample(direction)) return;
      if (!accepted) break;
    }
    finishDirection(flow, direction);
  }
  function onDrain(flow, direction) {
    traffic[direction].drainCount++;
    const ordinal = emit('drain', { connectionId: flow.connectionId, requestId: flow.requestId, direction });
    const pressure = flow[`${direction}Pressure`];
    if (!pressure || pressure.drainOrdinal !== null) { abortFlow(flow, 'observer_lost'); return; }
    pressure.drainOrdinal = ordinal;
    flow[`${direction}Pressure`] = null; flow[`${direction}Paused`] = false;
    if (fatalReason || closed || closing) return;
    sample(direction); pump(flow, direction);
    if (flow.terminal === 'unknown' && !flow[`${direction}Paused`]) {
      const source = direction === 'request' ? flow.client : flow.upstream; source?.resume();
    }
  }
  function connectUpstream(flow) {
    if (fatalReason || closed || closing || flow.upstream || flow.terminal !== 'unknown' || flow.held && !flow.released) return;
    const active = counts();
    if (active.upstreamLegs >= limits.maxConcurrentUpstreamLegs || active.proxySocketHandles >= limits.maxProxyDataSocketHandles
      || active.physicalConnections >= limits.maxConcurrentPhysicalDataConnections) { abortAll('connection_limit'); return; }
    const socket = net.createConnection({ host: upstream.host, port: upstream.port, allowHalfOpen: true, highWaterMark: 256 });
    flow.upstream = socket; flow.upstreamOpen = true; sockets.add(socket); counts();
    socket.on('connect', () => {
      if (fatalReason || closed || closing) { destroy(socket); return; }
      flow.upstreamConnected = true; counts(); pump(flow, 'request');
    });
    socket.on('data', bytes => receive(flow, 'response', bytes));
    socket.on('drain', () => onDrain(flow, 'request'));
    socket.on('end', () => {
      flow.responseEnded = true;
      if (!flow.responseParser.eof()) { abortFlow(flow, 'incomplete_response', 'aborted'); return; }
      if (!flow.requestParser.complete) { abortFlow(flow, 'incomplete_request', 'aborted'); return; }
      pump(flow, 'response'); finishDirection(flow, 'response'); maybeComplete(flow);
    });
    socket.on('error', () => { if (flow.terminal === 'unknown') abortFlow(flow, 'upstream_abort', 'aborted'); });
    socket.on('close', () => {
      sockets.delete(socket); flow.upstreamOpen = false; counts();
      if (flow.terminal === 'unknown' && !flow.responseEnded) abortFlow(flow, 'upstream_abort', 'aborted');
      sample('request'); sample('response');
    });
  }
  function identified(flow, metadata) {
    flow.method = metadata.method; flow.target = metadata.target; flow.headersKnown = true;
    emit('request_identified', { connectionId: flow.connectionId, requestId: flow.requestId });
    if (armed && metadata.method === armed.method && metadata.target === armed.target) {
      armed.matches.push(flow);
      if (armed.matches.length > limits.maxEligibleHeldRequests || armed.released) { abortAll('ambiguous_request'); return; }
      flow.held = true;
      flow.heldOrdinal = emit('held', { armId: armed.armId, connectionId: flow.connectionId, requestId: flow.requestId });
      notifyWaiters();
    } else connectUpstream(flow);
  }
  function receive(flow, direction, bytes) {
    if (fatalReason || closing || flow.terminal !== 'unknown' || closed) return;
    traffic[direction].readBytes += bytes.length; traffic[direction].readChunks++;
    flow[`${direction}Pending`].push(bytes); flow[`${direction}PendingBytes`] += bytes.length;
    // Measure the actual incoming allocation and Node buffers BEFORE any slicing/forwarding.
    if (!sample(direction)) { abortFlow(flow, 'queue_limit'); return; }
    const parser = flow[`${direction}Parser`]; parser.feed(bytes);
    if (parser.error) { abortFlow(flow, parser.error); return; }
    if (!artifactBound() || !sample(direction)) return;
    pump(flow, direction);
  }
  emit('capture_started', { protocol: 'HTTP/1.1' });
  const server = net.createServer({ allowHalfOpen: true, highWaterMark: 256 }, socket => {
    if (fatalReason || closed || closing) { socket.destroy(); return; }
    const active = counts();
    if (active.clientFlows >= limits.maxConcurrentClientFlows || active.proxySocketHandles >= limits.maxProxyDataSocketHandles
      || active.physicalConnections >= limits.maxConcurrentPhysicalDataConnections) {
      socket.destroy(); abortAll('connection_limit'); return;
    }
    const id = ++nextFlow;
    const flow = {
      connectionId: `connection-${id}`, requestId: `request-${id}`, client: socket, upstream: null,
      clientOpen: true, upstreamOpen: false, upstreamConnected: false, headersKnown: false,
      clientEnded: false, responseEnded: false, responseFinished: false,
      method: '', target: '', terminal: 'unknown', held: false, heldAcknowledged: false, released: false, heldOrdinal: 0,
      requestPending: [], requestPendingBytes: 0, responsePending: [], responsePendingBytes: 0,
      requestPaused: false, responsePaused: false, requestPressure: null, responsePressure: null,
      requestParser: null, responseParser: null, timer: null,
    };
    flow.requestParser = createHttpFraming({ direction: 'request', limits, requestMethod: () => flow.method, onHeaders: metadata => identified(flow, metadata) });
    flow.responseParser = createHttpFraming({ direction: 'response', limits, requestMethod: () => flow.method, onHeaders: () => {} });
    flows.push(flow); sockets.add(socket); counts();
    emit('connection_opened', { connectionId: flow.connectionId });
    flow.timer = setTimeout(() => abortFlow(flow, 'operation_deadline', 'timeout'), limits.operationDeadlineMs);
    socket.on('data', bytes => receive(flow, 'request', bytes));
    socket.on('drain', () => onDrain(flow, 'response'));
    socket.on('end', () => {
      flow.clientEnded = true;
      if (!flow.requestParser.eof()) { abortFlow(flow, 'incomplete_request', 'aborted'); return; }
      finishDirection(flow, 'request');
    });
    socket.on('finish', () => { flow.responseFinished = true; maybeComplete(flow); });
    socket.on('error', () => { if (flow.terminal === 'unknown') abortFlow(flow, 'client_abort', 'aborted'); });
    socket.on('close', () => {
      sockets.delete(socket); flow.clientOpen = false; counts();
      if (flow.terminal === 'unknown' && !flow.responseFinished) abortFlow(flow, 'client_abort', 'aborted');
      destroy(flow.upstream); sample('request'); sample('response');
    });
  });
  server.on('error', () => { block('observer_lost'); abortAll('observer_lost'); });
  await new Promise((resolve, reject) => {
    const setupError = () => reject(new Error('Literal transport listener setup failed'));
    server.once('error', setupError);
    server.listen({ host: '127.0.0.1', port: 0 }, () => { server.off('error', setupError); resolve(); });
  });
  const endpoint = server.address();
  if (!endpoint || typeof endpoint === 'string' || endpoint.address !== '127.0.0.1') {
    server.close(); throw new Error('Literal transport listener identity unavailable');
  }
  wholeTimer = setTimeout(() => abortAll('whole_case_deadline', 'timeout'), limits.wholeCaseDeadlineMs);
  function control(inputValue, keys) {
    controlCount++;
    if (fatalReason) return { ok: false, ordinal: history.length, reason: fatalReason };
    if (closed || closing || !exactKeys(inputValue, keys) || controlCount > limits.maxControlOperations) {
      const reason = controlCount > limits.maxControlOperations ? 'control_limit' : 'invalid_control';
      if (reason === 'control_limit') abortAll(reason); else block(reason);
      return { ok: false, ordinal: history.length, reason };
    }
    return null;
  }
  function rejectControl() { block('invalid_control'); return { ok: false, ordinal: history.length, reason: 'invalid_control' }; }
  const capability = {
    address: Object.freeze({ host: '127.0.0.1', port: endpoint.port }),
    async arm(value) {
      const rejected = control(value, ['armId', 'method', 'target']); if (rejected) return rejected;
      if (!armId(value.armId) || value.method !== 'POST' || value.target !== '/literal/save' || armed) return rejectControl();
      armed = { ...value, matches: [], released: false, timer: null };
      const ordinal = emit('armed', { armId: value.armId });
      if (fatalReason) return { ok: false, ordinal, reason: fatalReason };
      armed.timer = setTimeout(() => abortAll('operation_deadline', 'timeout'), limits.operationDeadlineMs);
      privateControlSequence.push({ controlOrdinal: 1, operation: 'arm', eventOrdinal: ordinal, armId: armed.armId });
      return { ok: true, ordinal };
    },
    async waitHeld(value) {
      const rejected = control(value, ['armId', 'timeoutMs']); if (rejected) return rejected;
      if (!armId(value.armId) || !armed || value.armId !== armed.armId
        || (value.timeoutMs !== undefined && (!positive(value.timeoutMs) || value.timeoutMs > limits.operationDeadlineMs))) return rejectControl();
      return new Promise(resolve => {
        let timer;
        const finish = receipt => { clearTimeout(timer); waiters.delete(check); resolve(receipt); };
        const check = () => {
          const flow = armed.matches[0];
          if (!fatalReason && flow && armed.matches.length === 1 && flow.terminal === 'unknown' && !armed.released && !reasons.has('ambiguous_request')) {
            // The producer's held event alone is not a delivered management
            // receipt. Repeated reads reuse this one accepted acknowledgment.
            if (!flow.heldAcknowledged) {
              flow.heldAcknowledged = true;
              privateControlSequence.push({ controlOrdinal: 2, operation: 'held', eventOrdinal: flow.heldOrdinal,
                armId: armed.armId, connectionId: flow.connectionId, requestId: flow.requestId });
            }
            finish({ ok: true, ordinal: flow.heldOrdinal, armId: armed.armId, connectionId: flow.connectionId, requestId: flow.requestId });
          } else if (closed || closing || reasons.size || flow && flow.terminal !== 'unknown') finish({ ok: false, ordinal: history.length, reason: 'invalid_control' });
        };
        waiters.add(check);
        timer = setTimeout(() => { abortAll('operation_deadline', 'timeout'); finish({ ok: false, ordinal: history.length, reason: 'operation_deadline' }); }, value.timeoutMs ?? limits.operationDeadlineMs);
        check();
      });
    },
    async release(value) {
      const rejected = control(value, ['armId', 'connectionId', 'requestId', 'heldOrdinal']); if (rejected) return rejected;
      const flow = armed?.matches[0];
      if (!flow || armed.matches.length !== 1 || !flow.heldAcknowledged || armed.released || flow.terminal !== 'unknown'
        || reasons.has('ambiguous_request') || reasons.has('connection_limit') || reasons.has('operation_deadline')
        || value.armId !== armed.armId || value.connectionId !== flow.connectionId || value.requestId !== flow.requestId
        || value.heldOrdinal !== flow.heldOrdinal) return rejectControl();
      armed.released = true; flow.released = true; clearTimeout(armed.timer);
      const ordinal = emit('released', { armId: armed.armId, connectionId: flow.connectionId, requestId: flow.requestId });
      if (fatalReason) return { ok: false, ordinal, reason: fatalReason };
      privateControlSequence.push({ controlOrdinal: 3, operation: 'release', eventOrdinal: ordinal,
        armId: armed.armId, connectionId: flow.connectionId, requestId: flow.requestId });
      connectUpstream(flow); pump(flow, 'request');
      return { ok: true, ordinal };
    },
    events() { return clone(history); },
    snapshot() {
      sample('request'); sample('response');
      const status = reasons.size ? 'BLOCKED' : flows.length && flows.every(flow => flow.terminal === 'complete') ? 'COMPLETE' : 'PENDING';
      return clone({
        schemaVersion: 1, protocol: 'HTTP/1.1', authority: 'TRUSTED_LOOPBACK_INFRASTRUCTURE_ONLY', status,
        reasons: [...reasons], limits, privateControlSequence,
        requests: flows.map(flow => ({ connectionId: flow.connectionId, requestId: flow.requestId, method: flow.method, target: flow.target,
          request: flow.requestParser.observation(), response: flow.responseParser.observation(), terminal: flow.terminal })),
        queue: { ...queue, kernelBuffers: 'UNOBSERVED', auditBuffersSeparate: true,
          aliasAccounting: 'Pending raw buffers, copied framing-line bytes, source readableLength and destination writableLength are distinct owned allocations; audit wire/entity copies are charged separately.' },
        connections: { active: counts(), maxObserved: maxConnections, allFixtureDataSocketHandles: 'UNOBSERVED' }, traffic, backpressure,
      });
    },
    async close() {
      if (closing) return closing;
      closing = (async () => {
        clearTimeout(wholeTimer); if (armed) clearTimeout(armed.timer);
        for (const flow of flows) {
          clearTimeout(flow.timer);
          if (flow.terminal === 'unknown') terminal(flow, 'aborted', 'close_incomplete');
        }
        const handles = [...sockets];
        // Membership means our native close observer has not run yet. Stream
        // flags can already be set while that event is still queued.
        const gone = handles.map(socket => new Promise(resolve => socket.once('close', resolve)));
        for (const socket of handles) destroy(socket);
        await Promise.all(gone);
        await new Promise(resolve => server.close(() => resolve()));
        closed = true; notifyWaiters(); counts(); sample('request'); sample('response'); emit('capture_closed');
        return { closed: !server.listening, remainingSockets: sockets.size };
      })();
      return closing;
    },
  };
  return Object.freeze(capability);
}

/** Strict imported replay validation grants no producer/native provenance. */
export function assessTransparentHoldEvents(events, options = {}) {
  const reasons = new Set(), fail = reason => reasons.add(reason);
  const maxEvents = options?.maxEvents ?? CAPS.maxSemanticEventsPerCase;
  if (!exactKeys(options, ['maxEvents']) || !positive(maxEvents) || maxEvents > CAPS.maxSemanticEventsPerCase
    || !Array.isArray(events) || !events.length || events.length > maxEvents) return { status: 'BLOCKED', authority: 'IMPORTED_EVENTS_UNTRUSTED', reasons: ['invalid_inventory'] };
  const connections = new Set(), requests = new Map(), arms = new Map(), pressures = new Map();
  const id = (value, prefix) => typeof value === 'string' && new RegExp(`^${prefix}-[1-9][0-9]{0,3}$`).test(value);
  let started = false, ended = false;
  const fields = {
    capture_started: ['protocol'], connection_opened: ['connectionId'], request_identified: ['connectionId', 'requestId'],
    armed: ['armId'], held: ['connectionId', 'requestId', 'armId'], released: ['connectionId', 'requestId', 'armId'],
    write_false: ['connectionId', 'requestId', 'direction'], drain: ['connectionId', 'requestId', 'direction'],
    terminal: ['connectionId', 'requestId', 'terminal', 'reason'], blocked: ['reason'], observer_lost: [], capture_closed: [],
  };
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (!record(event) || !Object.hasOwn(fields, event.type) || !exactKeys(event, ['schemaVersion', 'ordinal', 'type', ...fields[event.type]])
      || event.schemaVersion !== 1 || event.ordinal !== index + 1 || ended) { fail('invalid_event'); continue; }
    if (event.type === 'capture_started') {
      if (started || index || event.protocol !== 'HTTP/1.1') fail('invalid_protocol'); started = true; continue;
    }
    if (!started) { fail('missing_start'); continue; }
    if (event.type === 'connection_opened') {
      if (!id(event.connectionId, 'connection') || connections.has(event.connectionId)) fail('invalid_connection');
      else connections.add(event.connectionId);
    } else if (event.type === 'request_identified') {
      if (!connections.has(event.connectionId) || !id(event.requestId, 'request') || requests.has(event.requestId)) fail('invalid_request');
      else requests.set(event.requestId, { connectionId: event.connectionId, terminal: null, held: null, released: false });
    } else if (event.type === 'armed') {
      if (!armId(event.armId) || arms.has(event.armId)) fail('invalid_arm'); else arms.set(event.armId, { held: null, released: false });
    } else if (event.type === 'held' || event.type === 'released') {
      const request = requests.get(event.requestId), arm = arms.get(event.armId);
      if (!request || request.connectionId !== event.connectionId || request.terminal || !arm) { fail('invalid_association'); continue; }
      if (event.type === 'held') {
        if (request.held || arm.held) fail('ambiguous_held'); else { request.held = event.armId; arm.held = event.requestId; }
      } else if (request.held !== event.armId || arm.held !== event.requestId || request.released || arm.released) fail('invalid_release');
      else { request.released = true; arm.released = true; }
    } else if (event.type === 'write_false' || event.type === 'drain') {
      const request = requests.get(event.requestId), key = `${event.requestId}:${event.direction}`;
      if (!request || request.connectionId !== event.connectionId || request.terminal || request.held && !request.released
        || !['request', 'response'].includes(event.direction)) { fail('invalid_pressure'); continue; }
      if (event.type === 'write_false') {
        if (pressures.has(key)) fail('duplicate_pressure'); else pressures.set(key, event.ordinal);
      } else if (!pressures.delete(key)) fail('unmatched_drain');
    } else if (event.type === 'terminal') {
      const request = requests.get(event.requestId);
      if (!request || request.connectionId !== event.connectionId || request.terminal || !['complete', 'aborted', 'failed', 'timeout'].includes(event.terminal)
        || (event.reason !== undefined && !REASONS.has(event.reason)) || (event.terminal === 'complete' && event.reason !== undefined)) fail('invalid_terminal');
      else { request.terminal = event.terminal; if (event.terminal !== 'complete') fail('unsuccessful_transport'); }
    } else if (event.type === 'blocked' || event.type === 'observer_lost') {
      if (event.type === 'blocked' && !REASONS.has(event.reason)) fail('invalid_reason');
      fail('producer_blocked');
    } else if (event.type === 'capture_closed') ended = true;
  }
  if (!ended || !requests.size || connections.size !== requests.size || [...requests.values()].some(request => !request.terminal)
    || [...arms.values()].some(arm => !arm.released) || pressures.size) fail('incomplete_inventory');
  return { status: reasons.size ? 'BLOCKED' : 'COMPLETE', authority: 'IMPORTED_EVENTS_UNTRUSTED', reasons: [...reasons] };
}
