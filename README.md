# Shotaro Danjo — personal academic website

Static source for a GitHub Pages-ready academic website. It is deliberately dependency-free: opening `index.html` in a browser is enough to preview it. The site is organised as individual Japanese-language pages rather than a single scrolling page.

## Current status

Published at [shotaro-d.github.io](https://shotaro-d.github.io/) via GitHub Pages, deployed from the `main` branch root of this repository. The site is indexable (no `noindex`), has a `sitemap.xml` / `robots.txt`, and carries per-page canonical/Open Graph tags plus a Person JSON-LD block on `index.html` so `index.html` is treated as the primary entry point for name searches.

## Preview locally

Open `index.html` in a browser, or run:

```sh
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Updating the live site

Commit and push to `main` — GitHub Pages redeploys automatically. When adding pages, also add an entry to `sitemap.xml`.

## Updating content

Each page is a standalone HTML file. Publications, presentations, awards, and useful X-ray tools can each be edited without touching the layout code.
