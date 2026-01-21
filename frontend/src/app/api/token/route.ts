import { AccessToken } from "livekit-server-sdk";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const room = searchParams.get("room");
  const username = searchParams.get("username");

  if (!room) {
    return NextResponse.json(
      { error: 'Missing "room" query parameter' },
      { status: 400 }
    );
  }

  if (!username) {
    return NextResponse.json(
      { error: 'Missing "username" query parameter' },
      { status: 400 }
    );
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    return NextResponse.json(
      { error: "Server misconfigured: missing LiveKit credentials" },
      { status: 500 }
    );
  }

  const at = new AccessToken(apiKey, apiSecret, {
    identity: username,
    ttl: "1h",
  });

  at.addGrant({
    roomJoin: true,
    room: room,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    // Request agent dispatch when user joins
    agent: true,
  });

  const token = await at.toJwt();

  return NextResponse.json({ token });
}
