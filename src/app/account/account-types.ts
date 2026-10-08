/** Below this many published fees a bank page shows no fee table (the 3-fee site bar). */
export const SITE_FEE_BAR = 3;

export interface AccountReport {
  id: string;
  title: string;
  createdAt: string;
  href: string;
}

export interface OwnInstitution {
  id: number;
  name: string;
  publishedFeeCount: number;
}

/** A market report the account's (confirmed) email paid for. */
export interface PaidReport {
  leadId: number;
  institutionName: string;
  paidAt: string;
  /** The private report link; null when links aren't configured. */
  href: string | null;
}
