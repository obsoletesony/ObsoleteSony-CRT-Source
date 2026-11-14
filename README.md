# ObsoleteSony CRT

Source for the ObsoleteSony CRT browser converter, based on [ntsc-rs-web](https://github.com/ntsc-rs/ntsc-rs-web). Licensed under GPL-3.0-or-later; third-party components retain their own licenses.

Build requirements: Node.js 24, Rust nightly-2026-09-05 with `rust-src`, `wasm-bindgen-cli 0.2.129`, `wasm-opt 126`, and `cargo-about 0.8.4`.

```sh
git submodule update --init --recursive
npm ci
(cd ntsc-rs-web-wrapper && bash ./build.sh)
npm run check:crt
npm run test:crt
npm run build:crt
```

Output: `package/crt-1.0.0/`. The converter's Astro integration is in `integration/astro/`; install the built runtime with `node scripts/install-site.mjs /path/to/site`.
