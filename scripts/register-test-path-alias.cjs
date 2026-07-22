// Rewrites "@/..." requires to their compiled location under .test-build so
// tsc-compiled test bundles (which don't rewrite path-mapped imports at emit
// time) can resolve them at runtime under plain `node --test`.
const path = require("node:path");
const Module = require("node:module");

const projectRoot = path.resolve(__dirname, "..");
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) {
    const rewritten = path.join(projectRoot, ".test-build", request.slice(2));
    return originalResolveFilename.call(this, rewritten, ...rest);
  }
  return originalResolveFilename.call(this, request, ...rest);
};
