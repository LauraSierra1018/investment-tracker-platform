const backendUrl =
  process.env.BACKEND_URL || "http://127.0.0.1:8000";

const nextConfig = {
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