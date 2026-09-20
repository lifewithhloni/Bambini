import Image from "next/image";
import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-brand-bg px-6 py-24 text-center">
      <Image
        src="/bambini-logo.png"
        alt="Bambini — For every little beginning"
        width={160}
        height={160}
        priority
        className="h-32 w-32 sm:h-40 sm:w-40"
      />
      <h1 className="mt-8 max-w-md text-2xl font-semibold text-brand-ink sm:text-3xl">Bambini is being built.</h1>
      <p className="mt-3 max-w-sm text-brand-muted">
        A marketplace for parents to buy and sell baby and children&apos;s products, launching soon.
      </p>

      <div className="mt-8 flex w-full max-w-xs flex-col gap-3 sm:flex-row sm:justify-center">
        <Link
          href="/signup"
          className="rounded-full bg-brand-sage-dark px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-sage"
        >
          Create an account
        </Link>
        <Link
          href="/login"
          className="rounded-full border border-brand-border px-5 py-2.5 text-sm font-medium text-brand-ink hover:bg-white"
        >
          Log in
        </Link>
      </div>
    </div>
  );
}
