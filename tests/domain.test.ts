import assert from "node:assert/strict";
import test from "node:test";
import {
  boundedPage,
  serializedBytes,
  chunkTranscript,
  createMeetingSchema,
  itemSchema,
  parseTranscript,
  retrieveSegments,
  timestamp,
  verifyItems,
} from "../src/lib/domain";
import { demoMeetings } from "../src/lib/demo";
import { meetingMarkdown } from "../src/lib/export";

test("parses timestamped speaker turns without losing quoted text", () => {
  const segments = parseTranscript(
    "[00:15] Olivia: We need SSO.\n[01:02:09] Marcus: Agreed, I will draft the plan.",
  );
  assert.deepEqual(segments[0], {
    id: "seg-1",
    start: 15,
    end: 3729,
    speaker: "Olivia",
    text: "We need SSO.",
  });
  assert.equal(segments[1].start, 3729);
});
test("never invents timing for a plain transcript", () => {
  const segments = parseTranscript(
    "Olivia: We need clear navigation.\nMarcus: I will share a draft.",
  );
  assert.equal(segments.length, 2);
  assert.ok(segments.every((s) => s.start === null && s.end === null));
  assert.equal(timestamp(segments[0].start), "No timestamp");
});
test("splits oversized paragraphs into bounded extraction chunks", () => {
  const segments = parseTranscript("a".repeat(35000));
  assert.equal(segments.map((s) => s.text).join(""), "a".repeat(35000));
  const chunks = chunkTranscript(segments);
  assert.ok(chunks.length > 1);
  assert.ok(
    chunks.every((c) => c.reduce((n, s) => n + s.text.length, 0) <= 16000),
  );
});
test("requires consent and exactly one input source", () => {
  const base = {
    title: "Kickoff meeting",
    transcript: "Olivia: We must build an accessible navigation experience.",
    consent: true,
  };
  assert.equal(createMeetingSchema.safeParse(base).success, true);
  assert.equal(
    createMeetingSchema.safeParse({ ...base, consent: false }).success,
    false,
  );
  assert.equal(
    createMeetingSchema.safeParse({ ...base, sourcePath: "user/file.mp4" })
      .success,
    false,
  );
  assert.equal(
    createMeetingSchema.safeParse({ ...base, transcript: "" }).success,
    false,
  );
  assert.equal(
    createMeetingSchema.safeParse({
      ...base,
      transcript: undefined,
      sourcePath: "user/file.mp4",
    }).success,
    true,
  );
});
test("bounds oversized ASR turns while preserving citation IDs", () => {
  const chunks = chunkTranscript([{ id: "asr-1", start: 0, end: 300, speaker: "A", text: "x".repeat(40000) }]);
  assert.equal(chunks.length, 3);
  assert.ok(chunks.every(chunk => chunk.every(s => s.id === "asr-1" && s.text.length <= 16000)));
  assert.equal(chunks.flat().map(s => s.text).join("").length, 40000);
});
test("drops invented evidence, tiny quotes, and invalid references", () => {
  const meeting = demoMeetings()[0];
  const valid = meeting.items[0];
  const items = [
    valid,
    {
      ...valid,
      text: "Use Kubernetes",
      evidence: "Use Kubernetes for every service",
    },
    { ...valid, segmentId: "missing" },
    { ...valid, evidence: "The" },
  ];
  const verified = verifyItems(items, meeting.transcript);
  assert.equal(verified.length, 1);
  assert.equal(verified[0].text, valid.text);
});
test("deduplicates findings and flags inferred claims", () => {
  const meeting = demoMeetings()[0];
  const item = { ...meeting.items[0], confidence: 0.99, inferred: true };
  const verified = verifyItems(
    [item, { ...item, id: "duplicate" }],
    meeting.transcript,
  );
  assert.equal(verified.length, 1);
  assert.equal(verified[0].confidence, 0.7);
  assert.equal(verified[0].review, "needs-review");
});
test("leaves unknown owners and due dates empty", () => {
  const item = itemSchema.parse({
    id: "1",
    kind: "action",
    text: "Share requirements",
  });
  assert.equal(item.owner, null);
  assert.equal(item.dueDate, null);
});
test("retrieval favors relevant source passages", () => {
  assert.equal(
    retrieveSegments("checkout integration", demoMeetings()[0].transcript, 1)[0]
      .id,
    "seg-5",
  );
});
test("formatting handles zero, hours, and unknown timing", () => {
  assert.equal(timestamp(0), "00:00");
  assert.equal(timestamp(3729), "1:02:09");
  assert.equal(timestamp(null), "No timestamp");
});
test("exports reflect edits, completion, and missing timing", () => {
  const meeting = demoMeetings()[0];
  meeting.summary = "An updated summary.";
  meeting.items[2].completed = true;
  meeting.items[2].text = "Deliver revised design.";
  meeting.transcript[0].start = null;
  const markdown = meetingMarkdown(meeting, { includeTranscript: true });
  for (const text of [
    "An updated summary.",
    "[x] Deliver revised design.",
    "[No timestamp]",
    "## Requirements",
    "## Open questions",
  ])
    assert.ok(markdown.includes(text));
});
test("the full transcript is an optional appendix, not part of the default brief", () => {
  assert.ok(!meetingMarkdown(demoMeetings()[0]).includes("## Transcript"));
});
test("all sample findings have real source evidence", () => {
  for (const meeting of demoMeetings()) {
    assert.equal(
      verifyItems(meeting.items, meeting.transcript).length,
      meeting.items.length,
    );
    assert.equal(
      new Set(meeting.items.map((i) => i.id)).size,
      meeting.items.length,
    );
  }
});
test("library pagination stays below byte limits even for Unicode", () => {
  const rows = [
    { text: "hello" },
    { text: "\u65e5\u672c\u8a9e" },
    { text: "world" },
  ];
  const budget = serializedBytes(rows[0]) + serializedBytes(rows[1]);
  const page = boundedPage(rows, budget);
  assert.equal(page.length, 2);
  assert.ok(page.reduce((n, row) => n + serializedBytes(row), 0) <= budget);
  assert.throws(() => boundedPage([{ text: "a".repeat(1000) }], 100));
});
