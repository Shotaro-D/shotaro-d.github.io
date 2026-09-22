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

## Testing the photon energy calculator

The calculator has dependency-free regression tests for the live JavaScript behavior and an independent high-precision reference calculation, run against both the Japanese and the English page:

```sh
node tests/light-energy-calculation.test.mjs
python3 tests/test_light_energy_reference.py
```

## Site consistency checks

Checks the skip link, Open Graph tags, that dates on the Japanese and English home and awards pages agree, and also header order (menu button before the navigation), navigation labels, news-to-post anchors, and presentation numbering:

```sh
node tests/site-consistency.test.mjs
```

## Updating content

Each page is a standalone HTML file. Publications, presentations, awards, and useful X-ray tools can each be edited without touching the layout code. See [`tools/og-image/README.md`](tools/og-image/README.md) for how to regenerate the OGP share image.

### Consistency checklist

- Update the Japanese page and its `en/` counterpart in the same commit.
- Give every `<time>` in the news list and the awards list a machine-readable `datetime` (`YYYY-MM` or `YYYY-MM-DD`), and keep the same value on both language versions.
- Conference awards are dated by the month the conference was held (not the month the result was announced), so the home page news and `award.html` show the same month.
- Grants are listed by selection date on the home page and by funding period on the profile page.
