// @vitest-environment node
/** Pure trusted-wrapper tests only. No GitHub reader source is imported or executed here. */
import { describe, expect, it } from 'vitest';
import { admitStimulus, createOfflineApi, observeReader, type OfflineStimulus } from './ci-domain-probe.mjs';

const url = 'https://api.github.com/repos/fixture-owner/fixture-repo/pulls/1';
const call = { repository: 'fixture-owner/fixture-repo', prNumber: 1,
  token: 'literal-noncredential-fixture-token', requiredChecks: ['app-tests'], includeDeployments: false as const,
  now: '2026-11-11T12:00:00Z' };
const stimulus = (): OfflineStimulus => ({ schemaVersion: 2, call: structuredClone(call),
  routes: [{ method: 'GET', url, repeat: 'same', response: { status: 200, json: { number: 1 } } }],
  cases: [{ id: 'reader-01', mutations: [] }] });
const get = () => ({ method: 'GET', headers: { Authorization: 'Bearer ' + call.token,
  Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  redirect: 'error', signal: AbortSignal.timeout(5000) });
const snapshot = () => ({ provenance: { kind: 'test-transport-untrusted' }, problems: [],
  ci: { status: 'BLOCKED', problems: ['literal CI problem'], association: null, actualCheckoutSha: null } });

describe('finite offline reader wrapper, independent of candidate execution', () => {
  it('admits a separate copy and preserves response-object independence', async () => {
    const input = stimulus(), admitted = admitStimulus(input);
    input.routes[0].response.json = { changed: true };
    const api = createOfflineApi(admitted.routes, []);
    const first = await (await api.fetchImpl(url, get())).json() as { number: number };
    first.number = 9;
    expect(await (await api.fetchImpl(url, get())).json()).toEqual({ number: 1 });
    expect(api.observation().executionComplete).toBe(true);
    expect(api.observation().requestCount).toBe(2);
  });

  it('applies exact second-read mutation without modifying prior responses', async () => {
    const api = createOfflineApi(stimulus().routes, [{ routeUrl: url, responseRead: 2, jsonPath: 'number', set: 7 }]);
    expect(await (await api.fetchImpl(url, get())).json()).toEqual({ number: 1 });
    expect(await (await api.fetchImpl(url, get())).json()).toEqual({ number: 7 });
    expect(await (await api.fetchImpl(url, get())).json()).toEqual({ number: 1 });
  });

  it('mapped intentional HTTP403 is data, with no sticky harness error', async () => {
    const api = createOfflineApi(stimulus().routes, [{ routeUrl: url, responseRead: 'all',
      replaceResponse: { status: 403, json: { message: 'synthetic denied' } } }]);
    expect((await api.fetchImpl(url, get())).ok).toBe(false);
    expect(api.observation().setupErrors).toEqual([]);
  });

  for (const mode of ['url', 'query', 'method', 'headers', 'redirect', 'extra-option'] as const) {
    it(`keeps ${mode} protocol refusal sticky after the caller catches it`, async () => {
      const api = createOfflineApi(stimulus().routes, []), options: Record<string, unknown> = get();
      let requestUrl = url;
      if (mode === 'url') requestUrl += '/unmapped';
      if (mode === 'query') requestUrl += '?unexpected=1';
      if (mode === 'method') options.method = 'DELETE';
      if (mode === 'headers') options.headers = { Authorization: 'Bearer forbidden' };
      if (mode === 'redirect') options.redirect = 'follow';
      if (mode === 'extra-option') options.credentials = 'include';
      try { await api.fetchImpl(requestUrl, options); } catch { /* Intentional catch cannot clear wrapper state. */ }
      expect(api.observation().executionComplete).toBe(false);
      expect(api.observation().setupErrors).toHaveLength(1);
    });
  }

  it('rejects mismatched exact GraphQL bodies', async () => {
    const api = createOfflineApi([{ method: 'POST', url: 'https://api.github.com/graphql', repeat: 'same',
      requestJson: { query: 'literal' }, response: { status: 200, json: {} } }], []);
    await expect(api.fetchImpl('https://api.github.com/graphql', { method: 'POST',
      headers: { Authorization: 'Bearer ' + call.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'other' }), redirect: 'error', signal: AbortSignal.timeout(5000) }))
      .rejects.toThrow('graphql_body');
    expect(api.observation().executionComplete).toBe(false);
  });

  it('bounds actual requests and permits only a lowered request budget', async () => {
    const api = createOfflineApi(stimulus().routes, [], { maxRequests: 1 });
    await api.fetchImpl(url, get());
    await expect(api.fetchImpl(url, get())).rejects.toThrow('request_budget');
    expect(api.observation()).toMatchObject({ requestCount: 2, executionComplete: false });
    expect(() => createOfflineApi(stimulus().routes, [], { maxRequests: 129 })).toThrow();
  });

  it('caught fake-fetch exceptions cannot become an expected global behavioral refusal', async () => {
    const values = await observeReader({ collectGithubEvidence: async ({ fetchImpl }) => {
      try { await fetchImpl(url + '/unmapped', get()); } catch { /* Simulate reader capture. */ }
      return { ...snapshot(), problems: ['plausible global refusal'] };
    }, isGithubEvidence: () => false }, admitStimulus(stimulus()));
    expect(values[0].observation?.globalProblems).toEqual(['plausible global refusal']);
    expect(values[0].wrapper).toMatchObject({ executionComplete: false, setupErrors: ['unmapped_request'] });
  });

  it('keeps source/API execution failures distinct from returned global problems', async () => {
    const values = await observeReader({ collectGithubEvidence: async () => { throw new Error('literal stub failure'); },
      isGithubEvidence: () => false }, admitStimulus(stimulus()));
    expect(values[0].observation).toBeNull();
    expect(values[0].wrapper).toMatchObject({ executionComplete: false, subjectError: 'literal stub failure' });
  });

  it('refuses absent subject observation fields instead of manufacturing successful values', async () => {
    const values = await observeReader({ collectGithubEvidence: async () => ({}), isGithubEvidence: () => false },
      admitStimulus(stimulus()));
    expect(values[0].observation).toBeNull();
    expect(values[0].wrapper.executionComplete).toBe(false);
  });

  for (const mode of ['credential', 'foreign-route', 'duplicate-route', 'duplicate-case', 'prototype-path', 'extra-parent-field'] as const) {
    it(`rejects invalid stimulus ${mode}`, () => {
      const input = stimulus();
      if (mode === 'credential') input.call.token = 'not-the-literal-token';
      if (mode === 'foreign-route') input.routes[0].url = 'https://example.com/';
      if (mode === 'duplicate-route') input.routes.push(structuredClone(input.routes[0]));
      if (mode === 'duplicate-case') input.cases.push(structuredClone(input.cases[0]));
      if (mode === 'prototype-path') input.cases[0].mutations.push({ routeUrl: url, responseRead: 'all', jsonPath: '__proto__.x', set: 1 });
      if (mode === 'extra-parent-field') Object.assign(input, { expectedOutcome: 'PASS' });
      expect(() => admitStimulus(input)).toThrow();
    });
  }
});
