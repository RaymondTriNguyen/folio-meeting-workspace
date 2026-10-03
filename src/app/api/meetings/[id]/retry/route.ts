import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  ownedMeeting,
  apiError,
  ApiError,
  rateLimit,
  requireProcessing,
} from "@/lib/server";
import { inngest } from "@/lib/jobs";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { db, user, meeting } = await ownedMeeting(
      request,
      (await context.params).id,
    );
    if (meeting.status !== "failed")
      throw new ApiError(409, "Only failed meetings can be retried.");
    requireProcessing(
      Boolean(
        !meeting.transcript.length &&
          (meeting.sourcePath ||
            (meeting.sourceUrl &&
              meeting.sourceProvider &&
              meeting.sourceProvider !== "youtube")),
      ),
    );
    await rateLimit(user.id, "create", 15);
    const updated = {
      ...meeting,
      status: "queued",
      stage: "Waiting to retry",
      error: null,
    };
    const { data, error } = await db
      .from("meetings")
      .update({ data: updated, status: "queued" })
      .eq("id", meeting.id)
      .eq("user_id", user.id)
      .eq("status", "failed")
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiError(409, "A retry has already started.");
    try {
      await inngest.send({
        name: "folio/meeting.created",
        data: { meetingId: meeting.id, ownerId: user.id, runId: randomUUID() },
      });
    } catch (error) {
      await db
        .from("meetings")
        .update({ data: meeting, status: "failed" })
        .eq("id", meeting.id)
        .eq("user_id", user.id);
      throw error;
    }
    return NextResponse.json({ meeting: updated });
  } catch (error) {
    return apiError(error);
  }
}
