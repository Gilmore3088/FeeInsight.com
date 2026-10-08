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
