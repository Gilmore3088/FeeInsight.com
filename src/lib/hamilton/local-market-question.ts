/** Questions about the local market that name no fee: competitors, branches, locations. Pure, so the Ask bar can test it. */
const LOCAL_MARKET =
  /\b(competitors?|competition|compete|local market|my market|our market|branch(es)?|locations?|footprint|nearby|who('s| is| are)? (near|around)|in (my|our) (area|town|city|county))\b/i;

export function isLocalMarketQuestion(question: string): boolean {
  return LOCAL_MARKET.test(question);
}
