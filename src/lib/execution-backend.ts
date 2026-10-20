export type ExecutionBackend = "disabled" | "agentic_v1";

const BACKENDS = new Set<ExecutionBackend>(["disabled", "agentic_v1"]);

export interface ExecutionBackendStatus {
  backend: ExecutionBackend;
  enabled: boolean;
  label: string;
  detail: string;
}

export function getExecutionBackend(): ExecutionBackend {
  const raw = process.env.EXECUTION_BACKEND?.trim();
  if (!raw) return "disabled";
  if (BACKENDS.has(raw as ExecutionBackend)) return raw as ExecutionBackend;
  return "disabled";
}

export function getExecutionBackendStatus(): ExecutionBackendStatus {
  const backend = getExecutionBackend();
  if (backend === "agentic_v1") {
    return {
      backend,
      enabled: true,
      label: "Agentic backend selected",
      detail:
        "Retired external launchers remain blocked; launches must use the agentic run API.",
    };
  }

  return {
    backend,
    enabled: false,
    label: "Agentic backend disabled",
    detail:
      "Agent execution is visible but blocked until EXECUTION_BACKEND=agentic_v1 is selected.",
  };
}
