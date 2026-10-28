const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const Registry = require("../js/utils/RemovalRegistry.js");
const root = path.resolve(__dirname, "..");

test("source manifest pins a complete snapshot and loads policy scripts before app gates", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "content.json")));
  const policy = manifest.settings.removals;
  assert.equal(policy.snapshot, "removals.json");
  assert.equal(policy.checkpoint.authority, manifest.address);
  const registry = new Registry({policyId: policy.policyId, authority: manifest.address});
  const snapshot = fs.readFileSync(path.join(root, policy.snapshot), "utf8");
  assert.equal(registry.accept(snapshot, {trustedCheckpoint: policy.checkpoint}).ok, true);
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => match[1].split("?")[0]);
  assert.deepEqual(manifest.order_policy.first_paint.filter(file => file.startsWith("js/")), scripts);
  for (const script of scripts) assert.ok(fs.existsSync(path.join(root, script)), script);
  const codec = scripts.indexOf("js/utils/RemovalRegistry.js");
  const client = scripts.indexOf("js/utils/RemovalPolicy.js");
  assert.ok(codec >= 0 && client > codec);
  assert.ok(scripts.findIndex(script => /utils\/(Site|Post)Removal\.js$/.test(script)) > client);
  assert.ok(manifest.order_policy.prefetch.includes("removals.json"));
});
