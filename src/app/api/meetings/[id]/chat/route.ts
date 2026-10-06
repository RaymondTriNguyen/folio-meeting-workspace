import { NextResponse } from "next/server";
import { z } from "zod";
import {
  apiError,
  ApiError,
  ownedMeeting,
  jsonBody,
  rateLimit,
  getProviderKeys,
} from "@/lib/server";
import { askMeeting } from "@/lib/ai";
export const maxDuration = 180;
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { meeting, user } = await ownedMeeting(
      request,
      (await context.params).id,
    );
    if (meeting.status !== "ready")
      throw new ApiError(409, "This meeting is still processing.");
    const { question } = z
      .object({ question: z.string().trim().min(3).max(2000) })
      .parse(await jsonBody(request, 12000));
    await rateLimit(user.id, "chat", 60);
    return NextResponse.json(
      await askMeeting(meeting, question, await getProviderKeys(user.id)),
    );
  } catch (error) {
    return apiError(error);
  }
}
