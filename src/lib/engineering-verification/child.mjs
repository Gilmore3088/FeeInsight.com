/** Value-only adapter. Expected answers, credentials and the parent assertion runner are not mounted. */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
let input = '';
for await (const part of process.stdin) {
  input += part;
  if (Buffer.byteLength(input) > 2 * 1024 * 1024) throw new Error('Input exceeds bound');
}
const request = JSON.parse(input);
if (!request || !['knox.free-specialists.v1', 'engineering.policy.v1', 'engineering.policy.v2'].includes(request.adapter) || Object.keys(request).sort().join(',') !== 'adapter,cases'
  || !Array.isArray(request.cases) || !request.cases.length || request.cases.length > (request.adapter === 'engineering.policy.v2' ? 64 : 32)) throw new Error('Unsupported adapter request');
const ids = new Set();
for (const row of request.cases) {
  if (!row || Object.keys(row).sort().join(',') !== 'id,text' || typeof row.id !== 'string'
    || !(request.adapter === 'engineering.policy.v2' ? /^[a-zA-Z][a-zA-Z0-9-]{0,63}$/ : /^[a-z][a-z0-9-]{0,63}$/).test(row.id) || ids.has(row.id) || typeof row.text !== 'string'
    || row.text.length > 65536) throw new Error('Malformed adapter case');
  ids.add(row.id);
}
if (['engineering.policy.v1', 'engineering.policy.v2'].includes(request.adapter)) {
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
  process.stdout.write(JSON.stringify({schema_version: 1, cases}));
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
process.stdout.write(JSON.stringify({ schema_version: 1, cases }));
}
