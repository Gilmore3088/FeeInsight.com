import { recordProRequest } from "@/lib/agents/run-store";
import { getPeerListRows, getPeerListSubject } from "@/lib/data-store/hamilton-peer-list";
import { getPublishedPeerFees } from "@/lib/data-store/hamilton-peer-fees";
import { getActivePeerSet } from "./active-peer-set";
import { loadHamiltonAccountContext } from "./account-context-store";
import { normalizeCanonicalInstitutionId } from "./context-link";
import { resolveHamiltonInstitutionContext } from "./workspace-context";
import { feeCategoriesIn } from "./workspace/ask";
import { proseFeeName } from "./workspace/names";
import { isPeerListContinuationQuestion, peerListFeeFollowUp, peerListFollowUpFeePhrase, parsePeerListQuestion, peerListRefinementState, validatePeerListContinuation, peerListReferencesUnchanged, planPeerList, MAX_PEER_LIST_ROWS, type PeerListCriteria, type PeerListData, type PeerListResponse, type PeerListSubject } from "./peer-list";

/** Why "us" has no institution: none linked, or more than one. Never the researched institution. */
function noAccountInstitution(status: string): string {
  const why = status === "ambiguous"
    ? "More than one institution is linked to your account, so Hamilton can't tell which one is \"us\"."
    : "No institution is linked to your account, so there is no \"us\" to compare.";
  return `${why} Hamilton did not treat the institution you are researching as yours.`;
}

interface PeerAskBody { institutionId?: unknown; question?: unknown; answer?: unknown; previousPeerList?: unknown }
interface PeerAsker { id: number; institution_name?: string | null }

/** Says which institutions a capped list kept and how to see the others (#1540). */
export function cappedListNote(criteria: Pick<PeerListCriteria, "sort" | "limit">, shown: number, total: number): string {
  const kept = criteria.sort === "closest_assets" ? `the ${shown} closest in size` : criteria.sort === "largest_assets" ? `the ${shown} largest by assets` : `the first ${shown} by name`;
  const rest = criteria.limit < MAX_PEER_LIST_ROWS ? `Ask for "all" to see up to ${MAX_PEER_LIST_ROWS}.` : "Narrow the criteria to see the rest.";
  return `Showing ${kept} of ${total} matching institutions; ${total - shown} more are not shown. ${rest}`;
}

/** A recognized list is never sent to fee analysis or a paid narrative fallback. */
export async function answerPeerList(user: PeerAsker, body: PeerAskBody, recordActivity = true): Promise<PeerListResponse | null> {
  if (body.answer !== undefined || typeof body.question !== "string") return null;
  const question = body.question;
  const isContinuation = body.previousPeerList !== undefined;
  const intent = isContinuation ? null : parsePeerListQuestion(question);
  if (!isContinuation && !intent) return null;
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
      if (isContinuation) {
        // The original list is independently re-queried under the current user.
        // Neither client-selected IDs nor the old subject is trusted as authority.
        const prior = validatePeerListContinuation(body.previousPeerList);
        const state = peerListRefinementState(question);
        const feeIntent = peerListFeeFollowUp(question);
        // "Compare their overdraft fees" names one fee; "How does this compare with us?" means NSF.
        const phrase = feeIntent ? peerListFollowUpFeePhrase(question) : null;
        const named = phrase ? feeCategoriesIn(phrase) : ["nsf"];
        if (feeIntent && named.length !== 1)
          return message("needs_criteria", `Name one fee to compare, for example "Compare their overdraft fees" or "Compare their NSF fees". ${named.length ? "That names more than one fee." : "Hamilton did not recognize that fee."} Nothing was compared.`);
        const category = named[0];
        const label = proseFeeName(category);
        // "Compare with us" with no list yet: say whether the account has an institution to be "us",
        // from the account alone. The researched institution is never taken to be the asker's.
        if (!prior && feeIntent === "with_account") {
          const resolved = await loadHamiltonAccountContext(user);
          if (resolved.status === "unavailable")
            return message("unavailable", "Hamilton could not check which institution is linked to your account. Nothing was compared.");
          if (resolved.status !== "identified" || !resolved.institution)
            return message("needs_criteria", `${noAccountInstitution(resolved.status)} To see peers' ${label} fees, ask for a peer list first, then "Compare their ${label} fees".`);
          return message("needs_criteria", `Ask for a peer list first, for example "List ten similarly sized peers". Then ask "How does this compare with us?" to add ${resolved.institution.name}.`);
        }
        if (!prior || !isPeerListContinuationQuestion(question))
          return message("needs_criteria", "This follow-up has no valid prior peer list. Run the peer list again; no replacement list was selected.");
        const suppliedId = body.institutionId === undefined || body.institutionId === null || body.institutionId === ""
          ? null : typeof body.institutionId === "string" || typeof body.institutionId === "number"
            ? String(body.institutionId) : "";
        if (suppliedId !== prior.originInstitutionId)
          return message("needs_criteria", "The research institution changed. Start a new peer list; the earlier selection was not reused.");
        if (!state && !feeIntent)
          return message("needs_criteria", "Refine the displayed peers by state, ask 'Compare their NSF fees', or 'How does this compare with us?'. No new peer group or paid report was started.");
        const original = await answerPeerList(user, {
          question: prior.originQuestion,
          institutionId: prior.originInstitutionId,
        }, false);
        if (!original || original.peerList.status !== "ready" ||
            original.peerList.subject?.institutionId !== prior.originSubjectId ||
            !peerListReferencesUnchanged(original.peerList.rows, prior)) {
          return message("unavailable", "The original peer selection or its dated records have changed. Run the original list again; no substitute peer group was used.");
        }
        const selected = new Set(prior.selectedIds);
        const rows = original.peerList.rows.filter(row =>
          selected.has(row.institutionId) && (!state || row.stateCode === state));
        const count = prior.selectedIds.length;
        let feeComparison: PeerListData["feeComparison"];
        if (feeIntent) {
          let account: { institutionId: number; name: string } | null = null;
          if (feeIntent === "with_account") {
            const resolved = await loadHamiltonAccountContext(user);
            if (resolved.status !== "identified" || !resolved.institution)
              return resolved.status === "unavailable"
                ? message("unavailable", "Hamilton could not check which institution is linked to your account. Nothing was compared.")
                : message("needs_criteria", `${noAccountInstitution(resolved.status)} To compare the listed peers, ask "Compare their ${label} fees".`);
            account = { institutionId: Number(resolved.institution.id), name: resolved.institution.name };
            if (!Number.isSafeInteger(account.institutionId) || account.institutionId <= 0)
              return message("unavailable", "The account institution ID is invalid. No comparison was generated.");
          }
          const ids = rows.map(row => row.institutionId);
          const fees = ids.length || account ? await getPublishedPeerFees(
            [...new Set([...ids, ...(account ? [account.institutionId] : [])])], category) : [];
          feeComparison = {
            category, label, comparedPeerIds: ids, fees, account, includesAccount: account !== null,
            note: `Each consumer ${label} fee a peer publishes is listed on its own line, $0 fees included. A peer with no line has no matching published fee on file, and Hamilton fills in no amount for it.`,
          };
        }
        return {
          kind: "peer_list",
          shortAnswer: feeIntent
            ? feeIntent === "with_account" ? `${label[0].toUpperCase()}${label.slice(1)} fees for ${rows.length} selected peer${rows.length === 1 ? "" : "s"} compared with your institution.` : `Published ${label} fees for ${rows.length} selected peer${rows.length === 1 ? "" : "s"}.`
            : rows.length + " of " + count + " previously displayed peers are in " + state + ".",
          peerList: {
            ...original.peerList,
            rows,
            totalMatches: rows.length,
            criteria: original.peerList.criteria ? {
              ...original.peerList.criteria,
              states: state ? [state] : original.peerList.criteria.states,
              institutionIds: [...prior.selectedIds],
              descriptions: [...original.peerList.criteria.descriptions,
                "This refinement used only the " + count + " institutions displayed in the previous list."],
            } : null,
            notes: [...original.peerList.notes,
              "Only the previously displayed peer IDs were considered; no new peers were introduced. Reporting dates were rechecked."],
            ...(feeComparison ? { feeComparison } : {}),
          },
        };
      } else if (!intent) {
        result = message("needs_criteria", "Select a valid peer-list question.");
      } else if (question.trim().length > 1000) {
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
        const notes = ["Assets are from each institution's latest stored FDIC or NCUA filing, not a live check. Reporting dates may differ.", "Stored financial amounts are in USD thousands and are converted once to dollars here; dollar formatting does not imply more source precision."];
        if (found.totalMatches > found.rows.length) notes.push(cappedListNote(criteria, found.rows.length, found.totalMatches));
        else if ((criteria.requestedCount ?? 0) > criteria.limit) notes.push(`This view shows at most ${criteria.limit} institutions.`);
        if (criteria.requestedCount !== null && found.totalMatches < criteria.requestedCount) notes.push(found.totalMatches === 0
          ? `No institution meets these criteria. The filters above were not widened to find ${criteria.requestedCount}.`
          : `Only ${found.totalMatches} institution${found.totalMatches === 1 ? " meets" : "s meet"} these criteria. The filters above were not widened to reach ${criteria.requestedCount}.`);
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
  if (recordActivity) await recordProRequest({
    operation: "ask", title: "Hamilton peer list", status: result.peerList.status === "unavailable" ? "failed" : "completed",
    summary: result.shortAnswer, userId: user.id,
    ...(recordedSubject ? { institutionId: recordedSubject.institutionId } : {}),
    detail: { response_kind: "peer_list", question, criteria: result.peerList.criteria, returned_count: result.peerList.rows.length, matching_count: result.peerList.totalMatches, provider_called: false },
  }).catch((error) => console.error("[hamilton-peer-list] activity receipt failed", error));
  return result;
}
