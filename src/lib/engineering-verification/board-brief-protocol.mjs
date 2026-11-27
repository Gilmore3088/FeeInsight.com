/** Input-only protocol shared by the isolated drivers; no expected answers or assertions. */
export const ADAPTER = 'hamilton.board-brief.v1';
export const MAX_BYTES = 2 * 1024 * 1024;
const stringify = JSON.stringify.bind(JSON), parse = JSON.parse.bind(JSON);
const write = process.stdout.write.bind(process.stdout);
export const fields = Object.freeze(['pathnameSearch', 'statusText', 'alertText', 'alertPresent', 'titleValue', 'noteValue', 'titleDisabled', 'saveDisabled', 'downloadDisabled', 'saveArgs', 'replaceArgs', 'fetchArgs', 'createObjectUrlArgs', 'anchorClickArgs', 'revokeArgs']);
export const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const keys = (value, names) => record(value) && Reflect.ownKeys(value).length === names.length && names.every(key => Object.hasOwn(value, key));
export const text = (value, max = 16384) => typeof value === 'string' && value.length <= max && !value.includes('\0');
export function boundedJson(value) {
  let nodes = 0;
  const visit = (v, depth) => {
    if (++nodes > 50000 || depth > 32) throw new Error('JSON structure exceeds bound');
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e9)) return;
    if (typeof v === 'string' && text(v)) return;
    if (Array.isArray(v)) { if (v.length > 10000) throw new Error('JSON array exceeds bound'); for (const item of v) visit(item, depth + 1); return; }
    if (record(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v))) {
      for (const k of Reflect.ownKeys(v)) {
        if (typeof k !== 'string' || !text(k, 128) || ['__proto__', 'prototype', 'constructor'].includes(k)) throw new Error('Unsafe JSON key');
        visit(v[k], depth + 1);
      }
      return;
    }
    throw new Error('Non-JSON protocol value');
  };
  visit(value, 0);
  if (Buffer.byteLength(stringify(value)) > MAX_BYTES) throw new Error('JSON bytes exceed bound');
}
const url = value => {
  if (!text(value, 2048) || !/^\/pro\/(reports|analyze)(?:[?#]|$)/.test(value) || /[\\\x00-\x20\x7f]/.test(value)) return false;
  const parsed = new URL(value, 'https://fixture.test'); return parsed.origin === 'https://fixture.test';
};
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export function validOutcome(value) {
  return (keys(value, ['kind', 'reportId']) && value.kind === 'success' && uuid(value.reportId))
    || (keys(value, ['kind', 'error']) && value.kind === 'refused' && text(value.error))
    || (keys(value, ['kind', 'message']) && value.kind === 'rejected' && text(value.message));
}
export function validateStep(step) {
  let ok = false;
  switch (step?.op) {
    case 'history': ok = keys(step, ['op', 'url']) && url(step.url); break;
    case 'replace-mode': ok = keys(step, ['op', 'commitHistory']) && typeof step.commitHistory === 'boolean'; break;
    case 'save-mode': ok = keys(step, ['op', 'deferred', 'outcomes']) && typeof step.deferred === 'boolean' && Array.isArray(step.outcomes) && step.outcomes.length <= 16 && step.outcomes.every(validOutcome); break;
    case 'fetch-mode': ok = keys(step, ['op', 'responses']) && Array.isArray(step.responses) && step.responses.length <= 16 && step.responses.every(row => keys(row, ['status', 'body']) && Number.isInteger(row.status) && row.status >= 200 && row.status <= 599 && text(row.body)); break;
    case 'edit': ok = record(step) && ['op', 'title', 'teamNote'].every(k => k === 'op' || !Object.hasOwn(step, k) || text(step[k])) && Object.keys(step).every(k => ['op', 'title', 'teamNote'].includes(k)) && (Object.hasOwn(step, 'title') || Object.hasOwn(step, 'teamNote')); break;
    case 'click-save': case 'click-download': ok = keys(step, ['op', 'settle']) && typeof step.settle === 'boolean'; break;
    case 'resolve-save': ok = keys(step, ['op', 'outcome']) && validOutcome(step.outcome); break;
    case 'checkpoint': ok = keys(step, ['op', 'name']) && ['initial', 'pending', 'rejected', 'refused', 'downloaded', 'created', 'beforeCanonical', 'settled'].includes(step.name); break;
    case 'advance-timers': ok = keys(step, ['op', 'milliseconds']) && Number.isSafeInteger(step.milliseconds) && step.milliseconds >= 0 && step.milliseconds <= 10000; break;
    case 'fake-timers': case 'mount-reportA': case 'mount-analysis': case 'dispatch-double-save': case 'unmount': case 'keyed-reportB': ok = keys(step, ['op']); break;
  }
  if (!ok) throw new Error('Unsupported finite stimulus');
}
export function validateSourceRequest(value) {
  boundedJson(value);
  if (!keys(value, ['adapter', 'clockIso', 'literals', 'defaults', 'cases']) || value.adapter !== ADAPTER
    || typeof value.clockIso !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.clockIso) || !Number.isFinite(Date.parse(value.clockIso))
    || !keys(value.literals, ['A', 'B', 'ANALYSIS', 'report', 'otherReport', 'analysis', 'blobUrl'])
    || ![value.literals.A, value.literals.B, value.literals.ANALYSIS].every(uuid) || value.literals.blobUrl !== 'blob:synthetic-board-brief'
    || ![value.literals.report, value.literals.otherReport, value.literals.analysis].every(record)
    || !keys(value.defaults, ['initialUrl', 'replaceCommitsHistory', 'saveOutcome']) || !url(value.defaults.initialUrl)
    || typeof value.defaults.replaceCommitsHistory !== 'boolean' || !validOutcome(value.defaults.saveOutcome)
    || !Array.isArray(value.cases) || value.cases.length !== 27) throw new Error('Malformed finite source request');
  const ids = new Set(); let components = 0, pdfs = 0;
  for (const row of value.cases) {
    if (typeof row?.id !== 'string' || ids.has(row.id)) throw new Error('Duplicate or missing source case');
    ids.add(row.id);
    if (row.kind === 'component') {
      if (!keys(row, ['id', 'kind', 'steps']) || !/^HBB-COMP-(?:0[1-9]|1\d|2[0-5])$/.test(row.id) || !Array.isArray(row.steps) || !row.steps.length || row.steps.length > 32) throw new Error('Malformed component stimulus');
      const checkpoints = new Set();
      for (const step of row.steps) { validateStep(step); if (step.op === 'checkpoint') { if (checkpoints.has(step.name)) throw new Error('Repeated checkpoint'); checkpoints.add(step.name); } }
      if (!checkpoints.size || checkpoints.size > 8) throw new Error('Incomplete checkpoint inventory');
      components++;
    } else if (row.kind === 'pdf') {
      if (!keys(row, ['id', 'kind', 'report']) || !['HBB-PDF-DENSE', 'HBB-PDF-COMPACT'].includes(row.id) || !record(row.report)) throw new Error('Malformed PDF stimulus');
      pdfs++;
    } else throw new Error('Unsupported source case kind');
  }
  if (components !== 25 || pdfs !== 2) throw new Error('Incomplete finite source inventory');
}
export async function readInput() {
  let bytes = 0; const chunks = [];
  for await (const part of process.stdin) { const chunk = Buffer.from(part); bytes += chunk.length; if (bytes > MAX_BYTES) throw new Error('Input exceeds bound'); chunks.push(chunk); }
  return parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}
export function writeOutput(value) {
  const body = stringify(value);
  if (Buffer.byteLength(body) > MAX_BYTES) throw new Error('Output exceeds bound');
  write(body);
}
