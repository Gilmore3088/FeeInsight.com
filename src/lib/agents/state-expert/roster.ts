/**
 * The state experts: one agent design, 55 memories. Each state, DC and territory has a
 * named expert whose memory (`state_memory`) the `state-expert` lane step refreshes.
 * The name is a label for the memory; the behavior is the same code for every state.
 *
 * Each name is a historical (deceased) banking or finance figure from that place. Bios
 * are one factual line; `source` says where the claim is documented. "Hamilton" is the
 * publishing agent, so New York's expert is Albert Gallatin. Where a place has no
 * well-known banker, the roster names a well-documented public figure from it and the
 * bio says only what is on the record.
 */

export interface StateExpert {
  stateCode: string;
  name: string;
  bio: string;
  /** Where the bio's claim is documented. */
  source: string;
}

export const STATE_EXPERTS: readonly StateExpert[] = [
  { stateCode: "AL", name: "John Sparkman", bio: "U.S. Senator from Alabama who chaired the Senate Banking and Currency Committee (1967-1975).", source: "U.S. Senate Biographical Directory" },
  { stateCode: "AK", name: "Elmer E. Rasmuson", bio: "Longtime head of the National Bank of Alaska and mayor of Anchorage.", source: "Rasmuson Foundation history" },
  { stateCode: "AZ", name: "Walter Bimson", bio: "Built Valley National Bank into Arizona's largest bank as its president from 1933.", source: "Arizona Historical Society" },
  { stateCode: "AR", name: "Witt Stephens", bio: "Little Rock financier who built Stephens Inc. into a major investment bank.", source: "Encyclopedia of Arkansas" },
  { stateCode: "CA", name: "A. P. Giannini", bio: "Founded the Bank of Italy in San Francisco (1904), later Bank of America.", source: "Bank of America corporate history" },
  { stateCode: "CO", name: "David Moffat", bio: "Denver banker who led the First National Bank of Denver and financed Colorado railroads.", source: "Colorado Encyclopedia" },
  { stateCode: "CT", name: "J. Pierpont Morgan", bio: "Hartford-born banker who led J.P. Morgan & Co. and organized the response to the Panic of 1907.", source: "The Morgan Library & Museum" },
  { stateCode: "DE", name: "John J. Raskob", bio: "Financier who ran finance at DuPont and General Motors and made his home in Delaware.", source: "Hagley Museum and Library" },
  { stateCode: "DC", name: "William Wilson Corcoran", bio: "Washington banker who co-founded Corcoran & Riggs, later Riggs Bank.", source: "Smithsonian / National Gallery of Art archives" },
  { stateCode: "FL", name: "Alfred I. du Pont", bio: "Industrialist who moved to Jacksonville and started the Florida National Bank group.", source: "Alfred I. duPont Testamentary Trust history" },
  { stateCode: "GA", name: "Mills B. Lane Jr.", bio: "President of Atlanta's Citizens and Southern National Bank through its postwar growth.", source: "New Georgia Encyclopedia" },
  { stateCode: "HI", name: "Charles Reed Bishop", bio: "Founded Bishop & Co. (1858), Hawaii's first successful bank and forerunner of First Hawaiian Bank.", source: "First Hawaiian Bank history" },
  { stateCode: "ID", name: "C. W. Moore", bio: "Boise pioneer who founded the First National Bank of Idaho in 1867.", source: "Idaho State Historical Society" },
  { stateCode: "IL", name: "Charles G. Dawes", bio: "Comptroller of the Currency, Chicago bank founder, and U.S. Vice President.", source: "U.S. Senate Historical Office" },
  { stateCode: "IN", name: "Hugh McCulloch", bio: "Indiana state banker who became the first Comptroller of the Currency and later Treasury Secretary.", source: "U.S. Department of the Treasury" },
  { stateCode: "IA", name: "Leslie M. Shaw", bio: "Denison, Iowa banker and governor who served as U.S. Treasury Secretary (1902-1907).", source: "U.S. Department of the Treasury" },
  { stateCode: "KS", name: "J. N. Dolley", bio: "Kansas Bank Commissioner who championed the first state securities ('blue sky') law in 1911.", source: "Kansas Historical Society" },
  { stateCode: "KY", name: "Fred M. Vinson", bio: "Kentucky congressman who served as U.S. Treasury Secretary (1945-1946) and Chief Justice.", source: "U.S. Department of the Treasury" },
  { stateCode: "LA", name: "Russell B. Long", bio: "U.S. Senator from Louisiana who chaired the Senate Finance Committee (1966-1981).", source: "U.S. Senate Biographical Directory" },
  { stateCode: "ME", name: "William Pitt Fessenden", bio: "U.S. Senator from Maine who chaired Senate Finance and served as Treasury Secretary (1864-1865).", source: "U.S. Department of the Treasury" },
  { stateCode: "MD", name: "Johns Hopkins", bio: "Baltimore merchant, investor and bank director whose bequest founded the university and hospital.", source: "Johns Hopkins University history" },
  { stateCode: "MA", name: "Joseph P. Kennedy Sr.", bio: "Boston bank president at 25 who became the first chairman of the SEC (1934).", source: "U.S. Securities and Exchange Commission" },
  { stateCode: "MI", name: "Arthur H. Vandenberg", bio: "U.S. Senator from Michigan whose 1933 amendment started temporary federal deposit insurance.", source: "FDIC history" },
  { stateCode: "MN", name: "Charles A. Lindbergh Sr.", bio: "Minnesota congressman who pressed for the 1912 'Money Trust' inquiry and wrote on banking reform.", source: "Minnesota Historical Society" },
  { stateCode: "MS", name: "Pat Harrison", bio: "U.S. Senator from Mississippi who chaired the Senate Finance Committee (1933-1941).", source: "U.S. Senate Biographical Directory" },
  { stateCode: "MO", name: "William McChesney Martin Jr.", bio: "St. Louis native who chaired the Federal Reserve for nearly 19 years (1951-1970).", source: "Federal Reserve History" },
  { stateCode: "MT", name: "Samuel T. Hauser", bio: "Helena banker who founded the First National Bank of Helena and served as territorial governor.", source: "Montana Historical Society" },
  { stateCode: "NE", name: "Herman Kountze", bio: "Co-founded the Omaha bank that became the First National Bank of Omaha.", source: "First National Bank of Omaha history" },
  { stateCode: "NV", name: "William Sharon", bio: "Virginia City agent of the Bank of California during the Comstock era and U.S. Senator.", source: "Online Nevada Encyclopedia" },
  { stateCode: "NH", name: "Levi Woodbury", bio: "New Hampshire governor and senator who served as U.S. Treasury Secretary (1834-1841).", source: "U.S. Department of the Treasury" },
  { stateCode: "NJ", name: "Paul A. Volcker", bio: "Cape May-born Federal Reserve chairman (1979-1987) who broke the inflation of the 1970s.", source: "Federal Reserve History" },
  { stateCode: "NM", name: "Conrad Hilton", bio: "Born in San Antonio, New Mexico; tried local banking before founding Hilton Hotels.", source: "Conrad N. Hilton Foundation history" },
  { stateCode: "NY", name: "Albert Gallatin", bio: "Longest-serving U.S. Treasury Secretary (1801-1814) and later president of the National Bank of New York.", source: "U.S. Department of the Treasury" },
  { stateCode: "NC", name: "Francis H. Fries", bio: "Founding president of the Wachovia Loan and Trust Company in Winston (1893).", source: "NCpedia" },
  { stateCode: "ND", name: "Lynn J. Frazier", bio: "North Dakota governor whose administration created the state-owned Bank of North Dakota (1919).", source: "Bank of North Dakota history" },
  { stateCode: "OH", name: "Salmon P. Chase", bio: "Ohio governor and Treasury Secretary who shaped the National Banking Acts of 1863-1864.", source: "U.S. Department of the Treasury" },
  { stateCode: "OK", name: "Frank Phillips", bio: "Bartlesville banker who went on to found Phillips Petroleum.", source: "Oklahoma Historical Society" },
  { stateCode: "OR", name: "William S. Ladd", bio: "Co-founded Ladd & Tilton, Portland's first bank (1859).", source: "Oregon Encyclopedia" },
  { stateCode: "PA", name: "Robert Morris", bio: "Superintendent of Finance of the Revolution who chartered the Bank of North America (1781).", source: "U.S. National Park Service" },
  { stateCode: "RI", name: "Nelson W. Aldrich", bio: "U.S. Senator from Rhode Island whose Aldrich Plan laid groundwork for the Federal Reserve.", source: "Federal Reserve History" },
  { stateCode: "SC", name: "Langdon Cheves", bio: "South Carolina congressman who served as president of the Second Bank of the United States (1819-1822).", source: "U.S. House History" },
  { stateCode: "SD", name: "Peter Norbeck", bio: "U.S. Senator from South Dakota who chaired the Banking Committee when it began the Pecora inquiry.", source: "U.S. Senate Historical Office" },
  { stateCode: "TN", name: "Andrew Jackson", bio: "Tennessee president who vetoed the recharter of the Second Bank of the United States (1832).", source: "Miller Center, University of Virginia" },
  { stateCode: "TX", name: "Jesse H. Jones", bio: "Houston banker who chaired the Reconstruction Finance Corporation and served as Commerce Secretary.", source: "Texas State Historical Association" },
  { stateCode: "UT", name: "Marriner S. Eccles", bio: "Utah banker who chaired the Federal Reserve (1934-1948).", source: "Federal Reserve History" },
  { stateCode: "VT", name: "Justin S. Morrill", bio: "U.S. Senator from Vermont who wrote the Morrill Tariff and chaired the Senate Finance Committee.", source: "U.S. Senate Biographical Directory" },
  { stateCode: "VA", name: "Carter Glass", bio: "Virginia legislator who co-wrote the Federal Reserve Act and the Glass-Steagall Act and served as Treasury Secretary.", source: "Federal Reserve History" },
  { stateCode: "WA", name: "Dexter Horton", bio: "Founded Seattle's first bank, Dexter Horton & Co. (1870).", source: "HistoryLink.org" },
  { stateCode: "WV", name: "Henry Gassaway Davis", bio: "West Virginia senator and industrialist who built railroad, coal and banking interests around Elkins.", source: "e-WV: The West Virginia Encyclopedia" },
  { stateCode: "WI", name: "Alexander Mitchell", bio: "Milwaukee banker who led the Wisconsin Marine and Fire Insurance Company bank.", source: "Wisconsin Historical Society" },
  { stateCode: "WY", name: "Nellie Tayloe Ross", bio: "Wyoming governor who served as Director of the U.S. Mint (1933-1953).", source: "U.S. Mint history" },
  { stateCode: "PR", name: "Teodoro Moscoso", bio: "Led Puerto Rico's Operation Bootstrap industrial development program (Fomento).", source: "Encyclopedia of Puerto Rico" },
  { stateCode: "VI", name: "Ralph M. Paiewonsky", bio: "St. Thomas businessman who served as Governor of the U.S. Virgin Islands (1961-1969).", source: "U.S. Virgin Islands government records" },
  { stateCode: "GU", name: "Jesus S. Leon Guerrero", bio: "Founder of the Bank of Guam (1972), the territory's locally owned commercial bank.", source: "Bank of Guam history" },
  { stateCode: "AS", name: "Peter Tali Coleman", bio: "First Samoan-born governor of American Samoa and later its first elected governor.", source: "American Samoa government records" },
];

const BY_STATE = new Map(STATE_EXPERTS.map((expert) => [expert.stateCode, expert]));

/** The expert for a state code, or null for codes outside the 55 lanes. */
export function stateExpertFor(stateCode: string | null | undefined): StateExpert | null {
  if (!stateCode) return null;
  return BY_STATE.get(stateCode.trim().toUpperCase()) ?? null;
}
