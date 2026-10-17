/**
 * Custom peer groups: the hook every Pro chart and benchmark calls to follow the peer group a
 * bank picked in Settings ("Use for all charts").
 *
 *   const active = await getActivePeerSet({ userId, institutionId });
 *   const candidates = [
 *     ...(active ? [peerSetCandidate(active)] : []),
 *     ...buildInstitutionPeerFilterCandidates(institution),
 *     {},
 *   ];
 *
 * getActivePeerSet returns the workspace's default set (only for an active member of that
 * workspace), else the user's own default, else null. peerSetCandidate turns it into a
 * HamiltonPeerFilters candidate whose `label` is the set's name, so describePeerFilters and
 * every label built on it name the group the way the bank named it. The data readers
 * (getPeerFeeValues, getPeerIndex, getPeerIndexes) ignore `label` and honour the set's
 * `institutionIds` (exactly those peers) and `states`.
 *
 * A set with a wider dimension (asset range in dollars, regulator, credit union charter, holding
 * company, metro market, closest in assets) is resolved once through resolvePeerSet
 * (src/lib/data-store/peer-sets.ts) into the exact institutions, so its filters are
 * `institutionIds` and every reader above works unchanged. resolveSavedPeerSetFilters is that
 * one path, for any caller holding a saved set.
 *
 * The implementation lives in peer-index.ts beside the resolver, which uses the same default
 * when no peerSetId is passed.
 */
export {
  chooseDefaultPeerSet,
  getActivePeerSet,
  resolveSavedPeerSetFilters,
  peerSetCandidate,
  pickActivePeerSet,
  type ActivePeerSet,
} from "./peer-index";
