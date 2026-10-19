import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodeBlock } from "./code-block";

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

afterEach(() => {
  cleanup();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
});

describe("API documentation code copying", () => {
  it("keeps keyboard focus during and after copying and ignores repeated activation", async () => {
    let finishCopy!: () => void;
    const writeText = vi.fn(() => new Promise<void>((resolve) => { finishCopy = resolve; }));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<CodeBlock title="Request">curl https://feeinsight.com/api/v1/fees</CodeBlock>);
    const button = screen.getByRole("button", { name: "Copy Request" });
    button.focus();

    fireEvent.click(button);
    expect(button).toHaveFocus();
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(writeText).toHaveBeenCalledTimes(1);

    await act(async () => finishCopy());
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByRole("status")).toHaveTextContent("Copied to clipboard.");
  });

  it.each([
    ["GET /fees request", 'curl -H "Authorization: Bearer YOUR_API_KEY" https://feeinsight.com/api/v1/fees'],
    ["Connector link", "https://feeinsight.com/api/v1/mcp?api_key=YOUR_API_KEY"],
  ])("copies the complete %s and announces success", async (label, value) => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<CodeBlock title={label}>{value}</CodeBlock>);

    fireEvent.click(screen.getByRole("button", { name: `Copy ${label}` }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Copied to clipboard."));
    expect(writeText).toHaveBeenCalledExactlyOnceWith(value);
    expect(screen.getByRole("button", { name: `Copy ${label}` })).toHaveTextContent("Copied");
  });

  it.each(["denied", "unavailable"])("keeps the code available when clipboard access is %s", async (failure) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: failure === "denied" ? { writeText: vi.fn().mockRejectedValue(new Error("Denied")) } : undefined,
    });
    const value = "curl https://feeinsight.com/api/v1/fees";
    render(<CodeBlock title="Try it">{value}</CodeBlock>);

    fireEvent.click(screen.getByRole("button", { name: "Copy Try it" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Copy unavailable. Select the code and copy it manually."));
    expect(screen.getByLabelText("Try it")).toHaveTextContent(value);
    expect(screen.getByLabelText("Try it")).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("button", { name: "Copy Try it" })).toBeEnabled();
  });
});
