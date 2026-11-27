// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ADAPTER_ID, FIXTURE_PATH, PILOT, PILOT_ID, assessPilotValues, pilotRequest,
  validateAdapterRequest, validateObservedValues,
  type ComponentObservation, type ComponentValues, type Json, type Observation, type PdfItem, type PdfObservation,
} from './board-brief-draft.mjs';

type Check = { checkpoint: string; path: string; operator: 'equals' | 'contains' | 'lengthEquals'; value: Json };
type ComponentCase = { id: string; kind: 'component'; baselineExpected: string; steps: Json[]; checkpoints: string[]; checks: Check[] };
type PdfCase = { id: string; kind: 'pdf'; baselineExpected: string; report: Json; oracle: { rows: string[][]; title: string; subtitle: string; limit: string; after: string } };
type Requirement = { requirement_id: string; test_id: string; baselineExpected: string; caseIds: string[]; assertions: { id: string }[] };
const literal = JSON.parse(readFileSync(new URL('./__fixtures__/hamilton-board-brief-975-v1.json', import.meta.url), 'utf8')) as {
  id: string; adapter: string; clockIso: string; literals: Record<string, Json>; defaults: Json;
  componentCases: ComponentCase[]; pdfCases: PdfCase[]; requirements: Requirement[]; requiredNative: { status: string }[];
};
const clone = <T>(value: T): T => structuredClone(value);
const routeA = '/pro/reports?report_id=00000000-0000-4000-8000-000009701411';
const routeB = '/pro/reports?report_id=00000000-0000-4000-8000-000009701412';
const failedBaseline = ['HBB-COMP-06', 'HBB-COMP-07', 'HBB-COMP-08', 'HBB-COMP-09', 'HBB-COMP-18', 'HBB-COMP-19', 'HBB-COMP-23', 'HBB-COMP-24'];
const request = () => ({
  adapter: 'hamilton.board-brief.v1', clockIso: '2026-11-08T12:00:00.000Z',
  literals: clone(literal.literals), defaults: clone(literal.defaults),
  cases: [
    ...literal.componentCases.map(({ id, kind, steps }) => ({ id, kind, steps: clone(steps) })),
    ...literal.pdfCases.map(({ id, kind, report }) => ({ id, kind, report: clone(report) })),
  ],
});

function setPath(target: object, path: string, value: unknown) {
  const segments = path.split('.');
  let cursor = target as Record<string, unknown>;
  for (let index = 0; index < segments.length - 1; index++) {
    const key = segments[index];
    if (cursor[key] === undefined) cursor[key] = /^\d+$/.test(segments[index + 1]) ? [] : {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[segments.at(-1)!] = clone(value);
}

function emptyValues(): ComponentValues {
  return {
    pathnameSearch: routeA, statusText: null, alertText: null, alertPresent: false,
    titleValue: null, noteValue: null, titleDisabled: null, saveDisabled: null, downloadDisabled: null,
    saveArgs: [], replaceArgs: [], fetchArgs: [], createObjectUrlArgs: [], anchorClickArgs: [], revokeArgs: [],
  };
}

// These are deliberately synthetic parent-oracle examples, NOT executions, PDF rendering,
// authenticated child observations, or provenance. Each of the 100 frozen checks is
// separately corrupted below; independent concrete substitutions follow those checks.
function componentExample(row: ComponentCase): ComponentObservation {
  const checkpoints = row.checkpoints.map(name => ({ name, values: emptyValues() }));
  for (const check of row.checks) {
    const checkpoint = checkpoints.find(item => item.name === check.checkpoint)!;
    setPath(checkpoint.values, check.path, check.operator === 'lengthEquals'
      ? Array.from({ length: check.value as number }, () => []) : check.value);
  }
  // Call logs are cumulative dense argument vectors. A later indexed predicate
  // does not assert earlier calls again, but those slots still exist on the wire.
  for (let index = 1; index < checkpoints.length; index++) {
    for (const field of ['saveArgs', 'replaceArgs', 'fetchArgs', 'createObjectUrlArgs', 'anchorClickArgs', 'revokeArgs'] as const) {
      const calls = checkpoints[index].values[field];
      for (let call = 0; call < calls.length; call++) {
        if (!Object.hasOwn(calls, call)) calls[call] = clone(checkpoints[index - 1].values[field][call] ?? []);
      }
    }
  }
  return { id: row.id, kind: 'component', checkpoints };
}

function textItem(text: string, top: number, left = 72, height = 8): PdfItem {
  return { text, transform: [height, 0, 0, height, left, 792 - top - height * 0.8], width: 80, height, fontAscent: 0.8, fontDescent: -0.2 };
}

// Parser-shaped examples only. They are never represented as native PDF bytes or
// measured typography. The separate PDF reader/runner needs its own provenance tests.
function pdfExample(row: PdfCase): PdfObservation {
  const pages: PdfObservation['pages'] = [{ width: 612, height: 792, items: [textItem(row.oracle.title, 72), textItem(row.oracle.subtitle, 90)] }];
  row.oracle.rows.forEach((cells, index) => {
    const pageIndex = Math.floor(index / 12);
    if (!pages[pageIndex]) pages[pageIndex] = { width: 612, height: 792, items: [] };
    const top = 120 + (index % 12) * 22;
    cells.forEach((cell, column) => pages[pageIndex].items.push(textItem(cell, top, 72 + column * 110)));
  });
  const endTop = 120 + ((row.oracle.rows.length - 1) % 12) * 22 + 22;
  pages.at(-1)!.items.push(textItem(row.oracle.limit, endTop), textItem(`${row.oracle.after} All original saved rows precede this paragraph.`, endTop + 22));
  return { id: row.id, kind: 'pdf', pages };
}
const examples = (): Observation[] => [...literal.componentCases.map(componentExample), ...literal.pdfCases.map(pdfExample)];
function component(values: Observation[], id: string) { return values.find(row => row.id === id) as ComponentObservation; }
function pdf(values: Observation[], id = 'HBB-PDF-DENSE') { return values.find(row => row.id === id) as PdfObservation; }
function failedAssertions(values: Observation[]) { return assessPilotValues(values).flatMap(group => group.assertions.filter(row => row.status === 'FAILED').map(row => row.id)); }
function deepFrozen(value: unknown): boolean {
  if (!value || typeof value !== 'object') return true;
  return Object.isFrozen(value) && Object.values(value).every(deepFrozen);
}

describe('independent Hamilton board brief parent contract', () => {
  it('pins the finite original 25+2 cases, 100 operators, 8/17 component baseline, and two required blocked native groups', () => {
    expect(PILOT_ID).toBe('EV-HAMILTON-975-BOARD-BRIEF-V1');
    expect(ADAPTER_ID).toBe('hamilton.board-brief.v1');
    expect(FIXTURE_PATH.pathname.endsWith('/__fixtures__/hamilton-board-brief-975-v1.json')).toBe(true);
    expect(literal.componentCases).toHaveLength(25);
    expect(literal.pdfCases).toHaveLength(2);
    expect(literal.componentCases.flatMap(row => row.checks)).toHaveLength(100);
    expect(literal.componentCases.filter(row => row.baselineExpected === 'FAIL').map(row => row.id)).toEqual(failedBaseline);
    expect(literal.componentCases.filter(row => row.baselineExpected === 'PASS')).toHaveLength(17);
    expect(literal.pdfCases.map(row => row.baselineExpected)).toEqual(['FAIL', 'PASS']);
    expect(literal.requirements.flatMap(row => row.assertions)).toHaveLength(33);
    expect(PILOT.requiredNative).toEqual(literal.requiredNative);
    expect(literal.requiredNative.map(row => row.status)).toEqual(['BLOCKED', 'BLOCKED']);
    expect(deepFrozen(PILOT)).toBe(true);
  });

  it('sends finite ordinary stimuli and literal report inputs, with all parent expectations withheld', () => {
    expect(pilotRequest()).toEqual(request());
    expect(() => validateAdapterRequest(request())).not.toThrow();
    const text = JSON.stringify(pilotRequest());
    for (const key of ['baselineExpected', 'checkpoints', 'checks', 'oracle', 'requirements', 'sourceBindings', 'requiredNative', 'withdrawnPolicy']) {
      expect(text).not.toContain(`"${key}"`);
    }
    expect(new Set(literal.componentCases.flatMap(row => row.steps.map(step => (step as Record<string, Json>).op))).size).toBe(16);
  });

  it.each([
    ['missing case', (r: ReturnType<typeof request>) => { r.cases.pop(); }],
    ['duplicate case', (r: ReturnType<typeof request>) => { r.cases[1] = r.cases[0]; }],
    ['unknown case', (r: ReturnType<typeof request>) => { r.cases[0].id = 'BUILDER_CASE'; }],
    ['changed clock', (r: ReturnType<typeof request>) => { r.clockIso = '2030-01-01T00:00:00.000Z'; }],
    ['changed report title', (r: ReturnType<typeof request>) => { (r.literals.report as Record<string, Json>).title = 'Candidate expected title'; }],
    ['changed origin input', (r: ReturnType<typeof request>) => { (r.defaults as Record<string, Json>).initialUrl = routeB; }],
    ['arbitrary operation', (r: ReturnType<typeof request>) => { Object.assign(r.cases[0], { steps: [{ op: 'execute', module: '/tmp/assertions.mjs' }] }); }],
    ['arbitrary selector', (r: ReturnType<typeof request>) => { Object.assign(r.cases[0], { selector: '#candidate-pass' }); }],
    ['child expectation', (r: ReturnType<typeof request>) => { Object.assign(r.cases[0], { expected: 'PASS' }); }],
    ['top success claim', (r: ReturnType<typeof request>) => { Object.assign(r, { status: 'VERIFIED' }); }],
    ['extra case', (r: ReturnType<typeof request>) => { r.cases.push(clone(r.cases[0])); }],
  ])('rejects request substitution: %s', (_name, mutate) => {
    const candidate = request(); mutate(candidate);
    expect(() => validateAdapterRequest(candidate)).toThrow();
  });

  it('accepts complete synthetic raw observations by identity, without output-order authority', () => {
    expect(() => validateObservedValues(examples())).not.toThrow();
    expect(() => validateObservedValues(examples().reverse())).not.toThrow();
    expect(assessPilotValues(examples())).toEqual(literal.requirements.map(group => ({
      requirement_id: group.requirement_id, test_id: group.test_id, status: 'PASSED',
      assertions: group.assertions.map(row => ({ id: row.id, status: 'PASSED' })),
    })));
    expect(PILOT.requiredNative).toEqual(literal.requiredNative);
  });

  it.each(literal.componentCases.flatMap(row => row.checks.map((check, index) => ({ row, check, index }))))(
    'independently enforces $row.id frozen check $index ($check.path $check.operator)', ({ row, check }) => {
      const candidate = examples();
      const values = component(candidate, row.id).checkpoints.find(item => item.name === check.checkpoint)!.values;
      let wrong: unknown;
      if (check.operator === 'lengthEquals') wrong = Array.from({ length: (check.value as number) + 1 }, () => []);
      else if (Array.isArray(check.value)) wrong = check.value.length ? [] : [['unexpected']];
      else if (typeof check.value === 'boolean') wrong = !check.value;
      else wrong = 'INDEPENDENT-WRONG-VALUE';
      setPath(values, check.path, wrong);
      expect(failedAssertions(candidate)).toContain(row.id);
    },
  );

  it.each(failedBaseline)('rejects forbidden publication in %s even if other observations match', id => {
    const candidate = examples();
    component(candidate, id).checkpoints.at(-1)!.values.replaceArgs = [[routeA]];
    expect(failedAssertions(candidate)).toContain(id);
  });

  it('detects same-ID retry substitution and pre-ACK router publication as separate failures', () => {
    const candidate = examples();
    component(candidate, 'HBB-COMP-04').checkpoints.at(-1)!.values.saveArgs[1] = [{ reportId: '00000000-0000-4000-8000-000009701412', edits: { title: 'Lakeshore board brief A: reviewed', teamNote: 'Reviewed for the synthetic November committee.', includeEvidence: true } }];
    component(candidate, 'HBB-COMP-02').checkpoints[0].values.replaceArgs = [[routeA]];
    expect(failedAssertions(candidate)).toEqual(expect.arrayContaining(['HBB-COMP-04', 'HBB-COMP-02']));
  });

  it('retains the withdrawn-policy boundary: a requested PDF may complete after editor leave', () => {
    const serialized = JSON.stringify(request());
    expect(serialized).not.toContain('cancel-download');
    expect(literal.componentCases.map(row => row.id)).toEqual(Array.from({ length: 25 }, (_, index) => `HBB-COMP-${String(index + 1).padStart(2, '0')}`));
  });
});

describe('strict raw observation protocol, not candidate-authored verdicts', () => {
  it.each([
    ['missing observation', (v: Observation[]) => { v.pop(); }],
    ['duplicate identity', (v: Observation[]) => { v[1] = v[0]; }],
    ['unknown identity', (v: Observation[]) => { v[0].id = 'CANDIDATE_PASS'; }],
    ['unknown kind', (v: Observation[]) => { Object.assign(v[0], { kind: 'verdict' }); }],
    ['missing checkpoint', (v: Observation[]) => { component(v, 'HBB-COMP-02').checkpoints.pop(); }],
    ['duplicate checkpoint', (v: Observation[]) => { const row = component(v, 'HBB-COMP-02'); row.checkpoints[1] = row.checkpoints[0]; }],
    ['extra checkpoint', (v: Observation[]) => { const row = component(v, 'HBB-COMP-01'); row.checkpoints.push(clone(row.checkpoints[0])); }],
    ['missing raw field', (v: Observation[]) => { Reflect.deleteProperty(component(v, 'HBB-COMP-01').checkpoints[0].values, 'saveArgs'); }],
    ['unknown raw field', (v: Observation[]) => { Object.assign(component(v, 'HBB-COMP-01').checkpoints[0].values, { pass: true }); }],
    ['claimed PASS', (v: Observation[]) => { Object.assign(v[0], { status: 'PASSED' }); }],
    ['claimed native origin', (v: Observation[]) => { Object.assign(v[0], { origin: 'NATIVE_TRUSTED' }); }],
    ['string boolean', (v: Observation[]) => { Object.assign(component(v, 'HBB-COMP-01').checkpoints[0].values, { alertPresent: 'false' }); }],
    ['non-vector call', (v: Observation[]) => { Object.assign(component(v, 'HBB-COMP-01').checkpoints[0].values, { saveArgs: [{}] }); }],
    ['oversized text', (v: Observation[]) => { component(v, 'HBB-COMP-01').checkpoints[0].values.alertText = 'x'.repeat(16385); }],
    ['unbounded calls', (v: Observation[]) => { component(v, 'HBB-COMP-01').checkpoints[0].values.replaceArgs = Array.from({ length: 17 }, () => [routeA]); }],
    ['missing PDF output', (v: Observation[]) => { pdf(v).pages = []; }],
    ['child geometry claim', (v: Observation[]) => { Object.assign(pdf(v), { boundsPassed: true }); }],
    ['nonfinite native width', (v: Observation[]) => { pdf(v).pages[0].items[0].width = Number.NaN; }],
    ['nonfinite native ascent', (v: Observation[]) => { pdf(v).pages[0].items[0].fontAscent = Number.POSITIVE_INFINITY; }],
    ['missing native descent', (v: Observation[]) => { Reflect.deleteProperty(pdf(v).pages[0].items[0], 'fontDescent'); }],
    ['unexpected item field', (v: Observation[]) => { Object.assign(pdf(v).pages[0].items[0], { safe: true }); }],
    ['too many pages', (v: Observation[]) => { pdf(v).pages = Array.from({ length: 13 }, () => clone(pdf(v).pages[0])); }],
  ])('rejects incomplete/forged/malformed values: %s', (_name, mutate) => {
    const candidate = examples(); mutate(candidate);
    expect(() => validateObservedValues(candidate)).toThrow();
    expect(() => assessPilotValues(candidate)).toThrow();
  });

  it.each([null, {}, [], { status: 'PASSED', failed: 8 }, { error: 'missing candidate module' }])('cannot turn setup/missing output into a baseline behavioral failure: %j', value => {
    expect(() => validateObservedValues(value)).toThrow();
    expect(() => assessPilotValues(value)).toThrow();
  });
});

describe('parent-owned literal PDF preservation and painted geometry', () => {
  it('keeps numerical/source literals independent from the subject and checks every original dense row', () => {
    const dense = literal.pdfCases[0];
    expect(dense.oracle.rows).toHaveLength(24);
    expect(dense.oracle.rows[0]).toEqual(['ROW-001', '$35.01', 'SRC-001 record fee:published:2001; document 9701201; reporting date 2026-06-30; published source snapshot only; unchanged original fee evidence and calculation; no current official schedule recheck; END-001', 'Check-001']);
    expect(dense.oracle.rows[23]).toEqual(['ROW-024', '$35.24', 'SRC-024 record fee:published:2024; document 9701224; reporting date 2026-06-30; published source snapshot only; unchanged original fee evidence and calculation; no current official schedule recheck; END-024', 'Check-024']);
    expect(literal.pdfCases[1].oracle.rows).toEqual([['SMALL-001', '$35', 'Compact source one; SMALL-END-001', 'Checked'], ['SMALL-002', '$30', 'Compact source two; SMALL-END-002', 'Checked']]);
  });

  it.each([
    ['source literal removed', 'HBB-PDF-DENSE-ALL-LITERALS', (row: PdfObservation) => { row.pages[0].items.find(item => item.text.startsWith('SRC-001'))!.text = 'redacted'; }],
    ['figure changed', 'HBB-PDF-DENSE-ALL-LITERALS', (row: PdfObservation) => { row.pages[0].items.find(item => item.text === '$35.01')!.text = '$35.99'; }],
    ['duplicate row marker', 'HBB-PDF-DENSE-ROW-ASSOCIATIONS', (row: PdfObservation) => { row.pages[0].items.push(textItem('ROW-001', 500)); }],
    ['source on wrong page', 'HBB-PDF-DENSE-ROW-ASSOCIATIONS', (row: PdfObservation) => { const index = row.pages[0].items.findIndex(item => item.text.startsWith('SRC-001')); row.pages[1].items.push(row.pages[0].items.splice(index, 1)[0]); }],
    ['font shrink below native 8pt tolerance', 'HBB-PDF-DENSE-NATIVE-FONT', (row: PdfObservation) => { const item = row.pages[0].items.find(item => item.text.startsWith('SRC-001'))!; item.height = 7.98; item.transform[0] = 7.98; item.transform[3] = 7.98; }],
    ['right edge crosses content bounds', 'HBB-PDF-DENSE-BOUNDS', (row: PdfObservation) => { row.pages[0].items.find(item => item.text === 'ROW-001')!.transform[4] = 500; }],
    ['overlapping next row', 'HBB-PDF-DENSE-ORDER', (row: PdfObservation) => { const item = row.pages[0].items.find(item => item.text === 'ROW-002')!; item.transform[5] = 792 - 120 - 8 * 0.8; }],
    ['title below subtitle', 'HBB-PDF-DENSE-ORDER', (row: PdfObservation) => { row.pages[0].items[0].transform[5] = 792 - 110 - 8 * 0.8; }],
    ['all rows compressed onto one page', 'HBB-PDF-DENSE-PAGINATION', (row: PdfObservation) => { row.pages = [{ width: 612, height: 792, items: row.pages.flatMap(page => page.items) }]; }],
  ])('rejects %s using raw parser values', (_name, assertionId, mutate) => {
    const candidate = examples(); (mutate as (row: PdfObservation) => void)(pdf(candidate));
    expect(failedAssertions(candidate)).toContain(assertionId);
  });

  it('does not let successful dense geometry conceal a damaged compact control', () => {
    const candidate = examples();
    pdf(candidate, 'HBB-PDF-COMPACT').pages[0].items.find(item => item.text === '$30')!.text = '$35';
    expect(failedAssertions(candidate)).toContain('HBB-PDF-COMPACT-PRESERVATION');
    expect(assessPilotValues(candidate).slice(0, 3).map(row => row.status)).toEqual(['PASSED', 'PASSED', 'PASSED']);
  });
});
