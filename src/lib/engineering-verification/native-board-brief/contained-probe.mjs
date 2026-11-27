/** Observation-only credentialless entry point. No candidate source or expected outcomes. */
import { createTransparentHold } from './transparent-hold.mjs';
import { openLiteralClient, openLiteralPeer, waitFor } from './__fixtures__/transport-probe.mjs';
import { isNativeError } from 'node:util/types';

const MAX_BYTES = 2097152;
const CASES = new Set(['HTTP01', 'HTTP02', 'HOLD01', 'ABORT02']);
const ARM_ID = 'ARM-0001';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => object(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const errorNames = new Map([
  [Error.prototype, 'Error'], [TypeError.prototype, 'TypeError'], [SyntaxError.prototype, 'SyntaxError'],
  [RangeError.prototype, 'RangeError'], [ReferenceError.prototype, 'ReferenceError'],
  [URIError.prototype, 'URIError'], [EvalError.prototype, 'EvalError'], [AggregateError.prototype, 'AggregateError'],
]);

/** Retain bounded native fields without invoking arbitrary thrown-value getters. */
function errorObservation(error) {
  if (!isNativeError(error)) return {
    name: 'NonErrorThrow', message: 'Unexpected non-Error throw', code: null,
    thrownType: error === null ? 'null' : typeof error, truncated: false,
    originalBytes: { name: null, message: null, code: null },
  };
  const unobservedFields = [], truncatedFields = [], originalBytes = {};
  const inheritedName = errorNames.get(Object.getPrototypeOf(error));
  const field = (key, fallback, limit, absentValue = fallback) => {
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    let value;
    if (!descriptor) {
      value = absentValue;
      if (!inheritedName) unobservedFields.push(key);
    } else if (!Object.hasOwn(descriptor, 'value') || (typeof descriptor.value !== 'string' && !(key === 'code' && descriptor.value == null))) {
      value = fallback; unobservedFields.push(key);
    } else value = descriptor.value ?? null;
    if (value === null) { originalBytes[key] = null; return null; }
    originalBytes[key] = unobservedFields.includes(key) ? null : Buffer.byteLength(value, 'utf8');
    if (value.length <= limit) return value;
    truncatedFields.push(key);
    let prefix = value.slice(0, limit);
    if (/[\ud800-\udbff]$/.test(prefix) && /[\udc00-\udfff]/.test(value[limit])) prefix = prefix.slice(0, -1);
    return prefix;
  };
  const name = field('name', 'NativeError', 128, inheritedName ?? 'NativeError');
  const message = field('message', 'Native Error message unavailable without invoking an accessor', 4096, '');
  const code = field('code', null, 128, null);
  return { name, message, code, truncated: truncatedFields.length > 0, truncatedFields, originalBytes, unobservedFields };
}

async function readStimulus() {
  let bytes = 0; const chunks = [];
  for await (const chunk of process.stdin) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += part.length;
    if (bytes > MAX_BYTES) throw new Error('input_bound');
    chunks.push(part);
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes));
  // The finite wire-only schema contains no escaped property names or free text.
  if (!/^[{}":,\s0-9A-Za-z-]*$/.test(text)) throw new Error('invalid_input');
  for (const name of ['schemaVersion', 'caseId', 'stimulus', 'requestWireHex', 'responseWireHex']) {
    if ((text.match(new RegExp(`"${name}"\\s*:`, 'g')) ?? []).length !== 1) throw new Error('invalid_input');
  }
  const value = JSON.parse(text);
  if (!keys(value, ['schemaVersion', 'caseId', 'stimulus']) || value.schemaVersion !== 1 || !CASES.has(value.caseId)
    || !keys(value.stimulus, ['requestWireHex', 'responseWireHex'])) throw new Error('invalid_input');
  const decode = hex => {
    if (typeof hex !== 'string' || !hex.length || hex.length > 73728 * 2 || hex.length % 2 || !/^[0-9a-f]+$/.test(hex)) throw new Error('invalid_input');
    const decoded = Buffer.from(hex, 'hex');
    if (decoded.toString('hex') !== hex) throw new Error('invalid_input');
    return decoded;
  };
  return { caseId: value.caseId, request: decode(value.stimulus.requestWireHex), response: decode(value.stimulus.responseWireHex) };
}

function connectionObservation(connection) {
  return {
    receivedHex: connection.received.toString('hex'), receivedBytes: connection.received.length,
    events: structuredClone(connection.events), errors: [...connection.errors], ended: connection.ended,
    closed: connection.closed, writeCalls: connection.writes,
  };
}

let peer, controller, client, primary = null, primaryError = null, deadline = false, input;
let beforeRelease = null, armed = null, held = null, released = null, cleanup = [];
const deadlineStops = [], deadlineCleanupErrors = [];
const timer = setTimeout(() => {
  deadline = true;
  // Ending the read side is necessary when no stdin EOF ever arrives. The
  // iterator observes this actual Error; no successful input EOF is invented.
  try {
    if (!process.stdin.destroyed && !process.stdin.readableEnded) process.stdin.destroy(new Error('whole_case_deadline'));
  } catch (error) { deadlineCleanupErrors.push({ resource: 'stdin', completed: false, error: errorObservation(error) }); }
  // These are independent best-effort stops; the final cleanup still records each result.
  for (const [resource, stop] of [
    ['literal_client', () => client?.socket.destroy()], ['proxy', () => controller?.close()], ['literal_peer', () => peer?.close()],
  ]) deadlineStops.push(Promise.resolve().then(stop).catch(error => {
    deadlineCleanupErrors.push({ resource, completed: false, error: errorObservation(error) });
  }));
}, 45000);

try {
  input = await readStimulus();
  peer = await openLiteralPeer(connection => {
    let sent = false;
    connection.socket.on('data', () => {
      if (!sent && connection.received.length >= input.request.length) {
        sent = true;
        connection.socket.end(input.response);
      }
    });
  });
  controller = await createTransparentHold({ upstream: peer.address });
  if (input.caseId === 'HOLD01') armed = await controller.arm({ armId: ARM_ID, method: 'POST', target: '/literal/save' });
  client = await openLiteralClient(controller.address);
  client.socket.end(input.request);
  if (input.caseId === 'HOLD01') {
    held = await controller.waitHeld({ armId: ARM_ID });
    beforeRelease = {
      peers: peer.connections.map(connectionObservation), client: connectionObservation(client),
      proxySnapshot: controller.snapshot(), proxyEvents: controller.events(),
    };
    released = await controller.release({ armId: held.armId, connectionId: held.connectionId, requestId: held.requestId, heldOrdinal: held.ordinal });
  }
  await waitFor(() => client.ended || client.closed, { timeoutMs: 6000 });
  await waitFor(() => controller.snapshot().requests.every(row => row.terminal !== 'unknown'), { timeoutMs: 6000 });
} catch (error) {
  primary = deadline ? 'whole_case_deadline' : 'probe_execution_incomplete';
  primaryError = errorObservation(error);
} finally {
  if (client) {
    try {
      const gone = client.closed ? Promise.resolve() : new Promise(resolve => client.socket.once('close', resolve));
      client.socket.destroy(); await gone;
      cleanup.push({ resource: 'literal_client', completed: true, remainingSockets: client.closed ? 0 : 1 });
    } catch (error) { cleanup.push({ resource: 'literal_client', completed: false, error: errorObservation(error) }); }
  }
  if (controller) {
    try { cleanup.push({ resource: 'proxy', completed: true, ...await controller.close() }); }
    catch (error) { cleanup.push({ resource: 'proxy', completed: false, error: errorObservation(error) }); }
  }
  if (peer) {
    try { cleanup.push({ resource: 'literal_peer', completed: true, ...await peer.close() }); }
    catch (error) { cleanup.push({ resource: 'literal_peer', completed: false, error: errorObservation(error) }); }
  }
  await Promise.all(deadlineStops);
  clearTimeout(timer);
}

const result = {
  schemaVersion: 1, authority: 'TRUSTED_LOOPBACK_INFRASTRUCTURE_ONLY', caseId: input?.caseId ?? null,
  executionError: primary, primaryError, executionComplete: primary === null && !deadline,
  peers: peer?.connections.map(connectionObservation) ?? [], client: client ? connectionObservation(client) : null,
  control: { armed, held, beforeRelease, released }, proxySnapshot: controller?.snapshot() ?? null,
  proxyEvents: controller?.events() ?? [], cleanup, deadlineCleanupErrors,
  requiredNativeStatus: 'BLOCKED', registrationStatus: 'UNREGISTERED',
};
const output = Buffer.from(JSON.stringify(result));
if (output.length > MAX_BYTES) {
  process.stdout.write(JSON.stringify({ schemaVersion: 1, executionComplete: false, executionError: 'output_bound', requiredNativeStatus: 'BLOCKED', registrationStatus: 'UNREGISTERED' }));
  process.exitCode = 1;
} else {
  process.stdout.write(output);
  if (primary || deadlineCleanupErrors.length || cleanup.some(item => !item.completed || item.remainingSockets)) process.exitCode = 1;
}
