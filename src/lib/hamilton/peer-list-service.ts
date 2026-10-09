import { recordProRequest } from "@/lib/agents/run-store";
import { getPeerListRows, getPeerListSubject } from "@/lib/data-store/hamilton-peer-list";
import { getActivePeerSet } from "./active-peer-set";
import { loadHamiltonAccountContext } from "./account-context-store";
import { normalizeCanonicalInstitutionId } from "./context-link";
import { resolveHamiltonInstitutionContext } from "./workspace-context";
import { parsePeerListQuestion, planPeerList, type PeerListData, type PeerListResponse, type PeerListSubject } from "./peer-list";

interface PeerAskBody { institutionId?: unknown; question?: unknown; answer?: unknown }
interface PeerAsker { id: number; institution_name?: string | null }

/** A recognized list is never sent to fee analysis or a paid narrative fallback. */
export async function answerPeerList(user: PeerAsker, body: PeerAskBody): Promise<PeerListResponse | null> {
  if (body.answer !== undefined || typeof body.question !== "string") return null;
  const question = body.question;
  const intent = parsePeerListQuestion(question);
  if (!intent) return null;
  const now = new Date();
  const queriedAt = now.toISOString();
  const asOf = queriedAt.slice(0, 10);
  let subject: PeerListSubject | null = null;
  const message = (status: PeerListData["status"], text: string): PeerListResponse => ({
    kind: "peer_list", shortAnswer: text,
    peerList: { version: 1, status, subject, criteria: null, rows: [], totalMatches: null, queriedAt, notes: [] },
  });
  const build = async (): Promise<PeerListResponse> => {
    let result: PeerListResponse;
    try {
      if (question.trim().length > 1000) {
        result = message("needs_criteria", "Keep the peer-list question to 1,000 characters or fewer.");
      } else if (intent.problems.length) {
        result = message("needs_criteria", intent.problems.join(" "));
      } else {
        const supplied = body.institutionId;
        const hasSupplied = supplied !== undefined && supplied !== null && supplied !== "";
        const explicitId = typeof supplied === "string" || typeof supplied === "number" ? normalizeCanonicalInstitutionId(supplied) : null;
        if (hasSupplied && !explicitId) return message("needs_criteria", "Choose a valid research institution before requesting its peers.");
        let subjectId = explicitId;
        if (intent.accountSubject) {
          const account = await loadHamiltonAccountContext(user);
          if (account.status !== "identified" || !account.institution) {
            return message(account.status === "unavailable" ? "unavailable" : "needs_criteria", "The account institution could not be identified unambiguously. Select the intended institution and ask for its peers without using 'my' or 'our'; the viewed institution will not be assumed to be yours.");
          }
          subjectId = String(account.institution.id);
        }
        const resolved = await resolveHamiltonInstitutionContext({ userId: user.id, instId: subjectId, persistUrlSelection: false });
        if (resolved.error) return message("unavailable", "The research context could not be loaded. Retry the peer list; no substitute institution was used.");
        subjectId = resolved.institution ? String(resolved.institution.id) : null;
        if (!subjectId && !hasSupplied && !intent.accountSubject) {
          const account = await loadHamiltonAccountContext(user);
          subjectId = account.institution ? String(account.institution.id) : null;
        }
        if (!subjectId) return message("needs_criteria", "Select a research institution first. Its identity will be shown with the peer list.");
        subject = await getPeerListSubject(Number(subjectId), asOf);
        if (!subject) return message("unavailable", "That research institution could not be loaded. No substitute institution was used.");
        const explicitFilters = Boolean(intent.charterType || intent.bothTypes || intent.states.length || intent.sameState || intent.minAssets || intent.maxAssets || intent.similarSize || intent.largest);
        // Do not silently discard a saved-group lookup failure and switch to a national default.
        const active = intent.saved || (!explicitFilters && intent.peerBased)
          ? await getActivePeerSet({ userId: user.id, institutionId: subject.institutionId })
          : null;
        const planned = planPeerList(intent, subject, active);
        if (!planned.criteria) return message("needs_criteria", planned.problem ?? "Specify peer criteria.");
        const criteria = planned.criteria;
        const found = await getPeerListRows(subject.institutionId, criteria, asOf);
        const notes = ["Assets are from each institution's latest stored FDIC or NCUA filing, not a live check. Reporting dates may differ."];
        if (criteria.requestedCount === null || (criteria.requestedCount ?? 0) > criteria.limit) notes.push(`This view is limited to ${criteria.limit} rows. Narrow the criteria to inspect a smaller group.`);
        if (criteria.requestedCount !== null && found.totalMatches < criteria.requestedCount) notes.push(`Only ${found.totalMatches} institutions meet these criteria; the filters were not widened to reach ${criteria.requestedCount}.`);
        const older = found.rows.filter(row => row.reportDate && now.getTime() - new Date(`${row.reportDate}T00:00:00Z`).getTime() > 365 * 86400000).length;
        if (older) notes.push(`${older} displayed asset filing${older === 1 ? " is" : "s are"} more than 365 days old. Review the reporting dates before comparing.`);
        result = {
          kind: "peer_list",
          shortAnswer: `${found.rows.length} of ${found.totalMatches} matching institutions for ${subject.name}.`,
          peerList: { version: 1, status: "ready", subject, criteria, rows: found.rows, totalMatches: found.totalMatches, queriedAt, notes },
        };
      }
    } catch (error) {
      console.error("[hamilton-peer-list] lookup failed", error);
      result = message("unavailable", "The peer list could not be loaded. Retry it; no report or broader substitute list was generated.");
    }
    return result;
  };
  const result = await build();
  const recordedSubject = result.peerList.subject;
  // Public-data lookup only. This activity receipt is not a saved peer-set mutation.
  await recordProRequest({
    operation: "ask", title: "Hamilton peer list", status: result.peerList.status === "unavailable" ? "failed" : "completed",
    summary: result.shortAnswer, userId: user.id,
    ...(recordedSubject ? { institutionId: recordedSubject.institutionId } : {}),
    detail: { response_kind: "peer_list", question, criteria: result.peerList.criteria, returned_count: result.peerList.rows.length, matching_count: result.peerList.totalMatches, provider_called: false },
  }).catch((error) => console.error("[hamilton-peer-list] activity receipt failed", error));
  return result;
}
