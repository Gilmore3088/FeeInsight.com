/**
 * Hamilton Mode System — Screen capability gating.
 * Mode is orthogonal to HamiltonRole (consumer/pro/admin in agents.ts).
 * Each screen has fixed capabilities; components check MODE_BEHAVIOR[mode].canX.
 */

export type HamiltonMode = "home" | "analyze" | "simulate" | "report" | "monitor";

export const MODE_BEHAVIOR = {
  home:     { canRecommend: false, canExport: false, canSimulate: true  },
  analyze:  { canRecommend: false, canExport: false, canSimulate: true  },
  simulate: { canRecommend: true,  canExport: true,  canSimulate: true  },
  report:   { canRecommend: true,  canExport: true,  canSimulate: false },
  monitor:  { canRecommend: false, canExport: false, canSimulate: true  },
} as const;
