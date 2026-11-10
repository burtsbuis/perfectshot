import "server-only";

/**
 * Read ANTHROPIC_API_KEY defensively. Values pasted into hosting dashboards often pick up
 * surrounding quotes, whitespace, or the "NAME=" prefix. Anthropic then rejects them with a
 * confusing "Invalid bearer token". We clean the obvious cases and explain the rest,
 * without ever echoing the key itself.
 */
export function readAnthropicKey(): { key: string } | { problem: string } {
  const raw = process.env.ANTHROPIC_API_KEY;
  if (!raw || !raw.trim()) return { problem: "ANTHROPIC_API_KEY is not set in Vercel." };
  const key = raw
    .trim()
    .replace(/^ANTHROPIC_API_KEY\s*=\s*/, "")
    .replace(/^["']|["']$/g, "")
    .trim();
  if (!key.startsWith("sk-ant-api")) {
    return {
      problem:
        "ANTHROPIC_API_KEY doesn't look like an Anthropic API key. It should start with sk-ant-api. " +
        "Create a key in the Anthropic Console under API Keys and paste only the key into Vercel.",
    };
  }
  if (/\s/.test(key)) return { problem: "ANTHROPIC_API_KEY contains a space or line break. Re-paste it as a single line." };
  return { key };
}
