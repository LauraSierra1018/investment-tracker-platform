const backendUrl =
  process.env.BACKEND_URL || "http://127.0.0.1:8000";

const nextConfig = {
  // PDF vision has a 120s upstream budget; allow time for parsing and transport.
  experimental: { proxyTimeout: 180_000 },
  turbopack: {
    root: process.cwd(),
  },

  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;