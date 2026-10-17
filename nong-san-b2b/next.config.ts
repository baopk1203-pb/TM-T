import type { NextConfig } from "next";

const resolveAuthUrl = () => {
  // Ưu tiên VERCEL_URL khi ở môi trường preview của Vercel (như nhánh beta)
  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  const url = process.env.NEXTAUTH_URL?.trim();
  if (url && url.length > 0) return url;
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return "http://localhost:3000";
};

const authUrl = resolveAuthUrl();
process.env.NEXTAUTH_URL = authUrl;

const nextConfig: NextConfig = {
  env: {
    NEXTAUTH_URL: authUrl,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
