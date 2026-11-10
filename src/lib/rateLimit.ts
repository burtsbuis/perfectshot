import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Daily rate limits backed by the `plan_usage` table: one row per (day, key).
 * Keys: "global" and "ip:<sha256>", so raw IPs are never stored.
 *
 * Read-then-write isn't atomic, so two simultaneous requests can both slip under the limit.
 * That's acceptable for a portfolio demo (ADR-008); a Postgres function with
 * `insert ... on conflict do update ... returning count` would make it exact.
 */
export function hashIp(ip: string): string {
  return createHash("sha256").update(`${process.env.RATE_LIMIT_SALT ?? "perfectshot"}:${ip}`).digest("hex").slice(0, 32);
}

export type Limit = { key: string; limit: number };

export async function consume(db: SupabaseClient, limits: Limit[], day = new Date().toISOString().slice(0, 10)) {
  const { data, error } = await db
    .from("plan_usage")
    .select("key, count")
    .eq("day", day)
    .in("key", limits.map((l) => l.key));
  if (error) throw error;

  const counts = new Map((data ?? []).map((r: { key: string; count: number }) => [r.key, r.count]));
  const blocked = limits.find((l) => (counts.get(l.key) ?? 0) >= l.limit);
  if (blocked) return { ok: false as const, blockedKey: blocked.key };

  const { error: upErr } = await db
    .from("plan_usage")
    .upsert(limits.map((l) => ({ day, key: l.key, count: (counts.get(l.key) ?? 0) + 1 })));
  if (upErr) throw upErr;
  return { ok: true as const };
}
