import {
  getAutomationControl,
  getMarketingControl,
  getPipelineControl,
  type AutomationControlState,
} from "@/lib/automation-control";
import { getExecutionBackendStatus } from "@/lib/execution-backend";
import { isProviderStep, pauseScopeForStep } from "@/lib/agents/types";

/** The three controls in CLAUDE.md's "Three controls" rule. */
export type DispatchControl = "global" | "pipeline" | "marketing";

/**
 * Which controls govern a run made of these steps: `global` (the provider stop) only when a
 * step is a paid provider step, `marketing` for growth steps, `pipeline` for deterministic
 * data steps. Reporting steps (`PAUSE_EXEMPT_STEP_KEYS`) need neither pause.
 */
export function dispatchControlsForSteps(stepKeys: readonly string[]): Map<DispatchControl, string[]> {
  const controls = new Map<DispatchControl, string[]>();
  const add = (control: DispatchControl, key: string) => {
    controls.set(control, [...(controls.get(control) ?? []), key]);
  };
  for (const key of stepKeys) {
    if (isProviderStep(key)) add("global", key);
    const scope = pauseScopeForStep(key);
    if (scope !== "none") add(scope, key);
  }
  return controls;
}

const CONTROL_LABEL: Record<DispatchControl, string> = {
  global: "The provider stop (global control) is on",
  pipeline: "The pipeline is paused (pipeline control)",
  marketing: "Marketing is paused (marketing control)",
};

/**
 * Refuses an admin-started run only when a control that governs one of its steps is off.
 * Pass the step keys the run will queue, so a deterministic repair still runs while paid
 * model calls are stopped (#1402).
 */
export async function assertAtlasDispatchReady(stepKeys: readonly string[]): Promise<void> {
  const controls = dispatchControlsForSteps(stepKeys);
  const readers: Record<DispatchControl, () => Promise<AutomationControlState>> = {
    global: getAutomationControl,
    pipeline: getPipelineControl,
    marketing: getMarketingControl,
  };
  const checked = await Promise.all(
    [...controls.keys()].map(async (control) => ({ control, state: await readers[control]() })),
  );

  for (const { control, state } of checked) {
    if (state.enabled) continue;
    const steps = controls.get(control) ?? [];
    throw new Error(
      `${CONTROL_LABEL[control]}; this run queues ${steps.join(", ")}`
        + (state.reason ? `. Reason: ${state.reason}` : "."),
    );
  }

  const execution = getExecutionBackendStatus();
  if (!execution.enabled) {
    throw new Error(execution.detail);
  }
}
