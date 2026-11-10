import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { CreateMessage } from "./stage1";

/**
 * One model call that must return data matching a Zod schema, via a "submit" tool.
 *
 * Not every model supports forcing a tool, so we ask for it and recover from the usual failures:
 *   - answered in prose          → nudge to call the tool
 *   - invalid or cut-off input   → return the exact validation errors as a tool_result; it resubmits
 * Schemas can carry *refinements* (e.g. "aperture must be ≥ f/4.5 at 45mm"), so domain rules are
 * enforced the same way as types.
 */
export type StructuredResult<T> = { value: T; attempts: number; usage: { inputTokens: number; outputTokens: number } };

export function toolSchema(schema: z.ZodType): Anthropic.Messages.Tool.InputSchema {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  void _ignored;
  return rest as Anthropic.Messages.Tool.InputSchema;
}

export async function structuredCall<T>(opts: {
  create: CreateMessage;
  model: string;
  system: string;
  user: string;
  toolName: string;
  toolDescription: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  maxAttempts?: number;
}): Promise<StructuredResult<T>> {
  const tool: Anthropic.Messages.Tool = { name: opts.toolName, description: opts.toolDescription, input_schema: toolSchema(opts.schema) };
  const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: opts.user }];
  const usage = { inputTokens: 0, outputTokens: 0 };
  const maxAttempts = opts.maxAttempts ?? 3;
  let lastProblem = "no response";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await opts.create({ model: opts.model, max_tokens: opts.maxTokens ?? 4000, system: opts.system, tools: [tool], messages });
    usage.inputTokens += res.usage.input_tokens;
    usage.outputTokens += res.usage.output_tokens;
    messages.push({ role: "assistant", content: res.content });

    // The model may split one answer across several parallel calls (e.g. one per field): merge them.
    const uses = res.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use");
    const submits = uses.filter((b) => b.name === opts.toolName);
    let feedback: string;
    if (!submits.length) {
      lastProblem = res.stop_reason === "max_tokens" ? "ran out of tokens" : "answered without calling the tool";
      feedback = `Submit your answer now in ONE call to ${opts.toolName}.`;
    } else {
      const input = submits.length === 1 ? submits[0].input : Object.assign({}, ...submits.map((b) => b.input as object));
      const parsed = opts.schema.safeParse(input);
      if (parsed.success) return { value: parsed.data, attempts: attempt, usage };
      lastProblem = `${res.stop_reason === "max_tokens" ? "cut off by the token limit; " : ""}${parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`;
      feedback = `Not accepted: ${lastProblem}. Fix these and call ${opts.toolName} again ONCE with the complete answer.`;
    }
    // Every tool_use must be answered by a tool_result in the next message, or the API rejects the request.
    messages.push({
      role: "user",
      content: uses.length
        ? uses.map((b) => ({ type: "tool_result" as const, tool_use_id: b.id, is_error: true, content: feedback }))
        : feedback,
    });
  }
  throw new Error(`${opts.toolName}: no valid answer after ${maxAttempts} attempts (${lastProblem})`);
}

/** Word count helper for length limits in schemas. */
export const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** Word slack before a limit is enforced: the target is shown to the model, a little overrun is tolerated. */
export const WORD_SLACK = 1.25;

/**
 * A string with a word limit. The limit is in the JSON schema description, so the model sees it
 * *before* writing (an earlier version only revealed it in the error, and the model failed 3×).
 * Rejections say the actual count so the retry knows how much to cut.
 */
export const maxWords = (n: number, hint?: string) =>
  z
    .string()
    .superRefine((s, ctx) => {
      const count = words(s);
      if (count > Math.ceil(n * WORD_SLACK)) {
        ctx.addIssue({ code: "custom", message: `This is ${count} words; the limit is ${n}. Cut it to ${n} words or fewer.` });
      }
    })
    .describe(hint ? `${hint} At most ${n} words.` : `At most ${n} words.`);
