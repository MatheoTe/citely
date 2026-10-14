/**
 * Parsers normalise every format into an ordered list of blocks. The chunker
 * only ever sees blocks, so adding a new format means writing a parser — the
 * chunking, embedding and citation logic stay untouched.
 */
export type Block =
  | { kind: "heading"; level: number; text: string; page: number | null }
  | { kind: "paragraph"; text: string; page: number | null };

export interface ParsedDocument {
  title: string;
  pageCount: number | null;
  blocks: Block[];
}

export interface ChunkOptions {
  /** Soft target size of a chunk, in estimated tokens. */
  targetTokens: number;
  /** Tokens of trailing context repeated at the start of the next chunk in the same section. */
  overlapTokens: number;
}

export interface DraftChunk {
  ordinal: number;
  content: string;
  headingPath: string;
  pageStart: number | null;
  pageEnd: number | null;
  tokenCount: number;
}
