export interface InstitutionProfileLinkParams {
  institutionId: number;
  institutionName: string;
}

export interface InstitutionProfileLinks {
  submitSourceHref: string;
  claimReviewHref: string;
  analyzeHref: string;
  briefHref: string;
  scenarioHref: string;
}

export function buildInstitutionProfileLinks({
  institutionId,
  institutionName,
}: InstitutionProfileLinkParams): InstitutionProfileLinks {
  const instId = String(institutionId);
  return {
    submitSourceHref: `/submit-fees?institutionId=${instId}&institutionName=${encodeURIComponent(institutionName)}`,
    claimReviewHref: `/login?from=${encodeURIComponent(`/pro/settings?instId=${instId}&claim=1`)}`,
    analyzeHref: `/pro/analyze?instId=${instId}&intent=institution`,
    briefHref: `/pro/reports?instId=${instId}&intent=competitive-brief`,
    scenarioHref: `/pro/simulate?instId=${instId}`,
  };
}

export interface PublicInstitutionProfileLinkParams extends InstitutionProfileLinkParams {
  /** Logged-in viewers keep the direct Pro routes; anonymous viewers are sent to /subscribe. */
  isAuthenticated: boolean;
}

export interface PublicInstitutionProfileLinks {
  /** Free correction path: `/submit-fees?institution=<id>`. */
  correctSourceHref: string;
  /** Free institution-employee claim path: `/submit-fees?institution=<id>&claim=1`. */
  claimHref: string;
  /** Competitive Fee Position report offer, carrying `institution`, `name` and `src=profile` for the form. */
  reportOfferHref: string;
  analyzeHref: string;
  briefHref: string;
  scenarioHref: string;
}

/**
 * Links for the public institution profile. Pro actions route anonymous
 * viewers to the Pro plans with `from=<that Pro screen>`, so after checkout they land on the
 * brief, question or scenario they clicked rather than back on the profile.
 */
export function buildPublicInstitutionProfileLinks({
  institutionId,
  institutionName,
  isAuthenticated,
}: PublicInstitutionProfileLinkParams): PublicInstitutionProfileLinks {
  const instId = String(institutionId);
  const gate = (proHref: string) =>
    isAuthenticated ? proHref : `/subscribe?from=${encodeURIComponent(proHref)}#pro`;
  const reportContext = new URLSearchParams({ institution: instId, name: institutionName, src: "profile" });
  return {
    correctSourceHref: `/submit-fees?institution=${instId}`,
    claimHref: `/submit-fees?institution=${instId}&claim=1`,
    reportOfferHref: `/for-institutions?${reportContext.toString()}#report`,
    analyzeHref: gate(`/pro/analyze?instId=${instId}&intent=institution`),
    briefHref: gate(`/pro/reports?instId=${instId}&intent=competitive-brief`),
    scenarioHref: gate(`/pro/simulate?instId=${instId}`),
  };
}
