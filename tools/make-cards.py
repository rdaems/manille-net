#!/usr/bin/env python3
"""site/cards/<card>.webp: the classic card faces, from Byron Knoll's "Vector Playing Cards"
(released into the public domain; fetched from the mirror github.com/notpeter/Vector-Playing-Cards,
cards-svg/<rank><suit>.svg). <card> is the engine's number, 8 * suit + rank, with suits
S H C D and ranks 7 8 9 J Q K A 10.

The court cards are 0.7 MB each as SVG, so every card is drawn once by a browser, without
its outline, and kept as a WebP of 420 x 610 (enough for a large card on a sharp screen). Run in the test image:

    mkdir -p /tmp/knoll && cd /tmp/knoll      # the 32 SVGs, named <card>.svg (see the loop in this file's history)
    docker run --rm -v /tmp/knoll:/svg:ro -v ~/research/manille-net/site/cards:/out \\
        -v ~/research/manille-net/tools:/tools:ro house-uitest python3 /tools/make-cards.py
"""
import io
from PIL import Image
from playwright.sync_api import sync_playwright

W = 420
with sync_playwright() as pw:
    b = pw.chromium.launch()
    p = b.new_page(viewport={'width': W, 'height': 700}, device_scale_factor=1)
    for c in range(32):
        svg = open(f'/svg/{c}.svg').read().split('?>', 1)[-1]
        # the drawing starts with the card's own outline; the page draws the card (white, round
        # corners, a margin: `.card` in site/style.css), so the face comes without it
        assert svg.count('style="fill:#FFFFFF;stroke-width:0.5;"') == 1, c
        svg = svg.replace('style="fill:#FFFFFF;stroke-width:0.5;"', 'style="fill:#FFFFFF;stroke:none;"')
        p.set_content(f'<body style="margin:0;background:transparent">{svg}')
        p.evaluate(f"() => {{ const s = document.querySelector('svg'); s.style.display = 'block'; s.setAttribute('width', {W}); s.removeAttribute('height'); }}")
        png = p.locator('svg').first.screenshot(omit_background=True)
        im = Image.open(io.BytesIO(png))
        im.save(f'/out/{c}.webp', 'WEBP', quality=88, method=6)
        print(c, im.size, flush=True)
    b.close()
