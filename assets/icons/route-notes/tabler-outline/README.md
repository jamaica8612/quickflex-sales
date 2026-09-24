# Tabler Outline map marker sources

These are unmodified SVG originals from the official [Tabler Icons outline directory](https://github.com/tabler/tabler-icons/tree/main/icons/outline). Tabler Icons is licensed under MIT; the full notice is in [LICENSE.txt](LICENSE.txt).

`build-map.mjs` extracts only each source SVG's `<path d>` geometry into `src/lib/route-note-icons.js`. The browser uses the bundled paths, so map markers make no icon CDN or asset request at runtime. The application applies its own blue/coral color and 1.35 stroke width; source artwork stays unchanged.

The `building-warehouse` artwork is shared by `market_map` and `storage`. All other marker types select one source file. To verify the selection and geometry, run `node --test tests/route-note-map.test.mjs` from the repository root.
