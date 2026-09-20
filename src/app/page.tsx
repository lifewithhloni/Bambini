import Image from "next/image";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-[#FAF8F5] px-6 py-24 text-center">
      <Image
        src="/bambini-logo.png"
        alt="Bambini — For every little beginning"
        width={160}
        height={160}
        priority
        className="h-32 w-32 sm:h-40 sm:w-40"
      />
      <h1 className="mt-8 max-w-md text-2xl font-semibold text-[#58564F] sm:text-3xl">
        Bambini is being built.
      </h1>
      <p className="mt-3 max-w-sm text-[#8A8880]">
        A marketplace for parents to buy and sell baby and children&apos;s products, launching
        soon.
      </p>
    </div>
  );
}
