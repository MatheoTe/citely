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

  // 3. The inline citation opens the exact source chunk
  const citation = answer.getByTestId("citation").first();
  await expect(citation).toBeVisible();
  await citation.click();
  const panel = page.getByTestId("source-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Orbital Coffee Club");
  await expect(panel).toContainText("every Wednesday at 15:30 UTC");

  // 4. Deep link into the document lands on the highlighted chunk
  await panel.getByRole("link", { name: /open in document/i }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+#chunk-[0-9a-f-]+$/);
  const chunkId = new URL(page.url()).hash.slice(1);
  await expect(page.locator(`[id="${chunkId}"]`)).toContainText("15:30 UTC");

  // 5. The request was traced
  await page.goto("/traces");
  await expect(page.getByTestId("trace-row").first()).toContainText("When does the Orbital Coffee Club meet?");
});

test("says it does not know when the documents do not cover the question", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Question").fill("What is the airspeed velocity of an unladen swallow?");
  await page.getByRole("button", { name: "Ask" }).click();
  const answer = page.getByTestId("answer").last();
  await expect(answer).toContainText("I don't know based on the provided documents.");
  await expect(answer).toContainText("Not in documents");
});
