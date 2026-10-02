"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { CrewReply } from "@/lib/agents/crew-execute";
import { askCrew, confirmCrewCommand } from "./crew-actions";

const QUICK_COMMANDS = [
  "status",
  "what's stuck?",
  "Atlas, run all due states",
  "pause",
  "resume",
];

interface Exchange {
  id: number;
  said: string;
  reply: CrewReply;
  confirmed?: boolean;
}

export function CrewCommandBar() {
  const [text, setText] = useState("");
  const [history, setHistory] = useState<Exchange[]>([]);
  const [pending, startTransition] = useTransition();

  function send(command: string) {
    const said = command.trim();
    if (!said) return;
    setText("");
    startTransition(async () => {
      const reply = await askCrew(said);
      setHistory((previous) => [{ id: Date.now(), said, reply }, ...previous].slice(0, 6));
    });
  }

  function confirm(exchange: Exchange) {
    if (!exchange.reply.confirm) return;
    const commandText = exchange.reply.confirm.commandText;
    startTransition(async () => {
      const reply = await confirmCrewCommand(commandText);
      setHistory((previous) => [
        { id: Date.now(), said: `Confirmed: ${exchange.said}`, reply },
        ...previous.map((item) => (item.id === exchange.id ? { ...item, confirmed: true } : item)),
      ].slice(0, 6));
    });
  }

  return (
    <section aria-label="Talk to the crew" className="rounded-lg border border-black/[0.08] px-4 py-4 dark:border-white/[0.1]">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          send(text);
        }}
        className="flex gap-2"
      >
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={200}
          placeholder='Talk to the crew, e.g. "Magellan, run Texas" or "is Georgia done?"'
          aria-label="Command for the crew"
          className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-[var(--brand-primary)] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        />
        <button
          type="submit"
          disabled={pending || !text.trim()}
          className="h-10 shrink-0 rounded-md bg-[var(--brand-primary)] px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "…" : "Send"}
        </button>
      </form>
      <div className="mt-2 flex flex-wrap gap-2">
        {QUICK_COMMANDS.map((command) => (
          <button
            key={command}
            type="button"
            disabled={pending}
            onClick={() => send(command)}
            className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {command}
          </button>
        ))}
      </div>

      {history.length > 0 && (
        <ul className="mt-4 space-y-3">
          {history.map((exchange) => (
            <li key={exchange.id} className="text-sm">
              <p className="text-xs text-gray-500">You: {exchange.said}</p>
              <div className="mt-1 rounded-md bg-gray-50 px-3 py-2 dark:bg-gray-900">
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">{exchange.reply.speaker}</p>
                {exchange.reply.lines.map((line, index) => (
                  <p key={index} className="text-gray-800 dark:text-gray-200">{line}</p>
                ))}
                {exchange.reply.confirm && (
                  <div className="mt-2 flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/30">
                    <p className="text-amber-900 dark:text-amber-200">{exchange.reply.confirm.summary}</p>
                    {exchange.confirmed ? (
                      <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Confirmed</span>
                    ) : (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => confirm(exchange)}
                        className="rounded-md bg-amber-700 px-3 py-1 text-xs font-bold text-white disabled:opacity-50"
                      >
                        Confirm
                      </button>
                    )}
                  </div>
                )}
                {exchange.reply.links && exchange.reply.links.length > 0 && (
                  <p className="mt-1 flex flex-wrap gap-3 text-xs">
                    {exchange.reply.links.map((link) => (
                      <Link key={link.href + link.label} href={link.href} className="font-semibold text-[var(--brand-primary)]">
                        {link.label}
                      </Link>
                    ))}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
