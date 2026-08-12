export const dynamic = "force-dynamic";

function backendUrl(path: string) {
  const base = process.env.BACKEND_INTERNAL_URL || process.env.ROADSAFE_BACKEND_URL || "http://127.0.0.1:8000";
  return new URL(path, base).toString();
}

export async function POST(request: Request) {
  const body = await request.text();
  try {
    const response = await fetch(backendUrl("/predict"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      cache: "no-store",
    });
    const text = await response.text();
    return new Response(text, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") || "application/json" },
    });
  } catch {
    return Response.json(
      { detail: "Prediction service is unavailable. Check the FastAPI service deployment." },
      { status: 503 },
    );
  }
}
