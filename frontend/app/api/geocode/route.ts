import { NextResponse } from "next/server";
import { geocodeRoad } from "../predict/engine";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const road_name = searchParams.get("road_name") || searchParams.get("road") || "Bristol Road";
  const city = searchParams.get("city") || "Birmingham";
  const state = searchParams.get("state") || "West Midlands";
  const country = searchParams.get("country") || "United Kingdom";

  try {
    const location = await geocodeRoad({
      country,
      state,
      city,
      road_type: "A / Main Road",
      road_name,
    });
    return NextResponse.json({ success: true, location });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Geocoding failed." },
      { status: 404 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const location = await geocodeRoad({
      country: body.country || "United Kingdom",
      state: body.state || "West Midlands",
      city: body.city || "Birmingham",
      road_type: body.road_type || "A / Main Road",
      road_name: body.road_name || "Bristol Road",
    });
    return NextResponse.json({ success: true, location });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Geocoding failed." },
      { status: 404 }
    );
  }
}
