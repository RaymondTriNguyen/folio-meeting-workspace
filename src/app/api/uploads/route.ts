import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authenticated,
  apiError,
  ApiError,
  jsonBody,
  rateLimit,
  requireProcessing,
} from "@/lib/server";
import { MAX_UPLOAD_BYTES, mediaExtensions } from "@/lib/domain";
export async function POST(request: Request) {
  try {
    const { db, user } = await authenticated(request);
    requireProcessing(true);
    const input = z
      .object({
        name: z.string().min(1).max(250),
        size: z.number().positive().max(MAX_UPLOAD_BYTES),
        consent: z.literal(true),
      })
      .parse(await jsonBody(request, 5000));
    const ext = input.name.split(".").pop()?.toLowerCase() || "";
    if (!mediaExtensions.includes(ext))
      throw new ApiError(400, "Choose a supported audio or video format.");
    await rateLimit(user.id, "upload", 20);
    const path = `${user.id}/${randomUUID()}.${ext}`;
    const { data, error } = await db.storage
      .from("recordings")
      .createSignedUploadUrl(path);
    if (error) throw error;
    return NextResponse.json({ path, token: data.token });
  } catch (error) {
    return apiError(error);
  }
}
