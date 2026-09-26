import { NextResponse, type NextRequest } from "next/server";
import { getAppAccess } from "@/lib/auth/app-access";
import { createClient } from "@/lib/supabase/server";

function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/")) return "/";
  const candidate = new URL(value, "https://betea.invalid");
  if (candidate.origin !== "https://betea.invalid") return "/";
  return `${candidate.pathname}${candidate.search}`;
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

  const nextPath = safeNextPath(url.searchParams.get("next"));
  if (nextPath === "/auth/set-password") {
    return NextResponse.redirect(new URL(nextPath, url.origin));
  }

  const access = await getAppAccess();
  if (access.status === "owner") {
    return NextResponse.redirect(new URL(nextPath, url.origin));
  }
  if (access.status === "staff") {
    return NextResponse.redirect(new URL("/staff/dashboard", url.origin));
  }

  return NextResponse.redirect(new URL("/setup", url.origin));
}
