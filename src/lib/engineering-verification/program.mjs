/** Source-to-code traceability only. This validator never executes tests or certifies rollout, approval or production. */
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const PROGRAM_PATH = 'docs/project/acceptance/engineering/program.json';
const range = (prefix, total) => Array.from({ length: total }, (_, i) => `${prefix}-${String(i + 1).padStart(2, '0')}`);
const SOURCES = [
  { id: 'prd-v1', path: 'docs/project/acceptance/engineering/design-v1/prd-v1.md', sha256: '6ec2ff3c9a5005dfd783cdfc94652148613cec77c493d712f228601da71f7dcc', ids: [...range('FR', 22), ...range('SEC', 8), ...range('UAT', 10)] },
  { id: 'technical-design-v1', path: 'docs/project/acceptance/engineering/design-v1/technical-design-v1.md', sha256: '40acbb05266c300fc5dbb2b690d3fd89eb368310c3ccdeeb7580ccdf3c042c35', ids: range('AT', 10) },
];
const EXPECTED = new Set(SOURCES.flatMap(source => source.ids));
const STAGES = ['M0', 'M1', 'M2', 'M3', 'M4', 'M5'];
const REFERENCES = ['contract', 'policy', 'runner', 'proof', 'github', 'review', 'operational', 'summary', 'metrics', 'learning', 'ui', 'workflow', 'source-security'];
const REQUIRED_REFERENCE_FILES = {
  'source-security': {
    implementation: ['src/lib/agents/source-data-boundary.ts', 'src/lib/agents/knox/paid-extract.ts', 'src/lib/agents/rosetta/paid-read.ts', ...['pdf', 'html', 'txt'].map(extension => `src/lib/engineering-verification/__fixtures__/source-injection/fee-schedule.${extension}`)],
    tests: ['src/lib/engineering-verification/source-injection.test.ts'],
  },
  ui: {
    implementation: [...['buyer-journey-mapper', 'ux-ui-auditor', 'playwright-ux-simulator'].map(skill => `.claude/skills/${skill}/SKILL.md`), 'src/lib/engineering-verification/browser-evidence.mjs', 'tests/e2e/hamilton/evidence.ts'],
    tests: ['src/lib/engineering-verification/browser-evidence.test.ts', 'tests/e2e/hamilton/reports-journey.pw.ts'],
  },
  metrics: { implementation: ['src/lib/engineering-verification/scorecard.mjs'], tests: ['src/lib/engineering-verification/scorecard.test.ts'] },
};
const REQUIREMENT_GATES = {
  'AT-04': ['owner-security-approval', 'independent-reviewer-identity'],
  'UAT-03': ['owner-security-approval', 'independent-reviewer-identity'],
  'SEC-05': ['trusted-actions-proof', 'source-injection-coverage'],
  ...Object.fromEntries(['FR-03', 'FR-20', 'UAT-09'].map(id => [id, ['ui-specialist-adoption']])),
  ...Object.fromEntries(['FR-17', 'FR-19', 'FR-22', 'SEC-06'].map(id => [id, ['holdout-and-scorecard-adoption']])),
};
const GATES = ['owner-security-approval', 'independent-reviewer-identity', 'trusted-actions-proof', 'operational-observation', 'authorized-runtime-reruns', 'ui-specialist-adoption', 'holdout-and-scorecard-adoption', 'source-injection-coverage'];
const PENDING = ['PENDING_AUTHORIZATION', 'PENDING_IDENTITY', 'PENDING_EXECUTION', 'PENDING_ADOPTION'];
const text = value => typeof value === 'string' && value.trim().length > 0;
const list = value => Array.isArray(value) && value.every(text) && new Set(value).size === value.length;
const same = (a, b) => list(a) && a.length === b.length && [...a].sort().every((value, i) => value === [...b].sort()[i]);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateProgram(repositoryRoot) {
  const problems = [];
  let root;
  try { root = realpathSync(resolve(repositoryRoot)); }
  catch { return { status: 'BLOCKED', requirements: 0, problems: ['Repository root unavailable'] }; }
  const file = path => {
    if (!text(path) || path.includes('\\') || isAbsolute(path) || path.split('/').some(part => !part || part === '.' || part === '..') || /[\x00-\x1f\x7f]/.test(path)) { problems.push(`Unsafe file reference: ${String(path)}`); return null; }
    try {
      const actual = realpathSync(join(root, path));
      const within = relative(root, actual);
      if (within.startsWith('..' + sep) || isAbsolute(within) || !within) { problems.push(`Unsafe resolved file reference: ${path}`); return null; }
      if (!statSync(actual).isFile() || statSync(actual).size === 0) { problems.push(`Missing file contents: ${path}`); return null; }
      return actual;
    } catch { problems.push(`Missing file: ${path}`); return null; }
  };
  let program;
  try { const path = file(PROGRAM_PATH); if (!path) throw new Error(); program = JSON.parse(readFileSync(path, 'utf8')); }
  catch { return { status: 'BLOCKED', requirements: 0, problems: [...problems, 'Program manifest unavailable or invalid JSON'] }; }
  if (!object(program) || program.schema_version !== 1 || program.program_id !== 'FEEINSIGHT-ENGINEERING-VERIFICATION') return { status: 'BLOCKED', requirements: 0, problems: ['Unsupported program manifest'] };
  if (!text(program.status_semantics) || !program.status_semantics.includes('never certifies')) problems.push('Program must distinguish traceability from certified completion');
  const sourceRows = new Map();
  if (!Array.isArray(program.sources) || !same(program.sources.map(source => source?.id), SOURCES.map(source => source.id))) problems.push('Exact supplied source registry required');
  for (const source of SOURCES) {
    const declared = program.sources?.find?.(item => item?.id === source.id);
    if (!declared || declared.path !== source.path || declared.sha256 !== source.sha256) problems.push(`Source hash/path is not the pinned supplied edition: ${source.id}`);
    const path = file(source.path); if (!path) continue;
    const bytes = readFileSync(path);
    if (hash(bytes) !== source.sha256) problems.push(`Source hash drift: ${source.id}`);
    const rows = new Map();
    for (const line of bytes.toString('utf8').split('\n')) {
      const matched = line.match(/^\|\s*((?:FR|SEC|AT|UAT)-\d{2})(?=[ :|])/);
      if (!matched) continue;
      if (rows.has(matched[1])) problems.push(`Duplicate numbered source requirement: ${matched[1]}`);
      rows.set(matched[1], line.split('|').at(-2)?.trim());
    }
    if (!same([...rows.keys()], source.ids)) problems.push(`Supplied source requirement inventory differs: ${source.id}`);
    sourceRows.set(source.id, rows);
  }
  if (!object(program.references) || !same(Object.keys(program.references), REFERENCES)) problems.push('Complete implementation/test reference registry required');
  for (const [name, reference] of Object.entries(program.references ?? {})) {
    if (!object(reference)) { problems.push(`Malformed reference: ${name}`); continue; }
    for (const kind of ['implementation', 'tests']) {
      if (!list(reference[kind]) || !reference[kind].length) { problems.push(`Reference ${name} requires ${kind} files`); continue; }
      for (const path of reference[kind]) {
        if (kind === 'tests' && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(path) && !/^tests\/e2e\/[^\s]+\.pw\.ts$/.test(path)) problems.push(`Reference ${name} requires an actual test file: ${path}`);
        file(path);
      }
    }
  }
  for (const [name, kinds] of Object.entries(REQUIRED_REFERENCE_FILES)) {
    for (const [kind, paths] of Object.entries(kinds)) {
      for (const path of paths) if (!Array.isArray(program.references?.[name]?.[kind]) || !program.references[name][kind].includes(path)) problems.push(`Required traceability file missing from ${name}.${kind}: ${path}`);
    }
  }
  const refs = (values, owner) => {
    if (!list(values) || !values.length) { problems.push(`References missing for ${owner}`); return; }
    for (const name of values) if (!object(program.references) || !Object.hasOwn(program.references, name) || !REFERENCES.includes(name)) problems.push(`Unknown reference ${name} for ${owner}`);
  };
  const gates = (values, owner) => {
    if (!list(values)) { problems.push(`Activation gate list missing for ${owner}`); return; }
    for (const name of values) if (!GATES.includes(name)) problems.push(`Unknown activation gate ${name} for ${owner}`);
  };
  if (!Array.isArray(program.activation_gates) || !same(program.activation_gates.map(gate => gate?.id), GATES)) problems.push('Complete pending external activation registry required');
  for (const gate of Array.isArray(program.activation_gates) ? program.activation_gates : []) if (!object(gate) || !PENDING.includes(gate.state) || !text(gate.reason)) problems.push(`Activation gate ${gate?.id ?? 'unknown'} must remain pending external evidence; a manifest cannot grant approval`);
  if (!Array.isArray(program.stages) || !same(program.stages.map(stage => stage?.id), STAGES)) problems.push('All six M0-M5 stages required exactly once');
  for (const stage of Array.isArray(program.stages) ? program.stages : []) {
    if (!text(stage?.behavior)) problems.push(`Stage ${stage?.id} behavior missing`);
    refs(stage?.references, stage?.id); gates(stage?.activation_gates, stage?.id);
  }
  const found = new Set(), remaining = [];
  for (const requirement of Array.isArray(program.requirements) ? program.requirements : []) {
    if (!object(requirement)) { problems.push('Malformed requirement'); continue; }
    const id = requirement.id;
    if (!EXPECTED.has(id)) problems.push(`Unknown requirement: ${String(id)}`);
    if (found.has(id)) problems.push(`Duplicate requirement: ${String(id)}`);
    found.add(id);
    if (!STAGES.includes(requirement.stage)) problems.push(`Unknown milestone for ${String(id)}`);
    if (!text(requirement.behavior) || sourceRows.get(requirement.source)?.get(id) !== requirement.behavior) problems.push(`Requirement ${String(id)} source attribution or original acceptance behavior differs`);
    refs(requirement.references, id); gates(requirement.activation_gates, id);
    const requiredGates = REQUIREMENT_GATES[id] ?? [];
    for (const gate of requiredGates) if (!Array.isArray(requirement.activation_gates) || !requirement.activation_gates.includes(gate)) problems.push(`Requirement ${id} must retain required activation gate ${gate}`);
    if (id === 'SEC-05' && requirement.implementation_state !== 'PARTIAL') problems.push('SEC-05 remains PARTIAL until source-injection acceptance has trusted execution and independent review evidence');
    if (['SEC-05', 'AT-08', 'UAT-07'].includes(id) && (!Array.isArray(requirement.references) || !requirement.references.includes('source-security'))) problems.push(`Requirement ${id} must reference the actual source-security seam`);
    if (!['MECHANISM_PRESENT', 'PARTIAL'].includes(requirement.implementation_state)) problems.push(`Unknown implementation state for ${String(id)}`);
    if (requirement.implementation_state === 'PARTIAL' && (!text(requirement.remaining_work) || !requirement.activation_gates?.length)) problems.push(`Partial requirement ${String(id)} must disclose remaining work and adoption dependency`);
    if (requirement.implementation_state === 'PARTIAL' || requirement.activation_gates?.length) remaining.push(id);
  }
  for (const id of EXPECTED) if (!found.has(id)) problems.push(`Missing requirement: ${id}`);
  if (!same(program.remaining_requirements, remaining)) problems.push('remaining_requirements must exactly disclose all partial or activation-dependent requirements');
  return { status: problems.length ? 'BLOCKED' : 'PLAN_TRACEABLE', requirements: found.size, problems: [...new Set(problems)] };
}
