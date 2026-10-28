The removal registry publishes hashed target commitments and bounded decisions. Its complete snapshot is authenticated by the checkpoint in the application's signed root manifest. A report does not become a removal automatically. Mature/Adult classifications, spam ranking, unavailable sites, personal hiding, and owner withdrawal remain separate.

Run the publisher from a source checkout with Node.js:

```sh
node scripts/removals.cjs init
node scripts/removals.cjs verify
node scripts/removals.cjs apply /absolute/private/decisions.json
```

`init` is only for a new registry. It refuses existing configuration or an existing snapshot. It creates `removals.json` and pins its checkpoint in `content.json` under `settings.removals`. The policy ID is `epix-xite-removal-v1`; the issuing authority is the application's canonical Epix address. The initial sequence is 1. `expiresAt: 0` explicitly disables a time deadline. Sequence checks still apply. A finite expiry requires a deliberate owner-managed renewal process; this publisher refuses an expired current checkpoint.

`verify` checks the complete local snapshot against the locally pinned checkpoint. This is an integrity check, not verification of the root manifest's cryptographic signature. The node authenticates that manifest when distributing the signed application.

Keep the private decision file outside the checkout and outside every published Xite. The publisher rejects files inside its own repository, including symlink routes. It never copies this input into the application. Example private input, replacing the placeholder with a verified address:

```json
[
 {"address":"CANONICAL_EPIX_ADDRESS","action":"remove","reasonCode":"malware"}
]
```

Allowed removal reasons are `malware`, `abuse`, `scam`, and `policy`. No free-text notes, evidence, titles, links, or additional fields are accepted. To reverse an existing decision, use the same address with `"action":"reinstate"` and `"reasonCode":"reinstated"`. Unknown targets cannot be reinstated. Repeated decisions increment the target revision and create a new opaque decision ID. Every prior target remains in the complete snapshot with its latest decision; old revisions are replaced. Do not delete a target to reinstate it.

Resolve aliases and names through the application or node before preparing input, and use the verified canonical address. The publisher does not resolve names or accept URLs or paths. Epix Bech32 checksums are checked and uppercase addresses normalize to lowercase. Legacy Base58Check targets are validated without changing their case. Changing a listing ID or submitting an alias for the same resolved address produces the same address key. A copy under a new address is a different target.

Another application adopting the same policy ID can reissue a hashed decision without receiving the original address:

```json
[
 {"removedKey":"64_LOWERCASE_HEX_CHARACTERS","subjectKind":"address","action":"remove","reasonCode":"malware"}
]
```

Use the actual 64-character commitment in place of the placeholder. Hashed imports must use the same policy ID and key construction as their source; the publisher cannot recover or verify the hidden target from a hash alone. The new decision belongs to the receiving application's authority and receives its own ID and revision. Importing another application's checkpoint does not transfer its authority. The publisher accepts only `address` scope because that is what the current applications enforce. The codec distinguishes `item` and `content` keys for future integrations, but this publisher rejects those scopes rather than publishing decisions the current applications would ignore.

Back up the matching public snapshot and manifest before an update. `apply` verifies the current pair, validates the complete batch, rejects duplicate targets, increments the sequence, and writes the new snapshot before the manifest. Each write uses an atomic rename. A failure between writes leaves a checkpoint mismatch, so readers cannot treat the incomplete update as proof that a target is allowed. Restore the matching previous pair from the backup before retrying. A temporary `.removals-publisher.lock` prevents concurrent updates. If a crashed process leaves it behind, confirm that no publisher is running before removing it.

The output is source metadata. **The owner must sign and publish through the application or node before deployment.** Signing must regenerate the manifest's file hashes, bundles where applicable, and signatures. This script never updates those fields or fabricates a signature. Source changes and ordinary pull requests can contain stale signatures until the authorized owner signs the release. Verify the signed release through a fresh node before distribution.

Clients require the complete verified snapshot to establish absence. Missing, corrupt, or expired data yields `verification_unavailable`; known removals remain blocked. Reinstate with a newer authorized decision. A reversal for one target or policy does not override another applicable removal. Applications must preserve their accepted sequence/root across reloads and retain known removals during outages.

The application caches the complete accepted hashed snapshot together with its sequence and root in origin-local application storage. Reloads restore those decisions before checking the currently signed checkpoint, including known removals whose previous checkpoint expired. Clearing local application data loses that device's rollback and decision-history floor; a fresh installation knows only the currently authenticated snapshot.

The saved floor uses the application's existing whole-object local storage. A stale preference save from another tab can overwrite newer persisted state, so it is not a cross-tab or cross-device transparency guarantee. The active client still retains its in-memory floor. Publish registry updates with the owner tool, which preserves prior targets and requires explicit reinstatement independently of the client cache.

The public registry is not a raw-address directory, but hashing is not secrecy. Someone with a candidate address can compute its key and test for a match. Old signed listings, peer copies, cached pages, browser history, and prior exports may still contain addresses. The feature does not erase those copies, prevent modified clients from accessing content directly, or impose a network-wide ban.
