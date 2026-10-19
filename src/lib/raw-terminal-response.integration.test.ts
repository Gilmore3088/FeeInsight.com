/** @vitest-environment node */
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const state = vi.hoisted(() => ({ sql: vi.fn(), upsert: vi.fn(), getGuide: vi.fn(), summaries: vi.fn(), control: vi.fn(), budget: vi.fn(), stop: vi.fn(), savedRead: vi.fn(), savedWrite: vi.fn(), pro: vi.fn(), researchUsage: vi.fn(), audit: vi.fn() }));
vi.mock('@/lib/data-store/connection', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/data-store/connection')>(), sql: state.sql }));
vi.mock('@/lib/automation-control', async (importOriginal) => { const actual = await importOriginal<typeof import('@/lib/automation-control')>(); return { ...actual, assertAutomationEnabled: state.control, engageEmergencyStop: state.stop, findOpenProviderCreditFailure: async () => null }; });
vi.mock('@/lib/api-hardening/budget', () => ({ assertProviderBudgetAllowed: state.budget, ProviderBudgetBlockedError: class extends Error {
    }, providerBudgetDecisionToError: (x: {
        message?: string;
    }) => new Error(x.message) }));
vi.mock('@/lib/api-hardening/audit', () => ({ recordApiRouteAuditEvent: state.audit }));
vi.mock('@/lib/data-store/fees', () => ({ getFeeCategorySummaries: state.summaries }));
vi.mock('@/lib/data-store/guides', () => ({ upsertGuide: state.upsert, getGuideBySlug: state.getGuide }));
vi.mock('@/lib/agents/run-store', () => ({ recordProRequest: state.pro }));
vi.mock('@/lib/data-store/hamilton-workspace', () => ({ workspaceSchemaReady: async () => false, getMemoryFacts: async () => [], getDecision: async () => null, getDecisionEvents: async () => [], addDecisionEvents: async () => { }, findOrOpenDecision: async () => null, saveMemoryFact: async () => null, testedPrices: () => [] }));
vi.mock('@/lib/data-store/hamilton-analyses', () => ({ getSavedAnalysisResponse: state.savedRead, updateSavedAnalysisResponse: state.savedWrite, insertSavedAnalysis: vi.fn() }));
vi.mock('@/lib/hamilton/account-context-store', () => ({ loadHamiltonAccountContext: async () => ({ status: 'identified', institution: { id: 1, name: 'Example Valley Credit Union' }, profileLabel: null }) }));
vi.mock('@/lib/hamilton/workspace-context', () => ({ resolveHamiltonInstitutionContext: async () => ({ institution: { id: 1, name: 'Example Valley Credit Union' }, error: null, source: 'url' }) }));
vi.mock('@/lib/hamilton/workspace/research', () => ({ getFeeResearch: vi.fn(), getWorkspaceBriefing: vi.fn() }));
vi.mock('@/lib/hamilton/active-peer-set', () => ({ getActivePeerSet: async () => null }));
vi.mock('@/lib/research/history', () => ({ logUsage: state.researchUsage }));
import { answerAskMemo } from '@/lib/hamilton/ask-service';
import { storylineAnalysis } from '@/lib/hamilton/workspace/analysis-record';
import { generateSection, generateGlobalThesis } from '@/lib/hamilton/generate';
import { writeStorylineMemo } from '@/lib/hamilton/memo';
import { writeSimulateRead } from '@/lib/hamilton/simulate-read';
import { runEditorReview } from '@/lib/report-engine/editor';
import { runGuideDraft } from '@/lib/agents/guides/draft';
import { paidModelCall } from '@/lib/agents/paid-pass';
import { runRosettaPaidRead } from '@/lib/agents/rosetta/paid-read';
import { trackAnthropicRequest, observedProviderUsage } from '@/lib/ai-provider-usage';
import { IncompleteProviderResponseError } from '@/lib/ai-response-budget';
import { buildFeeAnswer } from '@/lib/hamilton/workspace/answer';
import { overdraftResearch } from '@/lib/hamilton/workspace/test-fixtures';
type RawUsage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; server_tool_use: { web_search_requests: number } };
let responseUsage: RawUsage | undefined;
let replySequence: Array<{ reason: string; text: string }> = [];
let bodyText = '';
let stopReason: string | null | undefined = 'end_turn';
let content: Array<Record<string, unknown>> | undefined;
let responseStopSequence: string | null = null;
type RequestBody = {
    model: string;
    max_tokens: number;
    tools?: Array<{
        name?: string;
        type?: string;
    }>;
    stop_sequences?: string[];
};
let requests: RequestBody[] = [];
const goodMemo = JSON.stringify({ summary: 'Your $32 overdraft fee is at the 75th percentile of 16 peers (median $29.50). The board decision is whether that position is worth what it earns.', board: 'Service charges came to $209 thousand over the last four quarters. The filing carries no separate overdraft line, so the money at stake is not yet measured.', market: 'Every peer group in your comparison publishes an overdraft fee; none charges $0, so price is not the headline claim against you.', questions: ['How many overdraft items did you charge last year?', 'Which peers do your customers actually compare you with?'] });
const thesis = JSON.stringify({ core_thesis: 'The supplied fee data supports this comparison.', tensions: [], revenue_model: 'The supplied filings describe service charges.', competitive_dynamic: 'The comparison is bounded by the supplied data.', contrarian_insight: null, narrative_summary: 'The supplied evidence supports this comparison.' });
const guide = JSON.stringify({ title: 'Overdraft Fees', seoTitle: 'Overdraft Fees Explained', description: 'A synthetic guide.', sections: [{ id: 'what-it-is', heading: 'What is it?', blocks: [{ type: 'paragraph', text: Array(850).fill('research').join(' ') }] }, { id: 'what-regulators-say', heading: 'What regulators say', blocks: [{ type: 'paragraph', text: 'Regulation E requires an opt-in.' }] }, { id: 'compare-your-bank', heading: 'Compare your bank', blocks: [{ type: 'paragraph', text: 'The median is {{overdraft.median}}.' }] }] });
const summary = (category: string) => ({ fee_category: category, institution_count: 100, total_observations: 120, min_amount: 5, max_amount: 50, avg_amount: 30, median_amount: 32, p25_amount: 28, p75_amount: 36, bank_count: 60, cu_count: 40, zero_count: 7, bank_median_amount: null, cu_median_amount: null });
const storyline = buildFeeAnswer(overdraftResearch(), { story: { wantsDecision: true } }).storyline!;
const sqlText = (x: unknown) => Array.isArray(x) ? x.join(' ') : String(x);
function ledger() { return state.sql.mock.calls.filter(c => sqlText(c[0]).includes('INSERT INTO ai_api_usage_events')).map(c => ({ operation: c[4], status: c[5], input: c[7], output: c[8], estimatedCost: c[11], metadata: JSON.parse(c.at(-1)) })); }
function record<T>(name: string, result: T, error: unknown) { const value = { name, stopReason, result, error: error instanceof Error ? { name: error.name, message: error.message } : error === undefined ? null : { name: 'Error', message: String(error) }, ledger: ledger(), savedWrites: state.savedWrite.mock.calls.map(c => ({ userId: c[0], id: c[1], institutionId: c[2], summary: c[3]?.memo?.summary, hamiltonView: c[3]?.hamiltonView })), runBudgetUpdates: state.sql.mock.calls.filter(c => sqlText(c[0]).includes('UPDATE agent_runs')).map(c => ({ values: c.slice(1) })), stops: state.stop.mock.calls, audits: state.audit.mock.calls.map(c => ({ statusCode: c[0]?.statusCode, outcome: c[0]?.outcome, reasonCode: c[0]?.reasonCode })), pro: state.pro.mock.calls.map(c => ({ status: c[0]?.status, detail: c[0]?.detail })), researchUsage: state.researchUsage.mock.calls, upserts: state.upsert.mock.calls.map(c => ({ status: c[0]?.status, slug: c[0]?.slug })), requests: requests.map(x => ({ model: x.model, max_tokens: x.max_tokens, tools: (x.tools ?? []).map((t) => t.name ?? t.type), stop_sequences: x.stop_sequences ?? null })) }; return value; }
type Observation<T> = ReturnType<typeof record<T | null>>;
function settle<T, U>(name: string, fn: () => Promise<T>, project: (value: T) => U): Promise<Observation<U>>;
function settle<T>(name: string, fn: () => Promise<T>): Promise<Observation<T>>;
async function settle(name: string, fn: () => Promise<unknown>, project?: (value: never) => unknown): Promise<Observation<unknown>> {
    try {
        const result = await fn();
        return record(name, project ? project(result as never) : result, undefined);
    }
    catch (error) {
        return record(name, null, error);
    }
}
beforeEach(() => {
    state.sql.mockReset().mockResolvedValue([]);
    state.savedRead.mockReset().mockResolvedValue(storylineAnalysis(storyline, 'external-fixture', null, { version: 1, researchInstitutionId: 1, accountInstitutionId: 1, accountStatus: 'identified', researchInstitutionName: 'Example Valley Credit Union', accountInstitutionName: 'Example Valley Credit Union' }));
    state.savedWrite.mockReset().mockResolvedValue(true);
    state.pro.mockReset().mockResolvedValue(1);
    state.audit.mockReset().mockResolvedValue(undefined);
    state.researchUsage.mockReset().mockResolvedValue(undefined);
    state.upsert.mockReset().mockResolvedValue(undefined);
    state.getGuide.mockReset().mockResolvedValue(null);
    state.summaries.mockReset().mockResolvedValue([summary('overdraft'), summary('od_daily_cap')]);
    state.control.mockReset().mockResolvedValue({ enabled: true });
    state.budget.mockReset().mockResolvedValue({ allowed: true, policyId: 1 });
    state.stop.mockReset();
    replySequence = []; responseUsage = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: { web_search_requests: 0 } }; bodyText = 'The median fee is $32.';
    stopReason = 'end_turn';
    content = undefined;
    responseStopSequence = null;
    requests = [];
    vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-shared');
    vi.stubEnv('ANTHROPIC_API_KEY_HAMILTON', 'synthetic-own');
    vi.stubEnv('ANTHROPIC_API_KEY_KNOX', 'synthetic-knox');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', '');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://fixture.invalid');
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
        if (String(url) !== 'https://fixture.invalid/v1/messages')
            throw new Error('Unexpected synthetic fetch URL');
        const request = JSON.parse(String(init?.body)) as RequestBody;
        requests.push(request);
        const next = replySequence.shift();
        return new Response(JSON.stringify({ id: 'msg_owned_fixture', type: 'message', role: 'assistant', model: request.model, content: content ?? [{ type: 'text', text: next?.text ?? bodyText, citations: null }], stop_reason: next?.reason ?? stopReason, stop_sequence: responseStopSequence, stop_details: null, usage: responseUsage }), { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_owned_fixture' } });
    }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const reasonCases = ['end_turn', 'max_tokens', 'refusal', 'pause_turn', 'tool_use', 'stop_sequence', 'model_context_window_exceeded', null, undefined, 'future_reason'] as const;
describe('terminal raw response integration with actual SDK and factory', () => {
    it.each([["tool_use", "tool_use"], ["tool_use", "end_turn"], ["server_tool_use", "end_turn"]])("rejects unexpected %s content even alongside text and %s", async (type, reason) => {
        bodyText = "The median fee is $32.";
        stopReason = reason;
        content = [{ type: "text", text: bodyText }, { type, id: "tool_owned", name: "extract_fee", input: { fee: 0 } }];
        const result = await settle("unexpected-tool", () => generateSection({ type: "overview", title: "Owned fixture", data: { median_amount: 32 } }));
        expect(result.error).not.toBeNull();
        expect(result.requests[0].tools).toEqual([]);
        expect(result.ledger).toHaveLength(1);
        expect(result.ledger[0]).toMatchObject({ status: "failed", estimatedCost: 440, metadata: { provider_finish_reason: "unexpected_content", usage_observation: "observed" } });
        expect(result.requests).toHaveLength(1);
    });
    it("rejects a bare tool-result block alongside text and end_turn", async () => {
        content = [{ type: "text", text: "The median fee is $32." }, { type: "web_search_tool_result", tool_use_id: "tool_owned", content: [] }];
        const result = await settle("unexpected-result", () => generateSection({ type: "overview", title: "Owned fixture", data: { median_amount: 32 } }));
        expect(result.error).not.toBeNull(); expect(result.requests).toHaveLength(1);
        expect(result.requests[0].tools).toEqual([]);
        expect(result.ledger[0]).toMatchObject({ status: "failed", metadata: { provider_finish_reason: "unexpected_content" } });
    });
    it("preserves completed text with thinking and redacted thinking", async () => {
        content = [{ type: "thinking", thinking: "Synthetic fixture only", signature: "synthetic" },
          { type: "redacted_thinking", data: "synthetic" }, { type: "text", text: "The median fee is $32." }];
        expect(await generateSection({ type: "overview", title: "Owned fixture", data: { median_amount: 32 } })).toMatchObject({ narrative: "The median fee is $32." });
        expect(ledger()[0].status).toBe("completed");
    });
    it.each(reasonCases)('section safety at stop_reason %s', async (reason) => {
        stopReason = reason;
        if (reason === 'stop_sequence')
            responseStopSequence = 'UNREQUESTED_BOUNDARY';
        const r = await settle('section', () => generateSection({ type: 'overview', title: 'Owned fixture', data: { median_amount: 32 } }, { agentRunId: 7 }), v => ({ narrative: v.narrative }));
        if (reason === 'end_turn') {
            expect(r.error).toBeNull();
            expect(r.ledger[0].status).toBe('completed');
        }
        else {
            expect(r.error, 'An incomplete raw response must not return a completed narrative').not.toBeNull();
        }
    });
    it.each(['end_turn', 'max_tokens'])('memo actual evidence checks at %s', async (reason) => {
        stopReason = reason;
        bodyText = goodMemo;
        const r = await settle('memo', () => writeStorylineMemo(storyline, 'should we change our overdraft fee?', { institutionId: 1, tracking: { agentRunId: 7, operation: "terminal_fixture" } }), v => ({ status: v.status, summary: v.status === 'written' ? v.memo.summary : undefined, unmatched: v.status === 'written' ? v.memo.figureCheck.unmatched : undefined, reason: v.status === 'written' ? undefined : v.reason }));
        if (reason === 'end_turn') {
            expect(r.result!.status).toBe('written');
            expect(r.result!.unmatched).toEqual([]);
        }
        else
            expect(r.result?.status).not.toBe('written');
    });
    it.each(['end_turn', 'max_tokens'])('simulate actual evidence check at %s', async (reason) => {
        stopReason = reason;
        bodyText = 'The tested fee is $30, compared with the current fee of $32 and a peer median of $29.50.';
        const r = await settle('simulate', () => writeSimulateRead({ feeCategory: 'overdraft', currentFee: 32, proposedFee: 30, distribution: { p25_amount: 25, median_amount: 29.5, p75_amount: 32, institution_count: 16 } }, { institutionId: 1, tracking: { agentRunId: 7, operation: "terminal_fixture" } }), v => ({ status: v.status, text: v.status === 'written' ? v.text : undefined, check: v.status === 'written' ? v.check : undefined, reason: v.status === 'written' ? undefined : v.reason }));
        if (reason === 'end_turn')
            expect(r.result!.status).toBe('written');
        else
            expect(r.result?.status).not.toBe('written');
    });
    it.each(['end_turn', 'max_tokens'])('thesis valid JSON at %s', async (reason) => {
        stopReason = reason;
        bodyText = thesis;
        const r = await settle('thesis', () => generateGlobalThesis({ scope: 'quarterly', data: { quarter: 'Q1 2025', total_institutions: 1200, top_categories: [{ fee_category: 'overdraft', display_name: 'Overdraft Fee', median_amount: 32, bank_median: 35, cu_median: 28, institution_count: 900, maturity_tier: 'strong' }], revenue_snapshot: null, fred_snapshot: null, beige_book_themes: [], derived_tensions: [] } }), v => ({ core_thesis: v.core_thesis }));
        if (reason === 'end_turn')
            expect(r.error).toBeNull();
        else
            expect(r.error).not.toBeNull();
    });
    it.each(['end_turn', 'max_tokens'])('editor valid approval JSON at %s', async (reason) => {
        stopReason = reason;
        bodyText = JSON.stringify({ flaggedSections: [], reviewNote: 'All sections approved.' });
        const r = await settle('editor', () => runEditorReview([], null), v => ({ approved: v.approved, reviewNote: v.reviewNote }));
        if (reason === 'end_turn')
            expect(r.result!.approved).toBe(true);
        else
            expect(r.result?.approved ?? false).toBe(false);
    });
    it.each(['end_turn', 'max_tokens'])('guide content gates and review storage at %s', async (reason) => {
        stopReason = reason;
        bodyText = guide;
        const r = await settle('guide', () => runGuideDraft({ runId: 7, primaryCategory: 'overdraft', db: state.sql as unknown as NonNullable<Parameters<typeof runGuideDraft>[0]["db"]> }), v => ({ status: v.status, wordCount: v.wordCount, issues: v.issues }));
        if (reason === 'end_turn') {
            expect(r.result!.status).toBe('drafted');
            expect(r.upserts).toEqual([{ status: 'in_review', slug: 'overdraft-fees' }]);
        }
        else
            expect(r.upserts).toHaveLength(0);
    });
    it.each(['end_turn', 'max_tokens'])('saved memo and actual usage at %s', async (reason) => {
        stopReason = reason;
        bodyText = JSON.stringify({ ...JSON.parse(goodMemo), summary: JSON.parse(goodMemo).summary.replace('Your $32', "Example Valley Credit Union's $32"), market: JSON.parse(goodMemo).market.replace('against you', 'against Example Valley Credit Union'), questions: ['How many overdraft items were charged last year?', 'Which peers form the published comparison?'] });
        const r = await settle('memo-saved', () => answerAskMemo({ id: 7, display_name: 'Owned fixture' }, { institutionId: '1', question: 'should we change our overdraft fee?', savedAnalysisId: 'a_owned' }), v => ({ status: v.status, bodyStatus: 'status' in v.body ? v.body.status : undefined, summary: 'memo' in v.body ? v.body.memo.summary : undefined }));
        if (reason === 'end_turn') {
            expect(r.result).toMatchObject({ status: 200, bodyStatus: 'written' });
            expect(r.savedWrites).toHaveLength(1);
            expect(r.savedWrites[0]).toMatchObject({ userId: 7, id: 'a_owned', institutionId: '1', summary: expect.stringContaining('$32') });
            expect(r.ledger[0].status).toBe('completed');
        }
        else {
            expect(r.error).toBeNull();
            expect(r.savedWrites, 'Incomplete memo must not overwrite the saved answer').toHaveLength(0);
        }
    });
    it.each(["zero", "unknown"])("keeps the memo user quota honest for an incomplete %s usage response", async (kind) => {
        stopReason = "max_tokens"; bodyText = goodMemo;
        responseUsage = kind === "zero" ? { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: { web_search_requests: 0 } } : undefined;
        const result = await answerAskMemo({ id: 7 }, { institutionId: "1", question: "overdraft?", savedAnalysisId: "a_owned" });
        expect(result.body).toMatchObject({ status: "unavailable" });
        expect(state.savedWrite).not.toHaveBeenCalled();
        expect(state.researchUsage).toHaveBeenCalledTimes(kind === "zero" ? 1 : 0);
        expect(ledger()).toHaveLength(1);
        expect(ledger()[0]).toMatchObject({ status: "failed", estimatedCost: kind === "zero" ? 0 : null,
          metadata: { response_complete: false, usage_observation: kind === "zero" ? "observed" : "unknown" } });
    });
    it("counts a completed unparseable draft and its observed incomplete memo retry without double-counting", async () => {
        replySequence = [{ reason: "end_turn", text: "not JSON" }, { reason: "max_tokens", text: goodMemo }];
        const usage = { calls: 0, inputTokens: 0, outputTokens: 0 };
        expect(await writeStorylineMemo(storyline, "overdraft?", { usage })).toMatchObject({ status: "unavailable" });
        expect(usage).toEqual({ calls: 2, inputTokens: 20, outputTokens: 40 });
        expect(ledger().map((entry) => entry.status)).toEqual(["completed", "failed"]);
        expect(requests).toHaveLength(2);
    });
    it('preserves the existing unparseable editor fail-safe on an ordinary end_turn', async () => { bodyText = 'not JSON'; const r = await settle('editor-malformed', () => runEditorReview([], null), v => ({ approved: v.approved, reviewNote: v.reviewNote })); expect(r.result!.approved).toBe(false); });
    it.each(['end_turn', 'max_tokens'])('Rosetta preserves explicitly labelled partial transcription at %s', async (reason) => {
        stopReason = reason;
        bodyText = 'SCHEDULE OF FEES\nOverdraft fee | $35.00\nNSF fee | $35.00\nStop payment | $30.00';
        const db = Object.assign(vi.fn(async (strings: unknown) => {
            const text = sqlText(strings);
            if (text.includes('learning_schema_ready'))
                return [{ learning_schema_ready: true }];
            if (text.includes('vault_schema_ready'))
                return [{ vault_schema_ready: true }];
            if (text.includes('rosetta_text_columns_ready'))
                return [{ rosetta_text_columns_ready: true }];
            if (text.includes('INSERT INTO agent_source_texts'))
                return [{ id: 990 }];
            return [];
        }), { unsafe: vi.fn(async (query: string) => query.includes('FROM agent_source_texts adt') ? [{ source_document_id: 1, institution_id: 41, institution_name: 'Scan Bank 1', document_url: 'https://scan1.example/fees.pdf', content_hash: 'owned-hash-1' }] : []) });
        // Callback-only sink; native Rosetta SQL controls prove rollback.
        Object.assign(db, { begin: vi.fn(async (work: (scope: typeof db) => Promise<unknown>) => work(db)) });
        const pdfFetch = vi.fn(async () => new Response(new TextEncoder().encode('%PDF-1.4 owned fixture'), { headers: { 'content-type': 'application/pdf' } }));
        const r = await settle('rosetta-partial', () => runRosettaPaidRead({ runId: 900, db: db as unknown as NonNullable<Parameters<typeof runRosettaPaidRead>[0]["db"]>, fetchImpl: pdfFetch, pageCounter: async () => 3 }), v => ({ processed: v.processed, succeeded: v.succeeded, failed: v.failed, result: v.results, attempts: db.mock.calls.filter((c: unknown[]) => sqlText(c[0]).includes('INSERT INTO pipeline_attempts')).map((c: unknown[]) => ({ strategy: c[4], outcome: c[7], cost: c[9], detail: c.at(-1) })), stored: db.mock.calls.filter((c: unknown[]) => sqlText(c[0]).includes('INSERT INTO agent_source_texts')).map((c: unknown[]) => ({ values: c.slice(1) })) }));
        expect(r.error).toBeNull();
        expect(r.result).toMatchObject({ processed: 1, succeeded: 1, failed: 0 });
        expect(r.result!.result[0].outcome).toBe(reason === 'max_tokens' ? 'ok_partial' : 'ok');
        expect(r.result!.stored).toHaveLength(1);
        expect(r.result!.attempts[0]).toMatchObject({ strategy: 'read.paid_transcribe', outcome: reason === 'max_tokens' ? 'ok_partial' : 'ok' });
        expect(r.ledger[0].status).toBe('completed');
    });
    it.each([{ name: 'observed', raw: { input_tokens: 10, output_tokens: 20 }, cost: 440 }, { name: 'zero', raw: { input_tokens: 0, output_tokens: 0 }, cost: 0 }, { name: 'unknown', raw: undefined, cost: null }])('existing typed incomplete accounting preserves %s', async ({ name, raw, cost }) => { const r = await settle('existing-incomplete-' + name, () => trackAnthropicRequest({ model: 'claude-opus-5-5', agent: 'hamilton', operation: 'owned_incomplete_capability', agentRunId: 7, routeId: 'api.hamilton.ask.memo' }, async () => { throw new IncompleteProviderResponseError('max_tokens', observedProviderUsage(raw)); })); expect(r.error?.name).toBe('IncompleteProviderResponseError'); expect(r.ledger).toHaveLength(1); expect(r.ledger[0]).toMatchObject({ status: 'failed', estimatedCost: cost, metadata: { response_complete: false, usage_observation: name === 'unknown' ? 'unknown' : 'observed' } }); expect(r.runBudgetUpdates).toHaveLength(name === 'unknown' ? 0 : 1); expect(r.stops).toHaveLength(0); expect(r.audits).toEqual([{ statusCode: 500, outcome: 'error', reasonCode: 'provider_call_failed' }]); });
    it('generic paid pass retains a legitimate tool_use message', async () => { stopReason = 'tool_use'; content = [{ type: 'tool_use', id: 'tool_owned', name: 'extract_fee', input: { fee: 0 } }]; const r = await settle('paid-tool', () => paidModelCall({ agent: 'knox', operation: 'owned_tool_fixture', runId: 7, params: { model: 'claude-haiku-4-5', max_tokens: 2000, tools: [{ name: 'extract_fee', description: 'Owned fixture only', input_schema: { type: 'object', properties: { fee: { type: 'number' } } } }], messages: [{ role: 'user', content: 'Owned fixture only' }] } }), v => ({ reason: v.message.stop_reason, content: v.message.content, cost: v.costMicrousd })); expect(r.result!.reason).toBe('tool_use'); expect(r.result!.content[0]).toMatchObject({ type: 'tool_use', input: { fee: 0 } }); expect(r.ledger[0].status).toBe('completed'); });
    it('generic paid pass preserves a request-configured stop_sequence boundary', async () => { stopReason = 'stop_sequence'; responseStopSequence = 'END_FIXTURE'; bodyText = 'A complete fixture.'; const r = await settle('paid-stop-sequence', () => paidModelCall({ agent: 'hamilton', operation: 'owned_stop_fixture', runId: 7, params: { model: 'claude-haiku-4-5', max_tokens: 2000, stop_sequences: ['END_FIXTURE'], messages: [{ role: 'user', content: 'Owned fixture only' }] } }), v => ({ reason: v.message.stop_reason, boundary: v.message.stop_sequence })); expect(r.result).toEqual({ reason: 'stop_sequence', boundary: 'END_FIXTURE' }); expect(r.requests[0].stop_sequences).toEqual(['END_FIXTURE']); });
});
