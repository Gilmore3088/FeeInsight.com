import type { FeeSceneIcon } from "./types";

/** Line drawings for a scene's two parties, centred on (cx, cy) inside a 100-unit square. */
export function SceneIcon({ icon, cx, cy }: { icon: FeeSceneIcon; cx: number; cy: number }) {
  const line = "fill-surface-0 stroke-ink";
  switch (icon) {
    case "atm":
      return (
        <g strokeWidth={3}>
          <rect x={cx - 40} y={cy - 50} width={80} height={100} rx={8} className={line} />
          <rect x={cx - 30} y={cy - 40} width={60} height={30} rx={3} className="fill-ink" />
          <text x={cx} y={cy - 19} textAnchor="middle" fontSize={16} fontWeight={700} className="fill-paper">
            ATM
          </text>
          <rect x={cx - 18} y={cy - 2} width={36} height={5} rx={2} className="fill-ink" />
          {[0, 1, 2].map((c) =>
            [0, 1].map((r) => (
              <rect
                key={`${c}-${r}`}
                x={cx - 21 + c * 15}
                y={cy + 10 + r * 12}
                width={12}
                height={8}
                rx={2}
                strokeWidth={1}
                className="fill-surface-200 stroke-border"
              />
            )),
          )}
          <rect x={cx - 24} y={cy + 40} width={48} height={5} rx={2} className="fill-ink" />
        </g>
      );
    case "bank":
      return (
        <g strokeWidth={3}>
          <polygon
            points={`${cx - 48},${cy - 22} ${cx},${cy - 50} ${cx + 48},${cy - 22}`}
            strokeLinejoin="round"
            className="fill-surface-200 stroke-ink"
          />
          {[-36, -14, 8, 30].map((dx) => (
            <rect key={dx} x={cx + dx - 1} y={cy - 16} width={8} height={44} className={line} />
          ))}
          <rect x={cx - 50} y={cy + 30} width={100} height={12} rx={2} className={line} />
        </g>
      );
    case "card":
      return (
        <g strokeWidth={3}>
          <rect x={cx - 44} y={cy - 28} width={88} height={56} rx={8} className="fill-brick-tint stroke-brick" />
          <rect x={cx - 42} y={cy - 14} width={84} height={10} className="fill-brick" />
          <rect x={cx - 32} y={cy + 6} width={18} height={12} rx={2} strokeWidth={2} className="fill-surface-0 stroke-brick" />
        </g>
      );
    case "check":
      return (
        <g strokeWidth={3}>
          <rect x={cx - 46} y={cy - 28} width={92} height={56} rx={3} className={line} />
          <rect x={cx - 36} y={cy - 16} width={44} height={5} className="fill-surface-200" />
          <rect x={cx - 36} y={cy - 4} width={70} height={5} className="fill-surface-200" />
          <path
            d={`M ${cx + 2} ${cy + 16} q 6 -10 12 0 t 12 0 t 10 -2`}
            fill="none"
            strokeLinecap="round"
            className="stroke-ink"
          />
        </g>
      );
    case "wire":
      return (
        <g strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" className="stroke-ink">
          <circle cx={cx} cy={cy} r={44} strokeWidth={3} className="fill-surface-0 stroke-ink" />
          <path d={`M ${cx - 26} ${cy - 10} H ${cx + 24} m -12 -12 l 12 12 l -12 12`} />
          <path d={`M ${cx + 26} ${cy + 14} H ${cx - 24} m 12 -12 l -12 12 l 12 12`} className="stroke-brick" />
        </g>
      );
    case "phone":
      return (
        <g strokeWidth={3}>
          <rect x={cx - 26} y={cy - 46} width={52} height={92} rx={10} className={line} />
          <rect x={cx - 18} y={cy - 34} width={36} height={60} rx={3} strokeWidth={0} className="fill-surface-200" />
          <circle cx={cx} cy={cy + 36} r={4} className="fill-ink" />
        </g>
      );
    case "globe":
      return (
        <g strokeWidth={3} fill="none" className="stroke-ink">
          <circle cx={cx} cy={cy} r={44} className="fill-surface-0 stroke-ink" />
          <ellipse cx={cx} cy={cy} rx={18} ry={44} />
          <path d={`M ${cx - 44} ${cy} H ${cx + 44} M ${cx - 38} ${cy - 22} H ${cx + 38} M ${cx - 38} ${cy + 22} H ${cx + 38}`} />
        </g>
      );
    case "store":
      return (
        <g strokeWidth={3}>
          <rect x={cx - 44} y={cy - 18} width={88} height={64} className={line} />
          <rect x={cx - 48} y={cy - 40} width={96} height={24} rx={3} className="fill-brick-tint stroke-brick" />
          {[-24, 0, 24].map((dx) => (
            <rect key={dx} x={cx + dx - 6} y={cy - 40} width={12} height={24} strokeWidth={0} className="fill-brick" />
          ))}
          <rect x={cx - 12} y={cy + 8} width={24} height={38} className="fill-surface-200 stroke-ink" />
        </g>
      );
    case "box":
      return (
        <g strokeWidth={3}>
          <rect x={cx - 44} y={cy - 40} width={88} height={80} rx={4} className="fill-surface-200 stroke-ink" />
          {[0, 1].map((c) =>
            [0, 1].map((r) => (
              <g key={`${c}-${r}`}>
                <rect x={cx - 36 + c * 38} y={cy - 32 + r * 34} width={34} height={28} rx={2} strokeWidth={2} className={line} />
                <circle cx={cx - 19 + c * 38} cy={cy - 18 + r * 34} r={3} className="fill-ink" />
              </g>
            )),
          )}
        </g>
      );
    case "calendar":
      return (
        <g strokeWidth={3}>
          <rect x={cx - 42} y={cy - 36} width={84} height={80} rx={6} className={line} />
          <rect x={cx - 42} y={cy - 36} width={84} height={20} rx={6} className="fill-brick stroke-ink" />
          {[0, 1, 2, 3].map((c) =>
            [0, 1, 2].map((r) => (
              <rect key={`${c}-${r}`} x={cx - 32 + c * 18} y={cy - 6 + r * 16} width={10} height={9} rx={1} className="fill-surface-200" strokeWidth={0} />
            )),
          )}
        </g>
      );
  }
}
