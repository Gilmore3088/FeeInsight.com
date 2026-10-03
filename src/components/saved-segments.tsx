"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SavedPeerSet } from "@/lib/data-store";
import { createPeerSet, removePeerSet } from "@/app/admin/peers/actions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

interface SavedSegmentsProps {
  segments: SavedPeerSet[];
  hasFilters: boolean;
  currentFilters: {
    charter?: string;
    tiers?: string[];
    districts?: number[];
  };
  basePath: string;
}

export function SavedSegments({
  segments,
  hasFilters,
  currentFilters,
  basePath,
}: SavedSegmentsProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();

  const applySegment = (segment: SavedPeerSet) => {
    const params = new URLSearchParams();
    if (segment.tiers) params.set("tier", segment.tiers);
    if (segment.districts) params.set("district", segment.districts);
    if (segment.charter_type) params.set("type", segment.charter_type);
    const qs = params.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
  };

  const handleSave = () => {
    if (!name.trim()) return;
    startTransition(async () => {
      await createPeerSet(name.trim(), currentFilters);
      setName("");
      setOpen(false);
    });
  };

  const handleDelete = (id: number) => {
    startTransition(async () => {
      await removePeerSet(id);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide mr-1">
        Saved
      </span>

      {segments.map((seg) => (
        <span
          key={seg.id}
          className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white pl-3 pr-1 py-1 text-xs text-gray-700 hover:border-blue-300 transition group"
        >
          <button
            onClick={() => applySegment(seg)}
            className="hover:text-blue-600 transition"
          >
            {seg.name}
          </button>
          <button
            onClick={() => handleDelete(seg.id)}
            className="rounded-full p-0.5 text-gray-400 hover:text-red-500 hover:bg-red-50 transition opacity-0 group-hover:opacity-100"
            disabled={isPending}
          >
            <svg aria-hidden="true" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </span>
      ))}

      {hasFilters && (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-3 py-1 text-xs text-gray-500 hover:border-blue-400 hover:text-blue-600 transition"
        >
          <svg aria-hidden="true" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Save current
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Peer Set</DialogTitle>
          </DialogHeader>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Small community banks in Chicago"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <button
              onClick={() => setOpen(false)}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!name.trim() || isPending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition disabled:opacity-50"
            >
              {isPending ? "Saving..." : "Save"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
