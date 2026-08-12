import { NextResponse } from "next/server";
import { fetchWeather } from "../predict/engine";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const latStr = searchParams.get("lat");
  const lonStr = searchParams.get("lon");

  if (!latStr || !lonStr) {
    return NextResponse.json({ error: "Missing lat/lon parameters" }, { status: 400 });
  }

  try {
    const weather = await fetchWeather(parseFloat(latStr), parseFloat(lonStr));
    return NextResponse.json({ success: true, weather });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Live weather unavailable." },
      { status: 503 }
    );
  }
}
