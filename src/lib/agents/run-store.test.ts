import { beforeEach, describe, expect, it, vi } from "vitest";

type TxMock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

const {
  sqlMock,
  txMock,
  withTransactionMock,
  assertAutomationEnabledMock,
  getAutomationControlMock,
  getPipelineControlMock,
  getExecutionBackendMock,
  runDarwinVerifyMock,
  runHamiltonPublishMock,
  runKnoxExtractMock,
  runMagellanDiscoveryMock,
  runMagellanFetchMock,
  runPublicDiscoveryAuditMock,
  runRosettaReadMock,
  runRegistryStepMock,
} = vi.hoisted(() => {
  const tx = vi.fn() as TxMock;
  tx.unsafe = vi.fn();
  const withTransaction = vi.fn(async (callback: (transaction: TxMock) => Promise<unknown>) => callback(tx));
  return {
    sqlMock: vi.fn(),
    txMock: tx,
    withTransactionMock: withTransaction,
    assertAutomationEnabledMock: vi.fn(),
    getAutomationControlMock: vi.fn(),
    getPipelineControlMock: vi.fn(),
    getExecutionBackendMock: vi.fn(),
    runDarwinVerifyMock: vi.fn(),
    runHamiltonPublishMock: vi.fn(),
    runKnoxExtractMock: vi.fn(),
    runMagellanDiscoveryMock: vi.fn(),
    runMagellanFetchMock: vi.fn(),
    runPublicDiscoveryAuditMock: vi.fn(),
    runRosettaReadMock: vi.fn(),
    runRegistryStepMock: vi.fn(),
  };
});

vi.mock("@/lib/data-store/connection", () => ({
  sql: sqlMock,
  withTransaction: withTransactionMock,
}));

vi.mock("@/lib/execution-backend", () => ({
  getExecutionBackend: getExecutionBackendMock,
}));

vi.mock("@/lib/automation-control", () => ({
  assertAutomationEnabled: assertAutomationEnabledMock,
  getAutomationControl: getAutomationControlMock,
  getPipelineControl: getPipelineControlMock,
}));

vi.mock("@/lib/agents/daily-brief", () => ({
  runDailyBrief: vi.fn().mockResolvedValue({
    brief: { subject: "Atlas daily brief", lines: ["What ran: 0 runs finished, 0 failed."] },
    funnel: {},
    deliveryStatus: "not_configured",
    deliveryReason: "RESEND_API_KEY is not configured.",
    recipient: "ops@example.com",
  }),
}));

vi.mock("@/lib/agents/fee-alerts", () => ({
  runFeeAlertDispatch: vi.fn().mockResolvedValue({
    dryRun: false,
    readers: 2,
    sent: 0,
    failed: 0,
    notConfigured: true,
    reason: "TRANSACTIONAL_EMAIL_FROM is not configured.",
    institutions: 2,
    changes: 3,
    newlyPublished: 0,
    deferred: 0,
  }),
  summarizeFeeAlertDispatch: vi.fn(() => "Atlas found 2 reader(s) with fee changes but did not email them."),
}));

vi.mock("@/lib/agents/darwin/verify", () => ({
  runDarwinVerify: runDarwinVerifyMock,
}));

vi.mock("@/lib/agents/hamilton/publish", () => ({
  runHamiltonPublish: runHamiltonPublishMock,
}));

vi.mock("@/lib/agents/knox/extract", () => ({
  runKnoxExtract: runKnoxExtractMock,
}));

vi.mock("@/lib/agents/magellan/discovery", () => ({
  runMagellanDiscovery: runMagellanDiscoveryMock,
}));

vi.mock("@/lib/agents/magellan/outcomes", () => ({
  recordLinkOutcomes: vi.fn(async () => ({ ready: false, slot: 0, links: 0, judged: { good: 0, thin: 0, rejected: 0, dead: 0 }, undecided: 0, unchanged: 0, written: 0 })),
}));

vi.mock("@/lib/agents/magellan/fetch", () => ({
  runMagellanFetch: runMagellanFetchMock,
}));

vi.mock("@/lib/agents/magellan/registry", () => ({
  isRegistryStepKey: (key: string) => key.startsWith("registry-"),
  runRegistryStep: runRegistryStepMock,
}));

vi.mock("@/lib/agents/public-discovery", () => ({
  clusterPublicDiscoveryFindings: vi.fn(async () => ({
    clusters: 0,
    systemicCandidates: 0,
    findingsTagged: 0,
    criticalFindings: 0,
    summaryRows: [],
  })),
  runPublicDiscoveryAudit: runPublicDiscoveryAuditMock,
  summarizePublicDiscoveryDiagnosis: vi.fn(async () => ({
    findings: 0,
    criticalFindings: 0,
    systemicCandidates: 0,
    topIssue: null,
    summary: "Public discovery found no deterministic public page findings in this run.",
  })),
}));

vi.mock("@/lib/agents/rosetta/read", () => ({
  runRosettaRead: runRosettaReadMock,
}));

import {
  cancelAgentRun,
  executeAgentRun,
  executeQueuedAgentRuns,
  startAgentRun,
  reapStaleAgentSteps,
  recordProRequest,
} from "./run-store";

const runRow = {
  id: 101,
  agent_name: "atlas",
  run_kind: "workflow",
  title: "Atlas full data cycle",
  status: "queued",
  started_at: "2026-08-12T20:00:00.000Z",
  completed_at: null,
  updated_at: "2026-08-12T20:00:00.000Z",
  trigger_source: "admin",
  triggered_by: "admin",
  correlation_id: "00000000-0000-4000-8000-000000000001",
  backend: "agentic_v1",
  progress_current: 0,
  progress_total: 2,
  current_stage: "discover",
  error_summary: null,
  summary: "Created",
  params_json: { limit: 10 },
};

const blockedRunRow = {
  ...runRow,
  status: "blocked",
  error_summary: "agentic execution backend is disabled",
};

const queuedStepRows = [
  {
    id: 201,
    agent_run_id: 101,
    step_key: "discover",
    agent_name: "magellan",
    title: "Find URLs",
    status: "queued",
    sequence: 1,
    summary: null,
    error_summary: null,
    queued_at: "2026-08-12T20:00:00.000Z",
    started_at: null,
    completed_at: null,
    updated_at: "2026-08-12T20:00:00.000Z",
  },
  {
    id: 202,
    agent_run_id: 101,
    step_key: "review",
    agent_name: "knox",
    title: "Review exceptions",
    status: "queued",
    sequence: 2,
    summary: null,
    error_summary: null,
    queued_at: "2026-08-12T20:00:00.000Z",
    started_at: null,
    completed_at: null,
    updated_at: "2026-08-12T20:00:00.000Z",
  },
];

const blockedStepRows = [
  {
    ...queuedStepRows[0],
    status: "blocked",
    error_summary: "Waiting for EXECUTION_BACKEND=agentic_v1",
  },
  queuedStepRows[1],
];

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

function installSqlMocks({
  idempotencyRows = [],
  finalRun = blockedRunRow,
  finalSteps = blockedStepRows,
}: {
  idempotencyRows?: Array<Record<string, unknown>>;
  finalRun?: Record<string, unknown>;
  finalSteps?: Array<Record<string, unknown>>;
} = {}) {
  sqlMock.mockImplementation((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("WHERE idempotency_key")) return Promise.resolve(idempotencyRows);
    if (text.includes("FROM agent_run_steps")) return Promise.resolve(finalSteps);
    if (text.includes("FROM agent_runs")) return Promise.resolve([finalRun]);
    return Promise.resolve([]);
  });
}

function installTxMocks(
  stepRows = queuedStepRows,
  runOverride: Record<string, unknown> = runRow,
) {
  txMock.mockImplementation((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("INSERT INTO agent_runs")) return Promise.resolve([runOverride]);
    if (text.includes("SELECT ar.status AS run_status")) {
      return Promise.resolve([{ run_status: "running", step_status: "running" }]);
    }
    if (text.includes("COUNT(*) FILTER")) {
      return Promise.resolve([{ completed_steps: "1", total_steps: String(stepRows.length) }]);
    }
    if (text.includes("SELECT step_key")) {
      return Promise.resolve(stepRows.length > 1 ? [{ step_key: stepRows[1].step_key }] : []);
    }
    if (text.includes("FROM agent_runs")) return Promise.resolve([runOverride]);
    if (text.includes("FROM agent_run_steps")) return Promise.resolve(stepRows);
    if (text.includes("FROM agent_messages")) {
      return Promise.resolve([
        { bucket: "pending", cnt: "3" },
        { bucket: "confirmed", cnt: "2" },
        { bucket: "overridden", cnt: "1" },
      ]);
    }
    return Promise.resolve([]);
  });
  txMock.unsafe.mockResolvedValue([{ count: "7" }]);
}

function combinedTransactionSql(): string {
  return txMock.mock.calls.map((call) => templateText(call[0])).join("\n");
}

describe("agentic run store", () => {
  beforeEach(() => {
    sqlMock.mockReset();
    txMock.mockReset();
    txMock.unsafe.mockReset();
    withTransactionMock.mockClear();
    assertAutomationEnabledMock.mockReset().mockResolvedValue({ enabled: true });
    getAutomationControlMock.mockReset().mockResolvedValue({ enabled: true, reason: null });
    getPipelineControlMock.mockReset().mockResolvedValue({ enabled: true, reason: null });
    getExecutionBackendMock.mockReset().mockReturnValue("disabled");
    runDarwinVerifyMock.mockReset().mockResolvedValue({
      selectedRawFees: 7,
      processedRawFees: 7,
      verifiedFees: 6,
      skippedFees: 1,
      limit: 10,
      dryRun: false,
      results: [],
    });
    runHamiltonPublishMock.mockReset().mockResolvedValue({
      selectedVerifiedFees: 6,
      processedVerifiedFees: 6,
      publishedFees: 5,
      skippedFees: 1,
      limit: 10,
      minConfidence: 0.8,
      dryRun: false,
      batchId: "agentic-run-101",
      results: [],
    });
    runMagellanDiscoveryMock.mockReset().mockResolvedValue({
      selected: 10,
      processed: 10,
      discovered: 3,
      dead: 2,
      needsHuman: 1,
      retryAfter: 4,
      failures: 0,
      attemptedUrls: 21,
      limit: 10,
      dryRun: false,
      results: [],
    });
    runMagellanFetchMock.mockReset().mockResolvedValue({
      selected: 10,
      processed: 10,
      succeeded: 8,
      failed: 1,
      skipped: 1,
      bytes: 1024,
      limit: 10,
      dryRun: false,
      results: [],
    });
    runPublicDiscoveryAuditMock.mockReset().mockResolvedValue({
      selected: 4,
      processed: 4,
      observed: 3,
      failed: 1,
      findings: 2,
      criticalFindings: 1,
      warningFindings: 1,
      routeTemplates: 3,
      limit: 20,
      dryRun: false,
      routes: [],
    });
    runRosettaReadMock.mockReset().mockResolvedValue({
      selected: 4,
      processed: 4,
      completed: 3,
      empty: 0,
      needsOcr: 1,
      failed: 0,
      skipped: 0,
      chars: 4096,
      limit: 4,
      dryRun: false,
      results: [],
    });
    runKnoxExtractMock.mockReset().mockResolvedValue({
      selectedDocuments: 3,
      processedDocuments: 3,
      extractedFees: 8,
      insertedFees: 7,
      freeFees: 0,
      skippedFees: 1,
      limit: 10,
      dryRun: false,
      results: [],
    });
  });

  it("creates a visible blocked run shell without any legacy backend call when execution is disabled", async () => {
    installSqlMocks();
    installTxMocks();

    const result = await startAgentRun({
      agent: "atlas",
      kind: "workflow",
      title: "Atlas full data cycle",
      params: { limit: 10 },
      triggeredBy: "admin",
      idempotencyKey: "atlas:test",
      steps: [
        { key: "discover", agent: "magellan", title: "Find URLs" },
        { key: "review", agent: "knox", title: "Review exceptions" },
      ],
    });

    expect(result.reused).toBe(false);
    expect(result.run).toMatchObject({
      id: 101,
      agent: "atlas",
      status: "blocked",
      backend: "agentic_v1",
      progressTotal: 2,
    });
    expect(result.steps[0]).toMatchObject({ status: "blocked" });
    expect(txMock.unsafe).not.toHaveBeenCalled();
    expect(runMagellanDiscoveryMock).not.toHaveBeenCalled();
    expect(runMagellanFetchMock).not.toHaveBeenCalled();
    const combinedSql = combinedTransactionSql();
    expect(combinedSql).toContain("INSERT INTO agent_runs");
    expect(combinedSql).toContain("INSERT INTO agent_run_steps");
    expect(combinedSql).toContain("run.blocked");
    expect(combinedSql).not.toContain("ops_jobs");
  });

  it("accepts deterministic runs while the provider automation stop is active", async () => {
    // Regression: the provider stop used to block every run at launch, freezing
    // deterministic fee ingestion when only provider billing was the problem.
    getExecutionBackendMock.mockReturnValue("agentic_v1");
    assertAutomationEnabledMock.mockRejectedValue(new Error("Emergency stop is active"));
    getAutomationControlMock.mockResolvedValue({ enabled: false, reason: "Provider credit failure" });
    const discoverRunRow = { ...runRow, progress_total: 1 };
    installSqlMocks({ finalRun: discoverRunRow, finalSteps: queuedStepRows.slice(0, 1) });
    installTxMocks(queuedStepRows.slice(0, 1), discoverRunRow);

    const result = await startAgentRun({
      agent: "atlas",
      kind: "workflow",
      title: "Atlas full data cycle",
      params: { limit: 10 },
      triggeredBy: "admin",
      idempotencyKey: "atlas:test",
      steps: [{ key: "discover", agent: "magellan", title: "Find URLs" }],
    });

    expect(result.run).toMatchObject({ id: 101, status: "queued" });
    expect(assertAutomationEnabledMock).not.toHaveBeenCalled();
    expect(combinedTransactionSql()).not.toContain("run.blocked");

    await expect(executeAgentRun(101)).resolves.toMatchObject({
      runId: 101,
      status: "completed",
      executedSteps: 1,
    });
    expect(runMagellanDiscoveryMock).toHaveBeenCalled();
  });

  it("leaves runs queued and executes nothing while the pipeline is paused", async () => {
    getExecutionBackendMock.mockReturnValue("agentic_v1");
    getPipelineControlMock.mockResolvedValue({ enabled: false, reason: "Operator maintenance" });
    const discoverRunRow = { ...runRow, progress_total: 1 };
    installSqlMocks({ finalRun: discoverRunRow, finalSteps: queuedStepRows.slice(0, 1) });
    installTxMocks(queuedStepRows.slice(0, 1), discoverRunRow);

    await expect(executeAgentRun(101)).resolves.toMatchObject({
      runId: 101,
      status: "queued",
      terminal: false,
      executedSteps: 0,
    });
    expect(runMagellanDiscoveryMock).not.toHaveBeenCalled();
    expect(combinedTransactionSql()).not.toContain("run.blocked");
  });

  it("creates a visible queued run first, then advances it through the agentic runner", async () => {
    getExecutionBackendMock.mockReturnValue("agentic_v1");
    const discoverRunRow = { ...runRow, progress_total: 1 };
    installSqlMocks({ finalRun: discoverRunRow, finalSteps: queuedStepRows.slice(0, 1) });
    installTxMocks(queuedStepRows.slice(0, 1), discoverRunRow);

    const result = await startAgentRun({
      agent: "atlas",
      kind: "workflow",
      title: "Atlas full data cycle",
      params: { limit: 10 },
      triggeredBy: "admin",
      idempotencyKey: "atlas:test",
      steps: [{ key: "discover", agent: "magellan", title: "Find URLs" }],
    });

    expect(result.reused).toBe(false);
    expect(result.run).toMatchObject({
      id: 101,
      status: "queued",
      progressCurrent: 0,
      progressTotal: 1,
    });
    expect(runMagellanDiscoveryMock).not.toHaveBeenCalled();
    await expect(executeAgentRun(101)).resolves.toMatchObject({
      runId: 101,
      status: "completed",
      terminal: true,
      executedSteps: 1,
    });
    expect(runMagellanDiscoveryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 101,
        mode: "discover",
        dryRun: false,
        limit: 10,
      }),
    );
    const combinedSql = combinedTransactionSql();
    expect(combinedSql).not.toContain("extracted_fees");
    expect(combinedSql).toContain("step.started");
    expect(combinedSql).toContain("step.finished");
    expect(combinedSql).toContain("run.completed");
    expect(combinedSql).not.toContain("ops_jobs");
  });

  it("runs Magellan fetch through the agentic worker instead of measuring only", async () => {
    getExecutionBackendMock.mockReturnValue("agentic_v1");
    const fetchStepRows = [
      {
        ...queuedStepRows[0],
        step_key: "fetch",
        title: "Fetch the institution fee document",
      },
    ];
    const fetchRunRow = {
      ...runRow,
      agent_name: "magellan",
      run_kind: "manual_repair",
      params_json: { institution_id: 42, fetch_limit: 1 },
    };
    installSqlMocks({ finalRun: fetchRunRow, finalSteps: fetchStepRows });
    installTxMocks(fetchStepRows, fetchRunRow);

    const result = await startAgentRun({
      agent: "magellan",
      kind: "manual_repair",
      title: "Extract fees for Test Bank",
      params: { institution_id: 42, fetch_limit: 1 },
      triggeredBy: "admin",
      idempotencyKey: "institution:42:extract",
      steps: [{ key: "fetch", agent: "magellan", title: "Fetch the institution fee document" }],
    });

    expect(result.reused).toBe(false);
    await executeAgentRun(101);
    expect(runMagellanFetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 101,
        dryRun: false,
        limit: 1,
        institutionId: 42,
      }),
    );
    expect(txMock.unsafe).not.toHaveBeenCalledWith(
      expect.stringContaining("fee_schedule_url IS NOT NULL"),
    );
  });

  it("runs a registry partition step outside a transaction with its partition key", async () => {
    getExecutionBackendMock.mockReturnValue("agentic_v1");
    runRegistryStepMock.mockResolvedValue({
      status: "completed",
      summary: "Magellan pulled 4,400 FDIC call reports for 2026Q2.",
      detail: { partition_key: "2026Q2", parsed_rows: 4400 },
    });
    const registryStepRows = [
      {
        ...queuedStepRows[0],
        step_key: "registry-fdic-financials",
        title: "Pull FDIC call-report financials 2026Q2",
        input_payload: { partition_key: "2026Q2" },
      },
    ];
    const registryRunRow = {
      ...runRow,
      agent_name: "magellan",
      params_json: { source: "magellan.registry", partition_key: "2026Q2" },
    };
    installSqlMocks({ finalRun: registryRunRow, finalSteps: registryStepRows });
    installTxMocks(registryStepRows, registryRunRow);

    await startAgentRun({
      agent: "magellan",
      kind: "workflow",
      title: "Magellan registry",
      params: { source: "magellan.registry", partition_key: "2026Q2" },
      triggeredBy: "test",
      steps: [{ key: "registry-fdic-financials", agent: "magellan", title: "Pull FDIC call-report financials" }],
    });
    const transactionsBefore = withTransactionMock.mock.calls.length;
    await executeAgentRun(101);

    expect(runRegistryStepMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stepKey: "registry-fdic-financials",
        runId: 101,
        partitionKey: "2026Q2",
        dryRun: false,
        db: sqlMock,
      }),
    );
    // prepare + finish each open a transaction; the network step itself does not.
    expect(withTransactionMock.mock.calls.length - transactionsBefore).toBe(2);
  });

  it("passes state lane scope into worker execution", async () => {
    getExecutionBackendMock.mockReturnValue("agentic_v1");
    const fetchStepRows = [
      {
        ...queuedStepRows[0],
        step_key: "fetch",
        title: "Fetch state source documents",
      },
    ];
    const fetchRunRow = {
      ...runRow,
      run_kind: "workflow_lane",
      state_code: "CA",
      params_json: { scope: "state", state_code: "CA", fetch_limit: 1 },
    };
    installSqlMocks({ finalRun: fetchRunRow, finalSteps: fetchStepRows });
    installTxMocks(fetchStepRows, fetchRunRow);

    const result = await startAgentRun({
      agent: "atlas",
      kind: "workflow_lane",
      title: "Atlas CA state lane",
      stateCode: "CA",
      params: { scope: "state", fetch_limit: 1 },
      triggeredBy: "admin",
      idempotencyKey: "atlas:state-lane:CA:2026-08-15",
      steps: [{ key: "fetch", agent: "magellan", title: "Fetch state source documents" }],
    });

    expect(result.reused).toBe(false);
    await executeAgentRun(101);
    expect(runMagellanFetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 101,
        dryRun: false,
        limit: 1,
        stateCode: "CA",
      }),
    );
  });

  it("runs public discovery through the agentic worker with state scope", async () => {
    getExecutionBackendMock.mockReturnValue("agentic_v1");
    const auditStepRows = [
      {
        ...queuedStepRows[0],
        step_key: "public-discovery",
        agent_name: "magellan",
        title: "Inventory and check state public discovery pages",
      },
    ];
    const auditRunRow = {
      ...runRow,
      run_kind: "workflow_lane",
      state_code: "CA",
      params_json: { scope: "state", state_code: "CA", public_discovery_limit: 12 },
    };
    installSqlMocks({ finalRun: auditRunRow, finalSteps: auditStepRows });
    installTxMocks(auditStepRows, auditRunRow);

    const result = await startAgentRun({
      agent: "atlas",
      kind: "workflow_lane",
      title: "Atlas CA public discovery lane",
      stateCode: "CA",
      params: { scope: "state", state_code: "CA", public_discovery_limit: 12 },
      triggeredBy: "admin",
      idempotencyKey: "atlas:public-discovery:CA:2026-08-15",
      steps: [{ key: "public-discovery", agent: "magellan", title: "Inventory public routes" }],
    });

    expect(result.reused).toBe(false);
    await executeAgentRun(101);
    expect(runPublicDiscoveryAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 101,
        dryRun: false,
        limit: 12,
        stateCode: "CA",
        db: sqlMock,
      }),
    );
  });

  it("runs Rosetta read through the agentic worker instead of measuring only", async () => {
    getExecutionBackendMock.mockReturnValue("agentic_v1");
    const readStepRows = [
      {
        ...queuedStepRows[0],
        step_key: "read",
        agent_name: "rosetta",
        title: "Read source document text",
      },
    ];
    const readRunRow = {
      ...runRow,
      agent_name: "rosetta",
      run_kind: "manual_repair",
      params_json: { institution_id: 42, read_limit: 4 },
    };
    installSqlMocks({ finalRun: readRunRow, finalSteps: readStepRows });
    installTxMocks(readStepRows, readRunRow);

    const result = await startAgentRun({
      agent: "rosetta",
      kind: "manual_repair",
      title: "Read fees for Test Bank",
      params: { institution_id: 42, read_limit: 4 },
      triggeredBy: "admin",
      idempotencyKey: "institution:42:read",
      steps: [{ key: "read", agent: "rosetta", title: "Read source document text" }],
    });

    expect(result.reused).toBe(false);
    await executeAgentRun(101);
    expect(runRosettaReadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 101,
        dryRun: false,
        limit: 4,
        institutionId: 42,
      }),
    );
    expect(txMock.unsafe).not.toHaveBeenCalledWith(
      expect.stringContaining("FROM source_documents"),
    );
  });

  it("cancels the run's queued later steps when a step fails", async () => {
    getExecutionBackendMock.mockReturnValue("agentic_v1");
    runRosettaReadMock.mockRejectedValue(new Error("invalid byte sequence"));
    const readStepRows = [
      { ...queuedStepRows[0], step_key: "read", agent_name: "rosetta", title: "Read source document text" },
      { ...queuedStepRows[0], id: 2, sequence: 2, step_key: "extract", agent_name: "knox", title: "Extract fees" },
    ];
    const readRunRow = {
      ...runRow,
      agent_name: "rosetta",
      run_kind: "manual_repair",
      params_json: { institution_id: 42, read_limit: 4 },
    };
    installSqlMocks({ finalRun: readRunRow, finalSteps: readStepRows });
    installTxMocks(readStepRows, readRunRow);

    await expect(executeAgentRun(101)).resolves.toMatchObject({ status: "failed", terminal: true });
    const combinedSql = combinedTransactionSql();
    expect(combinedSql).toContain("step.failed");
    expect(combinedSql).toContain("SET status = 'cancelled'");
    expect(combinedSql).toContain("AND status = 'queued'");
  });

  it("runs Knox extraction through the agentic worker instead of measuring only", async () => {
    getExecutionBackendMock.mockReturnValue("agentic_v1");
    const extractStepRows = [
      {
        ...queuedStepRows[0],
        step_key: "extract",
        agent_name: "knox",
        title: "Extract raw fee observations",
      },
    ];
    const extractRunRow = {
      ...runRow,
      agent_name: "knox",
      run_kind: "manual_repair",
      params_json: { institution_id: 42, extract_limit: 10 },
    };
    installSqlMocks({ finalRun: extractRunRow, finalSteps: extractStepRows });
    installTxMocks(extractStepRows, extractRunRow);

    const result = await startAgentRun({
      agent: "knox",
      kind: "manual_repair",
      title: "Extract fees for Test Bank",
      params: { institution_id: 42, extract_limit: 10 },
      triggeredBy: "admin",
      idempotencyKey: "institution:42:extract",
      steps: [{ key: "extract", agent: "knox", title: "Extract raw fee observations" }],
    });

    expect(result.reused).toBe(false);
    await executeAgentRun(101);
    expect(runKnoxExtractMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 101,
        dryRun: false,
        limit: 10,
        institutionId: 42,
        db: txMock,
      }),
    );
    expect(txMock.unsafe).not.toHaveBeenCalledWith(
      expect.stringContaining("FROM raw_fee_observations"),
    );
  });

  it("runs Darwin verification through the agentic worker instead of measuring only", async () => {
    getExecutionBackendMock.mockReturnValue("agentic_v1");
    const verifyStepRows = [
      {
        ...queuedStepRows[0],
        step_key: "verify",
        agent_name: "darwin",
        title: "Verify raw fee observations",
      },
    ];
    const verifyRunRow = {
      ...runRow,
      agent_name: "darwin",
      run_kind: "manual_repair",
      params_json: { institution_id: 42, verify_limit: 10 },
    };
    installSqlMocks({ finalRun: verifyRunRow, finalSteps: verifyStepRows });
    installTxMocks(verifyStepRows, verifyRunRow);

    const result = await startAgentRun({
      agent: "darwin",
      kind: "manual_repair",
      title: "Verify fees for Test Bank",
      params: { institution_id: 42, verify_limit: 10 },
      triggeredBy: "admin",
      idempotencyKey: "institution:42:verify",
      steps: [{ key: "verify", agent: "darwin", title: "Verify raw fee observations" }],
    });

    expect(result.reused).toBe(false);
    await executeAgentRun(101);
    expect(runDarwinVerifyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 101,
        dryRun: false,
        limit: 10,
        institutionId: 42,
        db: txMock,
      }),
    );
    expect(txMock.unsafe).not.toHaveBeenCalledWith(
      expect.stringContaining("FROM verified_fee_observations"),
    );
  });

  it("runs Hamilton publish through the agentic worker instead of measuring only", async () => {
    getExecutionBackendMock.mockReturnValue("agentic_v1");
    const publishStepRows = [
      {
        ...queuedStepRows[0],
        step_key: "publish",
        agent_name: "hamilton",
        title: "Publish clean fee intelligence",
      },
    ];
    const publishRunRow = {
      ...runRow,
      agent_name: "hamilton",
      run_kind: "manual_repair",
      params_json: {
        institution_id: 42,
        publish_limit: 10,
        publish_min_confidence: 0.88,
      },
    };
    installSqlMocks({ finalRun: publishRunRow, finalSteps: publishStepRows });
    installTxMocks(publishStepRows, publishRunRow);

    const result = await startAgentRun({
      agent: "hamilton",
      kind: "manual_repair",
      title: "Publish fees for Test Bank",
      params: {
        institution_id: 42,
        publish_limit: 10,
        publish_min_confidence: 0.88,
      },
      triggeredBy: "admin",
      idempotencyKey: "institution:42:publish",
      steps: [{ key: "publish", agent: "hamilton", title: "Publish clean fee intelligence" }],
    });

    expect(result.reused).toBe(false);
    await executeAgentRun(101);
    expect(runHamiltonPublishMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 101,
        dryRun: false,
        limit: 10,
        institutionId: 42,
        minConfidence: 0.88,
        db: txMock,
      }),
    );
    expect(combinedTransactionSql()).toContain("pg_advisory_xact_lock(hashtext('agents.hamilton.publish'))");
    expect(txMock.unsafe).not.toHaveBeenCalledWith(
      expect.stringContaining("FROM published_fee_records"),
    );
  });

  it("reuses an active idempotent run instead of creating a duplicate", async () => {
    sqlMock
      .mockResolvedValueOnce([{ ...runRow, status: "running" }])
      .mockResolvedValueOnce(queuedStepRows);

    const result = await startAgentRun({
      agent: "atlas",
      kind: "workflow",
      title: "Atlas full data cycle",
      triggeredBy: "admin",
      idempotencyKey: "atlas:test",
      steps: [{ key: "discover", agent: "magellan", title: "Find URLs" }],
    });

    expect(result.reused).toBe(true);
    expect(result.run.id).toBe(101);
    expect(result.steps).toHaveLength(2);
    expect(withTransactionMock).not.toHaveBeenCalled();
  });

  it("cancels an active agent run without touching ops_jobs", async () => {
    sqlMock.mockResolvedValueOnce([{ id: 101, status: "running" }]);
    txMock
      .mockResolvedValueOnce([{ id: 101 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await expect(cancelAgentRun(101, "admin")).resolves.toEqual({ success: true });
    expect(txMock).toHaveBeenCalledTimes(3);
    const combinedSql = combinedTransactionSql();
    expect(combinedSql).toContain("UPDATE agent_runs");
    expect(combinedSql).toContain("UPDATE agent_run_steps");
    expect(combinedSql).not.toContain("ops_jobs");
  });

  it("picks up legacy state_agent queued runs during queue drain", async () => {
    const legacyRunRow = {
      ...runRow,
      run_kind: "state_agent",
      state_code: "CA",
      params_json: { state_code: "CA" },
    };
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const text = templateText(strings);
      if (text.includes("SELECT id") && text.includes("status = 'queued'")) {
        return Promise.resolve([{ id: 101 }]);
      }
      if (text.includes("FROM agent_runs")) return Promise.resolve([legacyRunRow]);
      if (text.includes("FROM agent_run_steps")) return Promise.resolve(queuedStepRows);
      return Promise.resolve([]);
    });
    installTxMocks(queuedStepRows, legacyRunRow);

    const result = await executeQueuedAgentRuns({ runLimit: 1, maxStepsPerRun: 1 });

    expect(result).toMatchObject({
      selected: 1,
      results: [{ runId: 101, status: "blocked" }],
    });
    expect(JSON.stringify(sqlMock.mock.calls[0])).toContain("state_agent");
  });

  it("starts no further run once the tick deadline has passed, but still advances the first", async () => {
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const text = templateText(strings);
      if (text.includes("SELECT r.id")) return Promise.resolve([{ id: 101 }, { id: 102 }, { id: 103 }]);
      if (text.includes("FROM agent_runs")) return Promise.resolve([runRow]);
      if (text.includes("FROM agent_run_steps")) return Promise.resolve(queuedStepRows);
      return Promise.resolve([]);
    });
    installTxMocks(queuedStepRows, runRow);

    const result = await executeQueuedAgentRuns({ runLimit: 10, maxStepsPerRun: 10, deadlineAt: Date.now() - 1 });

    expect(result.selected).toBe(3);
    expect(result.results.map((run) => run.runId)).toEqual([101]);
  });

  it("leaves a paid step queued, neither run nor skipped, when the run has no paid slot this tick", async () => {
    getExecutionBackendMock.mockReturnValue("agentic_v1");
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const text = templateText(strings);
      if (text.includes("SELECT step_key")) return Promise.resolve([{ step_key: "read-paid" }]);
      if (text.includes("FROM agent_runs")) return Promise.resolve([runRow]);
      return Promise.resolve([]);
    });

    await expect(
      executeAgentRun(101, { maxSteps: 10, allowProviderSteps: true, deferProviderSteps: true }),
    ).resolves.toMatchObject({ runId: 101, status: "queued", terminal: false, executedSteps: 0 });
    expect(withTransactionMock).not.toHaveBeenCalled();
    expect(runRosettaReadMock).not.toHaveBeenCalled();
  });

  it("gives paid steps only to the first providerRunLimit runs of a tick", async () => {
    getExecutionBackendMock.mockReturnValue("agentic_v1");
    sqlMock.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = templateText(strings);
      if (text.includes("SELECT r.id")) return Promise.resolve([{ id: 101 }, { id: 102 }]);
      if (text.includes("SELECT step_key")) return Promise.resolve([{ step_key: "read-paid" }]);
      if (text.includes("FROM agent_runs")) {
        // Run 101 takes the one paid slot (and is already finished, so it does nothing).
        return Promise.resolve([values[0] === 101 ? { ...runRow, status: "completed" } : { ...runRow, id: 102 }]);
      }
      return Promise.resolve([]);
    });

    const result = await executeQueuedAgentRuns({
      runLimit: 10,
      maxStepsPerRun: 10,
      allowProviderSteps: true,
      providerRunLimit: 1,
    });

    expect(result.results[0]).toMatchObject({ runId: 101, terminal: true });
    expect(result.results[1]).toMatchObject({ runId: 102, terminal: false, executedSteps: 0 });
    expect(result.results[1].message).toContain("left queued");
    expect(withTransactionMock).not.toHaveBeenCalled();
  });

  it("still sends the Atlas daily brief while the pipeline is paused", async () => {
    getExecutionBackendMock.mockReturnValue("agentic_v1");
    getPipelineControlMock.mockResolvedValue({ enabled: false, reason: "Operator maintenance" });
    const briefStep = [{ ...queuedStepRows[0], step_key: "daily-brief", agent_name: "atlas", title: "Daily brief" }];
    const briefRun = { ...runRow, progress_total: 1 };
    installSqlMocks({ finalRun: briefRun, finalSteps: briefStep });
    installTxMocks(briefStep, briefRun);

    await expect(executeAgentRun(101)).resolves.toMatchObject({ executedSteps: 1 });
    expect(combinedTransactionSql()).toContain("step.finished");
  });

  it("starts no further step once the tick deadline has passed", async () => {
    getExecutionBackendMock.mockReturnValue("agentic_v1");
    getPipelineControlMock.mockResolvedValue({ enabled: false, reason: "Operator maintenance" });
    const briefStep = [{ ...queuedStepRows[0], step_key: "daily-brief", agent_name: "atlas", title: "Daily brief" }];
    const briefRun = { ...runRow, progress_total: 1 };
    installSqlMocks({ finalRun: briefRun, finalSteps: briefStep });
    installTxMocks(briefStep, briefRun);

    await expect(
      executeAgentRun(101, { maxSteps: 5, deadlineAt: Date.now() - 1 }),
    ).resolves.toMatchObject({ executedSteps: 1 });
  });

  it("runs the fee-alert dispatch as a visible step while the pipeline is paused", async () => {
    getExecutionBackendMock.mockReturnValue("agentic_v1");
    getPipelineControlMock.mockResolvedValue({ enabled: false, reason: "Operator maintenance" });
    const alertStep = [{ ...queuedStepRows[0], step_key: "fee-alert-dispatch", agent_name: "atlas", title: "Fee alerts" }];
    const alertRun = { ...runRow, progress_total: 1 };
    installSqlMocks({ finalRun: alertRun, finalSteps: alertStep });
    installTxMocks(alertStep, alertRun);

    await expect(executeAgentRun(101)).resolves.toMatchObject({ executedSteps: 1 });
    expect(combinedTransactionSql()).toContain("step.finished");
  });

  it("re-queues a stale running step and records a step.reaped event", async () => {
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const text = templateText(strings);
      if (text.includes("AS prior_reaps")) {
        return Promise.resolve([{ id: 7, agent_run_id: 240, step_key: "reclassify", prior_reaps: 0 }]);
      }
      return Promise.resolve([]);
    });
    txMock.mockResolvedValue([]);

    const result = await reapStaleAgentSteps();

    expect(result.requeued).toEqual([{ runId: 240, stepId: 7, stepKey: "reclassify", attempt: 1 }]);
    expect(result.dead).toEqual([]);
    const combinedSql = combinedTransactionSql();
    expect(combinedSql).toContain("SET status = 'queued'");
    expect(combinedSql).toContain("step.reaped");
  });

  it("marks a step dead and fails its run after the maximum reaped attempts", async () => {
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const text = templateText(strings);
      if (text.includes("AS prior_reaps")) {
        return Promise.resolve([{ id: 8, agent_run_id: 241, step_key: "read", prior_reaps: 2 }]);
      }
      return Promise.resolve([]);
    });
    txMock.mockResolvedValue([]);

    const result = await reapStaleAgentSteps({ maxAttempts: 3 });

    expect(result.dead).toEqual([{ runId: 241, stepId: 8, stepKey: "read", attempts: 3 }]);
    expect(result.requeued).toEqual([]);
    const combinedSql = combinedTransactionSql();
    expect(combinedSql).toContain("step.dead");
    expect(combinedSql).toContain("SET status = 'failed'");
    expect(combinedSql).toContain("SET status = 'cancelled'");
  });
});

describe("recordProRequest", () => {
  beforeEach(() => {
    txMock.mockReset();
    withTransactionMock.mockClear();
  });

  function text(call: unknown[]): string {
    return (call[0] as string[]).join("?");
  }

  it("writes one finished pro_request run, step and event in a transaction", async () => {
    txMock.mockResolvedValueOnce([{ id: 501 }]).mockResolvedValue([]);

    const runId = await recordProRequest({
      operation: "report",
      title: "Hamilton report: Peer Brief",
      status: "completed",
      summary: "Report saved.",
      userId: 7,
      institutionId: 2945,
      detail: { input_tokens: 10 },
    });

    expect(runId).toBe(501);
    expect(withTransactionMock).toHaveBeenCalledOnce();
    const statements = txMock.mock.calls.map(text);
    expect(statements[0]).toContain("INSERT INTO agent_runs");
    expect(statements[0]).toContain("'pro_request'");
    expect(statements[1]).toContain("INSERT INTO agent_run_steps");
    expect(statements[2]).toContain("INSERT INTO agent_run_events");
    expect(txMock.mock.calls[0]).toEqual(expect.arrayContaining(["completed", "user:7"]));
  });

  it("never throws, so the ledger cannot fail a paid request", async () => {
    txMock.mockRejectedValueOnce(new Error("check constraint"));
    await expect(
      recordProRequest({ operation: "thesis", title: "t", status: "failed", summary: "s", userId: null }),
    ).resolves.toBeNull();
  });
});

