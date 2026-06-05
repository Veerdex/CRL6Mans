import { NextRequest, NextResponse } from "next/server";
import { decrypt } from "@/app/lib/session";

const protectedRoutes = ["/dashboard"];

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const isProtected = protectedRoutes.some((r) => path.startsWith(r));

  const session = await decrypt(req.cookies.get("session")?.value);

  if (isProtected && !session?.userId) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }

  if (path === "/login" && session?.userId) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
