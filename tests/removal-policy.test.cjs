const assert = require("node:assert/strict");
const test = require("node:test");
const Registry = require("../js/utils/RemovalRegistry.js");
const Client = require("../js/utils/RemovalPolicy.js");

const AUTHORITY = "epix1searchd8hcnyfacvklmszzxwx9ptnf5rde04xf";
const TARGET = "epix12fdtj0j77kltvdw2eqfzw392mr34r2al22mqrf";
const OTHER = "epix1p0stmcza0xjkvv0vnjlk0ypr7xsunt4lxkhgcm";
const POLICY = "epix-xite-removal-v1", NOW = 1793210400;
const clone = value => JSON.parse(JSON.stringify(value));
function snapshot(sequence = 1, action = "remove") {
  return Registry.buildSnapshot({policyId: POLICY, authority: AUTHORITY, sequence,
    issuedAt: NOW - 10, expiresAt: 0, records: [{
      removedKey: Registry.targetKey(POLICY, "address", TARGET), policyId: POLICY,
      subjectKind: "address", action, reasonCode: action === "remove" ? "malware" : "reinstated",
      decisionId: "R-" + sequence, revision: sequence, authority: AUTHORITY
    }]});
}
function info(data) {
  return {content: {address: AUTHORITY, settings: {removals: {
    policyId: POLICY, snapshot: "removals.json", checkpoint: data.checkpoint
  }}}};
}
function setup(data = snapshot(), overrides = {}) {
  const calls = [];
  const page = {local_storage: {theme: "dark"}, cmd(command, params, callback) {
    calls.push({command, params});
    if (overrides[command]) return overrides[command](params, callback);
    if (command === "fileGet") callback(JSON.stringify(data));
    else if (command === "wrapperSetLocalStorage") callback(undefined);
    else if (command === "resolveStatus") callback(null);
    else throw new Error("Unexpected command");
  }};
  const client = new Client(() => page, {now: () => NOW, timeout: 100});
  return {page, calls, client};
}

test("policy fails closed until the root-pinned snapshot and persisted checkpoint are ready", async () => {
  let save;
  const data = snapshot(), {client, page} = setup(data, {
    wrapperSetLocalStorage(params, cb) { save = cb; }
  });
  assert.equal(client.check(OTHER).status, "verification_unavailable");
  const loading = client.configure(info(data));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(client.check(TARGET).status, "removed");
  assert.equal(client.check(OTHER).status, "verification_unavailable");
  save(undefined);
  await loading;
  assert.equal(client.check(OTHER).status, "allowed");
  assert.equal(page.local_storage.theme, "dark");
  assert.equal(page.local_storage.removal_checkpoints[AUTHORITY + ":" + POLICY].sequence, 1);
  const publicRows = JSON.stringify(client.records());
  assert.ok(!publicRows.includes(TARGET));
  assert.ok(!client.message(client.check(TARGET)).includes(TARGET));
});

test("root configuration cannot delegate trust to a different authority or snapshot", async () => {
  const data = snapshot(), {client, calls} = setup(data);
  for (const mutate of [
    config => { config.checkpoint.authority = OTHER; },
    config => { config.snapshot = "data/users/attacker.json"; },
    config => { config.checkpoint.root = "bad"; },
    config => { config.policyId = "other"; },
    config => { config.extra = "untrusted"; }
  ]) {
    const next = clone(info(data)); mutate(next.content.settings.removals);
    await client.configure(next);
    assert.equal(client.check(TARGET).status, "verification_unavailable");
  }
  assert.equal(calls.length, 0);
});

test("snapshot refresh failure preserves known removals while preventing new allowed decisions", async () => {
  const data = snapshot(), {client, page} = setup(data);
  await client.configure(info(data));
  page.cmd = (command, params, cb) => cb({error: "unavailable"});
  await client.refresh();
  assert.equal(client.check(TARGET).status, "removed");
  assert.equal(client.check(OTHER).status, "verification_unavailable");
  await client.configure({});
  assert.equal(client.check(TARGET).status, "removed");
  assert.equal(client.check(OTHER).status, "verification_unavailable");
});

test("saved sequence prevents rollback across reloads and rejects corrupt caches", async () => {
  const data = snapshot(), {client, page} = setup(data);
  page.local_storage.removal_checkpoints = {[AUTHORITY + ":" + POLICY]: {
    sequence: 2, root: snapshot(2, "reinstate").checkpoint.root, snapshot: snapshot(2, "reinstate")
  }};
  await client.configure(info(data));
  assert.equal(client.check(OTHER).status, "verification_unavailable");
  assert.equal(client.error, "checkpoint_rollback");
  const bad = setup(data);
  bad.page.local_storage.removal_checkpoints = "bad";
  await bad.client.configure(info(data));
  assert.equal(bad.client.error, "invalid_sequence_cache");
});

test("only a newer explicit reinstatement restores access", async () => {
  let data = snapshot();
  const {client} = setup(data, {fileGet(params, cb) { cb(JSON.stringify(data)); }});
  await client.configure(info(data));
  assert.equal(client.check(TARGET).status, "removed");
  data = snapshot(2, "reinstate");
  await client.configure(info(data));
  assert.equal(client.check(TARGET).status, "allowed");
  assert.equal(client.records().length, 0);
});

test("a late response from an older configuration cannot override a newer checkpoint", async () => {
  const responses = [], data = snapshot(), newer = snapshot(2, "reinstate");
  const {client, page} = setup(data, {fileGet(params, cb) { responses.push(cb); }});
  const old = client.configure(info(data));
  await new Promise(resolve => setImmediate(resolve));
  const current = client.configure(info(newer));
  await new Promise(resolve => setImmediate(resolve));
  responses[1](JSON.stringify(newer)); await current;
  responses[0](JSON.stringify(data)); await old;
  assert.equal(client.check(TARGET).status, "allowed");
  assert.equal(page.local_storage.removal_checkpoints[AUTHORITY + ":" + POLICY].sequence, 2);
});

test("verified aliases use canonical keys and refresh resolution before mutation", async () => {
  let address = TARGET, verified = true;
  const data = snapshot(), {client, calls} = setup(data, {resolveStatus(params, cb) {
    cb({host: params.host, address, verified, state: "resolved"});
  }});
  await client.configure(info(data));
  assert.equal(client.check("example.epix").status, "verification_unavailable");
  await client.prepare(["example.epix"]);
  assert.equal(client.check("example.epix").status, "removed");
  assert.equal(client.key("example.epix"), client.key(TARGET));
  address = OTHER;
  const allowed = await client.guard("example.epix");
  assert.equal(allowed.status, "allowed");
  assert.equal(allowed.canonicalAddress, OTHER);
  verified = false;
  assert.equal((await client.guard("example.epix")).status, "verification_unavailable");
  assert.ok(calls.every(call => ["fileGet", "wrapperSetLocalStorage", "resolveStatus"].includes(call.command)));
});

test("unverified, mismatched and unresolved aliases never become allowed", async () => {
  const data = snapshot();
  for (const result of [null, {host: "other.epix", address: OTHER, verified: true, state: "resolved"},
    {host: "example.epix", address: OTHER, verified: false, state: "resolved"},
    {host: "example.epix", address: "invalid", verified: true, state: "resolved"},
    {host: "example.epix", address: OTHER, verified: true, state: "failed"},
    {host: "example.epix", address: OTHER, verified: true, state: "resolving"},
    {host: "example.epix", address: OTHER, verified: true}]) {
    const {client} = setup(data, {resolveStatus(params, cb) { cb(result); }});
    await client.configure(info(data));
    assert.equal((await client.guard("example.epix")).status, "verification_unavailable");
  }
});

test("reload retains known decisions and rejects a newer snapshot that silently drops a removal", async () => {
  const first = setup();
  await first.client.configure(info(snapshot()));
  const empty = Registry.buildSnapshot({policyId: POLICY, authority: AUTHORITY, sequence: 2,
    issuedAt: NOW, expiresAt: 0, records: []});
  const second = setup(empty);
  second.page.local_storage = clone(first.page.local_storage);
  await second.client.configure(info(empty));
  assert.equal(second.client.error, "missing_prior_decision");
  assert.equal(second.client.check(TARGET).status, "removed");
  assert.equal(second.client.check(OTHER).status, "verification_unavailable");
  const reinstated = snapshot(2, "reinstate"), third = setup(reinstated);
  third.page.local_storage = clone(first.page.local_storage);
  await third.client.configure(info(reinstated));
  assert.equal(third.client.check(TARGET).status, "allowed");
});

test("reload restores expired known removals during an outage and rejects corrupted cached snapshots", async () => {
  const data = snapshot();
  data.checkpoint.expiresAt = NOW + 1;
  const first = setup(data);
  await first.client.configure(info(data));
  const second = setup(data, {fileGet(params, cb) { cb({error: "offline"}); }});
  second.page.local_storage = clone(first.page.local_storage);
  second.client.now = () => NOW + 2;
  await second.client.configure(info(data));
  assert.equal(second.client.check(TARGET).status, "removed");
  assert.equal(second.client.check(OTHER).status, "verification_unavailable");
  const third = setup(data);
  third.page.local_storage = clone(first.page.local_storage);
  third.page.local_storage.removal_checkpoints[AUTHORITY + ":" + POLICY].snapshot.records[0].reasonCode = "scam";
  await third.client.configure(info(data));
  assert.equal(third.client.error, "invalid_sequence_cache");
  assert.equal(third.client.check(OTHER).status, "verification_unavailable");
});

test("storage availability and write errors fail closed without erasing known removals", async () => {
  const data = snapshot(), {client, page} = setup(data, {
    wrapperSetLocalStorage(params, cb) { cb({error: "quota"}); }
  });
  await client.configure(info(data));
  assert.equal(client.check(OTHER).status, "verification_unavailable");
  assert.equal(client.check(TARGET).status, "removed");
  const delayed = setup(data);
  delete delayed.page.local_storage;
  let loaded;
  delayed.page.on_local_storage = {then(cb) { loaded = cb; }};
  const pending = delayed.client.configure(info(data));
  delayed.page.local_storage = {theme: "light"}; loaded(); await pending;
  assert.equal(delayed.client.check(OTHER).status, "allowed");
  assert.equal(delayed.page.local_storage.theme, "light");
});
