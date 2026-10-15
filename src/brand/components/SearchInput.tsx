import * as React from "react";

export interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
  hint?: string;
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { label, hint, id, className, placeholder = "Search a bank or credit union", ...rest }, ref,
) {
  const autoId = React.useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  return (
    <div className={["fi-field", className].filter(Boolean).join(" ")}>
      {label ? <label htmlFor={inputId}>{label}</label> : null}
      <div className="fi-input-wrap">
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" /><line x1="11" y1="11" x2="14.5" y2="14.5" /></svg>
        <input ref={ref} id={inputId} type="search" className="fi-input" placeholder={placeholder} aria-describedby={hintId} {...rest} />
      </div>
      {hint ? <div id={hintId} className="fi-hint">{hint}</div> : null}
    </div>
  );
});
