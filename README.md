# Epix Sites

Search and discover xites on [EpixNet](https://epixnet.io). A decentralized directory and search engine with community ratings, reports, and weighted trust.

## Features

- Free-text search over titles, descriptions, tags, addresses, and categories
- Browse by category and language (Yahoo-style directory under a search box)
- Content ratings: every listing declares General / Mature / Adult, and the community votes on the real label
- Listing states: Unverified, Verified, Mislabeled, Reported, Delisted, driven by weighted community votes and reports
- Reports with narrow reason codes (malware, abuse or exploitation of a person, scam, dead, spam) plus vouches as counter-reports; only the first three can warn or delist
- Reasons describe harm, never legal status: what is unlawful in one country is lawful in another, so a global vote never turns on a statute. Locally unlawful content is a node operator's own filtering concern
- Safe mode (on by default) hides adult-rated listings
- Flagged audit tab: warned listings retain their evidence; removed entries show only a removal key, bounded reason, and decision source
- Every card names its submitter ("Submitted by name.epix"): listings are public, signed records tied to a paid xId
- Stars weighted by identity: only chain-registered name.epix identities carry vote weight
- Editor moderation via signed tombstones (the EpixTalk signers pattern), no site-key pasting
- Sync progress bar on first load
- Responsive masonry layout, light and dark themes, Epix design system

## Trust model (phase 1)

All states are a deterministic pure function of the replicated data (js/utils/Trust.js): every client computes identical results. Editors listed in content.json settings carry bootstrap weight; name.epix directories carry member weight; raw-address directories carry zero weight and zero standing. Constants live in content.json settings.trust and are tuned by re-signing, not redeploying. The witness snapshot (tenure ramp, graded accuracy, penalties) is phase 2.

## Structure

```
epix1searchd8hcnyfacvklmszzxwx9ptnf5rde04xf/
├── index.html
├── content.json           # settings.categories/editors/trust, feeds descriptor
├── dbschema.json          # EpixSites DB (v2): site, site_star, site_rating, site_report, site_stat, json
├── LICENSE                # MIT
├── css/
│   ├── base.css           # design tokens (light+dark), typography, layout
│   ├── Head.css Site.css Form.css Menu.css Animation.css
│   └── all.css            # bundled stylesheet (concatenation of the above)
├── js/
│   ├── EpixSites.js       # Main app (extends EpixFrame): routes, sync state
│   ├── Head.js            # Logo, search box, safe toggle, tabs, sync bar
│   ├── Site.js            # Site card: chips, rating votes, reports, evidence
│   ├── SiteAdd.js         # Submit form with required content rating
│   ├── SiteList.js        # Category section
│   ├── SiteLists.js       # Data pipeline: 4 queries -> trust pass -> views
│   ├── User.js            # xId cert, signed-CRDT records, votes/reports/vouches
│   ├── lib/               # Maquette, EpixFrame, anime
│   └── utils/             # Trust (the deterministic pass), Form, Text, Time, Menu, ...
├── languages/             # es, fa, zh, zh-tw
└── data-default/
    └── users/
        └── content-default.json
```

## Data

Per-user signed-CRDT merge files (epix-orset-1) under `data/users/<dir>/`:

- `sites.json` - listings (now with required `rating` and optional `subcat`/`tags`)
- `stars.json` - star toggles
- `ratings.json` - one classification vote per (user, listing), keyed, re-vote supersedes
- `reports.json` - one report and one vouch per (user, listing), keyed

Records carry `target_dir` + `target_site_id` explicitly, so community judgments survive a submitter tombstoning their listing.

## Tech Stack

- Vanilla ES6 JavaScript (no build step)
- Maquette virtual DOM
- EpixFrame WebSocket bridge
- anime.js for animations
- All JS wrapped in IIFEs

## License

MIT

## Removal policy

The directory uses the shared signed removal snapshot configured in its signed
manifest. Submissions, address changes, ownership claims, opening a listing,
and incoming catalogue rows pass through the same policy check. A missing,
invalid, stale, or incomplete snapshot pauses additions and hides unverified
listing projections until verification succeeds. The Retry verification button
reloads the snapshot.

Active registry removals remain in the Flagged view even when the original
listing is absent. Community-delisted listings use the same address-free card,
with their decision source stated separately. Community delisting is recomputed
from current reports; the app does not automatically publish those decisions
into the owner registry. If the last listing for an address disappears, its
community removal cannot be reconstructed from listing-keyed reports alone.
Blocking future re-additions durably requires an entry in the signed owner
registry. Registry reinstatement does not erase an independent community
delisting while its report threshold is still met. The card contains only a
hashed removal key, a bounded reason, and status. Ordinary reports, Adult/Mature labels,
personal filtering, and owner withdrawal do not become removal decisions.

The app checks addresses rather than listing IDs, so another listing ID does not
bypass a known removal. Names are accepted only after the node has a verified
canonical resolution; otherwise use a canonical Xite address. An accepted name
is saved as its canonical address.

The legacy SQL feed descriptor is disabled: it could emit raw addresses and
metadata without the browser's verified policy check. Do not restore an
address-bearing feed until its producer applies the same policy. Deployment
also needs an owner-signed manifest with the shared scripts and policy snapshot;
a source merge alone does not publish the Xite.

These checks govern participating clients. They do not erase already replicated
signed records, exports, cached addresses, or older versions, and they do not
prevent another client from using the underlying node directly. Public hashed
keys can be matched against already-known candidate addresses.

Run the application regressions with `node --test tests/*.test.cjs`.
See [registry operation and deployment](docs/removals.md) for publishing removals
and reinstatements without adding target addresses to the public registry.
