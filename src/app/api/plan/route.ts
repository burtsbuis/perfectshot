import Anthropic from "@anthropic-ai/sdk";
import type { NextRequest } from "next/server";
import { AgentError, runStage1 } from "@/lib/agent/stage1";
import { readAnthropicKey, type KeyInfo } from "@/lib/anthropicKey";
import { runChecks } from "@/lib/checks";
import { buildFacts } from "@/lib/facts";
import { consume, hashIp } from "@/lib/rateLimit";
import { PlanRequestSchema } from "@/lib/schema";
import { getAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60; // seconds; an agent run takes several model turns

const AGENT_STAGE = 1;

export async function POST(request: NextRequest) {
  const parsed = PlanRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  const req = parsed.data;

  const apiKey = readAnthropicKey();
  if ("problem" in apiKey) return Response.json({ error: "The app isn't set up correctly yet.", detail: apiKey.problem }, { status: 500 });

  // Rate limit (required in production; skipped in local dev without Supabase)
  const db = getAdminClient();
  if (db) {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rl = await consume(db, [
      { key: "global", limit: Number(process.env.PLAN_LIMIT_GLOBAL_PER_DAY ?? 200) },
      { key: `ip:${hashIp(ip)}`, limit: Number(process.env.PLAN_LIMIT_PER_IP_PER_DAY ?? 5) },
    ]);
    if (!rl.ok) {
      const msg = rl.blockedKey === "global" ? "The demo hit its daily limit. Try again tomorrow." : "You've hit today's plan limit. Try again tomorrow.";
      return Response.json({ error: msg }, { status: 429 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Rate limiting not configured" }, { status: 500 });
  }

  // Facts for the checks (also validates that the lens fits the body)
  let facts;
  try {
    facts = await buildFacts(req);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Bad gear selection" }, { status: 400 });
  }

  const client = new Anthropic({ apiKey: apiKey.key });
  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
  const t0 = Date.now();
  try {
    const result = await runStage1(req, { create: (p) => client.messages.create(p), model });
    const checks = runChecks(result.plan, req, facts);
    const latencyMs = Date.now() - t0;

    let id: string | null = null;
    if (db) {
      const { data, error } = await db
        .from("plans")
        .insert({
          title: req.location.name ?? null,
          request: req,
          facts,
          plan: result.plan,
          agent_stage: AGENT_STAGE,
          model,
          latency_ms: latencyMs,
          input_tokens: result.usage.inputTokens,
          output_tokens: result.usage.outputTokens,
        })
        .select("id")
        .single();
      if (error) console.error("Saving plan failed", error);
      id = data?.id ?? null;
    }

    return Response.json({
      id,
      plan: result.plan,
      checks,
      timezone: facts.timezone,
      meta: { agentStage: AGENT_STAGE, model, latencyMs, turns: result.turns, usage: result.usage, trace: result.trace },
    });
  } catch (err) {
    console.error("Agent failed", err);
    const trace = err instanceof AgentError ? err.trace : undefined;
    const { error, detail } = explainFailure(err, apiKey);
    return Response.json({ error, detail, trace }, { status: 502 });
  }
}

/**
 * Turn an agent failure into a user-facing message plus a technical detail line.
 * The detail is the upstream error text (never includes secrets) so problems can be
 * diagnosed from the UI without digging through server logs.
 */
function explainFailure(err: unknown, key: KeyInfo): { error: string; detail: string } {
  const generic = "Couldn't generate a plan. Please try again.";
  if (err instanceof Anthropic.APIError) {
    const detail = `Anthropic API ${err.status ?? ""}: ${err.message}`.trim();
    const m = err.message.toLowerCase();
    if (err.status === 401) {
      const keyNote = `Key in use: starts with "${key.kind}", ${key.length} characters.${key.hint ? ` ${key.hint}` : ""}`;
      return { error: "The app's Anthropic API key was rejected. Check ANTHROPIC_API_KEY in Vercel.", detail: `${detail} · ${keyNote}` };
    }
    if (m.includes("credit")) return { error: "The Anthropic account is out of credits.", detail };
    if (err.status === 404 && m.includes("model")) return { error: "The AI model name isn't recognized. Check ANTHROPIC_MODEL in Vercel.", detail };
    if (err.status === 429) return { error: "Too many requests to the AI right now. Wait a minute and try again.", detail };
    if (err.status === 529 || (err.status ?? 0) >= 500) return { error: "The AI service is busy. Try again in a minute.", detail };
    return { error: generic, detail };
  }
  return { error: generic, detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
}
