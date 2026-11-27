/** Parent-owned finite assertions. This unregistered draft never grants provenance or native acceptance. */
import { openSync, closeSync, fstatSync, readFileSync, lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { boundedJson, fields, keys, text, validateSourceRequest } from './board-brief-protocol.mjs';
export const PILOT_ID = 'EV-HAMILTON-975-BOARD-BRIEF-V1';
export const ADAPTER_ID = 'hamilton.board-brief.v1';
export const FIXTURE_PATH = new URL('./__fixtures__/hamilton-board-brief-975-v1.json', import.meta.url);
const clone = value => JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function fixture() {
  const parent = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__'), path = fileURLToPath(FIXTURE_PATH);
  if (!lstatSync(parent).isDirectory() || lstatSync(parent).isSymbolicLink() || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('Canonical parent fixture required');
  const fd = openSync(path, 'r'); let value;
  try { const stat = fstatSync(fd); if (!stat.isFile() || stat.size <= 0 || stat.size > 512 * 1024) throw new Error('Parent fixture exceeds bound'); value = JSON.parse(readFileSync(fd, 'utf8')); }
  finally { closeSync(fd); }
  boundedJson(value);
  if (!keys(value, ['schemaVersion', 'id', 'adapter', 'clockIso', 'sourceBindings', 'literals', 'defaults', 'componentCases', 'pdfCases', 'requirements', 'requiredNative', 'limits', 'withdrawnPolicy'])
    || value.schemaVersion !== 1 || value.id !== PILOT_ID || value.adapter !== ADAPTER_ID || !Array.isArray(value.componentCases) || value.componentCases.length !== 25
    || !Array.isArray(value.pdfCases) || value.pdfCases.length !== 2 || !Array.isArray(value.requirements) || value.requirements.length !== 4
    || !Array.isArray(value.requiredNative) || value.requiredNative.length !== 2 || value.requiredNative.some(row => row.status !== 'BLOCKED')) throw new Error('Malformed independent Hamilton fixture');
  const all = [...value.componentCases, ...value.pdfCases], ids = new Set(all.map(row => row.id));
  if (ids.size !== 27) throw new Error('Parent case identity inventory is incomplete');
  for (const row of value.componentCases) {
    if (!Array.isArray(row.checkpoints) || !row.checkpoints.length || row.checkpoints.length > 8 || new Set(row.checkpoints).size !== row.checkpoints.length || !Array.isArray(row.checks) || !row.checks.length) throw new Error('Malformed parent checkpoints');
    for (const check of row.checks) if (!keys(check, ['checkpoint', 'path', 'operator', 'value']) || !row.checkpoints.includes(check.checkpoint)
      || typeof check.path !== 'string' || !new RegExp('^(?:' + fields.join('|') + ')(?:\\.[0-9]{1,2})?$').test(check.path)
      || !['equals', 'contains', 'lengthEquals'].includes(check.operator)) throw new Error('Unsupported parent comparison');
  }
  const assertionIds = new Set(), covered = new Set();
  for (const requirement of value.requirements) {
    if (!Array.isArray(requirement.assertions) || !requirement.assertions.length || !Array.isArray(requirement.caseIds) || !['PASS', 'FAIL'].includes(requirement.baselineExpected)) throw new Error('Malformed parent requirement');
    for (const id of requirement.caseIds) { if (!ids.has(id) || covered.has(id)) throw new Error('Parent requirement coverage differs'); covered.add(id); }
    for (const assertion of requirement.assertions) {
      if (!keys(assertion, ['id', 'caseId', 'oracle']) || !text(assertion.id, 128) || assertionIds.has(assertion.id) || !requirement.caseIds.includes(assertion.caseId)
        || !['component-checks', 'preservation', 'association', 'native-font', 'bounds', 'order', 'pagination', 'compact-geometry'].includes(assertion.oracle)) throw new Error('Malformed parent assertion');
      assertionIds.add(assertion.id);
    }
  }
  if (covered.size !== 27 || assertionIds.size !== 33) throw new Error('Frozen assertion coverage is incomplete');
  return value;
}
const frozen = fixture();
export const PILOT = freeze({ ...frozen, cases: [...frozen.componentCases, ...frozen.pdfCases] });

export function pilotRequest() {
  const value = { adapter: ADAPTER_ID, clockIso: PILOT.clockIso, literals: clone(PILOT.literals), defaults: clone(PILOT.defaults), cases: [
    ...PILOT.componentCases.map(({ id, kind, steps }) => ({ id, kind, steps: clone(steps) })),
    ...PILOT.pdfCases.map(({ id, kind, report }) => ({ id, kind, report: clone(report) })),
  ] };
  validateSourceRequest(value); return value;
}
export function validateAdapterRequest(value) {
  validateSourceRequest(value);
  if (!isDeepStrictEqual(value, pilotRequest())) throw new Error('Source request differs from frozen ordinary stimuli');
}
export function validateObservedValues(value) {
  boundedJson(value);
  if (!Array.isArray(value) || value.length !== 27 || Buffer.byteLength(JSON.stringify(value)) > 1024 * 1024) throw new Error('Incomplete bounded observation inventory');
  const seen = new Set(); let count = 0, textBytes = 0;
  for (const row of value) {
    const expected = PILOT.cases.find(item => item.id === row?.id);
    if (!expected || seen.has(row.id) || row.kind !== expected.kind) throw new Error('Unknown or duplicate observation identity');
    seen.add(row.id);
    if (row.kind === 'component') {
      if (!keys(row, ['id', 'kind', 'checkpoints']) || !Array.isArray(row.checkpoints) || row.checkpoints.length !== expected.checkpoints.length) throw new Error('Incomplete component checkpoints');
      const names = new Set();
      for (const checkpoint of row.checkpoints) {
        if (!keys(checkpoint, ['name', 'values']) || !expected.checkpoints.includes(checkpoint.name) || names.has(checkpoint.name) || !keys(checkpoint.values, fields)) throw new Error('Unknown or duplicate raw checkpoint');
        names.add(checkpoint.name); const v = checkpoint.values;
        if (!text(v.pathnameSearch) || ['statusText', 'alertText', 'titleValue', 'noteValue'].some(key => v[key] !== null && !text(v[key])) || typeof v.alertPresent !== 'boolean'
          || ['titleDisabled', 'saveDisabled', 'downloadDisabled'].some(key => v[key] !== null && typeof v[key] !== 'boolean')) throw new Error('Malformed raw component fields');
        for (const field of fields.filter(key => key.endsWith('Args'))) if (!Array.isArray(v[field]) || v[field].length > 16 || v[field].some(args => !Array.isArray(args) || args.length > 4)) throw new Error('Malformed bounded argument vectors');
      }
    } else {
      if (!keys(row, ['id', 'kind', 'pages']) || !Array.isArray(row.pages) || !row.pages.length || row.pages.length > 12) throw new Error('Incomplete bounded PDF pages');
      for (const page of row.pages) {
        if (!keys(page, ['width', 'height', 'items']) || ![page.width, page.height].every(n => Number.isFinite(n) && n > 0 && n <= 2000) || !Array.isArray(page.items) || page.items.length > 10000) throw new Error('Malformed PDF page');
        for (const item of page.items) {
          if (!keys(item, ['text', 'transform', 'width', 'height', 'fontAscent', 'fontDescent']) || !text(item.text) || !Array.isArray(item.transform) || item.transform.length !== 6
            || ![...item.transform, item.width, item.height, item.fontAscent, item.fontDescent].every(n => Number.isFinite(n) && Math.abs(n) <= 1e6)
            || item.width < 0 || item.height < 0 || Math.abs(item.fontAscent) > 10 || Math.abs(item.fontDescent) > 10) throw new Error('Malformed native PDF text item');
          if (++count > 50000 || (textBytes += Buffer.byteLength(item.text)) > 1024 * 1024) throw new Error('Native text inventory exceeds bound');
        }
      }
    }
  }
}
const at = (value, path) => path.split('.').reduce((v, part) => v == null ? undefined : v[part], value);
function componentPass(row, observed) {
  return row.checks.every(check => {
    const actual = at(observed.checkpoints.find(item => item.name === check.checkpoint).values, check.path);
    if (check.operator === 'equals') return isDeepStrictEqual(actual, check.value);
    if (check.operator === 'contains') return typeof actual === 'string' && typeof check.value === 'string' && actual.includes(check.value);
    return Array.isArray(actual) && actual.length === check.value;
  });
}
function pdfPass(row, observed) {
  const o = row.oracle, boxes = observed.pages.flatMap((page, index) => page.items.filter(item => item.text.trim()).map(item => ({
    page: index + 1, text: item.text, left: item.transform[4], right: item.transform[4] + item.width,
    top: page.height - item.transform[5] - item.height * item.fontAscent,
    bottom: page.height - item.transform[5] - item.height * item.fontDescent, fontHeight: item.height,
    axisAligned: item.transform[1] === 0 && item.transform[2] === 0,
  })));
  const body = boxes.map(box => box.text).join(' ').replace(/\s+/g, ' ');
  const find = token => { const matches = boxes.filter(box => box.text.includes(token)); return matches.length === 1 ? matches[0] : null; };
  const before = (a, b) => a && b && (a.page < b.page || (a.page === b.page && b.top >= a.bottom + o.orderGap));
  const markers = o.rows.map(cells => {
    const label = cells[0], suffix = label.startsWith('ROW-') ? label.slice(4) : label.slice(6);
    return { label: find(label), source: find(o.dense ? 'SRC-' + suffix : cells[2].split(';')[0]), end: find((o.dense ? 'END-' : 'SMALL-END-') + suffix), value: find(cells[1]), check: o.dense ? find(cells[3]) : null };
  });
  const preservation = o.rows.every(cells => cells.every(cell => body.includes(cell))) && body.includes(o.limit) && body.includes(o.after);
  const bounds = observed.pages.every(page => page.width === o.pageWidth && page.height === o.pageHeight) && boxes.every(box => box.axisAligned && ((box.top > o.footer.minTop && [o.footer.attribution, o.footer.date].includes(box.text))
    || (box.left >= o.bounds.minLeft && box.right <= o.bounds.maxRight && box.top >= o.bounds.minTop && box.bottom <= o.bounds.maxBottom)));
  const association = markers.every(r => r.label && r.source && r.end && r.value && (!o.dense || r.check)
    && [r.source, r.end, r.value, ...(o.dense ? [r.check] : [])].every(box => box.page === r.label.page));
  const nativeFont = markers.every(r => [r.label, r.source, r.end, r.value, r.check].filter(Boolean).every(box => box.fontHeight >= o.minDenseFontHeight));
  const order = before(find(o.title), find(o.subtitle)) && before(find(o.subtitle), markers[0].label)
    && markers.every((r, index) => r.source && r.end && r.end.top >= r.source.top && r.end.bottom >= r.source.bottom
      && (index === markers.length - 1 || before(r.end, markers[index + 1].label)))
    && before(markers.at(-1).end, find('EVIDENCE-LIMIT')) && before(find('EVIDENCE-LIMIT'), find(o.after));
  const pagination = new Set(markers.filter(r => r.label).map(r => r.label.page)).size >= o.minDenseRowPages;
  return { preservation, bounds, association, 'native-font': nativeFont, order: Boolean(order), pagination,
    'compact-geometry': bounds && Boolean(order) };
}
export function assessPilotValues(value) {
  validateObservedValues(value);
  const rows = new Map(value.map(row => [row.id, row]));
  return PILOT.requirements.map(requirement => {
    const assertions = requirement.assertions.map(assertion => {
      const fixture = PILOT.cases.find(row => row.id === assertion.caseId), observed = rows.get(assertion.caseId);
      const passed = assertion.oracle === 'component-checks' ? componentPass(fixture, observed) : pdfPass(fixture, observed)[assertion.oracle];
      return { id: assertion.id, status: passed ? 'PASSED' : 'FAILED', ...(passed ? {} : { message: 'Frozen ' + assertion.oracle + ' failed for ' + assertion.caseId }) };
    });
    return { requirement_id: requirement.requirement_id, test_id: requirement.test_id, status: assertions.every(row => row.status === 'PASSED') ? 'PASSED' : 'FAILED', assertions };
  });
}
