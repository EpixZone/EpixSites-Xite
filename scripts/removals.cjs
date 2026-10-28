#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Registry = require("../js/utils/RemovalRegistry.js");

const DEFAULT_POLICY = "epix-xite-removal-v1";
const SNAPSHOT_FILE = "removals.json";
const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_DECISIONS = 1000;
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const fail = code => { throw new Error(code); };
const plainObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const exactFields = (value, fields) => plainObject(value) && Object.keys(value).length === fields.length && fields.every(key => has(value, key));
const timestamp = options => options.now === undefined ? Math.floor(Date.now() / 1000) : options.now;
const json = value => JSON.stringify(value, null, 1) + "\n";

function rootDirectory(value) {
  try {
    const root = fs.realpathSync(value);
    if (!fs.statSync(root).isDirectory()) fail("invalid_root");
    return root;
  } catch (_) { fail("invalid_root"); }
}

function readJson(file, limit, code) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > limit) fail(code);
    const text = fs.readFileSync(file, "utf8");
    if (Buffer.byteLength(text) > limit) fail(code);
    return JSON.parse(text);
  } catch (_) { fail(code); }
}

function manifestAt(root) {
  const manifest = readJson(path.join(root, "content.json"), 4 * 1024 * 1024, "invalid_manifest");
  if (!plainObject(manifest) || !/^epix1/.test(manifest.address) || Registry.normalizeAddress(manifest.address) !== manifest.address ||
      (has(manifest, "settings") && !plainObject(manifest.settings))) fail("invalid_manifest");
  return manifest;
}

function currentState(root, options = {}) {
  const manifest = manifestAt(root);
  const config = manifest.settings && manifest.settings.removals;
  if (!exactFields(config, ["policyId", "snapshot", "checkpoint"]) || config.snapshot !== SNAPSHOT_FILE ||
      !plainObject(config.checkpoint) || config.checkpoint.authority !== manifest.address ||
      config.checkpoint.policyId !== config.policyId) fail("invalid_policy_configuration");
  let registry;
  try { registry = new Registry({policyId: config.policyId, authority: manifest.address}); }
  catch (_) { fail("invalid_policy_configuration"); }
  const snapshot = readJson(path.join(root, SNAPSHOT_FILE), Registry.MAX_BYTES, "invalid_snapshot");
  const result = registry.accept(snapshot, {trustedCheckpoint: config.checkpoint, now: timestamp(options)});
  if (!result.ok) fail("registry_verification_failed");
  return {manifest, snapshot, registry};
}

// Each rename is atomic. Snapshot first deliberately leaves a checkpoint
// mismatch if the second write fails, so readers cannot infer false absence.
function atomicWrite(file, text) {
  const directory = path.dirname(file);
  const temporary = path.join(directory, ".removals-write-" + crypto.randomBytes(12).toString("hex") + ".tmp");
  let descriptor;
  try {
    const mode = fs.existsSync(file) ? fs.statSync(file).mode & 0o777 : 0o644;
    descriptor = fs.openSync(temporary, "wx", mode);
    fs.writeFileSync(descriptor, text, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, file);
  } catch (_) { fail("write_failed"); }
  finally {
    if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch (_) {} }
    try { fs.unlinkSync(temporary); } catch (_) {}
  }
}

function withLock(root, operation) {
  const lock = path.join(root, ".removals-publisher.lock");
  let descriptor;
  try { descriptor = fs.openSync(lock, "wx", 0o600); }
  catch (_) { fail("publisher_busy_or_unwritable"); }
  try { return operation(); }
  finally {
    try { fs.closeSync(descriptor); } catch (_) {}
    try { fs.unlinkSync(lock); } catch (_) {}
  }
}

function summary(snapshot, decisionCount) {
  const result = {sequence: snapshot.checkpoint.sequence, entryCount: snapshot.checkpoint.entryCount, root: snapshot.checkpoint.root};
  if (decisionCount !== undefined) result.decisionCount = decisionCount;
  return result;
}

function writeState(root, manifest, snapshot, options) {
  const write = options.writeAtomic || atomicWrite;
  manifest.settings = manifest.settings || {};
  manifest.settings.removals = {policyId: snapshot.checkpoint.policyId, snapshot: SNAPSHOT_FILE, checkpoint: snapshot.checkpoint};
  try {
    write(path.join(root, SNAPSHOT_FILE), json(snapshot));
    write(path.join(root, "content.json"), json(manifest));
  } catch (_) { fail("write_failed"); }
  // The owner must sign and publish separately. Never fabricate signatures,
  // update manifest file hashes, or rewrite unrelated catalogue records here.
}

function init(root, options = {}) {
  root = rootDirectory(root);
  return withLock(root, () => {
    const manifest = manifestAt(root);
    if ((manifest.settings && has(manifest.settings, "removals")) || fs.existsSync(path.join(root, SNAPSHOT_FILE))) fail("registry_already_exists");
    let snapshot;
    try {
      snapshot = Registry.buildSnapshot({policyId: DEFAULT_POLICY, authority: manifest.address, sequence: 1,
        issuedAt: timestamp(options), expiresAt: 0, records: []});
    } catch (_) { fail("invalid_checkpoint"); }
    writeState(root, manifest, snapshot, options);
    return summary(snapshot, 0);
  });
}

function verify(root, options = {}) {
  return summary(currentState(rootDirectory(root), options).snapshot);
}

function readPrivateDecisions(root, inputFile) {
  if (typeof inputFile !== "string" || !path.isAbsolute(inputFile)) fail("private_input_requires_absolute_path");
  let realFile, realParent;
  try { realFile = fs.realpathSync(inputFile); realParent = fs.realpathSync(path.dirname(inputFile)); }
  catch (_) { fail("private_input_unreadable"); }
  const inside = candidate => {
    const relative = path.relative(root, candidate);
    return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
  };
  if ([path.resolve(inputFile), realParent, realFile].some(inside)) fail("private_input_inside_repository");
  const decisions = readJson(realFile, MAX_INPUT_BYTES, "invalid_private_input");
  if (!Array.isArray(decisions) || decisions.length < 1 || decisions.length > MAX_DECISIONS) fail("invalid_private_input");
  return decisions;
}

function parsedDecision(input, policy) {
  let key, kind;
  if (exactFields(input, ["address", "action", "reasonCode"])) {
    if (!Registry.normalizeAddress(input.address)) fail("invalid_decision");
    key = Registry.targetKey(policy, "address", input.address);
    kind = "address";
  } else if (exactFields(input, ["removedKey", "subjectKind", "action", "reasonCode"])) {
    if (typeof input.removedKey !== "string" || !/^[0-9a-f]{64}$/.test(input.removedKey) ||
        input.subjectKind !== "address") fail("invalid_decision");
    key = input.removedKey;
    kind = input.subjectKind;
  } else fail("invalid_decision");
  if (!["remove", "reinstate"].includes(input.action) || typeof input.reasonCode !== "string" ||
      !has(Registry.REASONS, input.reasonCode) || (input.action === "reinstate") !== (input.reasonCode === "reinstated")) fail("invalid_decision");
  return {key, kind, action: input.action, reasonCode: input.reasonCode};
}

function apply(root, inputFile, options = {}) {
  root = rootDirectory(root);
  return withLock(root, () => {
    const state = currentState(root, options);
    const decisions = readPrivateDecisions(root, inputFile).map(input => parsedDecision(input, state.registry.policyId));
    const seen = new Set(), records = new Map(state.registry.records.map(row => [row.removedKey, {...row}]));
    for (const decision of decisions) {
      if (seen.has(decision.key)) fail("duplicate_decision");
      seen.add(decision.key);
      const prior = records.get(decision.key);
      if (!prior && decision.action === "reinstate") fail("unknown_reinstatement");
      if (prior && prior.subjectKind !== decision.kind) fail("changed_subject_kind");
      const revision = prior ? prior.revision + 1 : 1;
      if (!Number.isSafeInteger(revision)) fail("revision_exhausted");
      records.set(decision.key, {removedKey: decision.key, policyId: state.registry.policyId,
        subjectKind: decision.kind, action: decision.action, reasonCode: decision.reasonCode,
        decisionId: "R-" + crypto.randomBytes(12).toString("hex"), revision, authority: state.manifest.address});
    }
    const now = timestamp(options);
    if (!Number.isSafeInteger(now) || now < state.snapshot.checkpoint.issuedAt) fail("clock_before_checkpoint");
    let next;
    try {
      next = Registry.buildSnapshot({policyId: state.registry.policyId, authority: state.manifest.address,
        sequence: state.snapshot.checkpoint.sequence + 1, issuedAt: now,
        expiresAt: state.snapshot.checkpoint.expiresAt, records: [...records.values()]});
    } catch (_) { fail("invalid_next_snapshot"); }
    // Also check transition rules against the full previously accepted set.
    if (!state.registry.accept(next, {trustedCheckpoint: next.checkpoint, now}).ok) fail("invalid_transition");
    writeState(root, state.manifest, next, options);
    return summary(next, decisions.length);
  });
}

function main(args, root = path.resolve(__dirname, ".."), output = process) {
  try {
    let result;
    if (args.length === 1 && args[0] === "init") result = init(root);
    else if (args.length === 1 && args[0] === "verify") result = verify(root);
    else if (args.length === 2 && args[0] === "apply") result = apply(root, args[1]);
    else fail("usage");
    output.stdout.write("Removal registry: sequence " + result.sequence + ", entries " + result.entryCount + ", root " + result.root + ".\n");
    if (args[0] !== "verify") output.stdout.write("Source metadata updated. The owner must sign and publish to regenerate file hashes, bundles, and signatures.\n");
    return 0;
  } catch (error) {
    const code = error && /^[a-z_]+$/.test(error.message) ? error.message : "operation_failed";
    output.stderr.write(code === "usage" ? "Usage: node scripts/removals.cjs init|verify|apply /absolute/private-decisions.json\n" : "Removal registry: " + code + ". No target details are printed.\n");
    return 1;
  }
}

module.exports = {init, verify, apply, main, atomicWrite, DEFAULT_POLICY, SNAPSHOT_FILE};
if (require.main === module) process.exitCode = main(process.argv.slice(2));
