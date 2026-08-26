# Epix Sites

Search and discover xites on [EpixNet](https://epixnet.io). A decentralized directory and search engine with community ratings, reports, and weighted trust.

## Features

- Free-text search over titles, descriptions, tags, addresses, and categories
- Browse by category and language (Yahoo-style directory under a search box)
- Content ratings: every listing declares General / Mature / Adult, and the community votes on the real label
- Listing states: Unverified, Verified, Mislabeled, Reported, Delisted, driven by weighted community votes and reports
- Reports with narrow reason codes (malware, illegal, scam, dead, spam) plus vouches as counter-reports; only malware/illegal/scam can warn or delist
- Safe mode (on by default) hides adult-rated listings
- Flagged audit tab: nothing is silently removed, every warned or delisted listing stays inspectable with its evidence
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
