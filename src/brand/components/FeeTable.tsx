import * as React from "react";
import type { MarketPosition } from "./StatCard";

export interface FeeRow {
  name: string;
  fee: number;
  position: MarketPosition;
  /** The one bank the page is about; tinted brick. */
  subject?: boolean;
}

export interface FeeTableProps {
  rows: FeeRow[];
  feeLabel?: string;
  /** Read by screen readers. */
  caption?: string;
  format?: (v: number) => string;
  className?: string;
}

const POS: Record<MarketPosition, string> = { above: "Above market", in: "In range", below: "Below market" };
const money = (v: number) => `$${v.toFixed(2)}`;
const srOnly: React.CSSProperties = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" };

export function FeeTable({ rows, feeLabel = "Fee", caption, format = money, className }: FeeTableProps) {
  return (
    <table className={["fi-table", className].filter(Boolean).join(" ")}>
      {caption ? <caption style={srOnly}>{caption}</caption> : null}
      <thead>
        <tr>
          <th scope="col">Institution</th>
          <th scope="col" className="num">{feeLabel}</th>
          <th scope="col">Position</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name} className={r.subject ? "is-subject" : undefined} aria-current={r.subject ? "true" : undefined}>
            <td>{r.name}</td>
            <td className="num">{format(r.fee)}</td>
            <td><span className={`fi-pos ${r.position}`}>{POS[r.position]}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
