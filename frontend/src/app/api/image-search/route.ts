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

  const apiKey = process.env.SERPAPI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Server misconfigured: missing SERPAPI_API_KEY" },
      { status: 500 }
    );
  }

  try {
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("engine", "google_images");
    url.searchParams.set("q", query);
    url.searchParams.set("num", "5"); // Get a few results in case some fail
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

    // Try to fetch and convert image to base64 (proxy to avoid CORS)
    for (const image of data.images_results) {
      try {
        // Try thumbnail first (usually more reliable), then original
        const imageUrl = image.thumbnail || image.original;

        const imageResponse = await fetch(imageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });

        if (!imageResponse.ok) {
          console.log(`Failed to fetch image: ${imageUrl}, trying next...`);
          continue;
        }

        const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
        const arrayBuffer = await imageResponse.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');
        const dataUrl = `data:${contentType};base64,${base64}`;

        return NextResponse.json({
          dataUrl,
          title: image.title,
          width: image.original_width,
          height: image.original_height,
        });
      } catch (fetchError) {
        console.log(`Error fetching image, trying next:`, fetchError);
        continue;
      }
    }

    // If all images failed, return error
    return NextResponse.json(
      { error: "Failed to fetch any images" },
      { status: 500 }
    );
  } catch (error) {
    console.error("Image search error:", error);
    return NextResponse.json(
      { error: "Failed to search for images" },
      { status: 500 }
    );
  }
}
