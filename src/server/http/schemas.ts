import { z } from "zod";
import { ValidationError } from "../errors";

export const askRequestSchema = z
  .object({
    question: z
      .string()
      .trim()
      .min(3, "Question is too short")
      .max(1000, "Question is too long (max 1000 characters)"),
    k: z.number().int().min(1).max(20).optional(),
    documentIds: z.array(z.uuid()).max(50).optional(),
  })
  .strict();

export type AskRequest = z.infer<typeof askRequestSchema>;

export const idParamSchema = z.object({ id: z.uuid("Invalid id") });

export const listTracesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const uploadSchema = z.object({
  file: z.instanceof(File, { message: "Expected a file in the 'file' field" }),
});

/** Parse or throw a typed ValidationError with field-level details. */
export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fieldErrors = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw new ValidationError(fieldErrors[0]?.message ?? "Invalid request", fieldErrors);
  }
  return result.data;
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
}
