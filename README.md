# ObsoleteSony CRT — Corresponding Source

This is the public corresponding-source repository being prepared for **ObsoleteSony CRT**, a browser-based VHS video converter based on [ntsc-rs-web](https://github.com/ntsc-rs/ntsc-rs-web).

**Source publication is in preparation.** The tested converter currently lives on private development branches; a complete, verified release has **not yet been published here**. Do not treat this initial repository as the corresponding source for a distributed converter binary.

## Scope of the release

The finished release will contain the source for the converter actually shipped to users, including upstream code and modifications, the headless media-processing runtime, its browser integration and 4:3 crop, time-dependent tape degradation, JSON profile support, build scripts, dependency pins, source/binary provenance, and required license notices.

Unrelated, independently developed ObsoleteSony website pages, content and infrastructure are not intended to be published here. The legal boundary for combined converter code will be assessed before public deployment.

## Licenses and attribution

The browser converter derives from **ntsc-rs-web (GPL-3.0-or-later)**. The `ntsc-rs` engine and bundled components have their own respective licenses, including MIT, ISC, Apache and LGPL terms, as applicable. The source release will preserve all required notices and build instructions.

This repository is not the live site. The current website remains at [www.obsoletesony.com/watch](https://www.obsoletesony.com/watch/).

## Project state

- Private engine implementation: `obsoletesony/ObsoleteSony-CRT` (PR #7)
- Private website integration: `obsoletesony/obsoletesony-archive` (PR #111)
- Public source release: preparation and verification pending

The executable source snapshot and license inventory must match the final distributed JS/WASM artifact before launch.
