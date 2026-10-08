export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { CAMPAIGN_NAME_PREFIX, CAMPAIGNS_PER_MONTH, formatBrief, parseCampaignName, scoreCampaign } from "@/lib/agents/marketing/formats";
import { listCampaigns, listGroups, mailerLiteConfigured, nationalGroupId, toStateGroups, type AgentCampaign } from "@/lib/agents/marketing/mailerlite-campaigns";
import { mailingAddress } from "@/lib/agents/marketing/monthly";
import { STATE_EDITION_FORMAT } from "@/lib/agents/marketing/state-edition";

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five"];
/** "one format" / "two formats", from the number planMonth actually picks. */
const formatsPicked = `${NUMBER_WORDS[CAMPAIGNS_PER_MONTH] ?? CAMPAIGNS_PER_MONTH} format${CAMPAIGNS_PER_MONTH === 1 ? "" : "s"}`;

async function load() {
  if (!mailerLiteConfigured()) return { error: "MAILERLITE_API_KEY is not set, so Growth can't read campaigns." } as const;
  try {
    const [drafts, sent, groups] = await Promise.all([
      listCampaigns("draft", CAMPAIGN_NAME_PREFIX),
      listCampaigns("sent", CAMPAIGN_NAME_PREFIX),
      listGroups().catch(() => null),
    ]);
    // Every reader sits in the national group or one state group, so these add up once each.
    const national = groups ? await nationalGroupId(undefined, groups, false) : null;
    const groupSize = groups
      ? (groups.find((group) => group.id === national)?.activeCount ?? 0) + toStateGroups(groups).reduce((sum, group) => sum + group.activeCount, 0)
      : null;
    return { drafts, sent, groupSize } as const;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "MailerLite could not be read." } as const;
  }
}

function byMonth(campaigns: AgentCampaign[]) {
  const months = new Map<string, AgentCampaign[]>();
  for (const campaign of campaigns) {
    const month = parseCampaignName(campaign.name)?.month ?? "other";
    months.set(month, [...(months.get(month) ?? []), campaign]);
  }
  return [...months.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

/** Growth's monthly marketing: this month's drafts to approve, and how past campaigns scored. */
export default async function MarketingPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  await requireAuth("view");
  const params = await searchParams;
  const data = await load();
  const address = mailingAddress();

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-6 py-8">
      <header>
        <p className="text-xs uppercase tracking-wide text-gray-500">
          <Link href="/admin/customers" className="underline">Customers</Link> · Marketing
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">Monthly marketing</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          On the 1st, Growth scores last month&apos;s emails, picks {formatsPicked} it hasn&apos;t used in three months,
          writes {CAMPAIGNS_PER_MONTH === 1 ? "it" : "them"} from live data and drafts {CAMPAIGNS_PER_MONTH === 1 ? "it" : "each"} as an A/B subject test in MailerLite. Readers who picked a state also get
          that state&apos;s edition. Nothing sends until you approve the month here.
        </p>
      </header>

      {params.sent ? (
        <p className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Approval recorded as run {params.sent}. Its result is in the Agents room activity log.
        </p>
      ) : null}

      {!address ? (
        <p className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          Sending is blocked: set MARKETING_MAILING_ADDRESS in Vercel. Marketing email must carry a postal address in its footer.
        </p>
      ) : null}

      {"error" in data ? (
        <p className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">{data.error}</p>
      ) : (
        <>
          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Waiting for your approval</h2>
            <p className="text-sm text-gray-500">
              Readers: {data.groupSize === null ? "size unknown" : `${data.groupSize} active subscriber${data.groupSize === 1 ? "" : "s"}`}.
            </p>
            {data.drafts.length === 0 ? (
              <p className="mt-3 text-sm text-gray-600">No drafts. The next set is written on the 1st.</p>
            ) : (
              byMonth(data.drafts).map(([month, all]) => {
                const editions = all.filter((c) => parseCampaignName(c.name)?.format === STATE_EDITION_FORMAT);
                const campaigns = all.filter((c) => parseCampaignName(c.name)?.format !== STATE_EDITION_FORMAT);
                return (
                <div key={month} className="mt-4 rounded-md border border-black/10 p-4 dark:border-white/10">
                  <h3 className="font-semibold">{month}</h3>
                  <ul className="mt-2 space-y-3 text-sm">
                    {campaigns.map((campaign) => {
                      const format = parseCampaignName(campaign.name)?.format ?? "";
                      return (
                        <li key={campaign.id}>
                          <p className="font-medium">{formatBrief(format)?.label ?? format}</p>
                          <p className="text-gray-600">Subjects tested: {campaign.subjects.map((s) => `“${s}”`).join(" vs ") || "see preview"}</p>
                          {campaign.previewUrl ? (
                            <a className="text-[#C44B2E] underline" href={campaign.previewUrl} target="_blank" rel="noreferrer">Preview</a>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                  {editions.length ? (
                    <div className="mt-3 text-sm">
                      <p className="font-medium">State editions ({editions.length}), each to readers who picked that state</p>
                      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                        {editions.map((campaign) => {
                          const code = campaign.name.split(" · ")[2] ?? campaign.name;
                          return campaign.previewUrl ? (
                            <a key={campaign.id} className="text-[#C44B2E] underline" href={campaign.previewUrl} target="_blank" rel="noreferrer">{code}</a>
                          ) : (
                            <span key={campaign.id}>{code}</span>
                          );
                        })}
                      </p>
                    </div>
                  ) : null}
                  <form action="/api/admin/marketing/approve" method="post" className="mt-4">
                    <input type="hidden" name="month" value={month} />
                    <button
                      type="submit"
                      disabled={!address}
                      className="rounded-md bg-[#C44B2E] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                    >
                      Approve and send {month}
                    </button>
                  </form>
                </div>
                );
              })
            )}
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Scorecard</h2>
            {data.sent.length === 0 ? (
              <p className="mt-2 text-sm text-gray-600">No agent campaigns sent yet.</p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th>Month</th><th>Format</th><th className="text-right">Sent to</th><th className="text-right">Opens</th>
                    <th className="text-right">Clicks</th><th className="text-right">Unsubs</th><th className="text-right">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sent.map((campaign) => {
                    const parsed = parseCampaignName(campaign.name);
                    return (
                      <tr key={campaign.id} className="border-t border-black/5">
                        <td>{parsed?.month}</td>
                        <td>{formatBrief(parsed?.format ?? "")?.label ?? parsed?.format}</td>
                        <td className="text-right">{campaign.recipients}</td>
                        <td className="text-right">{pct(campaign.openRate)}</td>
                        <td className="text-right">{pct(campaign.clickRate)}</td>
                        <td className="text-right">{pct(campaign.unsubscribeRate)}</td>
                        <td className="text-right font-semibold">{scoreCampaign(campaign)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <p className="mt-2 text-xs text-gray-500">
              Score = 0.3 × open rate + 2 × click rate − 10 × unsubscribe rate, as 0 to 100. Sends under 100 people count only lightly when Growth learns.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
