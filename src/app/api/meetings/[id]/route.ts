import { NextResponse } from "next/server";
import { z } from "zod";
import { ownedMeeting, apiError, jsonBody, ApiError } from "@/lib/server";
import {
  itemSchema,
  MAX_MEETING_BYTES,
  serializedBytes,
  type Meeting,
} from "@/lib/domain";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const { meeting, db } = await ownedMeeting(
      request,
      (await context.params).id,
    );
    let mediaUrl: string | null = null;
    if (meeting.sourcePath) {
      const { data, error } = await db.storage
        .from("recordings")
        .createSignedUrl(meeting.sourcePath, 3600);
      if (error) throw error;
      mediaUrl = data.signedUrl;
    }
    return NextResponse.json(
      { meeting, mediaUrl },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
const patchSchema = z.object({
  title: z.string().trim().min(2).max(180).optional(),
  summary: z.string().max(30000).optional(),
  items: z.array(itemSchema).max(1000).optional(),
  speaker: z
    .object({
      from: z.string().min(1).max(100),
      to: z.string().trim().min(1).max(100),
    })
    .optional(),
});
export async function PATCH(request: Request, context: Context) {
  try {
    const { db, user, meeting } = await ownedMeeting(
      request,
      (await context.params).id,
    );
    if (meeting.status !== "ready")
      throw new ApiError(
        409,
        "Wait for processing to finish before editing this meeting.",
      );
    const { speaker, ...patch } = patchSchema.parse(
      await jsonBody(request, MAX_MEETING_BYTES),
    );
    const updated: Meeting = { ...meeting, ...patch };
    if (speaker) {
      updated.transcript = meeting.transcript.map((s) =>
        s.speaker === speaker.from ? { ...s, speaker: speaker.to } : s,
      );
      updated.participants = [
        ...new Set(
          meeting.participants.map((p) =>
            p === speaker.from ? speaker.to : p,
          ),
        ),
      ];
      updated.items = updated.items.map((item) =>
        item.owner === speaker.from ? { ...item, owner: speaker.to } : item,
      );
    }
    if (serializedBytes(updated) > MAX_MEETING_BYTES)
      throw new ApiError(
        413,
        "The edited meeting is too large. Shorten the summary or reduce the findings.",
      );
    const { error } = await db
      .from("meetings")
      .update({ data: updated })
      .eq("id", meeting.id)
      .eq("user_id", user.id);
    if (error) throw error;
    return NextResponse.json({ meeting: updated });
  } catch (error) {
    return apiError(error);
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    const { db, user, meeting } = await ownedMeeting(
      request,
      (await context.params).id,
    );
    if (meeting.sourcePath) {
      const { error } = await db.storage
        .from("recordings")
        .remove([meeting.sourcePath]);
      if (error) throw error;
    }
    const { error } = await db
      .from("meetings")
      .delete()
      .eq("id", meeting.id)
      .eq("user_id", user.id);
    if (error) throw error;
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return apiError(error);
  }
}
