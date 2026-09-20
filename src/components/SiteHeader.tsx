import Image from "next/image";
import Link from "next/link";
import { getOptionalUser } from "@/server/auth/requireUser";
import { LogoutButton } from "./LogoutButton";

export async function SiteHeader() {
  const user = await getOptionalUser();

  return (
    <header className="flex items-center justify-between gap-4 border-b border-brand-border bg-brand-bg px-4 py-3 sm:px-6">
      <Link href="/" className="flex items-center gap-2">
        <Image src="/bambini-logo.png" alt="Bambini" width={32} height={32} className="h-8 w-8" />
        <span className="text-sm font-semibold text-brand-ink sm:text-base">Bambini</span>
      </Link>

      <nav className="flex items-center gap-4">
        {user ? (
          <>
            <Link href="/account" className="text-sm font-medium text-brand-ink hover:underline">
              Account
            </Link>
            <LogoutButton />
          </>
        ) : (
          <>
            <Link href="/login" className="text-sm font-medium text-brand-ink hover:underline">
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-full bg-brand-sage-dark px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-sage"
            >
              Sign up
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
