export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "Washington DC",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  PR: "Puerto Rico", VI: "Virgin Islands", GU: "Guam", AS: "American Samoa",
};

// Territory codes — DC is a district, PR/VI/GU/AS are US territories
const TERRITORY_CODES = ["DC", "PR", "VI", "GU", "AS"] as const;
export const US_TERRITORIES = new Set<string>(TERRITORY_CODES);
/** The territories alone, without DC: a list holding one is "states and territories". */
export const OVERSEAS_TERRITORIES = new Set<string>(["PR", "VI", "GU", "AS"]);

// 50 US states (everything in STATE_NAMES minus territories)
export const US_STATES_ONLY = new Set<string>(
  Object.keys(STATE_NAMES).filter((code) => !US_TERRITORIES.has(code))
);

// All valid US jurisdiction codes (50 states + DC + territories)
export const VALID_US_CODES = new Set<string>(Object.keys(STATE_NAMES));

// Freely Associated States — not US jurisdictions, should be excluded from aggregations
export const EXCLUDED_CODES = new Set(["FM", "MH", "PW"]);

// Compatibility export — 50 states + DC (excludes overseas territories)
export const STATE_CODES = Object.keys(STATE_NAMES).filter(
  (code) => !["PR", "VI", "GU", "AS"].includes(code)
);
