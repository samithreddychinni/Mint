import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { AppError, insist } from "./errors";
export async function handle(
  request: NextRequest,
  fn: () => Promise<unknown>,
  webhook = false,
) {
  try {
    if (request.method !== "GET" && !webhook)
      insist(
        request.headers.get("origin") ===
          new URL(process.env.APP_URL || "http://localhost:3000").origin,
        "BAD_ORIGIN",
        "This request must originate from MINT.",
        403,
      );
    return NextResponse.json((await fn()) ?? { ok: true }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof ZodError)
      return NextResponse.json(
        {
          code: "INVALID_INPUT",
          message: "Check the required fields and try again.",
          retryable: false,
        },
        { status: 400 },
      );
    if (error instanceof SyntaxError)
      return NextResponse.json(
        {
          code: "INVALID_INPUT",
          message: "Invalid request body.",
          retryable: false,
        },
        { status: 400 },
      );
    if (error instanceof AppError)
      return NextResponse.json(
        {
          code: error.code,
          message: error.message,
          retryable: [
            "RATE_LIMITED",
            "PAYMENT_PENDING",
            "PROVIDER_UNAVAILABLE",
          ].includes(error.code),
        },
        { status: error.status },
      );
    console.error(
      "MINT request failed:",
      error instanceof Error ? error.name : "UnknownError",
    );
    return NextResponse.json(
      {
        code: "INTERNAL_ERROR",
        message:
          "The request could not be completed. Reload to check its status before retrying.",
        retryable: true,
      },
      { status: 500 },
    );
  }
}
export async function body(request: NextRequest) {
  insist(
    Number(request.headers.get("content-length") || 0) <= 32768,
    "PAYLOAD_TOO_LARGE",
    "Request is too large.",
    413,
  );
  const raw = await request.text();
  insist(
    raw.length <= 32768,
    "PAYLOAD_TOO_LARGE",
    "Request is too large.",
    413,
  );
  return JSON.parse(raw);
}
