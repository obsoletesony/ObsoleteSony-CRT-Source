# Current source boundary — 2026-11-13

The full `ntsc-rs-web` tree at `5d15ee0e48685a306109698356ccb847a54dc02c` is imported, except its root README is retained as `docs/UPSTREAM_NTSC_RS_WEB_README.md` and its deployment workflow is excluded. Existing project instructions and the disabled-by-scope import workflow remain. The original editor under `src/` is retained as a reference; it is not included in the headless package.

`src/crt/upstream/` contains clearly marked GPL adaptations of the upstream media player, renderer, worker pool, RPC, decoder, WASM loader, PNG encoder and AAC encoder. Changes are limited to the headless integration:

- Crop in oriented display coordinates before Rust effects; rotate and resize to square-pixel 640×480. Non-square inputs normalize pixels after cropping. The crop helper is copied verbatim from the approved website and tested against it.
- Select immutable validated profiles at processing time using the same presentation-order packet index, timestamp and content seed in preview/export. Four workers maximum; no eager global worker pool. Acknowledged settings changes surface native parser failures.
- Preserve upstream AudioContext clock and scheduling, audio packet passthrough / AAC fallback, encoder and muxer. Close AudioContexts, frames, bitmaps, inputs, workers and temporary files, including failure, replacement and cancellation paths.
- Replace the export producer/consumer queue with a bounded ordered pipeline. Propagate exceptions, drain outstanding frames and emit an explicit finalizing state.
- Coalesce seeks while returning a promise for the settled frame. Suppress stale render results after destruction. Report playback/decode failures to the existing OSD.
- Keep the original editor imports and PWA separate. The headless Vite configuration has no HTML, editor CSS, fonts or service-worker plugin.

The native wrapper and Rust effect algorithms are unchanged. Cargo.lock still pins `ntsc-rs` to `8cfc51014092a6dc1da5eb0217bb9ae6516b124e`. Native `build.sh` regenerated descriptors and both WASM variants in a fresh target directory. The audited Docker export recipe remains unused because it omits the relaxed WASM artifact.

## Approved executable baseline

`src/app-state.ts` actually imports the **build** descriptors. Regeneration removes `video_scanline_phase_shift` (old default 2) and `video_scanline_phase_shift_offset` (old default 0), and changes `vhs_chroma_vert_blend` from true to false. Chroma-demodulation enum choices also expand, without changing its default. The golden profile contains 60 effect keys plus native `version:1`; its provenance file records its SHA-256. No default was manually retuned. Worn/tracking data are separate, explicitly authorized variations; the stable profile remains exact.

The default frame PNG matches the audited pinned editor byte for byte. A fresh export from the official live web app also matches the audited original editor's decoded RGB video hash. See the implementation report for evidence and browser versions.

## Known boundaries

Canonical frame identity is derived from indexed presentation timestamps, not average frame rate or processing order. Index storage grows with frame count, not image pixels. A 10-minute 30fps file needs 18,000 timestamp entries. The fingerprint hashes bounded samples from the beginning, middle and end plus file size; it is for repeatable scheduling, not cryptographic file identity. Identical fingerprints can intentionally share a schedule.

AAC passthrough retains every nonnegative packet, timestamp and duration. Like upstream, it drops negative priming packets: an initial decoder transient may affect the first few milliseconds, without ongoing drift. The 10-minute flash/beep test measured matching middle/end PCM and video timing. Files unsupported by browser decoders receive an error; universal format/browser support is not claimed.
