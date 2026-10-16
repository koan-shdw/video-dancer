// Render-now throttles per PROVIDER (docs/archive/CONCURRENT-RENDERS-SPEC-2026-08-11.md §2).
// Budgets are per account, not per engine — both ModelArk engines share the one budget of 3.
// Researched 2026-08-11. A provider ABSENT here is uncapped on OUR side:
//  - fal: concurrency is per fal ACCOUNT (2 new → 40 with credits), excess requests sit
//    IN_QUEUE on fal's servers and are never rejected — a client cap would only duplicate
//    that badly. The pool is shared across ALL fal engines + Nano Banana image edits.
//  - astria: "all jobs are handled in parallel and there is no wait time or queuing" (FAQ).
export interface ProviderLimits {
  maxConcurrent?: number // simultaneous in-flight jobs for this provider
  submitGapMs?: number // minimum gap between submits (QPS guard)
}

export const PROVIDER_LIMITS: Record<string, ProviderLimits> = {
  // Seedance 2.0 public beta quotas: 3 concurrent tasks per account, submit QPS 2 → 429.
  // 2.5 numbers unpublished — assumed the same until BytePlus documents otherwise.
  modelark: { maxConcurrent: 3, submitGapMs: 1000 },
  // hidden engine; conservative placeholder — re-research before ever enabling
  // (2026-08-11 recon: their platform API serves NO seedance; MCP OAuth = the future path)
  higgsfield: { maxConcurrent: 1, submitGapMs: 1000 }
}
