import { NextResponse, type NextRequest } from "next/server";
import { getOwnerAccess } from "@/lib/auth/owner-access";
import { createClient } from "@/lib/supabase/server";

function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }
  return value;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const codeError = url.searchParams.get("error");

  if (!code || codeError) {
    return NextResponse.redirect(new URL("/login?auth=failed", url.origin));
  }

  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.redirect(new URL("/login?auth=failed", url.origin));
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/login?auth=failed", url.origin));
  }

  const access = await getOwnerAccess();
  if (access.status === "owner") {
    return NextResponse.redirect(new URL(safeNextPath(url.searchParams.get("next")), url.origin));
  }

  return NextResponse.redirect(new URL("/setup", url.origin));
}
