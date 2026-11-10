import { z } from "zod";
import poseData from "../../data/poses.json";
import { LightStrategy } from "./schema";

export const PoseSchema = z.object({
  id: z.string(),
  name: z.string(),
  subjects: z.array(z.number().int().min(1).max(4)).min(1),
  vibes: z.array(z.enum(["natural", "moody", "bright_airy", "editorial"])).min(1),
  light: z.array(LightStrategy).min(1),
  instructions: z.array(z.string()).min(2),
  bestFor: z.string(),
});
export type Pose = z.infer<typeof PoseSchema>;

export const POSES: Pose[] = z.array(PoseSchema).parse(poseData.poses);
export const getPose = (id: string) => POSES.find((p) => p.id === id);

/**
 * Poses that suit the subject count, ranked by how well they match the light strategy and vibe.
 * Pure function: the agent tool and the checks both use it.
 */
export function findPoses(opts: {
  subjects: number;
  light?: z.infer<typeof LightStrategy>;
  vibe?: Pose["vibes"][number];
  limit?: number;
}): Pose[] {
  const n = Math.min(4, Math.max(1, opts.subjects));
  return POSES.filter((p) => p.subjects.includes(n))
    .map((p) => ({
      p,
      score: (opts.light && p.light.includes(opts.light) ? 2 : 0) + (opts.vibe && p.vibes.includes(opts.vibe) ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 10)
    .map((x) => x.p);
}
