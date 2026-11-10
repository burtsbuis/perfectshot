import "server-only";

/**
 * Read ANTHROPIC_API_KEY defensively. Values pasted into hosting dashboards often pick up
 * surrounding quotes, whitespace, or the "NAME=" prefix, so we clean those.
 *
 * We do NOT reject keys by format (formats can change); Anthropic decides validity.
 * For diagnosis we expose only a non-secret "kind" label (the leading type segment,
 * e.g. "sk-ant-api03") and the length, never the secret part of the key.
 */
export type KeyInfo = { key: string; kind: string; length: number; hint?: string };

export function readAnthropicKey(): KeyInfo | { problem: string } {
  const raw = process.env.ANTHROPIC_API_KEY;
  if (!raw || !raw.trim()) {
    return { problem: "ANTHROPIC_API_KEY is empty for this deployment. In Vercel, check the variable is enabled for Production, then redeploy." };
  }
  const key = raw
    .trim()
    .replace(/^ANTHROPIC_API_KEY\s*=\s*/, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, "");

  // Only short, lowercase type labels (like "ant", "api03") count as non-secret; stop at the first segment that isn't one
  const label: string[] = [];
  for (const seg of key.split("-").slice(0, 3)) {
    if (!/^[a-z]{2,5}\d{0,2}$/.test(seg)) break;
    label.push(seg);
  }
  const kind = label.length ? label.join("-") : "(unrecognized format)";
  return { key, kind, length: key.length, hint: hintFor(key) };
}

function hintFor(key: string): string | undefined {
  if (key.startsWith("sk-ant-oat")) return "This looks like a Claude subscription sign-in token (e.g. from Claude Code), not an API key. Create an API key in the Anthropic Console.";
  if (key.startsWith("sk-ant-admin")) return "This looks like an Anthropic Admin key, which can't generate messages. Create a regular API key.";
  if (key.startsWith("sk-proj-") || (key.startsWith("sk-") && !key.startsWith("sk-ant-"))) return "This doesn't look like an Anthropic key (it may be from another AI provider).";
  return undefined;
}
