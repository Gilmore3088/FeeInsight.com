import * as React from "react";

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** neutral by default; brick for the one item that matters ("Your bank"). */
  tone?: "neutral" | "brick";
}

export function Tag({ tone = "neutral", className, ...rest }: TagProps) {
  return <span className={["fi-tag", `fi-tag-${tone}`, className].filter(Boolean).join(" ")} {...rest} />;
}
