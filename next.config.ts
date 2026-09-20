import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Signed URLs for the private product-images bucket (see
      // src/server/listings/imageUrls.ts) — scoped to Storage's signed
      // object path, not a blanket allow of the whole Supabase host.
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/sign/**" },
      // Local `supabase start` stack.
      { protocol: "http", hostname: "127.0.0.1", pathname: "/storage/v1/object/sign/**" },
      { protocol: "http", hostname: "localhost", pathname: "/storage/v1/object/sign/**" },
    ],
  },
};

export default nextConfig;
