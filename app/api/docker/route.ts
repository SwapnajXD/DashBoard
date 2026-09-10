import { NextResponse } from "next/server";
import { getDockerContainers } from "@/app/lib/adapters/docker";

export async function GET() {
  try {
    const data = await getDockerContainers();

    return NextResponse.json({
      ok: true,
      ...data,
    });
  } catch (error) {
    console.error("Docker API error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Unable to connect to Docker",
      },
      { status: 503 },
    );
  }
}
