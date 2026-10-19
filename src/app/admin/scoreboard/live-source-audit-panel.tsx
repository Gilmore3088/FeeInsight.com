import { readHistoricalLiveSourceAudit,readHistoricalLiveAuditUnavailable } from "@/lib/data-store/live-source-audit-read";
import { validateLiveAuditComponent,type LiveAuditComponent } from "@/lib/agents/deming/live-source-audit-records";

/** Current evidence and retained dated draws are shown separately; draws are never pooled as independent fee labels. */
export function LiveSourceAuditPanel({current,history}:{current:LiveAuditComponent|null;history:Array<{date:string;detail:unknown}>}){
  const validated=validateLiveAuditComponent(current),s=validated?.summary;
  const retained=history.map(row=>({date:row.date,component:readHistoricalLiveSourceAudit(row.detail),unavailable:readHistoricalLiveAuditUnavailable(row.detail)}));
  return <section className="admin-card space-y-3 p-4" aria-labelledby="live-source-title">
    <h2 id="live-source-title" className="text-sm font-semibold">Live-source diagnostic</h2>
    <p className="text-xs text-gray-500">Automated checks of freshly observed official schedules using the shared source validator. Missing-fee recall is unmeasured. Launch accuracy remains James’s weekly 50 whole institutions.</p>
    <p className="text-sm" role="status">{s?`${s.state.replaceAll("_"," ")}: ${s.supported} supported, ${s.mismatch} positively contradicted, ${s.unknown} unknown and ${s.unattempted} unattempted of ${s.selected} selected fees (${s.institutions} institutions).`:"Unavailable: no validated current draw."}</p>
    {s?<p className="text-xs">Draw {s.day}; read as of {s.componentAsOf}; observations belong to the frozen window starting {s.asOf}; window ends {s.deadline}. {s.capture.pending} captures pending, {s.capture.captured} captured, {s.capture.failed+s.capture.blocked} failed or blocked. Current receipts are read live; retained archives are listed below. {s.reason??""}</p>:null}
    {s?.support!=null?<p className="text-xs">Conditional support among scorable fees: {(s.support*100).toFixed(2)}%. Selected-fee support envelope {((s.envelope?.low??0)*100).toFixed(1)}–{((s.envelope?.high??1)*100).toFixed(1)}%; unknowns may fall either way. This is not a confidence interval or certification.</p>:null}
    <details><summary className="cursor-pointer text-xs font-semibold">Dated draw history (separate cohorts)</summary>
      <div className="overflow-x-auto"><table className="w-full text-left text-xs"><caption className="sr-only">Retained live-source diagnostic draws; unavailable and legacy rows carry no score</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">State</th><th scope="col">Supported</th><th scope="col">Contradicted</th><th scope="col">Unknown / unattempted</th><th scope="col">Archive</th></tr></thead>
        <tbody>{retained.map(({date,component,unavailable})=>{const row=component?.summary;return <tr key={date}><th scope="row">{date}</th><td>{row?.state??(unavailable?"provenance unavailable":"unavailable / legacy")}</td><td>{row?.supported??"—"}</td><td>{row?.mismatch??"—"}</td><td>{row?`${row.unknown} / ${row.unattempted}`:"—"}</td><td>{row?.archiveState??(unavailable?`Origin retention exhausted (${unavailable.at})`:"unavailable")}</td></tr>;})}</tbody>
      </table></div>
    </details>
  </section>;
}
