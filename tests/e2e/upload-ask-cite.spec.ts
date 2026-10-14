import path from "node:path";
import { expect, test } from "@playwright/test";

test("upload a document, ask about it and open the cited source", async ({ page }) => {
  // 1. Upload
  await page.goto("/documents");
  await page.getByTestId("file-input").setInputFiles(path.resolve("tests/fixtures/coffee-club.md"));
  const row = page.locator('[data-testid="document-row"][data-filename="coffee-club.md"]');
  await expect(row).toBeVisible();
  // Background ingestion: queued → processing → ready (the list polls).
  await expect(row.locator('[data-status="ready"]')).toBeVisible();

  // 2. Ask
  await page.goto("/");
  await page.getByLabel("Question").fill("When does the Orbital Coffee Club meet?");
  await page.getByLabel("Question").press("Enter");

  const answer = page.getByTestId("answer").last();
  await expect(answer).toContainText("Wednesday at 15:30 UTC");
  // the live pipeline ran every stage (rerank is skipped without a reranker)
  await expect(answer.locator('[data-stage="generate"]')).toHaveAttribute("data-status", "done");
  await expect(answer.locator('[data-stage="rerank"]')).toHaveAttribute("data-status", "skipped");

  // 3. Hovering a citation previews the passage with the supporting sentence highlighted
  const citation = answer.getByTestId("citation").first();
  await expect(citation).toBeVisible();
  await citation.hover();
  const preview = page.getByTestId("citation-preview");
  await expect(preview).toBeVisible();
  await expect(preview.locator("mark")).toContainText("15:30 UTC");

  // 4. Clicking it opens the document view at the cited chunk, with retrieval evidence
  await citation.click();
  const panel = page.getByTestId("source-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Orbital Coffee Club");
  await expect(panel).toContainText("every Wednesday at 15:30 UTC");

  await expect(panel).toContainText("Retrieval evidence");
  await expect(panel.locator("mark")).toContainText("15:30 UTC");

  // 5. Follow-up questions use the conversation as context
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await page.getByLabel("Question").fill("How long does it last?");
  await page.getByLabel("Question").press("Enter");
  await expect(page.getByTestId("answer").nth(1)).toContainText("25 minutes");

  // 6. Deep link into the document lands on the highlighted chunk
  await page.getByTestId("answer").first().getByTestId("citation").first().click();
  await page.getByTestId("source-panel").getByRole("link", { name: /open in document/i }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+#chunk-[0-9a-f-]+$/);
  const chunkId = new URL(page.url()).hash.slice(1);
  await expect(page.locator(`[id="${chunkId}"]`)).toContainText("15:30 UTC");

  // 7. Both requests were traced; a row expands into the latency waterfall
  await page.goto("/traces");
  const rows = page.getByTestId("trace-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText("When does the Orbital Coffee Club meet?");
  await rows.nth(1).click();
  await expect(page.getByTestId("waterfall")).toBeVisible();
});

test("says it does not know when the documents do not cover the question", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Question").fill("What is the airspeed velocity of an unladen swallow?");
  await page.getByRole("button", { name: "Ask" }).click();
  const answer = page.getByTestId("answer").last();
  await expect(answer).toContainText("I don't know based on the provided documents.");
  await expect(answer).toContainText("Not in documents");
});
