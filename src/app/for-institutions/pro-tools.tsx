import Link from "next/link";
import {
  Activity,
  BarChart3,
  FileText,
  MessageSquare,
  Users,
  type LucideIcon,
} from "lucide-react";
import { SITE_NAME } from "@/lib/constants";
import { HamiltonBenchmarkPreview } from "./hamilton-benchmark-preview";
import {
  HAMILTON_CANONICAL,
  PRO_SECTION_TITLE,
  PRO_SUBHEAD,
  type HamiltonMode,
} from "./hamilton-copy";

export { HAMILTON_CANONICAL, HAMILTON_MODES } from "./hamilton-copy";

interface ModeCard {
  mode: HamiltonMode;
  icon: LucideIcon;
  body: string;
}

/** What you do inside Hamilton, one card per mode. Not sibling tools. */
const MODE_CARDS: ModeCard[] = [
  {
    mode: "This month",
    icon: MessageSquare,
    body:
      "Hamilton opens with the few fees worth your attention, overdraft first, and what changed in " +
      "your market since you last looked. Observations, not instructions.",
  },
  {
    mode: "My fees",
    icon: Users,
    body:
      "See any of your fees against your own counties, your state, your Fed district, your peer group " +
      "and the nation, with the banks your customers can walk into named and the rules that apply.",
  },
  {
    mode: "Try a price",
    icon: Activity,
    body:
      "Put any prices side by side, including no fee at all: where each would sit, what it does to " +
      "fee income from your own figures, and the notice it needs. Hamilton doesn't pick one.",
  },
  {
    mode: "Reports",
    icon: FileText,
    body:
      "Turn a decision into a CEO one-pager or a pricing committee packet, or build a board-ready " +
      "brief with every figure cited to its source document.",
  },
];

const PRIMARY_BUTTON =
  "inline-flex items-center justify-center rounded-md bg-[#C44B2E] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#A93D25]";
const SECONDARY_BUTTON =
  "inline-flex items-center justify-center rounded-md border border-warm-300 px-5 py-2.5 text-sm font-medium text-warm-900 transition-colors hover:border-warm-900";

export function ProToolsSection() {
  return (
    <section id="pro" className="scroll-mt-16 border-b border-warm-200 bg-warm-100">
      <div className="mx-auto max-w-page px-6 py-14">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">
          {SITE_NAME} Pro
        </p>
        <h2
          className="mt-3 text-[28px] text-warm-900"
          style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
        >
          {PRO_SECTION_TITLE}
        </h2>
        <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-warm-800">{HAMILTON_CANONICAL}</p>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-warm-700">{PRO_SUBHEAD}</p>

        <HamiltonBenchmarkPreview className="mt-8" />

        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {MODE_CARDS.map((card) => (
            <ModeCardView key={card.mode} card={card} />
          ))}
          <div className="flex flex-col justify-between rounded-xl border border-dashed border-warm-300 p-5">
            <div>
              <BarChart3 className="h-5 w-5 text-terra" aria-hidden="true" />
              <p className="mt-3 text-[15px] font-bold text-warm-900">One plan, up to 5 people</p>
              <p className="mt-1.5 text-[14px] leading-relaxed text-warm-700">
                Monthly or annual, same workspace. Monthly plans cancel at the end of the period.
              </p>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Link href="/subscribe" className={PRIMARY_BUTTON}>
                See pricing
              </Link>
              <Link href="/subscribe?plan=monthly" className={SECONDARY_BUTTON}>
                See monthly price
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ModeCardView({ card }: { card: ModeCard }) {
  const Icon = card.icon;
  return (
    <div className="rounded-xl border border-warm-300 bg-white p-5">
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5 text-terra" aria-hidden="true" />
        <h3 className="text-[15px] font-bold text-warm-900">{card.mode}</h3>
      </div>
      <p className="mt-2 text-[14px] leading-relaxed text-warm-700">{card.body}</p>
    </div>
  );
}
