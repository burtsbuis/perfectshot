import Anthropic from "@anthropic-ai/sdk";
import type { NextRequest } from "next/server";
import { AgentError, runStage1 } from "@/lib/agent/stage1";
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

  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "Server missing ANTHROPIC_API_KEY" }, { status: 500 });

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

  const client = new Anthropic();
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
    return Response.json({ error: "Couldn't generate a plan. Please try again.", trace }, { status: 502 });
  }
}
