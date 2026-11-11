import { attachBrowserProtocolObserver, createBrowserProtocolCapture } from './browser-protocol.mjs';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, required, optional = []) => record(value) && Object.keys(value).length >= required.length
  && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const bound = (value, maximum) => Number.isSafeInteger(value) && value > 0 && value <= maximum;
const artifactId = value => (typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x20\x7f]/.test(value))
  || (Number.isSafeInteger(value) && value > 0);
const freeze = value => { if (record(value) || Array.isArray(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const operations = Object.freeze({
  'save-peer-research': Object.freeze({ route: '/api/hamilton/ask', protocol: 'json', effect: 'peer-research' }),
  'save-analysis': Object.freeze({ route: '/api/hamilton/ask', protocol: 'json', effect: 'analysis' }),
  'save-board-brief': Object.freeze({ route: '/pro/reports', protocol: 'next-action', effect: 'board-brief' }),
});
const persistenceFlags = ['beforeExists', 'afterExists', 'ownerMatches', 'institutionMatches', 'semanticMatches'];
const reopenFlags = ['authenticatedActorMatches', 'artifactSubjectMatches', 'shellSubjectMatches', 'semanticMatches', 'freshContext', 'wrongUserDenied'];
const sameScope = (a, b) => ['contextId', 'sessionId', 'frameId', 'documentId'].every(key => a?.[key] === b?.[key]);
const scopeOf = value => Object.fromEntries(['contextId', 'sessionId', 'frameId', 'documentId'].map(key => [key, value[key]]));

/**
 * Separate local action witnesses. Native transport is never rewritten by application outcomes.
 * The caller supplies reviewed test-side comparisons; these cannot establish workflow authority.
 */
export function createBrowserActionsCapture(configuration = {}) {
  const supplied = record(configuration) ? configuration : {};
  const protocol = createBrowserProtocolCapture(supplied);
  const events = [], actions = [], sessions = new Map(), starts = new Map(), sticky = new Set();
  const routes = Array.isArray(supplied.routeTemplates) ? supplied.routeTemplates : [];
  const sameOrigin = value => { try { return new URL(value).origin === supplied.fixtureOrigin; } catch { return false; } };
  const maxEvents = bound(supplied.maxEvents, 10000) ? supplied.maxEvents : 2000;
  const maxActions = supplied.maxActions === undefined ? 20 : bound(supplied.maxActions, 100) ? supplied.maxActions : 20;
  let closed = false, truncated = false, protocolCursor = 0, pending = null;
  const append = (kind, fields = {}) => {
    if (events.length >= maxEvents) { truncated = true; sticky.add('overflow'); return null; }
    const event = freeze({ ordinal: events.length + 1, kind, ...fields }); events.push(event); return event.ordinal;
  };
  const problem = reason => { sticky.add(reason); append('incomplete', { reason }); };
  if (!exact(configuration, ['fixtureOrigin', 'routeTemplates'], ['protocolVersion', 'maxEvents', 'maxRequests', 'maxActions'])
    || (supplied.maxActions !== undefined && !bound(supplied.maxActions, 100))) problem('invalid_configuration');
  const sync = () => {
    const snapshot = protocol.snapshot();
    const added = snapshot.events.slice(protocolCursor); protocolCursor = snapshot.events.length;
    for (const event of added) {
      const ordinal = append('protocol_event', { protocolOrdinal: event.ordinal, protocolKind: event.kind });
      if (event.kind === 'request_started') {
        starts.set(event.requestId, ordinal);
        if (pending && pending.uiOrdinal === null && event.method === 'POST' && event.sessionId === pending.scope.sessionId) {
          pending.postIds.push(event.requestId);
        }
      }
    }
    return { snapshot, added };
  };
  sync();
  const active = () => { if (closed) { problem('event_after_finish'); return false; } return true; };
  function registerSession(sessionKey, options) {
    if (!active()) return;
    if (!exact(options, ['contextKey'])) { problem('invalid_session'); return; }
    protocol.registerSession(sessionKey, options);
    const { added } = sync();
    const event = added.find(row => row.kind === 'session_started');
    if (!event || sessions.has(sessionKey)) { problem('invalid_session'); return; }
    sessions.set(sessionKey, { sessionId: event.sessionId, contextId: event.contextId, mainScope: null, mainSameOrigin: false, rootFrame: null, stopped: false, lost: false });
  }
  function ingest(sessionKey, eventName, payload) {
    if (!active()) return;
    protocol.ingest(sessionKey, eventName, payload);
    const { added } = sync(), session = sessions.get(sessionKey);
    if (!session) return;
    if (eventName === 'Observer.stopped') session.stopped = true;
    if (eventName === 'Page.frameTree' && record(payload?.frameTree?.frame)) {
      const root = payload.frameTree.frame;
      if (session.rootFrame !== null && session.rootFrame !== root.id) { problem('scope_changed'); return; }
      session.rootFrame = root.id; session.mainSameOrigin = sameOrigin(root.url);
      // The passive protocol producer seeds the root before its child frames.
      const seeded = added.find(event => event.kind === 'frame_document' && event.sessionId === session.sessionId);
      if (seeded) session.mainScope = scopeOf(seeded);
      else if (!session.mainScope) problem('missing_scope');
    }
    if (eventName === 'Page.frameNavigated' && record(payload?.frame)
      && (payload.frame.id === session.rootFrame || payload.frame.parentId === undefined)) {
      const navigation = added.find(event => event.kind === 'navigation' && event.sessionId === session.sessionId);
      if (navigation) { session.rootFrame = payload.frame.id; session.mainScope = scopeOf(navigation); session.mainSameOrigin = navigation.sameOrigin; }
    }
    if (eventName === 'Page.frameDetached' && payload?.frameId === session.rootFrame) { session.mainScope = null; session.mainSameOrigin = false; }
  }
  function sessionLost(sessionKey) {
    if (!active()) return;
    protocol.sessionLost(sessionKey); sync();
    const session = sessions.get(sessionKey); if (session) session.lost = true;
    problem('session_lost');
  }
  function beginAction(spec) {
    if (!active()) return null;
    if (!exact(spec, ['operation', 'sessionKey', 'request', 'effectKind']) || typeof spec.operation !== 'string'
      || !Object.hasOwn(operations, spec.operation) || !exact(spec.request, ['method', 'routeTemplate', 'protocol'])) { problem('invalid_action'); return null; }
    const expected = operations[spec.operation], session = sessions.get(spec.sessionKey);
    if (spec.request.method !== 'POST' || spec.request.routeTemplate !== expected.route || spec.request.protocol !== expected.protocol || spec.effectKind !== expected.effect
      || !routes.includes(expected.route)) { problem('invalid_action'); return null; }
    if (pending !== null) { problem('overlapping_action'); return null; }
    if (!session?.mainScope || !session.mainSameOrigin || session.lost || session.stopped) { problem('missing_scope'); return null; }
    if (actions.length >= maxActions) { problem('overflow'); truncated = true; return null; }
    const action = { actionId: 'action-' + (actions.length + 1), operation: spec.operation, effectKind: expected.effect, expected,
      scope: { ...session.mainScope }, session, postIds: [], artifactId: null, artifactRef: null, uiSuccess: false, persistence: false, reopened: false,
      uiOrdinal: null, persistenceOrdinal: null, reopenOrdinal: null, semanticSha256: null, reasons: new Set() };
    action.beginOrdinal = append('action_started', { actionId: action.actionId, operation: action.operation, effectKind: action.effectKind, ...action.scope });
    actions.push(action); pending = action; return action.actionId;
  }
  const lookup = actionId => {
    if (!active()) return null;
    const action = typeof actionId === 'string' && actionId.length <= 16 ? actions.find(row => row.actionId === actionId) : null;
    if (!action) problem('unknown_action');
    return action;
  };
  const reject = (action, reason) => { action.reasons.add(reason); problem(reason); };
  function observeUiResult(actionId, result) {
    const action = lookup(actionId); if (!action) return;
    if (!exact(result, ['artifactId', 'success']) || !artifactId(result.artifactId) || typeof result.success !== 'boolean') { reject(action, 'invalid_ui_result'); return; }
    if (action.uiOrdinal !== null) { reject(action, 'duplicate_ui_result'); return; }
    action.artifactRef = 'artifact-' + (actions.indexOf(action) + 1);
    action.uiOrdinal = append('ui_result', { actionId: action.actionId, success: result.success, artifactRef: action.artifactRef });
    action.artifactId = result.artifactId; action.uiSuccess = result.success;
    if (!sameScope(action.scope, action.session.mainScope)) reject(action, 'scope_changed');
    if (!result.success) reject(action, 'ui_result_failed');
  }
  function observePersistence(actionId, witness) {
    const action = lookup(actionId); if (!action) return;
    if (!exact(witness, ['artifactId', ...persistenceFlags], ['semanticSha256']) || !artifactId(witness.artifactId)
      || persistenceFlags.some(key => typeof witness[key] !== 'boolean')
      || (witness.semanticSha256 !== undefined && (typeof witness.semanticSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(witness.semanticSha256)))) { reject(action, 'invalid_persistence'); return; }
    if (action.uiOrdinal === null || !action.uiSuccess || action.persistenceOrdinal !== null || action.reopenOrdinal !== null) { reject(action, action.persistenceOrdinal !== null ? 'duplicate_persistence' : 'invalid_order'); return; }
    const matches = Object.is(witness.artifactId, action.artifactId);
    action.persistenceOrdinal = append('persistence', { actionId: action.actionId, artifactRef: action.artifactRef, artifactMatches: matches,
      ...Object.fromEntries(persistenceFlags.map(key => [key, witness[key]])), ...(witness.semanticSha256 ? { semanticSha256: witness.semanticSha256 } : {}) });
    action.persistence = matches && !witness.beforeExists && witness.afterExists && witness.ownerMatches && witness.institutionMatches && witness.semanticMatches;
    action.semanticSha256 = witness.semanticSha256 ?? null;
    if (!action.persistence) reject(action, 'persistence_not_proven');
  }
  function observeReopen(actionId, witness) {
    const action = lookup(actionId); if (!action) return;
    if (!exact(witness, ['artifactId', ...reopenFlags]) || !artifactId(witness.artifactId) || reopenFlags.some(key => typeof witness[key] !== 'boolean')) { reject(action, 'invalid_reopen'); return; }
    if (action.persistenceOrdinal === null || action.reopenOrdinal !== null) { reject(action, action.reopenOrdinal !== null ? 'duplicate_reopen' : 'invalid_order'); return; }
    const matches = Object.is(witness.artifactId, action.artifactId);
    action.reopenOrdinal = append('reopen', { actionId: action.actionId, artifactRef: action.artifactRef, artifactMatches: matches, ...Object.fromEntries(reopenFlags.map(key => [key, witness[key]])) });
    action.reopened = matches && reopenFlags.every(key => witness[key]);
    if (!action.reopened) reject(action, 'reopen_not_proven');
    pending = null;
  }
  function snapshot() {
    const native = protocol.snapshot(), reasons = new Set(sticky);
    // Network completeness remains visible separately. Its failures are never reclassified.
    // Structural loss invalidates action associations even if a saved artifact was later read.
    for (const reason of native.incompleteReasons) if (!['capture_open', 'missing_terminal', 'canceled_transport', 'failed_transport', 'http_error', 'no_requests'].includes(reason)) reasons.add(reason);
    for (const request of native.requests) if (request.method === 'POST' && request.transport !== 'finished') reasons.add('unsettled_post');
    const projected = actions.map(action => {
      const localReasons = new Set(action.reasons);
      const candidates = action.postIds.map(id => native.requests.find(row => row.requestId === id))
        .filter(request => request && sameScope(request, action.scope) && request.routeTemplate === action.expected.route && request.sameOrigin);
      const request = candidates.length === 1 ? candidates[0] : null;
      const association = request && sameScope(request, action.scope) && request.hop === 0 && request.sameOrigin && request.method === 'POST'
        && request.resourceType === 'fetch' && request.routeTemplate === action.expected.route && starts.get(request.requestId) > action.beginOrdinal
        && action.uiOrdinal !== null && starts.get(request.requestId) < action.uiOrdinal ? 'exactly_one' : 'unknown';
      if (association === 'unknown') localReasons.add('ambiguous_association');
      const responseMatches = request?.responseStatus === 200 && request.responseUrlMatchesRequest === true
        && request.responseMimeClass === (action.expected.protocol === 'json' ? 'json' : 'rsc')
        && request.nextAction === (action.expected.protocol === 'next-action');
      const settled = association === 'exactly_one' && responseMatches && request.transport === 'finished' && action.uiSuccess;
      if (!settled) localReasons.add('settlement_not_proven');
      if (!action.persistence) localReasons.add('persistence_not_proven');
      if (!action.reopened) localReasons.add('reopen_not_proven');
      const complete = localReasons.size === 0;
      for (const reason of localReasons) reasons.add(reason);
      return { actionId: action.actionId, operation: action.operation, effectKind: action.effectKind, artifactRef: action.artifactRef,
        requestId: association === 'exactly_one' ? request.requestId : null, association, transport: request?.transport ?? 'unknown',
        actionSettlement: settled ? 'observed' : 'unknown', persistedEffect: action.persistence ? 'observed' : 'unknown', reopen: action.reopened ? 'observed' : 'unknown', complete,
        beginOrdinal: action.beginOrdinal, uiOrdinal: action.uiOrdinal, persistenceOrdinal: action.persistenceOrdinal, reopenOrdinal: action.reopenOrdinal,
        semanticSha256: action.semanticSha256, incompleteReasons: [...localReasons] };
    });
    if (!actions.length) reasons.add('no_actions');
    if (!closed) reasons.add('capture_open');
    return freeze({ schemaVersion: 1, authority: 'LOCAL_UNTRUSTED', status: reasons.size ? 'BLOCKED' : 'LOCAL_ACTIONS_UNTRUSTED', complete: reasons.size === 0, closed, truncated: truncated || native.truncated,
      events: [...events], actions: projected, protocol: native, incompleteReasons: [...reasons] });
  }
  return { registerSession, ingest, sessionLost, beginAction, observeUiResult, observePersistence, observeReopen, snapshot, finish() {
    if (!closed) { protocol.finish(); sync(); append('capture_finished'); closed = true; for (const session of sessions.values()) session.rootFrame = null; sessions.clear(); for (const action of actions) action.artifactId = null; }
    return snapshot();
  } };
}

/** Compose the existing metadata-only observer; no application traffic is wrapped or consumed. */
export function attachBrowserActionsObserver(session, capture, options) {
  return attachBrowserProtocolObserver(session, capture, options);
}
