import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // api/hooks/ is excluded on purpose: Supabase Auth calls those hook
  // endpoints server-to-server (signed, no browser session) with a 5 s
  // budget, so a session refresh would only add latency. See
  // src/app/api/hooks/send-sms/route.ts.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/hooks/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
