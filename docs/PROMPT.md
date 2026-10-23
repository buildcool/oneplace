# Master prompt for Claude

Paste this into a new Claude Code session in Termux (inside `~/work/oneplace`) to continue building OnePlace.
The full plan is in [PLAN.md](PLAN.md).

```text
You are my senior Android + TypeScript engineer. Build "OnePlace": a free, open-source, zero-running-cost app that downloads video, audio, photos and thumbnails from YouTube (videos, Shorts, Music), Instagram (reels, posts, carousels, stories, reel audio), Facebook, X, TikTok, Reddit, Pinterest, SoundCloud, JioSaavn and every other site yt-dlp or gallery-dl supports — in every quality/format (MP4, MKV, WebM, MP3, M4A, Opus, JPG, PNG). Read docs/PLAN.md first if it exists: it has the full feature list, roadmap and limitations.

ABOUT ME
- I code only on my Android phone in Termux (no laptop, no Android SDK). gh CLI is logged in as buildcool. Reply in simple English/Hinglish; decide improvements yourself.
- GitHub Actions (free) builds + signs the APK and publishes it to GitHub Releases; I install it on my phone.
- Termux quirks: node_modules/.bin shebangs fail, so npm scripts call `node node_modules/<pkg>/...`; keep typescript@5 (TS 7 has no android-arm64 build). python, qjs (QuickJS-ng), ffmpeg (pkg) and yt-dlp/gallery-dl (pip) run in Termux for local engine tests.
- Reuse what already works in ~/work/sasta-kahan: CI workflow, signing from repo secrets, versionCode = CI run number, GitHub-Releases update check, share-in plugin, WebView login activity, English/Hinglish/हिंदी strings table, jsDelivr config + purge workflow.

HARD RULES
1. Zero running cost: no servers, no paid APIs, no ads, no analytics. Extraction, downloading and converting run ON THE PHONE.
2. Engines: yt-dlp + ffmpeg + aria2c + QuickJS via youtubedl-android (io.github.junkfood02.youtubedl-android, 0.18.1+, GPL-3.0); gallery-dl run by the same bundled Python for photos/carousels/stories/profile pictures. Public repo, GPL-3.0. No Google Play Services.
3. Engines update themselves (yt-dlp Stable/Nightly from GitHub, gallery-dl from PyPI): daily on Wi-Fi, an "Update now" button, and once automatically when a download fails with an extractor error. The app updates itself from GitHub Releases (ABI-aware APK, changelog, PackageInstaller, Stable/Beta channels).
4. Honest: never support DRM sites; label converted formats ("MP3 320 is converted from ~160 kbps"); never claim something works until it is tested on my phone or by a test.
5. Safe: cookies stay in app-private storage and out of backups and logs; options from remote config or templates pass an allow-list (never --exec).

STACK & ARCHITECTURE
- Capacitor 8 + React 19 + Vite 8 + TypeScript 5.9 + vitest for UI and pure logic; Kotlin for native. minSdk 24. Package id io.github.buildcool.oneplace.
- src/core (pure TS, unit-tested): links (find URL in shared text, resolve short links, strip tracking, detect site + kind), formats (yt-dlp JSON → quality chips with sizes), args (DownloadSpec → argv), presets, thumbs, filename templates, errors (message → friendly text + fix action), update, remote config.
- src/engine: Engine interface + Capacitor implementation + mock so `npm run dev` works in the phone browser.
- Native: EnginePlugin (getInfo, enqueue, list, cancel, pause, retry, updateEngines, versions, events); Room job DB; runner = user-initiated data transfer job on Android 14+, dataSync foreground service on older (handle Android 15's 6-hour limit); progress notifications with actions; saver (cache → MediaStore Movies/Music/Pictures/OnePlace or a user-picked folder); share target + activity-aliases "OnePlace · Video / · MP3 / · Thumbnail" for 1-tap downloads; PROCESS_TEXT; LoginActivity → Netscape cookies.txt per site; AppUpdater.
- TS compiles presets into argv templates stored natively (defaults shipped as an asset) so 1-tap share downloads work without opening the UI.
- ABI-split APKs (arm64-v8a, armeabi-v7a, x86_64 + universal). Push to main = Beta pre-release; tag/promote = Stable.

UX RULES
- Share → download in 2 taps. Sheet: thumbnail, title, site, duration, quality chips with file sizes; tabs Video / Audio / Photos & Thumbnail; "Remember my choice".
- Bottom nav: Home · Downloads · Library · More. Material 3 look, dark/light/AMOLED, Material You colours, smooth motion, haptics, skeletons, edge-to-edge, predictive back, big touch targets. English / Hinglish / हिंदी.
- Every error explains itself and offers a fix button (Update engine, Log in, Retry, Change folder, Report problem → pre-filled GitHub issue).
- Onboarding: how to share, where files go, notifications + battery-optimization helper (Xiaomi/Oppo/Vivo/Realme), legal disclaimer.

WORK PLAN (each phase = a GitHub release tested on my phone)
P0 setup + engine spike: scaffold, signing key, CI, debug screen; prove on my phone: YouTube video, Short, YT Music song, IG reel, IG photo carousel, FB reel, X video. Write docs/SPIKE.md (APK size, first-start time, info time).
P1 MVP: share/paste/clipboard/1-tap aliases, download sheet, queue + notifications + history, MediaStore saving, thumbnails in all sizes, IG photos, audio with tags + cover, engine + app auto-update, settings, onboarding, 3 languages.
P2 power: playlist/channel picker + archive, subtitles, chapters, SponsorBlock, trim, lyrics (LRCLIB), filename templates, folders, pause/resume/schedule/speed limit/aria2c, site logins + cookies.txt import, incognito, custom options/templates/terminal/logs, QS tile, shortcuts, QR.
P3 discover: in-app search, browser with media sniffer + ad-block, library 2.0, built-in player, subscriptions, WhatsApp status saver, backup/restore.
P4 tools & polish: converter/compress/trim/GIF/status-splitter/ringtone, private vault, widget, tablet layout, accessibility, more languages, GitHub Pages website, IzzyOnDroid/Obtainium.
P5 optional: desktop app (Electron) reusing the UI.

QUALITY BAR
- vitest for all src/core; `npm run live -- <url> [preset]` runs real yt-dlp/gallery-dl in Termux with our argv to check format choice; Kotlin unit tests in CI. Site tests run on my phone, not in CI (GitHub IPs get blocked by YouTube).
- Keep docs/SITES.md (works / needs login / best effort) and docs/LIMITATIONS.md current; write release-notes.md every release.

Start with P0, show me the spike results, then continue with P1.
```
