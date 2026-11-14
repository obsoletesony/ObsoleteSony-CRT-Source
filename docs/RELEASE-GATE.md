# Public release checklist

This repository contains the source being prepared for the **ObsoleteSony CRT 1.0.0** browser converter. No public converter launch is implied by the source publication.

Before publishing the new converter JS/WASM through any publicly accessible page, including Vercel previews:

1. **Rebuild and verify:** a clean public checkout resolves submodules and produces the pinned headless runtime. Compare every applicable source hash, generated manifest, worker/WASM/codec artifact and the exact website integration version to the version that will be shipped.
2. **GPL corresponding source:** confirm this repository offers all GPL-required source and installation/build scripts for the distributed program, including any Astro integration glue that forms part of the combined converter. Keep upstream credits, modification history and all dependency notices. A qualified review of the combined-work boundary is still needed; don't assume bundling alone settles it.
3. **License details:** reconcile the FFmpeg/LGPL notices and audit the shipped dependency tree. Do not silently change upstream engine revision or default profiles when resolving advisories.
4. **TV image rights:** the owner made the cabinet/glass image in Photoshop from photographs in an old Sony manual. Identify the manual and underlying photo rights, determine permission or applicable legal basis, record necessary attribution. The composite artwork is not included here.
5. **Branding:** assess use of Sony/Trinitron marks separately from the rights to the edited artwork.
6. **Validation:** complete the native Windows save-picker verification or clearly document fallback-only support; test any advertised browsers/devices. Chrome and Edge on Windows have local engineering evidence; Safari/Firefox/mobile processing is not yet verified.
7. **Deployment:** obtain separate owner approval; remove the branch's deliberate Vercel deployment guard only after publication is ready. Preserve `[skip actions]` for GitHub commits while Actions quota is exhausted. Verify assets, source URL and a rollback path. Do not expose unrelated private archive source.

The existing public `/watch` original-video-only page is a separate prior deployment and must not be modified as a side effect of publishing this source snapshot.
