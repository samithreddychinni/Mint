import { workerAuthorized } from "@/jobs/auth";
import { tick } from "@/jobs/tick";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function POST(request: Request) {
  if (!workerAuthorized(request.headers, process.env.WORKER_AUTH_SECRET))
    return Response.json({ code: "UNAUTHENTICATED" }, { status: 401 });
  try {
    await tick();
    return Response.json(
      { completed: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { code: "WORKER_RETRY", message: "Pending work remains durable." },
      { status: 503 },
    );
  }
}
