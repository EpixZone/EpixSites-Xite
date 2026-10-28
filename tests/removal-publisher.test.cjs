const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Publisher = require("../scripts/removals.cjs");
const Registry = require("../js/utils/RemovalRegistry.js");

const AUTHORITY = "epix12fdtj0j77kltvdw2eqfzw392mr34r2al22mqrf";
const TARGET = "epix1searchd8hcnyfacvklmszzxwx9ptnf5rde04xf";
const OTHER = "epix1p0stmcza0xjkvv0vnjlk0ypr7xsunt4lxkhgcm";
const NOW = 1793210400;
const remove = address => ({address, action: "remove", reasonCode: "malware"});
const reinstate = address => ({address, action: "reinstate", reasonCode: "reinstated"});

function fixture(t, authority = AUTHORITY) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "removal-publisher-"));
  const root = path.join(directory, "app");
  fs.mkdirSync(root);
  const manifest = {address: authority, title: "Example", settings: {keep: "original"},
    files: {"index.html": {sha512: "unchanged-digest", size: 11}}, signs: {[authority]: "old-signature"}};
  fs.writeFileSync(path.join(root, "content.json"), JSON.stringify(manifest, null, 1));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const writeInput = (decisions, file = path.join(directory, "private.json")) => {
    fs.writeFileSync(file, JSON.stringify(decisions), {mode: 0o600}); return file;
  };
  return {root, directory, manifest, writeInput,
    init: () => Publisher.init(root, {now: NOW}),
    apply: decisions => Publisher.apply(root, writeInput(decisions), {now: NOW + 60}),
    snapshot: () => JSON.parse(fs.readFileSync(path.join(root, "removals.json"))),
    content: () => JSON.parse(fs.readFileSync(path.join(root, "content.json")))};
}

test("init creates an empty pinned checkpoint without fabricating signatures or hashes", t => {
  const f = fixture(t), result = f.init();
  assert.equal(result.sequence, 1);
  assert.equal(result.entryCount, 0);
  assert.equal(f.snapshot().checkpoint.issuedAt, NOW);
  assert.equal(f.snapshot().checkpoint.expiresAt, 0);
  assert.equal(f.snapshot().checkpoint.authority, AUTHORITY);
  assert.equal(f.content().settings.removals.policyId, "epix-xite-removal-v1");
  assert.deepEqual(f.content().settings.removals.checkpoint, f.snapshot().checkpoint);
  assert.deepEqual(f.content().files, f.manifest.files);
  assert.deepEqual(f.content().signs, f.manifest.signs);
  assert.equal(f.content().settings.keep, "original");
  assert.equal(Publisher.verify(f.root, {now: NOW}).sequence, 1);
  assert.throws(() => f.init(), /registry_already_exists/);
});

test("init refuses an existing snapshot even without configured policy", t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, "removals.json"), "{}");
  assert.throws(() => f.init(), /registry_already_exists/);
  assert.equal(fs.readFileSync(path.join(f.root, "removals.json"), "utf8"), "{}");
});

test("apply publishes only commitments, bounded reasons and opaque decision IDs", t => {
  const f = fixture(t); f.init();
  const result = f.apply([remove(TARGET.toUpperCase())]);
  assert.equal(result.sequence, 2);
  assert.equal(result.entryCount, 1);
  const row = f.snapshot().records[0];
  assert.equal(row.removedKey, Registry.targetKey(Publisher.DEFAULT_POLICY, "address", TARGET));
  assert.equal(row.authority, AUTHORITY);
  assert.match(row.decisionId, /^R-[a-f0-9]{24}$/);
  assert.equal(row.revision, 1);
  const publicData = fs.readFileSync(path.join(f.root, "removals.json"), "utf8") + fs.readFileSync(path.join(f.root, "content.json"), "utf8");
  assert.equal(publicData.toLowerCase().includes(TARGET), false);
  assert.equal(JSON.stringify(result).includes(TARGET), false);
  assert.deepEqual(f.content().files, f.manifest.files);
  assert.deepEqual(f.content().signs, f.manifest.signs);
  assert.equal(fs.readdirSync(f.root).some(name => name.includes("private") || name.includes(".tmp") || name.includes(".lock")), false);
});

test("repeated decisions increment revision, retain every key, and permit reinstatement", t => {
  const f = fixture(t); f.init();
  f.apply([remove(TARGET), remove(OTHER)]);
  const first = f.snapshot().records.find(row => row.removedKey === Registry.targetKey(Publisher.DEFAULT_POLICY, "address", TARGET));
  f.apply([remove(TARGET)]);
  const second = f.snapshot().records.find(row => row.removedKey === first.removedKey);
  assert.equal(second.revision, 2);
  assert.notEqual(second.decisionId, first.decisionId);
  f.apply([reinstate(TARGET)]);
  const last = f.snapshot();
  assert.equal(last.checkpoint.sequence, 4);
  assert.equal(last.records.length, 2);
  const registry = new Registry({policyId: Publisher.DEFAULT_POLICY, authority: AUTHORITY});
  assert.equal(registry.accept(last, {trustedCheckpoint: f.content().settings.removals.checkpoint, now: NOW + 60}).ok, true);
  assert.equal(registry.checkTarget({subjectKind: "address", subject: TARGET}, NOW + 60).status, "allowed");
  assert.equal(registry.checkTarget({subjectKind: "address", subject: OTHER}, NOW + 60).status, "removed");
});

test("tampered snapshot or checkpoint is refused before any new writes", t => {
  const f = fixture(t); f.init(); f.apply([remove(TARGET)]);
  const bad = f.snapshot(); bad.records[0].reasonCode = "scam";
  fs.writeFileSync(path.join(f.root, "removals.json"), JSON.stringify(bad));
  const beforeContent = fs.readFileSync(path.join(f.root, "content.json"), "utf8");
  assert.throws(() => f.apply([remove(OTHER)]), /registry_verification_failed/);
  assert.throws(() => Publisher.verify(f.root, {now: NOW + 60}), /registry_verification_failed/);
  assert.equal(fs.readFileSync(path.join(f.root, "content.json"), "utf8"), beforeContent);
  assert.deepEqual(f.snapshot(), bad);
});

test("private files must be outside the app and cannot use symlinks to bypass the restriction", t => {
  const f = fixture(t); f.init();
  const inside = f.writeInput([remove(TARGET)], path.join(f.root, "secret.json"));
  assert.throws(() => Publisher.apply(f.root, inside, {now: NOW}), /private_input_inside_repository/);
  const outsideLink = path.join(f.directory, "outside-link.json"); fs.symlinkSync(inside, outsideLink);
  assert.throws(() => Publisher.apply(f.root, outsideLink, {now: NOW}), /private_input_inside_repository/);
  const outside = f.writeInput([remove(TARGET)]);
  const insideLink = path.join(f.root, "inside-link.json"); fs.symlinkSync(outside, insideLink);
  assert.throws(() => Publisher.apply(f.root, insideLink, {now: NOW}), /private_input_inside_repository/);
  assert.throws(() => Publisher.apply(f.root, "private.json", {now: NOW}), /private_input_requires_absolute_path/);
  assert.equal(f.snapshot().records.length, 0);
});

test("unknown fields, wrong reason types, duplicate targets and unknown reinstatements are rejected", t => {
  const f = fixture(t); f.init();
  const key = Registry.targetKey(Publisher.DEFAULT_POLICY, "address", TARGET);
  for (const decisions of [[{...remove(TARGET), note: "identifying evidence"}], [{...remove(TARGET), title: "title"}],
    [{...remove(TARGET), reasonCode: "spam"}], [{...remove(TARGET), reasonCode: "dead"}], [{...remove(TARGET), reasonCode: "adult"}],
    [{...remove(TARGET), reasonCode: "copyright"}], [{...remove(TARGET), reasonCode: {text: "malware"}}],
    [remove(TARGET), remove(TARGET.toUpperCase())], [remove(TARGET), {removedKey: key, subjectKind: "address", action: "remove", reasonCode: "malware"}],
    [reinstate(TARGET)], [{...remove(TARGET), address: TARGET + "/"}], [{...remove(TARGET), address: "site.epix"}],
    [{...remove(TARGET), address: TARGET.slice(0, -1) + "q"}], []]) {
    assert.throws(() => f.apply(decisions));
    assert.equal(f.snapshot().checkpoint.sequence, 1);
    assert.equal(f.snapshot().records.length, 0);
  }
});

test("a hashed decision can be adopted by another app without copying raw addresses or issuer authority", t => {
  const first = fixture(t), second = fixture(t, OTHER);
  first.init(); second.init(); first.apply([remove(TARGET)]);
  const original = first.snapshot().records[0];
  second.apply([{removedKey: original.removedKey, subjectKind: original.subjectKind, action: original.action, reasonCode: original.reasonCode}]);
  const adopted = second.snapshot().records[0];
  assert.equal(adopted.removedKey, original.removedKey);
  assert.equal(adopted.authority, OTHER);
  assert.notEqual(adopted.decisionId, original.decisionId);
  assert.equal(JSON.stringify(second.snapshot()).includes(TARGET), false);
  assert.equal(JSON.stringify(second.snapshot()).includes(AUTHORITY), false);
});

test("publisher refuses unsupported scopes even though the codec understands them", t => {
  const f = fixture(t); f.init(); f.apply([remove(TARGET)]);
  const removedKey = f.snapshot().records[0].removedKey;
  assert.throws(() => f.apply([{removedKey, subjectKind: "item", action: "remove", reasonCode: "malware"}]), /invalid_decision/);
  assert.throws(() => f.apply([{removedKey: "c".repeat(64), subjectKind: "content", action: "remove", reasonCode: "malware"}]), /invalid_decision/);
  assert.throws(() => f.apply([{removedKey, subjectKind: "unknown", action: "remove", reasonCode: "malware"}]), /invalid_decision/);
  assert.throws(() => f.apply([{removedKey: "g".repeat(64), subjectKind: "address", action: "remove", reasonCode: "malware"}]), /invalid_decision/);
});

test("failure between atomic writes leaves a mismatch that readers reject", t => {
  const f = fixture(t); f.init();
  let writes = 0;
  assert.throws(() => Publisher.apply(f.root, f.writeInput([remove(TARGET)]), {now: NOW + 60,
    writeAtomic(file, text) {
      if (++writes === 2) throw new Error("simulated failure");
      Publisher.atomicWrite(file, text);
    }}), /write_failed/);
  assert.equal(f.snapshot().checkpoint.sequence, 2);
  assert.equal(f.content().settings.removals.checkpoint.sequence, 1);
  assert.throws(() => Publisher.verify(f.root, {now: NOW + 60}), /registry_verification_failed/);
  assert.equal(fs.existsSync(path.join(f.root, ".removals-publisher.lock")), false);
});

test("concurrent publishers are refused and malformed input errors do not echo paths or targets", t => {
  const f = fixture(t); f.init();
  fs.writeFileSync(path.join(f.root, ".removals-publisher.lock"), "");
  assert.throws(() => f.apply([remove(TARGET)]), /publisher_busy_or_unwritable/);
  fs.unlinkSync(path.join(f.root, ".removals-publisher.lock"));
  const secretPath = path.join(f.directory, TARGET + ".json");
  fs.writeFileSync(secretPath, "{raw:" + TARGET);
  let output = "";
  const sink = {stdout: {write: text => { output += text; }}, stderr: {write: text => { output += text; }}};
  assert.equal(Publisher.main(["apply", secretPath], f.root, sink), 1);
  assert.equal(output.includes(TARGET), false);
  assert.equal(output.includes(f.directory), false);
  assert.match(output, /invalid_private_input/);
});

test("publisher output identifies unsigned source metadata and never prints a target", t => {
  const f = fixture(t);
  let output = "";
  const sink = {stdout: {write: text => { output += text; }}, stderr: {write: text => { output += text; }}};
  assert.equal(Publisher.main(["init"], f.root, sink), 0);
  assert.match(output, /owner must sign and publish/);
  assert.match(output, /file hashes, bundles, and signatures/);
  output = "";
  assert.equal(Publisher.main(["apply", f.writeInput([remove(TARGET)])], f.root, sink), 0);
  assert.equal(output.includes(TARGET), false);
  output = "";
  assert.equal(Publisher.main(["verify"], f.root, sink), 0);
  assert.match(output, /sequence 2/);
});
