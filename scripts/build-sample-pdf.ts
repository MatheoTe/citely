/**
 * Renders corpus/src/onboarding-guide.txt into corpus/onboarding-guide.pdf.
 *
 * The output is committed so ingestion, tests and evals exercise a real PDF
 * (with real page numbers) without depending on this script at runtime.
 * Markup: "# " / "## " headings, "- " bullets, "<<<page>>>" forces a page break.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 64;

async function main() {
  const root = process.cwd();
  const source = await readFile(path.join(root, "corpus/src/onboarding-guide.txt"), "utf8");

  const pdf = await PDFDocument.create();
  // Fixed metadata keeps the output byte-for-byte reproducible (stable content hash).
  const fixedDate = new Date("2025-01-01T00:00:00Z");
  pdf.setTitle("Engineering Onboarding Guide");
  pdf.setAuthor("Kestrel Labs (fictional)");
  pdf.setCreationDate(fixedDate);
  pdf.setModificationDate(fixedDate);
  pdf.setProducer("citely/build-sample-pdf");
  pdf.setCreator("citely/build-sample-pdf");

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const newPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  };

  const drawWrapped = (text: string, font: PDFFont, size: number, indent = 0) => {
    const maxWidth = PAGE_WIDTH - MARGIN * 2 - indent;
    const words = text.split(/\s+/);
    let line = "";
    const lines: string[] = [];
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    for (const l of lines) {
      if (y < MARGIN + size) newPage();
      page.drawText(l, { x: MARGIN + indent, y, size, font, color: rgb(0.1, 0.1, 0.12) });
      y -= size * 1.45;
    }
  };

  const paragraphs = source.split(/\n\s*\n/);
  for (const raw of paragraphs) {
    const block = raw.trim();
    if (!block) continue;
    if (block === "<<<page>>>") {
      newPage();
      continue;
    }
    if (block.startsWith("# ")) {
      drawWrapped(block.slice(2), bold, 20);
      y -= 10;
    } else if (block.startsWith("## ")) {
      y -= 6;
      drawWrapped(block.slice(3), bold, 14);
      y -= 4;
    } else if (block.split("\n").every((l) => l.startsWith("- "))) {
      for (const item of block.split("\n")) drawWrapped(`•  ${item.slice(2)}`, regular, 11, 12);
      y -= 8;
    } else {
      drawWrapped(block.replace(/\s*\n\s*/g, " "), regular, 11);
      y -= 8;
    }
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawText(`Page ${i + 1} of ${pages.length}`, {
      x: PAGE_WIDTH - MARGIN - 70,
      y: MARGIN / 2,
      size: 9,
      font: regular,
      color: rgb(0.45, 0.45, 0.5),
    });
  });

  const bytes = await pdf.save({ useObjectStreams: false });
  const out = path.join(root, "corpus/onboarding-guide.pdf");
  await writeFile(out, bytes);
  console.log(`✔ wrote ${path.relative(root, out)} (${pages.length} pages, ${bytes.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
