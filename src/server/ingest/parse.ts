import path from "node:path";
import { UnsupportedFileError } from "../errors";
import { parseMarkdown } from "./parse-markdown";
import { parsePdf } from "./parse-pdf";
import type { ParsedDocument } from "./types";

export type SourceType = "pdf" | "markdown";

const EXTENSIONS: Record<string, SourceType> = {
  ".pdf": "pdf",
  ".md": "markdown",
  ".markdown": "markdown",
  ".txt": "markdown",
};

export const ACCEPTED_EXTENSIONS = Object.keys(EXTENSIONS);

export function detectSourceType(filename: string, bytes: Uint8Array): SourceType {
  const ext = path.extname(filename).toLowerCase();
  const byExtension = EXTENSIONS[ext];
  if (!byExtension) {
    throw new UnsupportedFileError(`Unsupported file type "${ext || filename}". Accepted: ${ACCEPTED_EXTENSIONS.join(", ")}`);
  }
  const looksLikePdf = bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-";
  if (byExtension === "pdf" && !looksLikePdf) throw new UnsupportedFileError("File has a .pdf extension but is not a PDF");
  if (byExtension === "markdown" && looksLikePdf) throw new UnsupportedFileError("File looks like a PDF but has a text extension");
  return byExtension;
}

export function titleFromFilename(filename: string): string {
  const base = path.basename(filename, path.extname(filename));
  return base.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function parseDocument(type: SourceType, bytes: Uint8Array, filename: string): Promise<ParsedDocument> {
  const fallbackTitle = titleFromFilename(filename);
  if (type === "pdf") return parsePdf(bytes, fallbackTitle);
  return parseMarkdown(new TextDecoder("utf-8").decode(bytes), fallbackTitle);
}
