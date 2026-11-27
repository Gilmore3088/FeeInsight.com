/** Product-shaped, deterministic seams. The driver capability is claimed once before source import. */
import React from 'react';

const parse = JSON.parse.bind(JSON), stringify = JSON.stringify.bind(JSON);
const freeze = Object.freeze.bind(Object), push = Function.call.bind(Array.prototype.push);
const shift = Function.call.bind(Array.prototype.shift);
const clone = value => parse(stringify(value));
let claimed = false, current;
const states = [];
function record(state, kind, args) {
  if (!state || state.closed) throw new Error('Seam invoked outside its case');
  if (state.logs[kind].length >= 16) { state.problem = true; throw new Error('Seam call bound exceeded'); }
  const encoded = stringify(args);
  if (typeof encoded !== 'string' || encoded.length > 65536) { state.problem = true; throw new Error('Seam argument bound exceeded'); }
  push(state.logs[kind], parse(encoded));
}
function outcome(value) {
  if (value.kind === 'rejected') return Promise.reject(new Error(value.message));
  return Promise.resolve(value.kind === 'success' ? { success: true, reportId: value.reportId } : { success: false, error: value.error });
}
export function useRouter() { if (!current) throw new Error('Seams not initialized'); return current.router; }
export function useReportBasket() { return freeze([]); }
export async function previewBoardBriefFindings() { return []; }
export function saveBoardBrief(...args) {
  const state = current;
  record(state, 'saveArgs', args);
  if (state.deferred) return new Promise((resolve, reject) => push(state.pending, { resolve, reject }));
  return outcome(shift(state.outcomes) ?? state.defaults.saveOutcome);
}
export function Link({ children, ...props }) { return React.createElement('a', props, children); }
export function ReportOutput({ report }) { return React.createElement('div', { 'data-testid': 'report-preview' }, report.title); }

/** Only the trusted entry driver retains this frozen capability; it is never a stub export. */
export function createSeamControl() {
  if (claimed) throw new Error('Driver capability has already been claimed');
  claimed = true;
  return freeze({
    begin(window, literals, defaults) {
      if (current && !current.closed) throw new Error('Previous seam case is still active');
      const state = { window, literals, defaults: clone(defaults), closed: false, problem: false,
        deferred: false, outcomes: [], pending: [], responses: [], commitHistory: defaults.replaceCommitsHistory,
        logs: Object.fromEntries(['saveArgs', 'replaceArgs', 'fetchArgs', 'createObjectUrlArgs', 'anchorClickArgs', 'revokeArgs'].map(key => [key, []])),
        timers: new Map(), timerId: 0, time: 0, fake: false, restore: [] };
      state.router = freeze({ replace(...args) {
        record(state, 'replaceArgs', args);
        if (state.commitHistory) window.history.replaceState(null, '', args[0]);
      } });
      const replace = (target, key, value) => {
        const descriptor = Object.getOwnPropertyDescriptor(target, key);
        Object.defineProperty(target, key, { configurable: true, writable: true, value });
        push(state.restore, () => descriptor ? Object.defineProperty(target, key, descriptor) : Reflect.deleteProperty(target, key));
      };
      replace(globalThis, 'fetch', async (...args) => {
        record(state, 'fetchArgs', args);
        const response = shift(state.responses);
        if (!response) { state.problem = true; throw new Error('Unconfigured fetch'); }
        return new Response(response.body, { status: response.status });
      });
      replace(globalThis.URL, 'createObjectURL', blob => { record(state, 'createObjectUrlArgs', [{ size: blob.size, type: blob.type }]); return literals.blobUrl; });
      replace(globalThis.URL, 'revokeObjectURL', (...args) => record(state, 'revokeArgs', args));
      replace(window.HTMLAnchorElement.prototype, 'click', function (...args) { record(state, 'anchorClickArgs', args); });
      current = state; push(states, state);
      return undefined;
    },
    configure(step) {
      const state = current;
      if (step.op === 'replace-mode') state.commitHistory = step.commitHistory;
      else if (step.op === 'save-mode') { state.deferred = step.deferred; state.outcomes = clone(step.outcomes); }
      else if (step.op === 'fetch-mode') state.responses = clone(step.responses);
      else throw new Error('Unsupported seam configuration');
    },
    resolve(value) {
      const state = current, pending = shift(state.pending);
      // A route guard may correctly avoid calling the pending action at all.
      if (!pending) return;
      if (value.kind === 'rejected') pending.reject(new Error(value.message));
      else pending.resolve(value.kind === 'success' ? { success: true, reportId: value.reportId } : { success: false, error: value.error });
    },
    fakeTimers() {
      const state = current;
      if (state.fake) throw new Error('Timers already controlled');
      state.fake = true;
      const originalTimeout = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
      const schedule = (fn, delay = 0, ...args) => {
        if (typeof fn !== 'function' || !Number.isFinite(Number(delay)) || state.timers.size >= 32) throw new Error('Unsupported bounded timer');
        const id = ++state.timerId; state.timers.set(id, { at: state.time + Math.max(0, Number(delay)), fn, args }); return id;
      };
      globalThis.setTimeout = schedule; globalThis.clearTimeout = id => state.timers.delete(id);
      push(state.restore, () => { globalThis.setTimeout = originalTimeout; globalThis.clearTimeout = originalClear; });
    },
    advance(milliseconds) {
      const state = current;
      if (!state.fake) throw new Error('Timers not controlled');
      const end = state.time + milliseconds;
      for (let n = 0; n < 64; n++) {
        const next = [...state.timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) { state.time = end; return; }
        state.time = next[1].at; state.timers.delete(next[0]); next[1].fn(...next[1].args);
      }
      throw new Error('Timer callback bound exceeded');
    },
    logs() { return clone(current.logs); },
    end() {
      const state = current;
      for (const restore of state.restore.reverse()) restore();
      state.closed = true;
      if (state.pending.length || state.timers.size || state.problem) throw new Error('Seam case did not settle cleanly');
    },
    finish() { if (states.some(state => !state.closed || state.problem)) throw new Error('Seam inventory incomplete'); },
  });
}
