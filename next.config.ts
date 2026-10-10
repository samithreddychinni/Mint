import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: { "/api/**": ["./certs/supabase-ca.crt"] },
  async rewrites() {
    const backend = process.env.BACKEND_URL;
    return {
      beforeFiles: backend
        ? [
            {
              source: "/api/:path*",
              destination: `${new URL(backend).origin}/api/:path*`,
            },
          ]
        : [],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "geolocation=(self), camera=(self)",
          },
        ],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};
export default config;
