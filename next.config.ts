import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // PGlite loads its WASM/data files from disk relative to the package, and
  // node-postgres has optional native bindings: keep them out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite", "@electric-sql/pglite-pgvector", "pg", "unpdf"],
  // The demo reset re-seeds from corpus/ at runtime: ship those files with the function.
  outputFileTracingIncludes: {
    "/api/demo/reset": ["./corpus/*.md", "./corpus/*.pdf"],
  },
  turbopack: {
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
