import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const expectedItemSchema = z.object({
  document: z.string(),
  evidence: z.array(z.string().min(1)).min(1),
  page: z.number().int().positive().optional(),
});

const questionSchema = z.object({
  id: z.string(),
  question: z.string().min(3),
  tags: z.array(z.string()).default([]),
  answerable: z.boolean().default(true),
  /** "all": every expected item must be retrieved; "any": one suffices (redundant sources). */
  match: z.enum(["all", "any"]).default("all"),
  expected: z.array(expectedItemSchema),
  /** Key facts a correct answer must contain (deterministic correctness proxy). */
  mustInclude: z.array(z.string()).default([]),
  reference: z.string().optional(),
});

const datasetSchema = z.object({
  version: z.number(),
  description: z.string(),
  questions: z.array(questionSchema).min(1),
});

export type GoldenQuestion = z.infer<typeof questionSchema>;
export type ExpectedItem = z.infer<typeof expectedItemSchema>;

export async function loadGoldenSet(file = path.resolve("eval/golden.json")): Promise<GoldenQuestion[]> {
  const parsed = datasetSchema.parse(JSON.parse(await readFile(file, "utf8")));
  const ids = new Set<string>();
  for (const q of parsed.questions) {
    if (ids.has(q.id)) throw new Error(`duplicate question id ${q.id}`);
    ids.add(q.id);
    if (q.answerable && q.expected.length === 0) throw new Error(`answerable question ${q.id} has no expected sources`);
  }
  return parsed.questions;
}
