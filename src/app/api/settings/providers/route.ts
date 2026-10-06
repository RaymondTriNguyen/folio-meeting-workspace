import { NextResponse } from "next/server";
import { z } from "zod";
import {
  apiError,
  authenticated,
  deleteProviderKey,
  jsonBody,
  providerCredentialStatus,
  saveProviderKeys,
} from "@/lib/server";

const providerSchema = z.enum(["groq", "openai"]);
const saveSchema = z
  .object({
    groqApiKey: z.string().trim().min(1).max(500).optional(),
    openaiApiKey: z.string().trim().min(1).max(500).optional(),
  })
  .refine((value) => value.groqApiKey || value.openaiApiKey, {
    message: "Enter a provider key before saving.",
  });

export async function GET(request: Request) {
  try {
    const { user } = await authenticated(request);
    return NextResponse.json(await providerCredentialStatus(user.id), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await authenticated(request);
    await saveProviderKeys(user.id, saveSchema.parse(await jsonBody(request, 5000)));
    return NextResponse.json(await providerCredentialStatus(user.id), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { user } = await authenticated(request);
    const body = z
      .object({ provider: providerSchema })
      .parse(await jsonBody(request, 1000));
    await deleteProviderKey(user.id, body.provider);
    return NextResponse.json(await providerCredentialStatus(user.id), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}
