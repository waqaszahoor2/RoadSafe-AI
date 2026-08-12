import { NextResponse } from "next/server";
import { fetchTraffic } from "../predict/engine";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const latStr = searchParams.get("lat");
  const lonStr = searchParams.get("lon");

  if (!latStr || !lonStr) {
    return NextResponse.json({ available: false, message: "Missing lat/lon parameters" }, { status: 400 });
  }

  const traffic = await fetchTraffic(parseFloat(latStr), parseFloat(lonStr));
  return NextResponse.json(traffic);
}
