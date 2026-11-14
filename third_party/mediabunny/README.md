# Mediabunny Matroska timing correction

Original: Mediabunny 1.55.7, pinned by package-lock.json (MPL-2.0). This directory contains the modified Matroska source and license. `scripts/patch-mediabunny.mjs` applies the same changes to the installed source and browser ESM module during npm ci/build: parse CodecDelay in nanoseconds, subtract it from emitted packet timestamps, and apply the inverse offset to seek lookups. No engine revision changes.

The remaining unmodified source is in the exact npm package identified by the lockfile. https://github.com/Vanilagy/mediabunny

The patch also enables negative audio timestamps only for regular (nonfragmented) MP4 output and writes a version-1 edit list to skip preroll in presentation while preserving the encoded packets. Modified files are `muxer.ts`, `isobmff-muxer.ts`, and `isobmff-boxes.ts`. Video and other output formats retain the original timestamp constraint. The existing pinned AAC-LC encoder's one-frame initial padding is signaled by its packet timestamps in the converter adapter.
