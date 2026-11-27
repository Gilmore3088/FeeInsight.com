/** Isolated production-value driver. No assertion, expected answer, credentials, or fixture file. */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createSeamControl } from './board-brief-seams.mjs';
import { readInput, writeOutput, validateSourceRequest } from './board-brief-protocol.mjs';

const tool = createRequire('/toolchain/package.json');
const React = tool('react');
const control = createSeamControl();
const sourceRoot = process.env.CODE_ROOT;
const phase = process.env.HAMILTON_PHASE;
const originalDate = globalThis.Date;
function pinClock(iso) {
  const milliseconds = originalDate.parse(iso);
  globalThis.Date = class extends originalDate {
    constructor(...args) { super(...(args.length ? args : [milliseconds])); }
    static now() { return milliseconds; }
  };
}
async function components(request) {
  const { JSDOM } = tool('jsdom');
  const result = [];
  let testing;
  for (const row of request.cases.filter(row => row.kind === 'component')) {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://fixture.test' + request.defaults.initialUrl });
    for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLAnchorElement', 'MouseEvent', 'Event', 'Node', 'URL']) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? dom.window : dom.window[key] });
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    testing ??= tool('@testing-library/react/pure');
    const { render, cleanup, fireEvent, act, getQueriesForElement } = testing;
    control.begin(dom.window, request.literals, request.defaults);
    let view, BoardBriefEditor, primary;
    const query = () => getQueriesForElement(document.body);
    const checkpoints = [];
    const mount = props => { view = render(React.createElement(BoardBriefEditor, props)); };
    const click = label => fireEvent.click(query().getByRole('button', { name: label }));
    const snapshot = () => {
      const q = query(), title = q.queryByLabelText('Title'), note = q.queryByLabelText(/^Team note/), save = q.queryByRole('button', { name: 'Save brief' }), download = q.queryByRole('button', { name: 'Download PDF' }), status = q.queryByRole('status'), alert = q.queryByRole('alert');
      return { pathnameSearch: window.location.pathname + window.location.search, statusText: status?.textContent ?? null, alertText: alert?.textContent ?? null, alertPresent: alert !== null,
        titleValue: title?.value ?? null, noteValue: note?.value ?? null, titleDisabled: title ? title.disabled : null,
        saveDisabled: save ? save.disabled : null, downloadDisabled: download ? download.disabled : null, ...control.logs() };
    };
    try {
      ({ BoardBriefEditor } = await import(pathToFileURL(join(sourceRoot, 'src/components/hamilton/reports/BoardBriefEditor.tsx')).href));
      for (const step of row.steps) {
        switch (step.op) {
          case 'history': window.history.replaceState(null, '', step.url); break;
          case 'replace-mode': case 'save-mode': case 'fetch-mode': control.configure(step); break;
          case 'fake-timers': control.fakeTimers(); break;
          case 'mount-reportA': mount({ key: request.literals.A, initialReport: request.literals.report, reportId: request.literals.A }); break;
          case 'mount-analysis': mount({ analysis: request.literals.analysis, analysisId: request.literals.ANALYSIS }); break;
          case 'edit':
            if (Object.hasOwn(step, 'title')) fireEvent.change(query().getByLabelText('Title'), { target: { value: step.title } });
            if (Object.hasOwn(step, 'teamNote')) fireEvent.change(query().getByLabelText(/^Team note/), { target: { value: step.teamNote } });
            break;
          case 'click-save': case 'click-download': {
            const run = () => click(step.op === 'click-save' ? 'Save brief' : 'Download PDF');
            if (step.settle) await act(async () => { run(); }); else run();
            break;
          }
          case 'dispatch-double-save': act(() => { const button = query().getByRole('button', { name: 'Save brief' }); button.dispatchEvent(new MouseEvent('click', { bubbles: true })); button.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); break;
          case 'unmount': if (!view) throw new Error('No mounted editor'); view.unmount(); break;
          case 'keyed-reportB': if (!view) throw new Error('No mounted editor'); view.rerender(React.createElement(BoardBriefEditor, { key: request.literals.B, initialReport: request.literals.otherReport, reportId: request.literals.B })); break;
          case 'resolve-save': await act(async () => { control.resolve(step.outcome); }); break;
          case 'advance-timers': await act(async () => { control.advance(step.milliseconds); }); break;
          case 'checkpoint': checkpoints.push({ name: step.name, values: snapshot() }); break;
          default: throw new Error('Unsupported finite driver step');
        }
      }
      result.push({ id: row.id, kind: 'component', checkpoints });
    } catch (error) { primary = error; }
    const cleanupErrors = [];
    for (const close of [cleanup, () => control.end(), () => dom.window.close()]) {
      try { close(); } catch (error) { cleanupErrors.push(error); }
    }
    if (primary) throw primary;
    if (cleanupErrors.length) throw cleanupErrors[0];
  }
  control.finish(); return result;
}
async function renderPdfs(request) {
  const { renderToBuffer } = tool('@react-pdf/renderer');
  const { PdfDocument } = await import(pathToFileURL(join(sourceRoot, 'src/components/hamilton/reports/PdfDocument.tsx')).href);
  const values = [];
  for (const row of request.cases.filter(row => row.kind === 'pdf')) {
    const bytes = await renderToBuffer(React.createElement(PdfDocument, { report: row.report, reportType: 'board_brief' }));
    if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new Error('Rendered PDF exceeds bound');
    values.push({ id: row.id, kind: 'pdf-bytes', base64: bytes.toString('base64') });
  }
  return values;
}
async function main() {
  const request = await readInput(); validateSourceRequest(request); pinClock(request.clockIso);
  if (!['component', 'pdf-render'].includes(phase)) throw new Error('Unsupported source phase');
  writeOutput({ schema_version: 1, cases: phase === 'component' ? await components(request) : await renderPdfs(request) });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { process.stderr.write('SETUP_FAILURE: ' + String(error?.message ?? 'Source driver failed').slice(0, 1024) + '\n'); process.exitCode = 1; });
