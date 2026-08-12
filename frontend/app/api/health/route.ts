import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "RoadSafe AI",
    timestamp: new Date().toISOString(),
    model: "HistGradientBoosting",
    model_version: "2.1.0",
    historical_dataset: "dft_collisions_2025.csv",
    historical_year: 2025,
    traffic_configured: Boolean(process.env.TOMTOM_API_KEY),
  });
}
