import { NextResponse } from "next/server";
import { collectInfrastructure } from "@/app/lib/infrastructure/collect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await collectInfrastructure(), { headers: { "Cache-Control": "no-store" } });
}
