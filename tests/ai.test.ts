import assert from "node:assert/strict";
import test from "node:test";
import { verifyMeaning } from "../src/lib/ai";
import { demoMeetings } from "../src/lib/demo";

test("independent verification rejects unsupported interpretations even when quotes exist", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = "unit-test-placeholder";
  const meeting = demoMeetings()[0];
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  verdicts: [
                    {
                      id: meeting.items[0].id,
                      supported: true,
                      confidence: 0.65,
                    },
                    {
                      id: meeting.items[1].id,
                      supported: false,
                      confidence: 0.1,
                    },
                    { id: "unknown-id", supported: true, confidence: 1 },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    const result = await verifyMeaning(
      meeting.items.slice(0, 3),
      meeting.transcript,
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].id, meeting.items[0].id);
    assert.equal(result[0].confidence, 0.65);
    assert.equal(result[0].review, "needs-review");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
  }
});
