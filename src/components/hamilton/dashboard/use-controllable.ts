"use client";
import { useCallback, useState } from "react";

/** A value a parent may control (value + onChange) or leave to the component (defaultValue). */
export function useControllable<T>(value: T | undefined, onChange: ((next: T) => void) | undefined, defaultValue: T): [T, (next: T) => void] {
  const [own, setOwn] = useState<T>(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? value : own;
  const set = useCallback(
    (next: T) => {
      if (!controlled) setOwn(next);
      onChange?.(next);
    },
    [controlled, onChange],
  );
  return [current, set];
}
