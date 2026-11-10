import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { KeyInfo } from "./anthropicKey";

/**
 * Turn an agent failure into a user-facing message plus a technical detail line.
 * The detail is the upstream error text (never includes secrets) so problems can be
 * diagnosed from the UI without digging through server logs.
 */
export function explainFailure(
  err: unknown,
  key: KeyInfo,
  generic = "Couldn't generate a plan. Please try again.",
): { error: string; detail: string } {
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
