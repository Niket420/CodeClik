import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the floating "N" dev-tools badge — it overlaps the IDE chrome.
  devIndicators: false,
  // web-tree-sitter's Emscripten-generated runtime guards `require("fs")`/
  // `require("path")` behind a `ENVIRONMENT_IS_NODE` runtime check (dead code
  // in a browser tab), but Turbopack still statically resolves those
  // requires when bundling for the client.
  //
  // `fs` has no legitimate browser use anywhere in this app, so it's stubbed
  // to a no-op. `path` is different: contextEnginer's ImportResolver does
  // real `path.posix.dirname`/`.join` calls at runtime to resolve import
  // graphs — aliasing it to the same empty stub would make every import
  // resolution silently throw, which would make the context engine's
  // graph/dependency features fail every time (falling back to naive
  // behavior) without ever surfacing an error. path-browserify implements
  // the real API using only string manipulation, so it's safe in a browser
  // and keeps that code actually working.
  turbopack: {
    resolveAlias: {
      fs: { browser: "./stubs/empty-module.js" },
      path: { browser: "path-browserify" },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "require-corp",
          },
        ],
      },
    ];
  },
};

export default nextConfig;