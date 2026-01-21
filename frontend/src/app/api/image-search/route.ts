import { NextRequest, NextResponse } from "next/server";

// SerpAPI Google Images endpoint
// Get your API key from: https://serpapi.com/

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");

  if (!query) {
    return NextResponse.json(
      { error: 'Missing "q" query parameter' },
      { status: 400 }
    );
  }

  const apiKey = process.env.SERPAPI_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Server misconfigured: missing SERPAPI_KEY" },
      { status: 500 }
    );
  }

  try {
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("engine", "google_images");
    url.searchParams.set("q", query);
    url.searchParams.set("num", "1");
    url.searchParams.set("safe", "active");

    const response = await fetch(url.toString());
    const data = await response.json();

    if (data.error) {
      return NextResponse.json(
        { error: data.error },
        { status: 500 }
      );
    }

    if (!data.images_results || data.images_results.length === 0) {
      return NextResponse.json(
        { error: "No images found" },
        { status: 404 }
      );
    }

    // Return the first image result
    const image = data.images_results[0];
    return NextResponse.json({
      url: image.original,
      thumbnail: image.thumbnail,
      title: image.title,
      width: image.original_width,
      height: image.original_height,
    });
  } catch (error) {
    console.error("Image search error:", error);
    return NextResponse.json(
      { error: "Failed to search for images" },
      { status: 500 }
    );
  }
}
