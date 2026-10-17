import type { CSSProperties, ReactNode } from "react";
import { SceneIcon } from "./scene-icons";
import { INTRO_DELAY_MS, countUp, dollars } from "./timeline";
import type { FeeScene, FeeSceneFrame } from "./types";

/** The drawing is 400 by 380 units and scales to its container. */
export const VIEW_W = 400;
export const VIEW_H = 380;

/** Text limits that keep every label inside its shape at the sizes below. */
export const TEXT_LIMITS = {
  actor: 16,
  item: 11,
  status: 22,
  charge: 18,
  total: 18,
  totalNote: 40,
  fork: 18,
  lookFor: 36,
  lookForTitle: 24,
} as const;

const LEFT_X = 80;
const RIGHT_X = 320;
const CARD_DONE_MS = 1800;
const TOTAL_DELAY_MS = 1000;

/**
 * One frame of a scene. `elapsedMs` is the time since the frame's step began; the part named by
 * `frame.intro` moves in during that time. A still frame passes Infinity, so everything is in
 * place. Without `motion`, nothing transitions.
 */
export function SceneDiagram({
  scene,
  frame,
  elapsedMs,
  motion,
}: {
  scene: FeeScene;
  frame: FeeSceneFrame;
  elapsedMs: number;
  motion: boolean;
}) {
  const intro = frame.intro;
  const itemDelay = frame.item?.via === "card" ? CARD_DONE_MS : INTRO_DELAY_MS;
  const shown = (key: string, delay = INTRO_DELAY_MS) => key !== intro || elapsedMs >= delay;
  const move = motion ? "motion-safe:transition-[opacity,transform] motion-safe:duration-700 motion-safe:ease-out" : "";

  const charges = scene.charges.filter((c) => frame.charges.includes(c.id));
  const totalAmount = frame.total?.amount ?? charges.reduce((sum, c) => sum + c.amount, 0);
  const joined = Boolean(frame.total) && shown("total");

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="block h-auto w-full"
      aria-hidden="true"
      focusable="false"
    >
      {/* The two parties. */}
      <SceneIcon icon={scene.left.icon} cx={LEFT_X} cy={72} />
      <SceneIcon icon={scene.right.icon} cx={RIGHT_X} cy={72} />
      <text x={LEFT_X} y={150} textAnchor="middle" fontSize={17} fontWeight={600} className="fill-ink">
        {scene.left.label}
      </text>
      <text x={RIGHT_X} y={150} textAnchor="middle" fontSize={17} fontWeight={600} className="fill-ink">
        {scene.right.label}
      </text>

      {/* A card going into the machine. */}
      {frame.item?.via === "card" && intro === "item" && elapsedMs < CARD_DONE_MS + 800 && (
        <Moving
          className={move}
          x={elapsedMs >= INTRO_DELAY_MS ? 0 : 70}
          opacity={elapsedMs >= INTRO_DELAY_MS + 700 ? 0 : 1}
        >
          <rect x={LEFT_X - 22} y={58} width={44} height={28} rx={4} strokeWidth={2.5} className="fill-brick-tint stroke-brick" />
          <rect x={LEFT_X - 22} y={64} width={44} height={6} className="fill-brick" />
        </Moving>
      )}

      {/* The transaction. */}
      {frame.item && (
        <Moving className={move} x={shown("item", itemDelay) ? 0 : -60} opacity={shown("item", itemDelay) ? 1 : 0}>
          <rect x={145} y={40} width={110} height={64} rx={10} strokeWidth={2.5} className="fill-surface-0 stroke-ink" />
          {frame.item.amount === undefined ? (
            <text x={200} y={78} textAnchor="middle" fontSize={15} fontWeight={600} className="fill-ink">
              {frame.item.label}
            </text>
          ) : (
            <>
              <text x={200} y={62} textAnchor="middle" fontSize={14} className="fill-ink-muted">
                {frame.item.label}
              </text>
              <text x={200} y={94} textAnchor="middle" fontSize={26} fontWeight={700} className="fill-ink tabular-nums">
                {dollars(frame.item.amount)}
              </text>
            </>
          )}
          {frame.item.status && (
            <text
              x={200}
              y={124}
              textAnchor="middle"
              fontSize={15}
              fontWeight={frame.item.statusTone === "alert" ? 700 : 600}
              className={frame.item.statusTone === "alert" ? "fill-brick" : "fill-ink-soft"}
            >
              {frame.item.status}
            </text>
          )}
        </Moving>
      )}

      {/* The charges, each under the party that charges it. */}
      {charges.map((c) => {
        const visible = shown(c.id);
        const value = intro === c.id ? countUp(c.amount, elapsedMs) : c.amount;
        const x0 = c.under === "left" ? 14 : 230;
        const inward = joined ? (c.under === "left" ? 14 : -14) : 0;
        return (
          <Moving key={c.id} className={move} x={inward} y={visible ? 0 : -18} opacity={visible ? 1 : 0}>
            <rect x={x0} y={172} width={156} height={76} rx={12} strokeWidth={2.5} className="fill-brick-tint stroke-brick" />
            <text x={x0 + 78} y={197} textAnchor="middle" fontSize={15} fontWeight={600} className="fill-ink">
              {c.label}
            </text>
            <text x={x0 + 78} y={236} textAnchor="middle" fontSize={34} fontWeight={700} className="fill-brick tabular-nums">
              +{dollars(value)}
            </text>
          </Moving>
        );
      })}

      {/* The charges add into one total. */}
      {frame.total && (
        <Moving className={move} opacity={shown("total", TOTAL_DELAY_MS) ? 1 : 0} y={shown("total", TOTAL_DELAY_MS) ? 0 : 12}>
          {charges.map((c) => (
            <path
              key={c.id}
              d={c.under === "left" ? "M 106 250 L 150 266" : "M 294 250 L 250 266"}
              strokeWidth={2.5}
              strokeLinecap="round"
              className="stroke-ink-muted"
              fill="none"
            />
          ))}
          <rect x={110} y={266} width={180} height={84} rx={12} strokeWidth={3} className="fill-surface-0 stroke-ink" />
          <text x={200} y={290} textAnchor="middle" fontSize={15} fontWeight={600} className="fill-ink-soft">
            {frame.total.label}
          </text>
          <text x={200} y={336} textAnchor="middle" fontSize={40} fontWeight={700} className="fill-ink tabular-nums">
            {dollars(intro === "total" ? countUp(totalAmount, elapsedMs, TOTAL_DELAY_MS + 200) : totalAmount)}
          </text>
          {frame.total.note && (
            <text x={200} y={373} textAnchor="middle" fontSize={15} className="fill-ink-muted">
              {frame.total.note}
            </text>
          )}
        </Moving>
      )}

      {/* Two ways it can go. */}
      {frame.fork && !frame.lookFor && (
        <Moving className={move} opacity={shown("fork") ? 1 : 0} y={shown("fork") ? 0 : 12}>
          <ForkOption x={14} label={frame.fork.a} state={forkState(frame.fork.chosen, "a")} />
          <ForkOption x={206} label={frame.fork.b} state={forkState(frame.fork.chosen, "b")} />
          <text x={200} y={312} textAnchor="middle" fontSize={14} className="fill-ink-muted">
            or
          </text>
        </Moving>
      )}

      {/* What to look for. */}
      {frame.lookFor && (
        <Moving className={move} opacity={shown("lookFor") ? 1 : 0} y={shown("lookFor") ? 0 : 12}>
          <rect x={14} y={262} width={372} height={112} rx={12} strokeWidth={2} className="fill-surface-0 stroke-border" />
          <text x={30} y={286} fontSize={14} fontWeight={700} className="fill-brick" letterSpacing={1}>
            {(frame.lookForTitle ?? "Look for").toUpperCase()}
          </text>
          {frame.lookFor.map((line, i) => (
            <g key={line}>
              <path
                d={`M 30 ${306 + i * 26} l 5 5 l 9 -10`}
                fill="none"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="stroke-brick"
              />
              <text x={52} y={312 + i * 26} fontSize={16} className="fill-ink">
                {line}
              </text>
            </g>
          ))}
        </Moving>
      )}
    </svg>
  );
}

function forkState(chosen: "a" | "b" | undefined, side: "a" | "b"): "open" | "chosen" | "faded" {
  if (!chosen) return "open";
  return chosen === side ? "chosen" : "faded";
}

function ForkOption({ x, label, state }: { x: number; label: string; state: "open" | "chosen" | "faded" }) {
  return (
    <g opacity={state === "faded" ? 0.4 : 1}>
      <rect
        x={x}
        y={272}
        width={180}
        height={70}
        rx={12}
        strokeWidth={state === "chosen" ? 3 : 2}
        className={state === "chosen" ? "fill-brick-tint stroke-brick" : "fill-surface-0 stroke-ink"}
      />
      <text x={x + 90} y={313} textAnchor="middle" fontSize={16} fontWeight={600} className="fill-ink">
        {label}
      </text>
    </g>
  );
}

function Moving({
  children,
  className,
  x = 0,
  y = 0,
  opacity = 1,
}: {
  children: ReactNode;
  className: string;
  x?: number;
  y?: number;
  opacity?: number;
}) {
  const style: CSSProperties = { transform: `translate(${x}px, ${y}px)`, opacity };
  return (
    <g className={className || undefined} style={style}>
      {children}
    </g>
  );
}
