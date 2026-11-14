# Rebuilding the ObsoleteSony CRT runtime

This source tree mirrors the tested private engine implementation at `e27ac1f5098f0de4dd3823a12256f2fb609fbd58`, with internal audit materials intentionally excluded. The browser runtime is built from the source in `src/crt`, the pinned Rust wrapper and its Git submodules.

## Dependencies

The local verification used Windows, Node **24.14.0**, npm **11.9.0**, Rust **nightly-2026-09-05** with `rust-src`, `wasm-bindgen-cli 0.2.129`, Binaryen **126** (`wasm-opt`), `cargo-about 0.8.4`, and Git Bash. Docker was not used.

Submodules resolve publicly through `.gitmodules`. The `valadaptive-lib` checkout and `aac-codec/FFmpeg` revision must match the recorded pins. The AAC WASM codec is checked in to `aac-codec/avcodec.wasm`; the FFmpeg submodule and patches/documentation are also retained for source/licensing completeness.

## Clean checkout and build

```sh
git clone --recurse-submodules https://github.com/obsoletesony/ObsoleteSony-CRT-Source.git
cd ObsoleteSony-CRT-Source

npm ci
cd ntsc-rs-web-wrapper
bash ./build.sh
cd ..

npm run check:crt
npm run test:crt
npm run build:crt
```

`build.sh` creates both standard and relaxed WASM variants and regenerates descriptors from the pinned Rust engine. **Do not treat the pre-existing `generated/setting-descriptors.ts` as executable defaults**; the build-generated descriptor is authoritative. The exact default profile is in `presets/v1/upstream-default.json` and the corresponding provenance file.

`npm run build:crt` produces `package/crt-1.0.0` with its JavaScript entry, worker, normal/relaxed WASM, AAC codec, presets, source maps, license notices and SHA-256 artifact manifest. The tested package consists of 26 artifacts. Use the `manifest.json` included in this repository as the reference for the engineering snapshot, recognizing that different toolchain or source revisions may produce different hashes.

The pinned upstream Docker export stage is known to omit the relaxed WASM; the **native `build.sh` path** is the tested route.

## Testing and installation

```sh
node --test tests/contracts.mjs
node scripts/install-site.mjs /path/to/a/compatible-astro-checkout
```

The installer verifies the generated artifact manifest before copying files under `public/vendor/crt/1.0.0/`. It expects the target Astro checkout to contain `src/pages/watch.astro`. The converter's relevant source files are included under `integration/astro/`; the rest of the ObsoleteSony Archive is a separately developed site and is not mirrored here.

The reference implementation was locally tested in Chrome and Edge on Windows with real video decode, preview, audio and 640×480 H.264/AAC export. **This public source snapshot has not yet been independently rebuilt in this repository**; that verification is a release step. No GitHub Actions workflows are included, since the account's Actions allocation is exhausted.

See [`docs/RELEASE-GATE.md`](RELEASE-GATE.md) before distributing a converter bundle.
