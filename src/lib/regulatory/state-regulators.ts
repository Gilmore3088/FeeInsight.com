/**
 * State chartering agencies for banks and credit unions (50 states + DC).
 *
 * States publish no common machine-readable registry, so this is a reviewed
 * constant that the registry-state-regulators step upserts into
 * state_regulators. `creditUnionAgency` is set only where a state charters
 * credit unions through a different agency than its banks. Websites are the
 * agencies' public home pages; null where a stable URL was not confirmed.
 */

export interface StateRegulator {
  stateCode: string;
  stateName: string;
  agency: string;
  website: string | null;
  creditUnionAgency?: string;
  creditUnionWebsite?: string | null;
}

export const STATE_REGULATORS: StateRegulator[] = [
  { stateCode: "AL", stateName: "Alabama", agency: "Alabama State Banking Department", website: "https://banking.alabama.gov", creditUnionAgency: "Alabama Credit Union Administration", creditUnionWebsite: null },
  { stateCode: "AK", stateName: "Alaska", agency: "Alaska Division of Banking and Securities", website: "https://www.commerce.alaska.gov/web/dbs" },
  { stateCode: "AZ", stateName: "Arizona", agency: "Arizona Department of Insurance and Financial Institutions", website: "https://difi.az.gov" },
  { stateCode: "AR", stateName: "Arkansas", agency: "Arkansas State Bank Department", website: "https://bank.arkansas.gov", creditUnionAgency: "Arkansas Credit Union Commission", creditUnionWebsite: null },
  { stateCode: "CA", stateName: "California", agency: "California Department of Financial Protection and Innovation", website: "https://dfpi.ca.gov" },
  { stateCode: "CO", stateName: "Colorado", agency: "Colorado Division of Banking", website: "https://banking.colorado.gov", creditUnionAgency: "Colorado Division of Financial Services", creditUnionWebsite: "https://dfs.colorado.gov" },
  { stateCode: "CT", stateName: "Connecticut", agency: "Connecticut Department of Banking", website: "https://portal.ct.gov/dob" },
  { stateCode: "DE", stateName: "Delaware", agency: "Delaware Office of the State Bank Commissioner", website: "https://banking.delaware.gov" },
  { stateCode: "DC", stateName: "District of Columbia", agency: "DC Department of Insurance, Securities and Banking", website: "https://disb.dc.gov" },
  { stateCode: "FL", stateName: "Florida", agency: "Florida Office of Financial Regulation", website: "https://flofr.gov" },
  { stateCode: "GA", stateName: "Georgia", agency: "Georgia Department of Banking and Finance", website: "https://dbf.georgia.gov" },
  { stateCode: "HI", stateName: "Hawaii", agency: "Hawaii Division of Financial Institutions", website: "https://cca.hawaii.gov/dfi" },
  { stateCode: "ID", stateName: "Idaho", agency: "Idaho Department of Finance", website: "https://www.finance.idaho.gov" },
  { stateCode: "IL", stateName: "Illinois", agency: "Illinois Department of Financial and Professional Regulation", website: "https://idfpr.illinois.gov" },
  { stateCode: "IN", stateName: "Indiana", agency: "Indiana Department of Financial Institutions", website: "https://www.in.gov/dfi" },
  { stateCode: "IA", stateName: "Iowa", agency: "Iowa Division of Banking", website: null, creditUnionAgency: "Iowa Credit Union Division", creditUnionWebsite: null },
  { stateCode: "KS", stateName: "Kansas", agency: "Kansas Office of the State Bank Commissioner", website: "https://www.osbckansas.org", creditUnionAgency: "Kansas Department of Credit Unions", creditUnionWebsite: "https://kdcu.ks.gov" },
  { stateCode: "KY", stateName: "Kentucky", agency: "Kentucky Department of Financial Institutions", website: "https://kfi.ky.gov" },
  { stateCode: "LA", stateName: "Louisiana", agency: "Louisiana Office of Financial Institutions", website: "https://ofi.la.gov" },
  { stateCode: "ME", stateName: "Maine", agency: "Maine Bureau of Financial Institutions", website: "https://www.maine.gov/pfr/financialinstitutions" },
  { stateCode: "MD", stateName: "Maryland", agency: "Maryland Office of Financial Regulation", website: "https://labor.maryland.gov/finance" },
  { stateCode: "MA", stateName: "Massachusetts", agency: "Massachusetts Division of Banks", website: "https://www.mass.gov/orgs/division-of-banks" },
  { stateCode: "MI", stateName: "Michigan", agency: "Michigan Department of Insurance and Financial Services", website: "https://www.michigan.gov/difs" },
  { stateCode: "MN", stateName: "Minnesota", agency: "Minnesota Department of Commerce", website: "https://mn.gov/commerce" },
  { stateCode: "MS", stateName: "Mississippi", agency: "Mississippi Department of Banking and Consumer Finance", website: "https://dbcf.ms.gov" },
  { stateCode: "MO", stateName: "Missouri", agency: "Missouri Division of Finance", website: "https://finance.mo.gov", creditUnionAgency: "Missouri Division of Credit Unions", creditUnionWebsite: "https://cu.mo.gov" },
  { stateCode: "MT", stateName: "Montana", agency: "Montana Division of Banking and Financial Institutions", website: "https://banking.mt.gov" },
  { stateCode: "NE", stateName: "Nebraska", agency: "Nebraska Department of Banking and Finance", website: "https://ndbf.nebraska.gov" },
  { stateCode: "NV", stateName: "Nevada", agency: "Nevada Financial Institutions Division", website: "https://fid.nv.gov" },
  { stateCode: "NH", stateName: "New Hampshire", agency: "New Hampshire Banking Department", website: "https://www.banking.nh.gov" },
  { stateCode: "NJ", stateName: "New Jersey", agency: "New Jersey Department of Banking and Insurance", website: "https://www.nj.gov/dobi" },
  { stateCode: "NM", stateName: "New Mexico", agency: "New Mexico Financial Institutions Division", website: "https://www.rld.nm.gov/financial-institutions" },
  { stateCode: "NY", stateName: "New York", agency: "New York State Department of Financial Services", website: "https://www.dfs.ny.gov" },
  { stateCode: "NC", stateName: "North Carolina", agency: "North Carolina Commissioner of Banks", website: "https://www.nccob.nc.gov", creditUnionAgency: "North Carolina Credit Union Division", creditUnionWebsite: null },
  { stateCode: "ND", stateName: "North Dakota", agency: "North Dakota Department of Financial Institutions", website: "https://www.nd.gov/dfi" },
  { stateCode: "OH", stateName: "Ohio", agency: "Ohio Division of Financial Institutions", website: "https://com.ohio.gov/divisions-and-programs/financial-institutions" },
  { stateCode: "OK", stateName: "Oklahoma", agency: "Oklahoma State Banking Department", website: "https://banking.ok.gov" },
  { stateCode: "OR", stateName: "Oregon", agency: "Oregon Division of Financial Regulation", website: "https://dfr.oregon.gov" },
  { stateCode: "PA", stateName: "Pennsylvania", agency: "Pennsylvania Department of Banking and Securities", website: "https://www.dobs.pa.gov" },
  { stateCode: "RI", stateName: "Rhode Island", agency: "Rhode Island Department of Business Regulation, Banking Division", website: "https://dbr.ri.gov" },
  { stateCode: "SC", stateName: "South Carolina", agency: "South Carolina Board of Financial Institutions", website: "https://banking.sc.gov" },
  { stateCode: "SD", stateName: "South Dakota", agency: "South Dakota Division of Banking", website: "https://dlr.sd.gov/banking" },
  { stateCode: "TN", stateName: "Tennessee", agency: "Tennessee Department of Financial Institutions", website: "https://www.tn.gov/tdfi" },
  { stateCode: "TX", stateName: "Texas", agency: "Texas Department of Banking", website: "https://www.dob.texas.gov", creditUnionAgency: "Texas Credit Union Department", creditUnionWebsite: "https://www.cud.texas.gov" },
  { stateCode: "UT", stateName: "Utah", agency: "Utah Department of Financial Institutions", website: "https://dfi.utah.gov" },
  { stateCode: "VT", stateName: "Vermont", agency: "Vermont Department of Financial Regulation", website: "https://dfr.vermont.gov" },
  { stateCode: "VA", stateName: "Virginia", agency: "Virginia State Corporation Commission, Bureau of Financial Institutions", website: "https://www.scc.virginia.gov" },
  { stateCode: "WA", stateName: "Washington", agency: "Washington Department of Financial Institutions", website: "https://dfi.wa.gov" },
  { stateCode: "WV", stateName: "West Virginia", agency: "West Virginia Division of Financial Institutions", website: "https://dfi.wv.gov" },
  { stateCode: "WI", stateName: "Wisconsin", agency: "Wisconsin Department of Financial Institutions", website: "https://dfi.wi.gov", creditUnionAgency: "Wisconsin Office of Credit Unions", creditUnionWebsite: "https://dfi.wi.gov" },
  { stateCode: "WY", stateName: "Wyoming", agency: "Wyoming Division of Banking", website: "https://wyomingbankingdivision.wyo.gov" },
];

/** Agency that charters this institution, given its regulator fields. */
export function chartering(
  stateCode: string | null | undefined,
  charterType: string | null | undefined,
  charterAgency: string | null | undefined,
): { agency: string; website: string | null } | null {
  if (!charterAgency) return null;
  if (charterAgency !== "State") return { agency: charterAgency, website: null };
  const state = STATE_REGULATORS.find((entry) => entry.stateCode === stateCode);
  if (!state) return { agency: "State regulator", website: null };
  if (charterType === "credit_union" && state.creditUnionAgency) {
    return { agency: state.creditUnionAgency, website: state.creditUnionWebsite ?? null };
  }
  return { agency: state.agency, website: state.website };
}
