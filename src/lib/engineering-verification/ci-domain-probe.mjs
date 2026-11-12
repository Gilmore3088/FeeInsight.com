/** Unregistered, observation-only offline reader probe. No real credentials or API transport. */
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const PROBE_LIMITS = Object.freeze({ inputBytes: 262144, outputBytes: 2097152,
  cases: 39, routes: 18, requestsPerCase: 128, setupErrors: 8, deadlineMs: 45000 });
const TOKEN = 'literal-noncredential-fixture-token';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, required, optional = []) => object(value)
  && required.every(key => Object.hasOwn(value, key))
  && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const clone = value => structuredClone(value);
const safePart = value => /^(?:[A-Za-z_][A-Za-z0-9_-]*|[0-9]+)$/.test(value)
  && !['__proto__', 'prototype', 'constructor'].includes(value);
const apiUrl = value => {
  if (typeof value !== 'string' || value.length > 1024) return false;
  try { const parsed = new URL(value); return parsed.protocol === 'https:' && parsed.hostname === 'api.github.com'
    && !parsed.username && !parsed.password && !parsed.port && !parsed.hash; } catch { return false; }
};
const errorText = error => error instanceof Error ? error.message.slice(0, 512) : 'Non-Error execution failure';

function responseShape(response) {
  return keys(response, ['status', 'json']) && Number.isInteger(response.status)
    && response.status >= 100 && response.status <= 599;
}

/** Validate finite literal data only. This never imports or executes reader source. */
export function admitStimulus(input) {
  if (!keys(input, ['schemaVersion', 'call', 'routes', 'cases']) || input.schemaVersion !== 2
    || !keys(input.call, ['repository', 'prNumber', 'token', 'requiredChecks', 'includeDeployments', 'now'])
    || input.call.repository !== 'fixture-owner/fixture-repo' || input.call.prNumber !== 1
    || input.call.token !== TOKEN || input.call.includeDeployments !== false
    || !isDeepStrictEqual(input.call.requiredChecks, ['app-tests'])
    || input.call.now !== '2026-11-11T12:00:00Z'
    || !Array.isArray(input.routes) || !input.routes.length || input.routes.length > PROBE_LIMITS.routes
    || !Array.isArray(input.cases) || !input.cases.length || input.cases.length > PROBE_LIMITS.cases)
    throw new Error('Invalid finite offline stimulus');
  const routes = new Map();
  for (const row of input.routes) {
    if (!keys(row, ['method', 'url', 'response', 'repeat'], ['requestJson'])
      || !['GET', 'POST'].includes(row.method) || !apiUrl(row.url) || row.repeat !== 'same'
      || !responseShape(row.response) || (row.method === 'POST') !== Object.hasOwn(row, 'requestJson')
      || row.method === 'POST' && row.url !== 'https://api.github.com/graphql')
      throw new Error('Invalid finite offline route');
    const key = row.method + ' ' + row.url;
    if (routes.has(key)) throw new Error('Duplicate offline route');
    routes.set(key, row);
  }
  const ids = new Set();
  for (const row of input.cases) {
    if (!keys(row, ['id', 'mutations']) || !/^reader-(?:0[1-9]|[12][0-9]|3[0-9])$/.test(row.id)
      || ids.has(row.id) || !Array.isArray(row.mutations) || row.mutations.length > 8)
      throw new Error('Invalid finite offline case');
    ids.add(row.id);
    for (const mutation of row.mutations) {
      const replacement = Object.hasOwn(mutation, 'replaceResponse');
      const validKeys = replacement ? ['routeUrl', 'responseRead', 'replaceResponse']
        : ['routeUrl', 'responseRead', 'jsonPath', 'set'];
      if (!keys(mutation, validKeys) || !apiUrl(mutation.routeUrl)
        || ![...routes.values()].some(route => route.url === mutation.routeUrl)
        || mutation.responseRead !== 'all' && mutation.responseRead !== 2
        || replacement && !responseShape(mutation.replaceResponse)
        || !replacement && (typeof mutation.jsonPath !== 'string' || mutation.jsonPath.length > 128
          || !mutation.jsonPath.split('.').every(safePart))) throw new Error('Invalid finite offline mutation');
    }
  }
  // The admitted value is independent from caller-held data and all later API responses.
  return clone(input);
}

function mutate(response, mutation) {
  if (Object.hasOwn(mutation, 'replaceResponse')) return clone(mutation.replaceResponse);
  const parts = mutation.jsonPath.split('.');
  let here = response.json;
  for (const part of parts.slice(0, -1)) {
    if ((!object(here) && !Array.isArray(here)) || !Object.hasOwn(here, part))
      throw new Error('Mutation path is absent from literal response');
    here = here[part];
  }
  const last = parts.at(-1);
  if ((!object(here) && !Array.isArray(here)) || !Object.hasOwn(here, last))
    throw new Error('Mutation target is absent from literal response');
  here[last] = clone(mutation.set);
  return response;
}

/** Sticky state belongs to this trusted wrapper, not the subject's capture callbacks. */
export function createOfflineApi(routes, mutations, { maxRequests = PROBE_LIMITS.requestsPerCase } = {}) {
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > PROBE_LIMITS.requestsPerCase)
    throw new Error('Finite request budget can only be lowered');
  const definitions = new Map(routes.map(row => [row.method + ' ' + row.url, clone(row)]));
  const counts = new Map(), requests = [], setupErrors = [];
  let requestCount = 0;
  const fail = code => {
    if (setupErrors.length < PROBE_LIMITS.setupErrors) setupErrors.push(code);
    throw new Error('Offline harness setup failure: ' + code);
  };
  const fetchImpl = async (url, options) => {
    requestCount++;
    if (requestCount > maxRequests) return fail('request_budget');
    if (typeof url !== 'string' || !object(options) || !['GET', 'POST'].includes(options.method))
      return fail('method_or_url');
    const key = options.method + ' ' + url, row = definitions.get(key);
    if (!row) return fail('unmapped_request');
    const allowed = options.method === 'POST' ? ['method', 'headers', 'body', 'redirect', 'signal']
      : ['method', 'headers', 'redirect', 'signal'];
    if (!keys(options, allowed) || options.redirect !== 'error' || !(options.signal instanceof AbortSignal))
      return fail('request_options');
    const headers = options.method === 'POST'
      ? { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }
      : { Authorization: 'Bearer ' + TOKEN, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (!isDeepStrictEqual(options.headers, headers)) return fail('request_headers');
    if (options.method === 'POST' && options.body !== JSON.stringify(row.requestJson)) return fail('graphql_body');
    const readIndex = (counts.get(key) ?? 0) + 1;
    counts.set(key, readIndex);
    requests.push({ method: options.method, url, readIndex });
    let response = clone(row.response);
    try {
      for (const mutation of mutations) if (mutation.routeUrl === url
        && (mutation.responseRead === 'all' || mutation.responseRead === readIndex)) response = mutate(response, mutation);
    } catch { return fail('mutation_protocol'); }
    let bodyRead = false;
    return Object.freeze({ status: response.status, ok: response.status >= 200 && response.status < 300,
      json: async () => { if (bodyRead) return fail('repeated_response_body'); bodyRead = true; return clone(response.json); } });
  };
  return Object.freeze({ fetchImpl, reject: fail, observation: () => ({ executionComplete: !setupErrors.length,
    setupErrors: [...setupErrors], requestCount,
    membershipReadCount: counts.get('GET https://api.github.com/repos/fixture-owner/fixture-repo/commits/' + 'a'.repeat(40) + '/pulls?per_page=100&page=1') ?? 0,
    requests: clone(requests) }) });
}

const stringArray = value => Array.isArray(value) && value.length <= 128
  && value.every(item => typeof item === 'string' && item.length <= 4096);

/** A trusted literal stub may exercise this in unit tests; baseline source runs only in Docker. */
export async function observeReader(reader, admitted) {
  if (typeof reader?.collectGithubEvidence !== 'function' || typeof reader?.isGithubEvidence !== 'function')
    throw new Error('Reader export/API unavailable');
  const observations = [];
  for (const row of admitted.cases) {
    const api = createOfflineApi(admitted.routes, row.mutations);
    let observation = null, subjectError = null;
    try {
      const snapshot = await reader.collectGithubEvidence({ ...admitted.call,
        now: new Date(admitted.call.now), fetchImpl: api.fetchImpl });
      const claim = reader.isGithubEvidence(snapshot);
      if (!object(snapshot) || !object(snapshot.provenance) || typeof snapshot.provenance.kind !== 'string'
        || !stringArray(snapshot.problems) || !object(snapshot.ci) || typeof snapshot.ci.status !== 'string'
        || !stringArray(snapshot.ci.problems) || snapshot.ci.association !== null && !object(snapshot.ci.association)
        || snapshot.ci.actualCheckoutSha !== null && typeof snapshot.ci.actualCheckoutSha !== 'string'
        || typeof claim !== 'boolean') throw new Error('Reader observation shape unavailable');
      observation = { provenanceKind: snapshot.provenance.kind, inProcessEvidenceClaim: claim,
        globalProblems: clone(snapshot.problems), ciStatus: snapshot.ci.status,
        ciProblems: clone(snapshot.ci.problems), ciAssociation: clone(snapshot.ci.association),
        actualCheckoutSha: snapshot.ci.actualCheckoutSha };
    } catch (error) { subjectError = errorText(error); }
    const wrapper = api.observation();
    if (subjectError) { wrapper.executionComplete = false; wrapper.subjectError = subjectError; }
    observations.push({ schemaVersion: 1, caseId: row.id, observation, wrapper });
  }
  return observations;
}

async function run() {
  const globalSetupErrors = [];
  // Set before subject import so the reader's default fetch remains a distinct denying function.
  globalThis.fetch = async () => { if (globalSetupErrors.length < 8) globalSetupErrors.push('global_fetch_denied');
    throw new Error('No real transport in offline reader probe'); };
  let result, bytes = 0, rejectDeadline;
  const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
  const timer = setTimeout(() => {
    const error = new Error('whole_probe_deadline');
    if (!process.stdin.destroyed && !process.stdin.readableEnded) process.stdin.destroy(error);
    rejectDeadline(error);
  }, PROBE_LIMITS.deadlineMs);
  try {
    result = await Promise.race([deadline, (async () => {
      const chunks = [];
      for await (const part of process.stdin) {
        bytes += part.length; if (bytes > PROBE_LIMITS.inputBytes) throw new Error('input_bound'); chunks.push(part);
      }
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes));
      const admitted = admitStimulus(JSON.parse(raw));
      const subjectUrl = 'file:///harness/subject/github.mjs';
      const reader = await import(/* @vite-ignore */ subjectUrl);
      const observations = await observeReader(reader, admitted);
      return { schemaVersion: 1, origin: 'OFFLINE_SYNTHETIC_VALUES_ONLY', observations, globalSetupErrors,
        executionComplete: !globalSetupErrors.length && observations.every(row => row.wrapper.executionComplete),
        currentCodeVerified: false, registered: false };
    })()]);
  } catch (error) {
    result = { schemaVersion: 1, origin: 'OFFLINE_SYNTHETIC_VALUES_ONLY', executionComplete: false,
      setupError: errorText(error), globalSetupErrors, currentCodeVerified: false, registered: false };
  } finally { clearTimeout(timer); }
  let output = JSON.stringify(result);
  if (Buffer.byteLength(output) > PROBE_LIMITS.outputBytes) output = JSON.stringify({ schemaVersion: 1,
    origin: 'OFFLINE_SYNTHETIC_VALUES_ONLY', executionComplete: false, setupError: 'output_bound', currentCodeVerified: false, registered: false });
  process.stdout.write(output);
  if (!result.executionComplete || Buffer.byteLength(JSON.stringify(result)) > PROBE_LIMITS.outputBytes) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await run();
