# ObsoleteSony CRT Astro integration source

These are the **exact converter-specific files** from private `obsoletesony/obsoletesony-archive` PR #111 at commit `537631b6a68bd29e5cda8301288af96a3c241f1f`:

| Path in this repository | Role |
| --- | --- |
| `src/pages/watch.astro` | Existing TV interface and metadata, in-screen SAVE VIDEO/CANCEL |
| `src/scripts/watch-player.ts` | Browser processing/playback/export UI coordination |
| `src/scripts/watch.ts` | Analog idle static |
| `src/lib/crt.ts` | Versioned headless package loader/type contract |
| `src/lib/watchCrop43.ts` | Exact centered 4:3 crop reference |
| `src/styles/watch.css` | Approved responsive television/screen mask and OSD styling |
| `scripts/verify-crt-package.mjs` | Verification of installed binary artifact hashes |

The sources preserve the tested TV design. They intentionally import a host-site `SiteLayout.astro`, which provides the independently developed ObsoleteSony header, announcement bar, footer, and global styles. **This integration folder is not a complete standalone Astro website.** The actual converter engine is built at this repository's root, not by this subfolder.

After generating `package/crt-1.0.0/` from source, `node scripts/install-site.mjs /path/to/compatible-astro-site` installs the compiled runtime into `public/vendor/crt/1.0.0`. Copy or apply these specific files to a compatible host site to integrate the converter. The private archive's unrelated content, layouts, branding assets and business infrastructure are not included.

**Image assets:** The live site supplies its separately authored TV cabinet and glass at `/images/watch/tv-frame.webp` and `/images/watch/tv-glass.webp`. Their actual image bytes are outside this source repository and should not be treated as libre-licensed by inclusion of this code.

**Release:** Verify this integration matches the deployed artifact; provide any additional combined source found legally necessary before offering the public converter.
