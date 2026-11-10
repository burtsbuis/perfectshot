import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The eval endpoints spend the owner's credits and skip rate limits, so they need a password.
 * Set EVAL_PASSWORD in Vercel. The browser sends it in the x-eval-password header.
 */
export function checkEvalPassword(request: Request): Response | null {
  const expected = process.env.EVAL_PASSWORD;
  if (!expected) {
    return Response.json(
      { error: "Evals aren't set up yet.", detail: "Add an EVAL_PASSWORD environment variable in Vercel, then redeploy." },
      { status: 503 },
    );
  }
  const given = request.headers.get("x-eval-password") ?? "";
  const h = (s: string) => createHash("sha256").update(s).digest();
  if (!timingSafeEqual(h(given), h(expected))) {
    return Response.json({ error: "Wrong password." }, { status: 401 });
  }
  return null;
}
