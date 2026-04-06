# Epix Sites

Discover more sites on [EpixNet](https://epixnet.io). A decentralized site directory.

## Features

- Browse sites by category and language
- Categories: Blogs, Services, Forums, Chat, Video/Image, Guides, News, Politics, Crypto, Games, Other
- Star/favorite system for site ranking
- Submit your own site to the directory
- Edit existing listings
- Peer count and popularity metrics
- Language filtering
- Responsive multi-column layout
- 4 language translations

## Structure

```
epix1searchd8hcnyfacvklmszzxwx9ptnf5rde04xf/
├── index.html
├── content.json
├── dbschema.json          # EpixSites DB (v2)
├── LICENSE                # MIT
├── css/
│   └── all.css            # Bundled stylesheet
├── js/
│   ├── EpixSites.js       # Main app (extends EpixFrame)
│   ├── Head.js            # Header with view modes
│   ├── Site.js            # Site card component
│   ├── SiteAdd.js         # Submit new site form
│   ├── SiteList.js        # Category list
│   ├── SiteLists.js       # Master list with filtering
│   ├── User.js            # User auth and favorites
│   ├── lib/               # Maquette, EpixFrame, anime
│   └── utils/             # Animation, Form, Text, Time, Menu, etc.
├── languages/             # es, fa, zh, zh-tw
└── data-default/
    └── users/
        └── content.json
```

## Database

- **File:** `data/users/epixsites.db`
- **Tables:** `site`, `site_stat`, `site_star`, `json`

## Tech Stack

- Vanilla ES6 JavaScript (no build step)
- Maquette virtual DOM
- EpixFrame WebSocket bridge
- anime.js for animations
- All JS wrapped in IIFEs

## License

MIT
