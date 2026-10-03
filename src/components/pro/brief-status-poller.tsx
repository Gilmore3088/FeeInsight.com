'use client';

import { useState, useEffect, useRef } from 'react';
import type { ReportJobStatus } from '@/lib/report-engine/types';

interface StatusResponse {
  id: string;
  status: ReportJobStatus;
  report_type: string;
  created_at: string;
  completed_at: string | null;
  error: string | null;
  presigned_url: string | null;
}

interface Props {
  jobId: string;
}

// Progress percentage per step
const STEP_PROGRESS: Record<ReportJobStatus, number> = {
  pending: 10,
  assembling: 35,
  rendering: 75,
  complete: 100,
  failed: 0,
  cancel_requested: 50,
  cancelled: 0,
};

// Ordered steps for the stepper (terminal steps excluded from main sequence)
const STEPS: ReportJobStatus[] = ['pending', 'assembling', 'rendering', 'complete'];

function stepIndex(status: ReportJobStatus): number {
  return STEPS.indexOf(status);
}

export function BriefStatusPoller({ jobId }: Props) {
  const [status, setStatus] = useState<ReportJobStatus | null>(null);
  const [presignedUrl, setPresignedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastPollAt, setLastPollAt] = useState<Date | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch(`/api/reports/${jobId}/status`);
        if (!res.ok) return;

        const data = await res.json() as StatusResponse;
        setStatus(data.status);
        setPresignedUrl(data.presigned_url);
        setError(data.error);
        setLastPollAt(new Date());

        // Clear interval on terminal state
        if (data.status === 'complete' || data.status === 'failed' || data.status === 'cancelled') {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        }
      } catch {
        // Network errors are transient; keep polling
      }
    }

    // Poll immediately, then every 3s
    void poll();
    intervalRef.current = setInterval(() => { void poll(); }, 3000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [jobId]);

  // Error state: replace stepper with red banner
  if (status === 'failed') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5">
        <p className="text-sm font-semibold text-red-700 mb-1">Report generation failed</p>
        <p className="text-sm text-red-600">
          {error ?? 'An unexpected error occurred.'}
        </p>
        <p className="mt-2 text-xs text-red-500">
          Please try again or contact support.
        </p>
      </div>
    );
  }

  if (status === 'cancelled') {
    return (
      <div className="rounded-xl border border-[#E8DFD1] bg-[#FFFDF9] p-5">
        <p className="text-sm font-semibold text-[#5E574D]">Report generation cancelled</p>
        <p className="mt-1 text-sm text-[#81786B]">No further report work will run for this request.</p>
      </div>
    );
  }

  const currentStepIdx = status ? stepIndex(status) : -1;
  const progressPct = status ? STEP_PROGRESS[status] : 0;

  return (
    <div className="rounded-xl border border-[#E8DFD1] bg-[#FFFDF9] p-5 space-y-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6255]">
        Generation Progress
      </p>

      {/* Progress bar */}
      <div className="h-1.5 w-full rounded-full bg-[#E8DFD1] overflow-hidden">
        <div
          className="h-full rounded-full bg-[#C44B2E] transition-all duration-500"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* 4-step stepper */}
      <div className="flex items-center justify-between">
        {STEPS.map((step, idx) => {
          const isComplete = currentStepIdx > idx;
          const isCurrent = currentStepIdx === idx;
          const isFuture = currentStepIdx < idx;

          const label = step.charAt(0).toUpperCase() + step.slice(1);

          return (
            <div key={step} className="flex flex-col items-center gap-1">
              <div
                className={`h-2 w-2 rounded-full ${
                  isComplete || isCurrent
                    ? 'bg-[#C44B2E]'
                    : 'bg-[#E8DFD1]'
                }`}
              />
              <span
                className={`text-[11px] font-medium ${
                  isCurrent
                    ? 'text-[#C44B2E]'
                    : isComplete
                      ? 'text-[#1A1815]'
                      : isFuture
                        ? 'text-[#D5CBBF]'
                        : 'text-[#D5CBBF]'
                }`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Last poll timestamp */}
      {lastPollAt && status !== 'complete' && (
        <p className="text-[10px] text-[#C4B9A8]">
          Last updated {lastPollAt.toLocaleTimeString()}
        </p>
      )}

      {/* Complete state: download CTA */}
      {status === 'complete' && presignedUrl && (
        <div className="space-y-2 pt-1">
          <p className="text-sm font-medium text-emerald-600">
            Generated successfully
          </p>
          <a
            href={presignedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white bg-[#C44B2E] hover:bg-[#A83D25] transition-colors"
          >
            <svg aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
              />
            </svg>
            Download Brief
          </a>
        </div>
      )}

      {/* Complete state: no URL yet (shouldn't happen but graceful) */}
      {status === 'complete' && !presignedUrl && (
        <p className="text-sm font-medium text-emerald-600">
          Report ready — refresh to download.
        </p>
      )}
    </div>
  );
}
