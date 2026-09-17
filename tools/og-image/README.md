# OGP image source

`og-image.html` renders the 1200×630 Open Graph card for `assets/images/og-image.png`.
It is a self-contained page (OS system fonts only, no network requests) with an inline
SVG "waterfall" schematic of time-resolved XRD generated deterministically by inline JS
(no randomness, no external assets).

## Regenerate

Update the HTML (e.g. yearly, or when the name/tagline changes), then run:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=1 --window-size=1200,630 --virtual-time-budget=3000 \
  --screenshot=/tmp/og-image.png "file://$(pwd)/tools/og-image/og-image.html"

sips -g pixelWidth -g pixelHeight /tmp/og-image.png   # confirm 1200x630
cp /tmp/og-image.png assets/images/og-image.png
```

Visually check the PNG afterwards (Japanese text rendering, no overlap/overflow).
