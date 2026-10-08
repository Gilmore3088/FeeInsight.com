import { CONTACT_EMAIL, PRODUCT_NAME, SITE_NAME, SITE_URL } from "@/lib/constants";


/**
 * /llms.txt (llmstxt.org): a plain-language map of the site for AI assistants and answer
 * engines, so they describe the data correctly and link to the right pages. No counts here:
 * live numbers belong on the pages, which read them from the catalog.
 */
export function buildLlmsTxt(base: string = SITE_URL): string {
  const link = (path: string) => `${base}${path}`;
  return [
    `# ${SITE_NAME}`,
    "",
    `> ${SITE_NAME} publishes the ${PRODUCT_NAME}: what U.S. banks and credit unions charge in fees (overdraft, NSF, monthly maintenance, ATM, wire and more). Every fee is read from the institution's own published fee schedule and checked before it is published, with a link back to that source.`,
    "",
    "Fees stated as a dollar amount and fees stated as a rate are kept apart and never averaged together. A median is shown only when enough institutions publish that fee. Comparisons state how far a fee sits above or below a median; they do not rate institutions as good or bad.",
    "",
    "## Look up fees",
    "",
    `- [Fee index by category](${link("/fees")}): medians and typical ranges for each fee type`,
    `- [Institution directory](${link("/institutions")}): each bank or credit union's published fees against state and national medians, with sources`,
    `- [Consumer guides](${link("/guides")}): plain-language explanations of common bank fees`,
    "",
    "## Research",
    "",
    `- [Research hub](${link("/research")}): national, state and Federal Reserve district fee reports`,
    `- [National fee index](${link("/research/national-fee-index")})`,
    `- [Fed districts](${link("/districts")})`,
    `- [Methodology](${link("/methodology")}): how fees are collected, checked and summarized`,
    "",
    "## For banks and credit unions",
    "",
    `- [Benchmarking and fee reports](${link("/for-institutions")}): free national and district reports, and a paid report comparing one institution with named local competitors`,
    `- [Pro plans](${link("/subscribe")}): the Hamilton workspace for fee and pricing teams`,
    `- [API documentation](${link("/api-docs")})`,
    "",
    "## Contact",
    "",
    `- ${CONTACT_EMAIL}`,
    "",
  ].join("\n");
}
