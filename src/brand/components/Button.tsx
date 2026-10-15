import * as React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = navy (main action) · brick = the one accent action per view · secondary = outlined (default) · quiet = text only. */
  variant?: "primary" | "brick" | "secondary" | "quiet";
  size?: "md" | "sm";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, type = "button", ...rest }, ref,
) {
  const cls = ["fi-btn", `fi-btn-${variant}`, size === "sm" && "fi-btn-sm", className].filter(Boolean).join(" ");
  return <button ref={ref} type={type} className={cls} {...rest} />;
});
