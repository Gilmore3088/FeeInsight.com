"use client";

import { useEffect } from "react";

/**
 * A closed <details> prints closed, so Save as PDF would lose every fee's evidence and the
 * method. Before printing this opens each one on the page; afterwards it closes the ones the
 * reader had not opened. Renders nothing.
 */
export function PrintOpen() {
  useEffect(() => {
    let opened: HTMLDetailsElement[] = [];
    const before = () => {
      opened = [...document.querySelectorAll<HTMLDetailsElement>("main details:not([open])")];
      for (const d of opened) d.open = true;
    };
    const after = () => {
      for (const d of opened) d.open = false;
      opened = [];
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);
  return null;
}
