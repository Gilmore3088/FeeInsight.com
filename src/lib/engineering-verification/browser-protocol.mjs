/** Passive local metadata only: transport does not establish action settlement or effects. */
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const nativeId = value => typeof value === 'string' && value.length > 0 && value.length <= 2048 && !/[\x00-\x1f\x7f]/.test(value);
const identityKey = value => nativeId(value) || record(value);
const localId = (value, kind) => {
  if (typeof value !== 'string' || value.length > 32 || !value.startsWith(kind + '-')) return false;
  const counter = value.slice(kind.length + 1);
  return /^[1-9][0-9]{0,4}$/.test(counter) && Number(counter) <= (kind === 'request' ? 2000 : 10000);
};
const freeze = value => { if (record(value) || Array.isArray(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE']);
const resourceTypes = new Set(['document', 'stylesheet', 'image', 'media', 'font', 'script', 'texttrack', 'xhr', 'fetch', 'prefetch', 'eventsource', 'websocket', 'manifest', 'signedexchange', 'ping', 'cspviolationreport', 'preflight', 'other']);
const mimeClasses = new Set(['rsc', 'html', 'json', 'other', 'unknown']);
const blockedReasons = new Set(['none', 'unknown', 'other', 'csp', 'mixed-content', 'origin', 'inspector', 'integrity', 'subresource-filter', 'content-type', 'coep-frame-resource-needs-coep-header', 'coop-sandboxed-iframe-cannot-navigate-to-coop-page', 'corp-not-same-origin', 'corp-not-same-origin-after-defaulted-to-same-origin-by-coep', 'corp-not-same-origin-after-defaulted-to-same-origin-by-dip', 'corp-not-same-origin-after-defaulted-to-same-origin-by-coep-and-dip', 'corp-not-same-site', 'sri-message-signature-mismatch']);
const corsErrors = new Set(['none', 'unknown', 'DisallowedByMode', 'InvalidResponse', 'WildcardOriginNotAllowed', 'MissingAllowOriginHeader', 'MultipleAllowOriginValues', 'InvalidAllowOriginValue', 'AllowOriginMismatch', 'InvalidAllowCredentials', 'CorsDisabledScheme', 'PreflightInvalidStatus', 'PreflightDisallowedRedirect', 'PreflightWildcardOriginNotAllowed', 'PreflightMissingAllowOriginHeader', 'PreflightMultipleAllowOriginValues', 'PreflightInvalidAllowOriginValue', 'PreflightAllowOriginMismatch', 'PreflightInvalidAllowCredentials', 'PreflightMissingAllowExternal', 'PreflightInvalidAllowExternal', 'InvalidAllowMethodsPreflightResponse', 'InvalidAllowHeadersPreflightResponse', 'MethodDisallowedByPreflightResponse', 'HeaderDisallowedByPreflightResponse', 'RedirectContainsCredentials', 'InsecureLocalNetwork', 'InvalidLocalNetworkAccess', 'NoCorsRedirectModeNotFollow', 'LocalNetworkAccessPermissionDenied']);
const reasonCodes = new Set(['invalid_configuration', 'invalid_event', 'invalid_order', 'unknown_session', 'session_lost', 'frame_lost', 'unknown_request', 'ambiguous_request', 'identity_mismatch', 'duplicate_response', 'duplicate_terminal', 'missing_response', 'missing_terminal', 'invalid_redirect', 'invalid_navigation', 'unsupported_protocol_value', 'overflow', 'event_after_finish', 'capture_open', 'unknown_protocol_version', 'setup_failed', 'canceled_transport', 'failed_transport', 'http_error', 'no_requests']);
const template = value => typeof value === 'string' && value.length <= 256 && (value === '/' || /^\/(?:[a-z0-9-]+|\[[a-z][a-z0-9_-]*\])(?:\/(?:[a-z0-9-]+|\[[a-z][a-z0-9_-]*\]))*\/?$/.test(value));
const scopeKeys = ['contextId', 'sessionId', 'frameId', 'documentId'];
const requestKeys = ['requestId', ...scopeKeys];
const schemas = {
  capture_started: ['protocolVersion', 'routeTemplates'],
  session_started: ['contextId', 'sessionId'], session_stopped: ['contextId', 'sessionId'], session_lost: ['contextId', 'sessionId'],
  frame_document: scopeKeys, frame_lost: ['contextId', 'sessionId', 'frameId'],
  navigation: ['navigationId', ...scopeKeys, 'navigationKind', 'routeTemplate', 'sameOrigin'],
  request_started: [...requestKeys, 'hop', 'method', 'routeTemplate', 'resourceType', 'sameOrigin', 'rsc', 'routerPrefetch', 'nextAction'],
  response_received: [...requestKeys, 'responseStatus', 'responseMimeClass', 'responseUrlMatchesRequest'],
  request_terminal: [...requestKeys, 'terminal', 'redirectToRequestId', 'canceled', 'netError', 'blockedReason', 'corsError'],
  incomplete: ['reason'], capture_finished: [],
};
function validField(key, value, routes) {
  if (key === 'protocolVersion') return ['1.3', 'unknown'].includes(value);
  if (key === 'routeTemplates') return Array.isArray(value) && value.length <= 500 && value.every(template) && new Set(value).size === value.length;
  if (key === 'redirectToRequestId') return value === null || localId(value, 'request');
  if (key.endsWith('Id')) return localId(value, key.slice(0, -2));
  if (['sameOrigin', 'rsc', 'routerPrefetch', 'nextAction', 'canceled', 'responseUrlMatchesRequest'].includes(key)) return typeof value === 'boolean';
  if (key === 'hop') return integer(value) && value < 2000;
  if (key === 'method') return methods.has(value);
  if (key === 'routeTemplate') return value === '[unmapped]' || routes.has(value);
  if (key === 'resourceType') return resourceTypes.has(value);
  if (key === 'responseStatus') return integer(value) && value >= 100 && value <= 599;
  if (key === 'responseMimeClass') return mimeClasses.has(value);
  if (key === 'navigationKind') return ['document', 'same_document'].includes(value);
  if (key === 'terminal') return ['finished', 'canceled', 'failed', 'redirect'].includes(value);
  if (key === 'netError') return ['aborted', 'other', 'unknown'].includes(value);
  if (key === 'blockedReason') return blockedReasons.has(value);
  if (key === 'corsError') return corsErrors.has(value);
  return key === 'reason' && reasonCodes.has(value);
}
function validTerminal(event) {
  if (event.terminal === 'finished' || event.terminal === 'redirect') {
    return event.canceled === false && event.netError === 'unknown' && event.blockedReason === 'none' && event.corsError === 'none'
      && (event.terminal === 'redirect' ? event.redirectToRequestId !== null : event.redirectToRequestId === null);
  }
  return event.canceled === (event.terminal === 'canceled') && event.netError !== 'unknown' && event.redirectToRequestId === null;
}

/** Pure safe-log replay. This can never mint authenticated workflow or whole-browser authority. */
export function reduceBrowserProtocolCapture(events, { incompleteReasons = [], truncated = false } = {}) {
  const reasons = new Set(), safeEvents = [], requests = new Map(), navigations = [], sessions = new Map(), documents = new Map(), invalidated = new Set();
  const definedSessions = new Set(), definedNavigations = new Set(), frameScopes = new Map();
  let routes = new Set(), previousOrdinal = 0, closed = false, started = false, protocolVersion = 'unknown';
  if (!Array.isArray(events) || events.length > 10000) { events = []; reasons.add('invalid_event'); }
  if (Array.isArray(incompleteReasons)) for (const reason of incompleteReasons) reasons.add(reasonCodes.has(reason) ? reason : 'invalid_event');
  else reasons.add('invalid_event');
  if (truncated) reasons.add('overflow');
  const sameScope = (a, b) => scopeKeys.every(key => a[key] === b[key]);
  for (const raw of events) {
    const keys = record(raw) && typeof raw.kind === 'string' && Object.hasOwn(schemas, raw.kind) && schemas[raw.kind];
    if (!keys || !integer(raw.ordinal) || raw.ordinal !== previousOrdinal + 1) { reasons.add('invalid_event'); continue; }
    previousOrdinal = raw.ordinal;
    if (Object.keys(raw).length !== keys.length + 2 || keys.some(key => !validField(key, raw[key], routes))) { reasons.add('invalid_event'); continue; }
    const event = { ordinal: raw.ordinal, kind: raw.kind };
    for (const key of keys) event[key] = Array.isArray(raw[key]) ? [...raw[key]] : raw[key];
    safeEvents.push(event);
    if (closed && event.kind !== 'incomplete') { reasons.add('event_after_finish'); continue; }
    if (event.kind === 'capture_started') {
      if (started || event.ordinal !== 1) { reasons.add('invalid_order'); continue; }
      started = true; protocolVersion = event.protocolVersion; routes = new Set(event.routeTemplates); continue;
    }
    if (!started) { reasons.add('invalid_order'); continue; }
    if (event.kind === 'incomplete') { reasons.add(event.reason); continue; }
    if (event.kind === 'capture_finished') { closed = true; continue; }
    if (event.kind === 'session_started') {
      if (definedSessions.has(event.sessionId)) reasons.add('invalid_order');
      else { definedSessions.add(event.sessionId); sessions.set(event.sessionId, event.contextId); }
      continue;
    }
    if (sessions.get(event.sessionId) !== event.contextId) { reasons.add('unknown_session'); continue; }
    if (event.kind === 'session_lost' || event.kind === 'frame_lost') {
      reasons.add(event.kind);
      for (const row of requests.values()) if (row.sessionId === event.sessionId && (event.kind === 'session_lost' || row.frameId === event.frameId) && row.terminal === 'unknown') invalidated.add(row.requestId);
      if (event.kind === 'session_lost') sessions.delete(event.sessionId);
      continue;
    }
    if (event.kind === 'session_stopped') { sessions.delete(event.sessionId); continue; }
    if (event.kind === 'frame_document') {
      const frameScope = frameScopes.get(event.frameId);
      if (documents.has(event.documentId) || (frameScope && (frameScope.sessionId !== event.sessionId || frameScope.contextId !== event.contextId))) { reasons.add('invalid_order'); continue; }
      frameScopes.set(event.frameId, { sessionId: event.sessionId, contextId: event.contextId });
      documents.set(event.documentId, { ...event }); continue;
    }
    if (!sameScope(event, documents.get(event.documentId) ?? {})) { reasons.add('identity_mismatch'); continue; }
    if (event.kind === 'navigation') {
      if (definedNavigations.has(event.navigationId)) { reasons.add('invalid_order'); continue; }
      definedNavigations.add(event.navigationId);
      navigations.push({ navigationId: event.navigationId, ordinal: event.ordinal, kind: event.navigationKind, ...Object.fromEntries(scopeKeys.map(key => [key, event[key]])), routeTemplate: event.routeTemplate, sameOrigin: event.sameOrigin }); continue;
    }
    if (event.kind === 'request_started') {
      if (requests.has(event.requestId) || requests.size >= 2000) { reasons.add('invalid_order'); continue; }
      requests.set(event.requestId, { ...Object.fromEntries(requestKeys.map(key => [key, event[key]])), hop: event.hop, method: event.method,
        routeTemplate: event.routeTemplate, resourceType: event.resourceType, sameOrigin: event.sameOrigin, rsc: event.rsc, routerPrefetch: event.routerPrefetch, nextAction: event.nextAction,
        responseStatus: null, responseMimeClass: 'unknown', responseUrlMatchesRequest: null, startOrdinal: event.ordinal, responseOrdinal: null, terminalOrdinal: null,
        terminal: 'unknown', transport: 'unknown', redirectToRequestId: null, navigation: 'unknown', actionSettlement: 'unknown', effect: 'unknown', canceled: false, netError: 'unknown', blockedReason: 'none', corsError: 'none' }); continue;
    }
    const row = requests.get(event.requestId);
    if (!row || !sameScope(row, event)) { reasons.add('unknown_request'); continue; }
    if (invalidated.has(row.requestId)) { reasons.add('identity_mismatch'); continue; }
    if (event.kind === 'response_received') {
      if (row.responseOrdinal !== null || row.terminal !== 'unknown') { reasons.add('duplicate_response'); continue; }
      row.responseOrdinal = event.ordinal; row.responseStatus = event.responseStatus; row.responseMimeClass = event.responseMimeClass; row.responseUrlMatchesRequest = event.responseUrlMatchesRequest;
      if (!event.responseUrlMatchesRequest) reasons.add('identity_mismatch');
    } else if (event.kind === 'request_terminal') {
      if (!validTerminal(event)) { reasons.add('invalid_event'); continue; }
      if (row.terminal !== 'unknown') { reasons.add('duplicate_terminal'); continue; }
      if (['finished', 'redirect'].includes(event.terminal) && row.responseOrdinal === null) { reasons.add('missing_response'); continue; }
      Object.assign(row, { terminal: event.terminal, transport: event.terminal === 'redirect' ? 'unknown' : event.terminal, terminalOrdinal: event.ordinal,
        redirectToRequestId: event.redirectToRequestId, canceled: event.canceled, netError: event.netError, blockedReason: event.blockedReason, corsError: event.corsError });
    }
  }
  const redirectPredecessors = new Map();
  for (const row of requests.values()) {
    if (row.terminal === 'unknown') reasons.add('missing_terminal');
    if (row.transport === 'canceled') reasons.add('canceled_transport');
    if (row.transport === 'failed') reasons.add('failed_transport');
    if (row.responseStatus >= 400) reasons.add('http_error');
    if (row.terminal === 'redirect') {
      const next = requests.get(row.redirectToRequestId);
      if (!next || !sameScope(next, row) || next.hop !== row.hop + 1 || next.startOrdinal <= row.terminalOrdinal || row.responseStatus < 300 || row.responseStatus >= 400) reasons.add('invalid_redirect');
      else redirectPredecessors.set(next.requestId, (redirectPredecessors.get(next.requestId) ?? 0) + 1);
    }
  }
  for (const row of requests.values()) if ((redirectPredecessors.get(row.requestId) ?? 0) !== (row.hop === 0 ? 0 : 1)) reasons.add('invalid_redirect');
  if (!requests.size) reasons.add('no_requests');
  if (!closed) reasons.add('capture_open');
  if (protocolVersion !== '1.3') reasons.add('unknown_protocol_version');
  return freeze({ schemaVersion: 1, protocolVersion, completenessScope: 'registered_cdp_sessions', unobservedTargets: 'unknown', status: reasons.size ? 'BLOCKED' : 'LOCAL_PROTOCOL_UNTRUSTED', complete: reasons.size === 0, closed,
    truncated: Boolean(truncated), events: safeEvents, requests: [...requests.values()], navigations, incompleteReasons: [...reasons] });
}

export function createBrowserProtocolCapture(options = {}) {
  const events = [], sticky = new Set(), contexts = new Map(), sessions = new Map();
  const counts = { context: 0, session: 0, frame: 0, document: 0, request: 0, navigation: 0 };
  let closed = false, truncated = false, origin = null;
  if (!record(options)) { options = {}; sticky.add('invalid_configuration'); }
  const protocolVersion = options.protocolVersion === '1.3' ? '1.3' : 'unknown';
  const routeTemplates = Array.isArray(options.routeTemplates) ? [...new Set(options.routeTemplates.filter(template))] : [];
  const maxEvents = integer(options.maxEvents) && options.maxEvents > 0 && options.maxEvents <= 10000 ? options.maxEvents : 2000;
  const maxRequests = integer(options.maxRequests) && options.maxRequests > 0 && options.maxRequests <= 2000 ? options.maxRequests : 500;
  try {
    const url = new URL(options.fixtureOrigin);
    if (url.origin !== options.fixtureOrigin || url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || !Array.isArray(options.routeTemplates) || routeTemplates.length !== options.routeTemplates.length || routeTemplates.length > 500
      || (options.maxEvents !== undefined && maxEvents !== options.maxEvents) || (options.maxRequests !== undefined && maxRequests !== options.maxRequests)) throw new Error();
    origin = url.origin;
  } catch { sticky.add('invalid_configuration'); }
  const id = kind => kind + '-' + ++counts[kind];
  const append = (kind, fields = {}) => {
    if (events.length >= maxEvents) { truncated = true; sticky.add('overflow'); return; }
    events.push(freeze({ ordinal: events.length + 1, kind, ...fields }));
  };
  append('capture_started', { protocolVersion, routeTemplates });
  // A replay must retain construction failures, not just the live controller's metadata.
  for (const reason of [...sticky]) append('incomplete', { reason });
  const problem = reason => { sticky.add(reason); append('incomplete', { reason }); };
  const scope = (session, frame, documentId) => ({ contextId: session.contextId, sessionId: session.sessionId, frameId: frame.frameId, documentId });
  const urlInfo = value => {
    if (typeof value !== 'string' || value.length > 8192) throw new Error();
    const url = new URL(value), sameOrigin = url.origin === origin;
    const matches = sameOrigin ? routeTemplates.filter(route => {
      const parts = route.split('/'), path = url.pathname.split('/');
      return parts.length === path.length && parts.every((part, index) => /^\[[a-z][a-z0-9_-]*\]$/.test(part) ? path[index].length > 0 : part === path[index]);
    }) : [];
    if (matches.length > 1) problem('identity_mismatch');
    return { routeTemplate: matches.length === 1 ? matches[0] : '[unmapped]', sameOrigin, raw: url.href };
  };
  const frameFor = (session, nativeFrame) => {
    if (!nativeId(nativeFrame)) throw new Error();
    let frame = session.frames.get(nativeFrame);
    if (!frame) {
      if (counts.frame >= maxEvents) { problem('overflow'); return null; }
      frame = { frameId: id('frame'), documents: new Map(), currentDocument: null }; session.frames.set(nativeFrame, frame);
    }
    return frame;
  };
  const documentFor = (session, frame, loader) => {
    if (!frame || !nativeId(loader)) throw new Error();
    let documentId = frame.documents.get(loader);
    if (!documentId) {
      if (counts.document >= maxEvents) { problem('overflow'); return null; }
      documentId = id('document'); frame.documents.set(loader, documentId); append('frame_document', scope(session, frame, documentId));
    }
    return documentId;
  };
  const headers = value => {
    if (!record(value) || Object.keys(value).length > 1000) throw new Error();
    const values = new Map();
    for (const name of Object.keys(value)) if (['rsc', 'next-router-prefetch', 'next-action'].includes(name.toLowerCase())) {
      const key = name.toLowerCase();
      if (values.has(key) || typeof value[name] !== 'string') problem('unsupported_protocol_value');
      else values.set(key, value[name]);
    }
    return { rsc: values.get('rsc') === '1', routerPrefetch: values.get('next-router-prefetch') === '1', nextAction: typeof values.get('next-action') === 'string' && values.get('next-action').length > 0 };
  };
  const responseFields = (entry, response) => {
    if (!record(response) || !integer(response.status) || response.status < 100 || response.status > 599 || typeof response.mimeType !== 'string') throw new Error();
    const responseUrlMatchesRequest = urlInfo(response.url).raw === entry.rawUrl;
    if (!responseUrlMatchesRequest) { entry.ambiguous = true; problem('identity_mismatch'); return null; }
    const mime = response.mimeType.toLowerCase().split(';')[0].trim();
    return { responseStatus: response.status, responseMimeClass: mime === 'text/x-component' ? 'rsc' : ['text/html', 'application/xhtml+xml'].includes(mime) ? 'html' : mime === 'application/json' || mime.endsWith('+json') ? 'json' : mime ? 'other' : 'unknown', responseUrlMatchesRequest };
  };
  const responseTo = (entry, fields) => {
    if (!fields || entry.ambiguous) return;
    if (entry.responded || entry.terminal) { entry.ambiguous = true; problem('duplicate_response'); return; }
    entry.responded = true; append('response_received', { requestId: entry.requestId, ...entry.scope, ...fields });
  };
  const terminalTo = (entry, terminal, fields = {}) => {
    if (entry.ambiguous) { problem('ambiguous_request'); return; }
    if (entry.terminal) { problem('duplicate_terminal'); return; }
    if (['finished', 'redirect'].includes(terminal) && !entry.responded) { problem('missing_response'); return; }
    entry.terminal = terminal;
    append('request_terminal', { requestId: entry.requestId, ...entry.scope, terminal, redirectToRequestId: null, canceled: false, netError: 'unknown', blockedReason: 'none', corsError: 'none', ...fields });
  };
  const nativeEnum = (value, allowed) => { if (value === undefined) return 'none'; if (allowed.has(value) && value !== 'none' && value !== 'unknown') return value; problem('unsupported_protocol_value'); return 'unknown'; };
  function registerSession(sessionKey, { contextKey } = {}) {
    if (closed) { problem('event_after_finish'); return; }
    if (!identityKey(sessionKey) || !identityKey(contextKey)) { problem('invalid_event'); return; }
    if (sessions.has(sessionKey)) { problem('ambiguous_request'); return; }
    if (sessions.size >= maxEvents || contexts.size >= maxEvents) { problem('overflow'); return; }
    let contextId = contexts.get(contextKey);
    if (!contextId) { contextId = id('context'); contexts.set(contextKey, contextId); }
    const session = { contextId, sessionId: id('session'), frames: new Map(), requests: new Map(), lost: false, stopped: false };
    sessions.set(sessionKey, session); append('session_started', { contextId, sessionId: session.sessionId });
  }
  function sessionLost(sessionKey) {
    if (closed) { problem('event_after_finish'); return; }
    const session = sessions.get(sessionKey);
    if (!session || session.lost || session.stopped) { problem('unknown_session'); return; }
    session.lost = true;
    for (const entry of session.requests.values()) if (!entry.terminal) entry.ambiguous = true;
    append('session_lost', { contextId: session.contextId, sessionId: session.sessionId });
  }
  function ingest(sessionKey, eventName, payload) {
    if (closed) { problem('event_after_finish'); return; }
    const session = sessions.get(sessionKey);
    if (!session || session.lost || session.stopped) { problem('unknown_session'); return; }
    if (truncated) return;
    try {
      if (!record(payload)) throw new Error();
      if (eventName === 'Observer.setupFailed') { problem('setup_failed'); return; }
      if (eventName === 'Observer.stopped') { session.stopped = true; append('session_stopped', { contextId: session.contextId, sessionId: session.sessionId }); return; }
      if (protocolVersion !== '1.3') { problem('unknown_protocol_version'); return; }
      if (eventName === 'Page.frameTree') {
        let count = 0;
        const seed = (tree, depth) => {
          if (!record(tree) || !record(tree.frame) || depth > 32 || ++count > maxEvents) throw new Error();
          const frame = frameFor(session, tree.frame.id), documentId = documentFor(session, frame, tree.frame.loaderId);
          if (frame && documentId) frame.currentDocument = documentId;
          if (tree.childFrames !== undefined) { if (!Array.isArray(tree.childFrames)) throw new Error(); for (const child of tree.childFrames) seed(child, depth + 1); }
        };
        seed(payload.frameTree, 0); return;
      }
      if (eventName === 'Page.frameNavigated') {
        if (!record(payload.frame) || !['Navigation', 'BackForwardCacheRestore'].includes(payload.type)) throw new Error();
        const frame = frameFor(session, payload.frame.id), documentId = documentFor(session, frame, payload.frame.loaderId);
        if (!frame || !documentId) return;
        frame.currentDocument = documentId;
        const info = urlInfo(payload.frame.url);
        append('navigation', { navigationId: id('navigation'), ...scope(session, frame, documentId), navigationKind: 'document', routeTemplate: info.routeTemplate, sameOrigin: info.sameOrigin }); return;
      }
      if (eventName === 'Page.navigatedWithinDocument') {
        const frame = session.frames.get(payload.frameId);
        if (!frame?.currentDocument || !['fragment', 'historyApi', 'other'].includes(payload.navigationType)) { problem('invalid_navigation'); return; }
        const info = urlInfo(payload.url);
        append('navigation', { navigationId: id('navigation'), ...scope(session, frame, frame.currentDocument), navigationKind: 'same_document', routeTemplate: info.routeTemplate, sameOrigin: info.sameOrigin }); return;
      }
      if (eventName === 'Page.frameDetached') {
        const frame = session.frames.get(payload.frameId);
        if (!frame || !['remove', 'swap'].includes(payload.reason)) throw new Error();
        for (const entry of session.requests.values()) if (entry.scope.frameId === frame.frameId && !entry.terminal) entry.ambiguous = true;
        append('frame_lost', { contextId: session.contextId, sessionId: session.sessionId, frameId: frame.frameId }); session.frames.delete(payload.frameId); return;
      }
      if (!nativeId(payload.requestId)) throw new Error();
      const previous = session.requests.get(payload.requestId);
      if (eventName === 'Network.requestWillBeSent') {
        if (!record(payload.request) || !methods.has(payload.request.method) || typeof payload.type !== 'string' || !resourceTypes.has(payload.type.toLowerCase())) throw new Error();
        if (counts.request >= maxRequests) { problem('overflow'); truncated = true; return; }
        const frame = frameFor(session, payload.frameId), documentId = documentFor(session, frame, payload.loaderId);
        if (!frame || !documentId) return;
        const info = urlInfo(payload.request.url), requestScope = scope(session, frame, documentId), requestId = id('request');
        let hop = 0;
        if (previous) {
          if (!record(payload.redirectResponse) || previous.terminal || previous.ambiguous || previous.nativeFrame !== payload.frameId || previous.nativeLoader !== payload.loaderId) { previous.ambiguous = true; problem('ambiguous_request'); return; }
          const fields = responseFields(previous, payload.redirectResponse);
          if (!fields || fields.responseStatus < 300 || fields.responseStatus >= 400) { previous.ambiguous = true; problem('invalid_redirect'); return; }
          responseTo(previous, fields); terminalTo(previous, 'redirect', { redirectToRequestId: requestId }); hop = previous.hop + 1;
        } else if (payload.redirectResponse !== undefined) { problem('invalid_redirect'); return; }
        const entry = { requestId, scope: requestScope, nativeFrame: payload.frameId, nativeLoader: payload.loaderId, rawUrl: info.raw, hop, responded: false, terminal: null, ambiguous: false };
        session.requests.set(payload.requestId, entry);
        append('request_started', { requestId, ...requestScope, hop, method: payload.request.method, routeTemplate: info.routeTemplate, resourceType: payload.type.toLowerCase(), sameOrigin: info.sameOrigin, ...headers(payload.request.headers) }); return;
      }
      if (!previous) { problem('unknown_request'); return; }
      if (eventName === 'Network.responseReceived') {
        if (payload.frameId !== previous.nativeFrame || payload.loaderId !== previous.nativeLoader) { previous.ambiguous = true; problem('identity_mismatch'); return; }
        responseTo(previous, responseFields(previous, payload.response)); return;
      }
      if (eventName === 'Network.loadingFinished') { terminalTo(previous, 'finished'); return; }
      if (eventName === 'Network.loadingFailed') {
        if (typeof payload.errorText !== 'string' || (payload.canceled !== undefined && typeof payload.canceled !== 'boolean')) throw new Error();
        terminalTo(previous, payload.canceled === true ? 'canceled' : 'failed', { canceled: payload.canceled === true, netError: payload.errorText === 'net::ERR_ABORTED' ? 'aborted' : 'other',
          blockedReason: nativeEnum(payload.blockedReason, blockedReasons), corsError: nativeEnum(payload.corsErrorStatus?.corsError, corsErrors) }); return;
      }
      throw new Error();
    } catch { problem('invalid_event'); }
  }
  const snapshot = () => reduceBrowserProtocolCapture(events, { incompleteReasons: [...sticky], truncated });
  return { registerSession, ingest, sessionLost, snapshot, finish() {
    if (!closed) { append('capture_finished'); closed = true; sessions.clear(); contexts.clear(); }
    return snapshot();
  } };
}

/** Only subscribe/enable metadata. Session ownership and browser behavior stay with the caller. */
export async function attachBrowserProtocolObserver(session, capture, { sessionKey, contextKey }) {
  const handlers = new Map(); let stopped = false;
  capture.registerSession(sessionKey, { contextKey });
  try {
    for (const name of ['Network.requestWillBeSent', 'Network.responseReceived', 'Network.loadingFinished', 'Network.loadingFailed', 'Page.frameNavigated', 'Page.navigatedWithinDocument', 'Page.frameDetached']) {
      const listener = payload => capture.ingest(sessionKey, name, payload); handlers.set(name, listener); session.on(name, listener);
    }
    const lost = () => capture.sessionLost(sessionKey);
    for (const name of ['close', 'Disconnected', 'Inspector.detached']) { handlers.set(name, lost); session.on(name, lost); }
    await session.send('Network.enable'); await session.send('Page.enable'); capture.ingest(sessionKey, 'Page.frameTree', await session.send('Page.getFrameTree'));
  } catch { capture.ingest(sessionKey, 'Observer.setupFailed', {}); capture.sessionLost(sessionKey); }
  return { async stop() {
    if (stopped) return;
    stopped = true;
    for (const [name, listener] of handlers) { try { session.off(name, listener); } catch { capture.ingest(sessionKey, 'Observer.setupFailed', {}); } }
    handlers.clear(); if (!capture.snapshot().closed) capture.ingest(sessionKey, 'Observer.stopped', {});
  } };
}
