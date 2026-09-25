import Image from "next/image";
import Link from "next/link";
import { getOptionalUser } from "@/server/auth/requireUser";
import { LogoutButton } from "./LogoutButton";

export async function SiteHeader() {
  const user = await getOptionalUser();

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-brand-border bg-brand-surface/95 px-4 py-3 backdrop-blur sm:px-6">
      <Link href="/" className="flex items-center gap-2">
        <Image src="/bambini-logo.png" alt="Bambini" width={32} height={32} className="h-8 w-8 rounded-control" />
        <span className="text-heading-card text-brand-ink">Bambini</span>
      </Link>

      <nav aria-label="Secondary" className="flex items-center gap-4">
        {/* Not hidden on mobile, unlike Sell/Account below — there is no
            bottom-nav item for Nearby (BottomNav's "Explore" points at
            /search, a different page), so this remains the only way to
            reach it on a small screen. */}
        <Link href="/nearby" className="text-body-small font-medium text-brand-ink hover:text-bambini-forest">
          Nearby
        </Link>
        {user ? (
          <>
            <Link href="/sell" className="hidden text-body-small font-medium text-brand-ink hover:text-bambini-forest sm:inline">
              Sell
            </Link>
            <Link href="/account" className="hidden text-body-small font-medium text-brand-ink hover:text-bambini-forest sm:inline">
              Account
            </Link>
            <LogoutButton />
          </>
        ) : (
          <>
            <Link href="/login" className="text-body-small font-medium text-brand-ink hover:text-bambini-forest">
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-button bg-brand-sage-dark px-4 py-1.5 text-body-small font-semibold text-white transition-colors duration-150 ease-bambini hover:bg-bambini-green"
            >
              Sign up
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
