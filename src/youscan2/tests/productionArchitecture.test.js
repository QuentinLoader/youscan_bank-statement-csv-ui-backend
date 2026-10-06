import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("production import graph cannot reach a legacy or bank-specific extractor", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const visited = new Set();
  function visit(file) {
    if (visited.has(file)) return;
    visited.add(file);
    const relative = path.relative(root, file).replaceAll("\\", "/");
    assert.equal(/^(app\.js|parsers\/|core\/|modules\/parse\/|routes\/parse\.js|services\/parseStatement\.js)/.test(relative), false, relative);
    assert.equal(/youscan2\/(classifier\/|normalizer\/|extractor\/(absa|fnb|capitec|nedbank|discovery|standardBank)\/)/.test(relative), false, relative);
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/(?:from\s*|import\s*\(?\s*)["'](\.[^"']+)["']/g)) {
      const dependency = path.resolve(path.dirname(file), match[1]);
      assert.ok(fs.existsSync(dependency), `Missing production dependency: ${dependency}`);
      visit(dependency);
    }
  }
  const server = path.join(root, "server.js");
  visit(server);
  const source = fs.readFileSync(server, "utf8");
  assert.equal(/app\.use\(["']\/parse["']/.test(source), false);
  assert.ok(source.includes('app.use("/api/v2/parse"'));
});
