import type { NextConfig } from "next";

const resolveAuthUrl = () => {
  const url = process.env.NEXTAUTH_URL?.trim();
  if (url && url.length > 0) return url;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
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
