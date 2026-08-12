import { NextResponse } from "next/server";
import { runPredictionPipeline } from "./engine";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body || !body.road_name || !body.city || !body.state) {
      return NextResponse.json(
        { detail: "Missing required prediction fields (road_name, city, state, country)." },
        { status: 400 }
      );
    }

    const supportedCountries = ["United Kingdom", "UK", "Great Britain"];
    if (!supportedCountries.includes(body.country || "United Kingdom")) {
      return NextResponse.json(
        { detail: `A validated country-specific model is not available for ${body.country}. Current production model supports the United Kingdom.` },
        { status: 422 }
      );
    }

    const prediction = await runPredictionPipeline({
      country: body.country || "United Kingdom",
      state: body.state,
      city: body.city,
      road_type: body.road_type || "A / Main Road",
      road_name: body.road_name,
    });

    return NextResponse.json(prediction);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Live road prediction failed.";
    const isClientError = message.includes("could not be located") || message.includes("supported");
    return NextResponse.json({ detail: message }, { status: isClientError ? 404 : 503 });
  }
}
