import { strToU8, zipSync } from "fflate";

/**
 * Test samples of the Federal Reserve Board files the publisher loaders read. Not imported by app
 * code.
 *
 * - CHGDEL_DELINQUENCY_SA_HTML and SLOOS_CHART_DATA_HTML carry rows read from the live pages
 *   (federalreserve.gov/releases/chargeoff/delallsa.htm and data/sloos/sloos-202607-chart-data.htm)
 *   through a web reader on 2026-10-18: the header levels and the numbers are the Board's; the HTML
 *   markup around them is rebuilt, since the reader returned text, not the page source.
 * - sdmxPackage builds an SDMX compact-schema file in the shape the DDP help page describes
 *   (Series with SERIES_NAME and UNIT_MULT; Obs with TIME_PERIOD, OBS_VALUE, OBS_STATUS). The
 *   container that wrote it could not download a live package, so its values are illustrative.
 */

export const CHGDEL_DELINQUENCY_SA_HTML = `<html><body>
<h3>Delinquency Rates</h3><h4>All Banks, SA</h4>
<table class="statistics">
<thead>
<tr><th rowspan="3">&nbsp;</th><th colspan="4">Real estate loans</th><th colspan="3">Consumer loans</th><th rowspan="3">Leases</th><th rowspan="3">C&amp;I loans</th><th rowspan="3">Agricultural loans</th><th rowspan="3">Total loans and leases</th></tr>
<tr><th rowspan="2">All</th><th colspan="3">Booked in domestic offices</th><th rowspan="2">All</th><th rowspan="2">Credit cards</th><th rowspan="2">Other</th></tr>
<tr><th>Residential<sup>1</sup></th><th>Commercial<sup>2</sup></th><th>Farmland</th></tr>
</thead>
<tbody>
<tr><th>2026:2</th><td>1.68</td><td>1.86</td><td>1.53</td><td>1.33</td><td>2.62</td><td>2.85</td><td>2.33</td><td>1.19</td><td>1.27</td><td>1.10</td><td>1.42</td></tr>
<tr><th>2026:1</th><td>1.70</td><td>1.88</td><td>1.56</td><td>1.34</td><td>2.64</td><td>2.91</td><td>2.28</td><td>1.16</td><td>1.33</td><td>1.12</td><td>1.45</td></tr>
<tr><th>2025:4</th><td>1.68</td><td>1.79</td><td>1.58</td><td>1.31</td><td>2.63</td><td>2.95</td><td>2.27</td><td>1.22</td><td>1.34</td><td>1.16</td><td>1.46</td></tr>
<tr><th>1985:1</th><td>n.a.</td><td>n.a.</td><td>n.a.</td><td>n.a.</td><td>n.a.</td><td>n.a.</td><td>n.a.</td><td>n.a.</td><td>n.a.</td><td>n.a.</td><td>4.61</td></tr>
</tbody>
</table>
<h6>Footnotes</h6></body></html>`;

const sloosPanels = (panels: string[], subs: string[]) =>
  `<tr><th rowspan="2">Period</th>${panels.map((p) => `<th colspan="${subs.length}">${p}</th>`).join("")}</tr>` +
  `<tr>${panels.map(() => subs.map((s) => `<th>${s}</th>`).join("")).join("")}</tr>`;

export const SLOOS_CHART_DATA_HTML = `<html><body>
<h4>Figure 1: Measures of Supply and Demand for C&amp;I Loans by Size of Firm Seeking Loans</h4>
<table><thead>${sloosPanels(
  [
    "Net Percentage of Domestic Respondents Tightening Standards for C&amp;I Loans",
    "Net Percentage of Domestic Respondents Increasing Spreads of Loan Rates over Banks' Cost of Funds",
    "Net Percentage of Domestic Respondents Reporting Stronger Demand for C&amp;I Loans",
  ],
  ["Large and medium", "Small"],
)}</thead><tbody>
<tr><td>1990:2</td><td>54.4</td><td>52.7</td><td>10.7</td><td>7.4</td><td>n.a.</td><td>n.a.</td></tr>
<tr><td>2026:2</td><td>8.1</td><td>6.6</td><td>-12.9</td><td>-8.2</td><td>4.8</td><td>0.0</td></tr>
<tr><td>2026:3</td><td>0.0</td><td>1.8</td><td>-26.8</td><td>-14.5</td><td>16.1</td><td>3.6</td></tr>
</tbody></table>
<h4>Figure 3: Measures of Supply and Demand for Residential Mortgage Loans</h4>
<table><thead>${sloosPanels(
  [
    "Net Percentage of Domestic Respondents Tightening Standards for Mortgage Loans",
    "Net Percentage of Domestic Respondents Reporting Stronger Demand for Mortgage Loans",
  ],
  ["All", "Prime", "Nontraditional", "Subprime"],
)}</thead><tbody>
<tr><td>1991:1</td><td>32.7</td><td>n.a.</td><td>n.a.</td><td>n.a.</td><td>-57.4</td><td>n.a.</td><td>n.a.</td><td>n.a.</td></tr>
</tbody></table>
</body></html>`;

export interface SdmxSampleSeries {
  name: string;
  unitMult?: string;
  obs: Array<[period: string, value: string, status?: string]>;
}

/** An SDMX compact file for the given series, prefixed the way Board files are (kf:, frb:). */
export function sdmxXml(dataset: string, series: SdmxSampleSeries[]): string {
  const body = series
    .map(
      (s) =>
        `<kf:Series CURRENCY="USD" FREQ="19" SERIES_NAME="${s.name}" UNIT="Currency"${s.unitMult ? ` UNIT_MULT="${s.unitMult}"` : ""}>` +
        `<frb:Annotations><common:Annotation><common:AnnotationType>Short Description</common:AnnotationType><common:AnnotationText>${s.name} sample</common:AnnotationText></common:Annotation></frb:Annotations>` +
        s.obs.map(([period, value, status]) => `<frb:Obs OBS_STATUS="${status ?? "A"}" OBS_VALUE="${value}" TIME_PERIOD="${period}" />`).join("\n") +
        `</kf:Series>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<message:MessageGroup xmlns:frb="http://www.federalreserve.gov/structure/compact/common" xmlns:kf="http://www.federalreserve.gov/structure/compact/${dataset}" xmlns:message="http://www.SDMX.org/resources/SDMXML/schemas/v1_0/message">
<message:Header><message:ID>${dataset}</message:ID></message:Header>
<kf:DataSet id="${dataset}">
${body}
</kf:DataSet>
</message:MessageGroup>`;
}

/** A release package zip: the data file plus a structure file the reader must skip. */
export function sdmxPackage(dataset: string, series: SdmxSampleSeries[]): Uint8Array {
  return zipSync({
    [`${dataset}_data.xml`]: strToU8(sdmxXml(dataset, series)),
    [`${dataset}_struct.xml`]: strToU8(`<structure><kf:Series SERIES_NAME="${series[0]?.name ?? "X"}"><frb:Obs OBS_VALUE="1" TIME_PERIOD="1900-01-01"/></kf:Series></structure>`),
  });
}
