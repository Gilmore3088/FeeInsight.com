// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe,it,expect } from "vitest";
import { LiveSourceAuditPanel } from "./live-source-audit-panel";
import { LIVE_SOURCE_AUDIT_SERIES } from "@/lib/agents/deming/live-source-audit";
import { liveAuditBrief,type LiveAuditComponent } from "@/lib/agents/deming/live-source-audit-records";
const component:LiveAuditComponent={summary:{protocol:1,series:LIVE_SOURCE_AUDIT_SERIES,drawId:1,day:"2026-10-19",asOf:"2026-10-19T12:00:00.000Z",componentAsOf:"2026-10-19T12:01:00.000Z",deadline:"2026-10-20T12:00:00.000Z",frameFingerprint:"a".repeat(64),state:"complete",reason:null,population:2,selected:2,attempted:2,supported:1,mismatch:0,unknown:1,unattempted:0,institutions:1,support:1,envelope:{low:0.5,high:1},byReason:{own_current_fee_supported:1,live_observation_failed:1},byDimension:{},capture:{requested:0,pending:0,captured:0,failed:0,blocked:0,oldestPendingAt:null},archiveState:"pending"},archive:null,archiveEventId:null};

describe("validated current and historical diagnostic projections",()=>{
  it("labels conditional support, unknowns, window and weekly launch policy consistently with the brief",()=>{
    const html=renderToStaticMarkup(<LiveSourceAuditPanel current={component} history={[]}/>);
    expect(html).toContain("1 supported, 0 positively contradicted, 1 unknown and 0 unattempted");
    expect(html).toContain("100.00%");expect(html).toContain("50.0–100.0%");expect(html).toContain("not a confidence interval or certification");
    expect(html).toContain("weekly 50 whole institutions");expect(html).toContain("Missing-fee recall is unmeasured");expect(html).toContain("2026-10-20T12:00:00.000Z");
    const brief=liveAuditBrief(component);expect(brief).toContain("supported");expect(brief).toContain("unknown");expect(brief).toContain("weekly");
  });
  it("never exposes a forged metric or falls back to a legacy/history score as current",()=>{
    const invalid={...component,summary:{...component.summary,supported:2}};
    const html=renderToStaticMarkup(<LiveSourceAuditPanel current={invalid} history={[{date:"2026-10-18",detail:{goal:{liveSourceAudit:invalid}}}]}/>);
    expect(html).toContain("no validated current draw");expect(html).toContain("unavailable / legacy");expect(html).not.toContain("100.00%");
    expect(liveAuditBrief(invalid)).toMatch(/unavailable/i);
  });
  it("shows explicit retained provenance loss without a numerical or current fallback",()=>{
    const detail={goal:{liveSourceAudit:null,liveSourceAuditUnavailable:{protocol:1,series:LIVE_SOURCE_AUDIT_SERIES,drawId:1,tombstoneId:2,reason:"origin_retention_exhausted",at:"2026-10-19T12:01:00.000Z"}}};
    const html=renderToStaticMarkup(<LiveSourceAuditPanel current={null} history={[{date:"2026-07-01",detail}]}/>);
    expect(html).toContain("provenance unavailable");expect(html).toContain("Origin retention exhausted");expect(html).not.toContain("100.00%");expect(html).toContain('scope="col"');expect(html).toContain("<caption");
  });
});
