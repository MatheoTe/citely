import { asc, desc, eq } from "drizzle-orm";
import type { Db } from "./db/client";
import { chunks, documents, traces } from "./db/schema";
import { NotFoundError } from "./errors";

const documentColumns = {
  id: documents.id,
  title: documents.title,
  filename: documents.filename,
  sourceType: documents.sourceType,
  byteSize: documents.byteSize,
  pageCount: documents.pageCount,
  status: documents.status,
  error: documents.error,
  chunkCount: documents.chunkCount,
  embeddingModel: documents.embeddingModel,
  createdAt: documents.createdAt,
  processedAt: documents.processedAt,
};

export type DocumentSummary = Awaited<ReturnType<typeof listDocuments>>[number];

export function listDocuments(db: Db) {
  return db.select(documentColumns).from(documents).orderBy(desc(documents.createdAt));
}

export async function getDocument(db: Db, id: string) {
  const [doc] = await db.select(documentColumns).from(documents).where(eq(documents.id, id));
  if (!doc) throw new NotFoundError("Document", id);
  return doc;
}

export async function getDocumentWithChunks(db: Db, id: string) {
  const doc = await getDocument(db, id);
  const rows = await db
    .select({
      id: chunks.id,
      ordinal: chunks.ordinal,
      content: chunks.content,
      headingPath: chunks.headingPath,
      pageStart: chunks.pageStart,
      pageEnd: chunks.pageEnd,
      tokenCount: chunks.tokenCount,
    })
    .from(chunks)
    .where(eq(chunks.documentId, id))
    .orderBy(asc(chunks.ordinal));
  return { ...doc, chunks: rows };
}

export async function deleteDocument(db: Db, id: string): Promise<void> {
  const deleted = await db.delete(documents).where(eq(documents.id, id)).returning({ id: documents.id });
  if (deleted.length === 0) throw new NotFoundError("Document", id);
}

export async function getChunk(db: Db, id: string) {
  const [row] = await db
    .select({
      id: chunks.id,
      documentId: chunks.documentId,
      documentTitle: documents.title,
      content: chunks.content,
      headingPath: chunks.headingPath,
      pageStart: chunks.pageStart,
      pageEnd: chunks.pageEnd,
      ordinal: chunks.ordinal,
    })
    .from(chunks)
    .innerJoin(documents, eq(documents.id, chunks.documentId))
    .where(eq(chunks.id, id));
  if (!row) throw new NotFoundError("Chunk", id);
  return row;
}

export function listTraces(db: Db, limit: number) {
  return db.select().from(traces).orderBy(desc(traces.createdAt)).limit(limit);
}

export async function getTrace(db: Db, id: string) {
  const [row] = await db.select().from(traces).where(eq(traces.id, id));
  if (!row) throw new NotFoundError("Trace", id);
  return row;
}
