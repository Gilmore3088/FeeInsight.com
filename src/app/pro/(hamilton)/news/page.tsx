export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import {
  getArticles,
  getArticleCount,
  getTopicCounts,
  getSourceCounts,
  TOPIC_LABELS,
  SOURCE_LABELS,
} from "@/lib/data-store/news";
import { getFederalRuleTracker } from "@/lib/data-store/federal-rules";
import { getStateWire, getStatesWithNews } from "@/lib/data-store/state-news";
import { getFederalRelated, getResearchNotes, getStateRelated } from "@/lib/data-store/wire-research";
import {
  WIRE_PAGE_SIZE,
  pageWindow,
  parseWireParams,
  rangePhrase,
  rangeSince,
} from "@/lib/regulatory/wire";
import { STATE_NAMES } from "@/lib/us-states";
import { NewsFeed } from "./news-feed";
import { RefreshButton } from "./refresh-button";
import { JurisdictionField, StateWire, stateItemKey } from "./state-wire";
import { WireControls, WireHeader } from "./wire-controls";

export const metadata: Metadata = {
  title: "Regulatory Wire",
};

export default async function NewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const returnParams = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) {
      value.forEach((item) => returnParams.append(key, item));
    } else if (value) {
      returnParams.set(key, value);
    }
  }
  const returnPath = returnParams.toString() ? `/pro/news?${returnParams.toString()}` : "/pro/news";

  const user = await getCurrentUser();
  if (!user) redirect(`/login?from=${encodeURIComponent(returnPath)}`);
  if (!canAccessPremium(user)) redirect(`/subscribe?from=${encodeURIComponent(returnPath)}`);

  const params = parseWireParams(raw, (code) => Boolean(STATE_NAMES[code]));
  const now = new Date();
  const since = rangeSince(params.range, now) ?? undefined;
  const phrase = rangePhrase(params.range, now);

  if (params.view === "states") {
    const [wire, states] = await Promise.all([
      getStateWire({
        stateCode: params.state,
        kind: params.kind,
        since,
        q: params.q,
        fee: params.fee,
        limit: WIRE_PAGE_SIZE,
        offset: (params.page - 1) * WIRE_PAGE_SIZE,
      }),
      getStatesWithNews(),
    ]);
    const refs = wire.items.flatMap((item) => {
      const id = stateItemKey(item);
      if (!id || item.kind === "press") return [];
      return [{ kind: item.kind === "bill" ? ("tracker" as const) : ("article" as const), id }];
    });
    const billRefs = wire.items.flatMap((item) => {
      const key = stateItemKey(item);
      return item.kind === "bill" && key
        ? [{ key, state: item.state_code, identifier: item.identifier, title: item.title, url: item.url, date: item.date }]
        : [];
    });
    const pressRefs = wire.items.flatMap((item) => {
      const key = stateItemKey(item);
      // The related-bill test reads the stored title, publisher included, as the step searched it.
      return item.kind === "press" && key
        ? [{ key, state: item.state_code, title: item.publisher ? `${item.headline} - ${item.publisher}` : item.headline, url: item.link, date: item.date }]
        : [];
    });
    const [notes, related] = await Promise.all([getResearchNotes(refs), getStateRelated(billRefs, pressRefs)]);
    // The reader clamps a page past the end to the last page; show that page's numbers.
    const win = pageWindow(wire.offset / WIRE_PAGE_SIZE + 1, wire.total);
    const shown = { ...params, page: win.page };
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        <WireHeader params={shown} />
        <div className="mt-5">
          <WireControls params={shown} lead={<JurisdictionField states={states} active={params.state} />} />
        </div>
        <StateWire params={shown} wire={wire} win={win} phrase={phrase} now={now} notes={notes} related={related} />
      </div>
    );
  }

  const filter = { source: params.source, topic: params.topic, since, q: params.q, fee: params.fee };
  const total = await getArticleCount(filter);
  const win = pageWindow(params.page, total);
  const shown = { ...params, page: win.page };
  const canRefreshFeeds = user?.role === "admin" || user?.role === "analyst";
  const [articles, topicCounts, sourceCounts, tracker] = await Promise.all([
    getArticles({ ...filter, limit: WIRE_PAGE_SIZE, offset: win.offset }),
    getTopicCounts(since, params.q || undefined, params.fee),
    getSourceCounts(since, params.q || undefined, params.fee),
    getFederalRuleTracker({ now, q: params.q, source: params.source }),
  ]);
  const [notes, related] = await Promise.all([
    getResearchNotes(articles.map((a) => ({ kind: "article" as const, id: a.guid }))),
    getFederalRelated(articles),
  ]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      <WireHeader params={shown} />
      <div className="mt-5">
        <WireControls params={shown} actions={canRefreshFeeds ? <RefreshButton /> : undefined} />
      </div>
      <NewsFeed
        params={shown}
        articles={articles}
        tracker={tracker}
        win={win}
        phrase={phrase}
        topicCounts={topicCounts}
        sourceCounts={sourceCounts}
        topicLabels={TOPIC_LABELS}
        sourceLabels={SOURCE_LABELS}
        now={now}
        canRefreshFeeds={canRefreshFeeds}
        notes={notes}
        related={related}
      />
    </div>
  );
}
