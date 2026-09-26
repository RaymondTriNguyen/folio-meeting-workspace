import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { buildExport } from "../src/lib/export";
import { demoMeetings } from "../src/lib/demo";

test("PDF export paginates long notes and wraps unbroken source strings", async () => {
  const meeting = demoMeetings()[0];
  meeting.summary = "A source-backed summary. ".repeat(900) + "a".repeat(600);
  const blob = await buildExport(meeting, "pdf");
  assert.equal(blob.type, "application/pdf");
  const pdf = await PDFDocument.load(await blob.arrayBuffer());
  assert.ok(pdf.getPageCount() > 3);
  assert.equal(pdf.getTitle(), meeting.title);
  assert.ok(
    pdf
      .getPages()
      .every((page) => page.getWidth() === 595 && page.getHeight() === 842),
  );
});
test("DOCX export produces a real zipped Word document", async () => {
  const blob = await buildExport(demoMeetings()[0], "docx");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  assert.ok(bytes.length > 3000);
  assert.ok(new TextDecoder().decode(bytes).includes("word/document.xml"));
});
test("Markdown preserves Unicode and the optional transcript appendix", async () => {
  const meeting = demoMeetings()[0];
  meeting.title = "R\u00e9union \u65e5\u672c\u8a9e";
  const blob = await buildExport(meeting, "md", { includeTranscript: true });
  const text = await blob.text();
  assert.ok(text.includes(meeting.title));
  assert.ok(text.includes("## Transcript"));
});
