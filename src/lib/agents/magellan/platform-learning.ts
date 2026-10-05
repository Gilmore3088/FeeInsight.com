import type { sql } from "@/lib/data-store/connection";

import type { PlatformKnowledge } from "./finders";
import { isReusablePath } from "./site-signals";

type SqlTag = typeof sql;

/**
 * Per-platform learning for the find team. A bank's website platform (Q2, Banno/Jack
 * Henry, Fiserv, FIS, NCR, WordPress, Drupal, ...) is detected from its homepage and
 * stored on `institution_source_profiles.platform`. Paths come from two places:
 *   - `platform_registry.fee_paths`: seeded per platform, and grown when the same
 *     reusable path is found at two or more banks on that platform;
 *   - every bank on the platform with a fee link: a path found at a bank counts for it,
 *     a path Rosetta rejected at a bank (`rejected_source_urls`) counts twice against it.
 * Peer hints use the same facts narrowed to one state.
 */

const MAX_PLATFORM_PATHS = 6;
const MAX_PEER_PATHS = 5;
const REGISTRY_MAX_PATHS = 12;
/** A learned path joins the registry once it has been found at this many banks. */
const REGISTRY_PROMOTE_AT = 2;

interface PathFacts {
  /** Banks where the path is the fee link. */
  found: Map<string, number>;
  /** Banks where the path was read and was not a fee schedule. */
  rejected: Map<string, number>;
}

function pathOf(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function bump(map: Map<string, number>, key: string | null): void {
  if (key) map.set(key, (map.get(key) ?? 0) + 1);
}

function rankPaths(facts: PathFacts, seeds: string[], filter: (path: string) => boolean): string[] {
  const scores = new Map<string, number>();
  for (const seed of seeds) scores.set(seed, 1);
  for (const [path, count] of facts.found) if (filter(path)) scores.set(path, (scores.get(path) ?? 0) + count);
  for (const [path, count] of facts.rejected) if (scores.has(path)) scores.set(path, (scores.get(path) ?? 0) - 2 * count);
  return [...scores.entries()]
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([path]) => path);
}

export interface PlatformLearner extends PlatformKnowledge {
  /** Called after a bank's fee link is found and stored. */
  recordFind(input: { platform: string | null; url: string; foundByPlatformPath: boolean }): Promise<void>;
}

/** A learner for one discovery step; facts are read once per platform (and state) per step. */
export function createPlatformLearner(db: SqlTag, enabled = true): PlatformLearner {
  const nationwide = new Map<string, Promise<PathFacts>>();
  const byState = new Map<string, Promise<Array<{ institutionId: number; path: string }>>>();
  const seeds = new Map<string, Promise<string[]>>();

  const loadSeeds = (platform: string) => {
    if (!seeds.has(platform)) {
      seeds.set(platform, (async () => {
        const [row] = await db`SELECT fee_paths FROM platform_registry WHERE platform = ${platform}`;
        return Array.isArray(row?.fee_paths) ? (row.fee_paths as unknown[]).filter((path): path is string => typeof path === "string") : [];
      })().catch(() => []));
    }
    return seeds.get(platform)!;
  };

  const loadFacts = (platform: string) => {
    if (!nationwide.has(platform)) {
      nationwide.set(platform, (async () => {
        const rows = await db`
          SELECT COALESCE(profile.canonical_source_url, inst.fee_schedule_url) AS url,
                 COALESCE(profile.rejected_source_urls, '[]'::jsonb) AS rejected
            FROM institution_sources inst
            LEFT JOIN institution_source_profiles profile ON profile.institution_id = inst.id
           WHERE COALESCE(profile.platform, inst.cms_platform) = ${platform}
             AND COALESCE(inst.status, 'active') = 'active'
        `;
        const facts: PathFacts = { found: new Map(), rejected: new Map() };
        for (const row of rows) {
          bump(facts.found, pathOf(row.url));
          const rejected = Array.isArray(row.rejected) ? row.rejected : [];
          for (const entry of rejected as Array<{ url?: unknown }>) bump(facts.rejected, pathOf(entry?.url));
        }
        return facts;
      })().catch(() => ({ found: new Map(), rejected: new Map() })));
    }
    return nationwide.get(platform)!;
  };

  return {
    async platformPaths(platform) {
      if (!enabled) return [];
      const [facts, seeded] = await Promise.all([loadFacts(platform), loadSeeds(platform)]);
      // Learned paths must recur (two banks) and be reusable on another domain.
      const learned: PathFacts = {
        found: new Map([...facts.found].filter(([path, count]) => count >= REGISTRY_PROMOTE_AT && isReusablePath(path))),
        rejected: facts.rejected,
      };
      return rankPaths(learned, seeded, () => true).slice(0, MAX_PLATFORM_PATHS);
    },

    async peerPaths(platform, stateCode, institutionId) {
      if (!enabled || !stateCode) return [];
      const key = `${platform}:${stateCode}`;
      if (!byState.has(key)) {
        byState.set(key, (async () => {
          const rows = await db`
            SELECT inst.id, COALESCE(profile.canonical_source_url, inst.fee_schedule_url) AS url
              FROM institution_sources inst
              LEFT JOIN institution_source_profiles profile ON profile.institution_id = inst.id
             WHERE COALESCE(profile.platform, inst.cms_platform) = ${platform}
               AND upper(btrim(inst.state_code)) = ${stateCode}
               AND COALESCE(inst.status, 'active') = 'active'
               AND COALESCE(profile.canonical_source_url, inst.fee_schedule_url) IS NOT NULL
          `;
          return rows
            .map((row) => ({ institutionId: Number(row.id), path: pathOf(row.url) }))
            .filter((row): row is { institutionId: number; path: string } => Boolean(row.path) && row.path !== "/");
        })().catch(() => []));
      }
      const peers = (await byState.get(key)!).filter((peer) => peer.institutionId !== institutionId);
      const facts = await loadFacts(platform);
      const found = new Map<string, number>();
      for (const peer of peers) bump(found, peer.path);
      return rankPaths({ found, rejected: facts.rejected }, [], (path) => !/[0-9a-f]{16,}/i.test(path)).slice(0, MAX_PEER_PATHS);
    },

    async recordFind({ platform, url, foundByPlatformPath }) {
      if (!enabled || !platform) return;
      const path = pathOf(url);
      const facts = await loadFacts(platform);
      if (path) facts.found.set(path, (facts.found.get(path) ?? 0) + 1);
      const promote = Boolean(path) && isReusablePath(path!) && (facts.found.get(path!) ?? 0) >= REGISTRY_PROMOTE_AT;
      try {
        await db`
          INSERT INTO platform_registry (platform, fee_paths, validated_count, last_updated)
          VALUES (${platform}, ARRAY[]::text[], 0, NOW())
          ON CONFLICT (platform) DO NOTHING
        `;
        await db`
          UPDATE platform_registry
             SET validated_count = validated_count + ${foundByPlatformPath ? 1 : 0},
                 fee_paths = CASE
                   WHEN ${promote}::boolean
                    AND NOT (${path}::text = ANY(COALESCE(fee_paths, ARRAY[]::text[])))
                    AND cardinality(COALESCE(fee_paths, ARRAY[]::text[])) < ${REGISTRY_MAX_PATHS}
                     THEN array_append(COALESCE(fee_paths, ARRAY[]::text[]), ${path}::text)
                   ELSE fee_paths
                 END,
                 institution_count = (
                   SELECT count(*)::int FROM institution_source_profiles WHERE platform = ${platform}
                 ),
                 last_updated = NOW()
           WHERE platform = ${platform}
        `;
      } catch (error) {
        // Learning is best effort: a failed registry write never fails the bank's find.
        console.warn("platform_registry update failed:", error instanceof Error ? error.message : error);
      }
    },
  };
}
