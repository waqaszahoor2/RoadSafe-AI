export const dynamic = "force-dynamic";

function backendUrl(path: string) {
  const base = process.env.BACKEND_INTERNAL_URL || process.env.ROADSAFE_BACKEND_URL || "http://127.0.0.1:8000";
  return new URL(path, base).toString();
}

export async function GET() {
  try {
    const response = await fetch(backendUrl("/health"), { cache: "no-store" });
    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
