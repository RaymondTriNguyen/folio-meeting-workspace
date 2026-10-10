import { NextResponse } from "next/server";
import {
  ownedMeeting,
  apiError,
  ApiError,
  rateLimit,
  requireProcessing,
} from "@/lib/server";
import { processMeetingDirect } from "@/lib/direct-processing";

export const maxDuration = 300;
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
    await requireProcessing(
      user.id,
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
      status: "queued" as const,
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
    const processed = await processMeetingDirect(updated, user.id);
    return NextResponse.json({ meeting: processed });
  } catch (error) {
    return apiError(error);
  }
}
