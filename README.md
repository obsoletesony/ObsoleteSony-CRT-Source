# ObsoleteSony CRT — Source Code

Corresponding source snapshot for **ObsoleteSony CRT**, a browser-based VHS video converter based on [ntsc-rs-web](https://github.com/ntsc-rs/ntsc-rs-web). ObsoleteSony's converter applies a fixed 4:3 center crop, VHS/NTSC effects, and deterministic stable/worn/tracking wear, with local H.264/AAC export.

**Status: pre-release source snapshot, not a public converter launch.** The tested converter remains on private feature branches. This repository is being prepared as an openly accessible source distribution for the converter and its browser integration, before any release of the new compiled JS/WASM on [obsoletesony.com/watch](https://www.obsoletesony.com/watch/).

## What is included

- **`src/crt/`**: the headless browser converter, including modified upstream workers, decoder, audio and exporter.
- **`ntsc-rs-web-wrapper/`**, **`aac-codec/`** and Git submodules: pinned Rust/WASM toolchain, codec source/configuration and patch history.
- **`presets/v1/`**: exact Rust-generated default settings, alternate tape profiles and profile registry.
- **`scripts/`**, **`vite.crt.config.ts`**, dependency locks: generation, validation and packaging scripts.
- **`integration/astro/`**: exact converter-specific UI integration and file-crop sources from the site's implementation branch, without unrelated archive pages or infrastructure.
- **`package/crt-1.0.0/manifest.json`**: the manifest from the locally verified reference build (26 artifacts, SHA-256 checksums); production binaries are not published here yet.

This tree also retains the original upstream editor source as a reference; the headless converter's generated package does **not** bundle that editor or its PWA.

## Provenance

| Component | Pinned revision |
| --- | --- |
| [ntsc-rs-web](https://github.com/ntsc-rs/ntsc-rs-web) | `5d15ee0e48685a306109698356ccb847a54dc02c` |
| [ntsc-rs](https://github.com/ntsc-rs/ntsc-rs) | `8cfc51014092a6dc1da5eb0217bb9ae6516b124e` |
| [valadaptive-lib](https://github.com/valadaptive/valadaptive-lib) | `8e6a36a0bc116d54a53703e2914d545a34dc3921` |
| [FFmpeg](https://github.com/FFmpeg/FFmpeg) | `bf1b838f2ab88b4f8fd83443325c782ea0e0f7fa` |
| ObsoleteSony engine source | `e27ac1f5098f0de4dd3823a12256f2fb609fbd58` (private PR #7) |
| ObsoleteSony Astro integration | `537631b6a68bd29e5cda8301288af96a3c241f1f` (private PR #111) |

## Building

See [`docs/REBUILD.md`](docs/REBUILD.md) for pinned tools and the tested build process, and [`integration/astro/README.md`](integration/astro/README.md) for the site integration boundary. The public repository's source mirror must be independently rebuilt/verified against the referenced manifest before deployment.

## License

The browser application derives from **ntsc-rs-web, GPL-3.0-or-later**. See [`LICENSE`](LICENSE). The underlying `ntsc-rs` Rust library, WASM wrapper, FFmpeg/AAC codec, fonts and other dependencies retain their own licenses. Refer to [`docs/LICENSING.md`](docs/LICENSING.md), submodule license files and the generated package notice inventories.

Publishing this source does not itself clear unrelated photograph, branding or trademark questions. The Sony television composite image used on the existing website was made by the project owner in Photoshop using imagery from a vintage Sony manual; it is **not included** here. See [`docs/RELEASE-GATE.md`](docs/RELEASE-GATE.md).
