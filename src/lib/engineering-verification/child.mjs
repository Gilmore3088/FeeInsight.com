/** Value-only adapter. Expected answers, credentials and the parent assertion runner are not mounted. */
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/** Only trusted literal stubs may replace the loader in host unit tests. */
export async function runReaderCases(request, stimulusBytes, loadReader) {
  if (createHash('sha256').update(stimulusBytes).digest('hex') !== 'c89dfc33d196fdbd002a36fd778c7daf921f0fa3e06b1de57f3415fec0a742f9') throw new Error('Frozen public reader stimulus changed');
  const ids = Array.from({ length: 39 }, (_, index) => 'reader-' + String(index + 1).padStart(2, '0'));
  const batches = [ids.slice(0, 32), ids.slice(32)];
  if (!request || Object.keys(request).sort().join(',') !== 'adapter,cases' || request.adapter !== 'engineering.ci-domains.v1'
    || !Array.isArray(request.cases) || !batches.some(batch => JSON.stringify(batch) === JSON.stringify(request.cases.map(row => row?.id)))
    || request.cases.some(row => !row || Object.keys(row).sort().join(',') !== 'id,text' || row.text !== JSON.stringify({ caseId: row.id }))) throw new Error('Unknown or malformed fixed reader batch');
  const publicInput = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stimulusBytes));
  const { admitStimulus, observeReader } = await import('./ci-domain-probe.mjs');
  const admitted = admitStimulus({ schemaVersion: 2,
    call: Object.fromEntries(Object.entries(publicInput.call).filter(([key]) => key !== 'fetchImpl')),
    routes: publicInput.routeBase, cases: request.cases.map(row => {
      const source = publicInput.cases.find(item => item.id === row.id);
      return { id: source.id, mutations: source.mutations };
    }),
  });
  const globalSetupErrors = [];
  // The source captures this distinct denial before import. Caught denial remains
  // sticky outside its own capture callbacks and cannot become behavioral RED.
  globalThis.fetch = async () => {
    if (globalSetupErrors.length < 8) globalSetupErrors.push('global_fetch_denied');
    throw new Error('No real transport in reader source sandbox');
  };
  const subjectUrl = 'file:///harness/subject/github.mjs';
  const reader = await (loadReader ? loadReader() : import(/* @vite-ignore */ subjectUrl));
  const cases = await observeReader(reader, admitted);
  if (globalSetupErrors.length || cases.some(row => !row.wrapper.executionComplete || row.wrapper.setupErrors.length)) throw new Error('Reader wrapper setup incomplete');
  return cases;
}

export async function childMain(input) {
const request = JSON.parse(input);
if (!request || !['knox.free-specialists.v1', 'engineering.policy.v1', 'engineering.policy.v2', 'engineering.ci-domains.v1'].includes(request.adapter) || Object.keys(request).sort().join(',') !== 'adapter,cases'
  || !Array.isArray(request.cases) || !request.cases.length || request.cases.length > (request.adapter === 'engineering.policy.v2' ? 64 : 32)) throw new Error('Unsupported adapter request');
const ids = new Set();
for (const row of request.cases) {
  if (!row || Object.keys(row).sort().join(',') !== 'id,text' || typeof row.id !== 'string'
    || !(request.adapter === 'engineering.policy.v2' ? /^[a-zA-Z][a-zA-Z0-9-]{0,63}$/ : /^[a-z][a-z0-9-]{0,63}$/).test(row.id) || ids.has(row.id) || typeof row.text !== 'string'
    || row.text.length > 65536) throw new Error('Malformed adapter case');
  ids.add(row.id);
}
if (request.adapter === 'engineering.ci-domains.v1') {
  return { schema_version: 1, cases: await runReaderCases(request, readFileSync(new URL('./ci-domain-stimulus-v2.json', import.meta.url))) };
} else if (['engineering.policy.v1', 'engineering.policy.v2'].includes(request.adapter)) {
  const policy = await import(pathToFileURL(join(process.env.CODE_ROOT, 'src/lib/engineering-verification/contract.mjs')).href);
  const cases = request.cases.map(({id, text}) => {
    const input = JSON.parse(text);
    if (request.adapter === 'engineering.policy.v2') {
      if (!input || Object.keys(input).sort().join(',') !== 'operation,paths' || input.operation !== 'financial'
        || !Array.isArray(input.paths) || !input.paths.length || input.paths.length > 16
        || input.paths.some(path => typeof path !== 'string' || !path.length || path.length > 1024)
        || typeof policy.classifyChange !== 'function' || typeof policy.routeSkills !== 'function') throw new Error('Malformed or unsupported financial policy input');
      return { id, risk: policy.classifyChange(input.paths).risk_tier, skills: policy.routeSkills(input.paths) };
    }
    if (!input || Object.keys(input).sort().join(',') !== 'operation,paths' || !['risk','docs'].includes(input.operation)
      || !Array.isArray(input.paths) || input.paths.length !== 1 || typeof input.paths[0] !== 'string' || input.paths[0].length > 1024) throw new Error('Malformed policy input');
    return {id, value: input.operation === 'risk' ? policy.classifyChange(input.paths).risk_tier : policy.mayUseDocsOnlyFastPath(input.paths)};
  });
  return { schema_version: 1, cases };
} else {
const { runFreeSpecialists } = await import(pathToFileURL(join(process.env.CODE_ROOT, 'src/lib/agents/knox/specialists.ts')).href);
const { feeApplicability } = await import(pathToFileURL(join(process.env.CODE_ROOT, 'src/lib/fee-audience.ts')).href);
const cases = request.cases.map(({ id, text }) => {
  const result = runFreeSpecialists(text);
  return {
    id,
    candidates: result.candidates.filter(row => row.canonicalHint?.startsWith('wire_')).map(row => ({
      feeName: row.feeName, amount: row.amount, canonicalHint: row.canonicalHint,
    })),
    held: result.held.filter(row => row.canonicalHint?.startsWith('wire_')).map(row => ({
      shape: row.shape, feeName: row.feeName, amount: row.amount, canonicalHint: row.canonicalHint,
      audience: feeApplicability(row.feeName, row.excerpt, row.amount).feeAudience, excerpt: row.excerpt,
    })),
  };
});
return { schema_version: 1, cases };
}

}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let input = '';
  for await (const part of process.stdin) {
    input += part;
    if (Buffer.byteLength(input) > 2 * 1024 * 1024) throw new Error('Input exceeds bound');
  }
  const output = JSON.stringify(await childMain(input));
  if (Buffer.byteLength(output) > 2 * 1024 * 1024) throw new Error('Output exceeds bound');
  process.stdout.write(output);
}
