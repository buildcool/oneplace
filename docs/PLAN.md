# OnePlace: plan for an app that downloads from any site

## 1. Context
You want **one app** that downloads **video, audio, photos and thumbnails** from YouTube (videos, Shorts, YT Music), Instagram (reels, posts, carousels, stories, reel audio), Facebook and every other popular site, in **every quality and format** (MP4, MKV, WebM, MP3, M4A, Opus, JPG, PNG…). It should also have:
- **Share from any app** straight into OnePlace
- **Auto-update** whenever you publish a release
- Lots of features with great UI/UX
- **Zero running cost** (no server)

You code only on your phone (Termux) and ship APKs through GitHub Actions → GitHub Releases, the same way as SastaKahan.

This plan gives you:
- a feature list based on research into other apps
- the architecture
- a phased roadmap
- an honest list of what only a server or money can buy
- **one master prompt for Claude** (§10)

**Decisions you confirmed:**
- **Stack:** Capacitor + React UI with a Kotlin download engine.
- **Name:** **OnePlace**, package ID `io.github.buildcool.oneplace`.
- **After approval:** I build it here, starting with P0 and then P1.

## 2. The key decision: an Android app, not a website
- **A website can't download by itself.** Browsers block cross-site requests (CORS), and YouTube and Instagram block server IPs. Every "web downloader" (SaveFrom, cobalt…) runs paid servers and pays for the video bandwidth, so it isn't zero-cost.
- **An Android app can do everything on the phone.** **youtubedl-android** packs yt-dlp (1,000+ sites), Python, ffmpeg, aria2c and **QuickJS** inside the APK. Seal and YTDLnis use the same library. QuickJS solves YouTube's new JavaScript challenges, which yt-dlp needs since Nov 2025. The library passes `--js-runtimes quickjs:<path>` automatically. Your phone's home or mobile IP also gets blocked less often than a server's IP.
- **gallery-dl** runs on the same bundled Python and handles what yt-dlp can't:
  - Instagram photo posts, carousels, stories, highlights and HD profile pictures
  - Pinterest boards, X photos, Reddit galleries, Tumblr, Imgur, Bluesky, VSCO…
- **The engines update themselves** from GitHub and PyPI. Sites keep working without a new app release.
- **A free website on GitHub Pages is still useful** for the landing page, APK download, a YouTube thumbnail grabber and an "Open in app" button.
- **Consequences:**
  - The app must be **GPL-3.0** (youtubedl-android's license) in a **public repo**.
  - Google Play bans YouTube downloaders, so we ship through **GitHub Releases + Obtainium/IzzyOnDroid**.

## 3. Research: what other apps do and what we take
| App (type) | Good ideas we copy | Their weak spot = our chance |
|---|---|---|
| **YTDLnis** (open source, yt-dlp, v1.9.1 Oct 2026) | Queue + scheduling, several downloads at once, cut by time/chapters, SponsorBlock, embed subs/chapters/metadata, split by chapter, command templates + terminal, share-menu & .txt import, "observe sources" auto-download, cookie login, incognito, backup/restore, synced lyrics (LRCLIB), burn-in subtitles, crop, random delays against YouTube throttling | Built for power users (many screens), no photo/carousel downloads, English-first |
| **Seal** (open source, yt-dlp) | Material You look, quick download from the share sheet with format and playlist choice (v2 alpha), aria2c speed-up, cover + tags in audio, custom commands, resume failed downloads | v2 still alpha, video/audio only |
| **NewPipe** (open source) | In-app search, background & popup player, subscriptions without an account | Few sites |
| **Snaptube / VidMate / InsTube** (closed, ad-funded, not on Play) | Built-in site browser, quality chips that show file size, MP3 convert, private folder, built-in player | Heavy ads, trackers, trust issues |
| **1DM** (closed, typical features) | Browser that detects media on any page, multi-part speed-up, pause/resume, scheduler, speed limit, clipboard watch | Ads, cluttered |
| **cobalt.tools** (web, AGPL) | Paste-and-go simplicity, no ads | Needs servers; YouTube often blocked on public instance |
| **Instagram savers** (FastSave-type) | Stories/highlights, all carousel photos, HD profile pic, copy caption/hashtags, repost | Instagram-only, ad-heavy |
| **WhatsApp status savers** | Save friends' statuses | Single-purpose |

**Our edge:** one clean, ad-free app that does all of the above, including photos.
- English / Hinglish / हिंदी
- Share → download in 2 taps
- Honest quality labels
- Self-healing engines

## 4. Feature list (everything possible at zero cost)
★ = must-have. P1…P5 = phase (§8).

**A. Getting links in**
- ★P1 Share from any app opens the download sheet.
- ★P1 **1-tap share targets**: "OnePlace · Video", "OnePlace · MP3" and "OnePlace · Thumbnail" appear in the share menu. They download with your default preset without opening the app, and you can hide them.
- ★P1 Paste box that finds links inside messy text, and handles several links at once.
- ★P1 "Download copied link?" chip when you open the app.
- P1 "Download" option in the text-selection menu.
- P1 Short-link resolver (fb.watch, pin.it, vm.tiktok, t.co, bit.ly, instagram /share/). It also strips tracking params (si, igsh, utm_*).
- P2 Quick Settings tile "Download copied link", app-icon shortcuts, QR-code scan, import a .txt of links.
- P3 In-app browser and search (section J).
- P4 `oneplace://` deep link + website "Open in app" button.

**B. Sites (the app picks the engine itself)**
- ★P1 **yt-dlp** covers 1,000+ sites, including generic pages with embedded video:
  - YouTube: videos, Shorts, live, clips, playlists, channels
  - YouTube Music: songs, albums, playlists
  - Instagram: reels, video posts, stories (login)
  - Facebook: videos, reels, watch
  - X, TikTok, Reddit, Pinterest, Vimeo, Dailymotion, Twitch, Kick
  - SoundCloud, Bandcamp, Mixcloud, Audiomack, **JioSaavn**, Hungama
  - Bilibili, Bluesky, Tumblr, LinkedIn, Snapchat Spotlight, Likee, Rumble, 9GAG, Imgur, Streamable
  - Google Drive, Dropbox, Archive.org
- ★P1 **gallery-dl** covers photos:
  - Instagram: photos, carousels, stories, highlights, profile pics
  - Pinterest, X photos, Reddit galleries, Tumblr, Imgur, Bluesky, VSCO, Flickr, DeviantArt, ArtStation, Pixiv, Weibo
- P1 In-app "Supported sites" page with a status for each site: works / needs login / best effort.
- P3 Sites neither engine supports get the browser media sniffer plus small custom adapters, best effort: **Threads, ShareChat, Moj, Josh, Terabox**.
- ✗ Never: DRM services (see §9).

**C. Video**
- ★P1 Every quality the site offers: 144p up to 4K/8K, 60 fps, HDR. Each chip shows the estimated size.
- ★P1 Two modes:
  - "Most compatible": MP4 with H.264/AAC
  - "Best quality": VP9/AV1 in MKV/WebM
- ★P1 Presets: Best, 1080p, 720p, 480p "data saver", "WhatsApp-friendly".
- P2 Subtitles:
  - choose languages, including auto-generated and auto-translated (e.g. Hindi)
  - SRT or VTT files
  - embedded or burned in
- P2 Chapters: embed them, or split the video into one file per chapter.
- P2 SponsorBlock: remove or mark sponsor/intro/self-promo segments.
- P2 Trim: download only a from–to part.
- P2 Live: record from the start, or wait for a premiere.
- P2 Playlists, channels and profiles:
  - item picker: all, range, search, newest N
  - numbered folders
  - "skip already downloaded"

**D. Audio & music**
- ★P1 Audio formats:
  - "Original" (M4A/Opus, no re-encode, best and fastest)
  - MP3 320/256/192/128, M4A, Opus
  - FLAC/WAV, labelled "converted, not higher quality"
- ★P1 Tags + cover art embedded. YT Music covers are auto-cropped square, and titles are cleaned up to "Artist – Title".
- ★P1 Instagram/Facebook **reel song**: extract the reel's audio to MP3/M4A.
- P2 Synced lyrics from LRCLIB (free API): embedded, plus an .lrc file.
- P2 Album/playlist goes to an album folder with track numbers.
- P4 Spotify/Apple Music link → find the same song on YT Music (experimental). JioSaavn links download directly.

**E. Photos & thumbnails**
- ★P1 **Thumbnail for anything**:
  - YouTube/Shorts: every size, from maxres 1280×720 down to default
  - YT Music: square cover
  - other sites: the largest available
  - preview it, save as JPG/PNG/WebP, copy its link, share it
- ★P1 Instagram: every carousel item at full size, the reel cover, and the HD profile picture.
- P2 Thumbnails for a whole playlist/channel, plus an "always save thumbnail" option.
- P2 Copy caption, hashtags or description.

**F. Download manager**
- ★P1 Queue:
  - live speed, ETA and size
  - cancel and retry, with automatic retry and backoff
  - **keeps running after the app is closed**
  - notification with actions
- ★P1 **Self-healing**: when an extractor fails, the app updates the engine and retries once on its own.
- P1 1–3 downloads at once, Wi-Fi-only option, free-space check before starting.
- P1 Battery-optimization helper for Xiaomi/Oppo/Vivo/Realme.
- P2 Queue control:
  - pause/resume, reorder, schedule (e.g. at night), speed limit
  - aria2c multi-connection
  - ban-safe delays, duplicate warning
  - batch of hundreds of links
- P2 Download archive, so the same video isn't downloaded twice.

**G. Library & player**
- ★P1 Downloads list with thumbnails: open, share, delete. Files go to `Movies/`, `Music/` and `Pictures/OnePlace`, so they show up in Gallery and music apps.
- P2 A folder per type (SD card too) and filename templates: `{title} {uploader} {date} {res}`…
- P3 Library 2.0:
  - grid/list, filters, search, sort
  - multi-select: share, move, rename, delete, convert
  - storage usage
  - "re-download in another quality", "open source link"
- P3 Built-in player: background audio, picture-in-picture, speed, loop, sleep timer, music queue.

**H. Accounts, privacy, safety**
- P1 No ads, no tracking, no account. About lists every network call the app makes.
- P1 Disclaimer: download only what you have rights to. No DRM.
- P2 **Site login inside the app** (Instagram, Facebook, X, TikTok, Reddit, Pinterest, Threads, Twitch…):
  - turns the login into cookies for private, age-restricted and story downloads
  - cookies.txt import (needed for YouTube)
  - clear per site
  - warning to use a spare account
- P2 Incognito mode (no history or logs).
- P4 App lock + private vault (fingerprint, hidden from gallery).

**I. Updates**
- ★P1 **App auto-update** from GitHub Releases:
  - checks daily and when you open the app
  - shows "What's new"
  - picks the right APK for the phone (arm64/armv7/x86_64)
  - one-tap install
  - Stable/Beta channel, "skip this version"
  - Android 12+ may install later updates silently once OnePlace has updated itself once (to verify)
- ★P1 **Engine auto-update**:
  - yt-dlp (Stable/Nightly; Nightly gets fixes fastest) and gallery-dl
  - daily on Wi-Fi, plus an "Update now" button
- P1 **Remote config** (jsDelivr, free) for announcements ("YouTube changed: update engine"), per-site fix flags and feature kill-switches. It can only use allow-listed options.

**J. Discover**
- P3 In-app search: YouTube, YT Music, SoundCloud → one-tap download.
- P3 In-app browser that detects video/audio/images on any page (including m3u8), with ad-block and favourite-site bookmarks.
- P3 **Subscriptions**: follow channels, playlists and IG profiles. The app checks every few hours, then notifies or auto-downloads using rules (Wi-Fi + charging, audio only, max length, keywords).

**K. Tools (on-device ffmpeg)**
- P3 WhatsApp / WA Business **status saver**.
- P3 Backup/restore settings, history, templates and subscriptions to a file.
- P4 Editing tools:
  - convert a local video to MP3/M4A
  - compress (to a target size or for WhatsApp), trim, GIF maker
  - split a long video into 60-second WhatsApp-status parts
  - ringtone cutter

**L. Power users**
- P2 Custom yt-dlp/gallery-dl options and command templates.
- P2 Terminal, per-site defaults, output-template editor with live preview.
- P2 Your own proxy/VPN, log viewer, "Report a problem" → pre-filled GitHub issue.
- P5 Desktop app (Windows/Mac/Linux) with the same UI.

## 5. UI/UX
- **Navigation:** a bottom bar with Home · Downloads · Library · More. Actions sit at thumb height, and bottom sheets replace new pages.
```
Home                                   Download sheet (after share/paste)
┌──────────────────────────────┐       ┌──────────────────────────────┐
│ OnePlace                  ⚙  │       │ [thumbnail]            3:45  │
│ ┌──────────────────────────┐ │       │ Song title (2 lines)         │
│ │ 🔗 Paste link or search  │ │       │ YouTube · Channel            │
│ └──────────────────────────┘ │       │ [Video] [Audio] [Photo/Thumb]│
│ 📋 Copied: instagram.com/…  ⤓│       │ ● 1080p60 · 96 MB            │
│ YouTube Insta FB X Music 🌐  │       │ ○ 720p · 48 MB  ○ 4K · 410 MB│
│ ▶ 2 downloading ▓▓▓░ 45%     │       │ ▸ More: MP4/MKV, trim, subs  │
│ Recent: ▢ ▢ ▢ ▢              │       │ ☑ Remember my choice         │
└──────────────────────────────┘       │ [      Download · 96 MB     ]│
 Home  Downloads  Library  More        └──────────────────────────────┘
```
- **Two taps** from share to download. The default preset is preselected, and the sheet shows exactly what you will get: size, format, quality.
- **Look:**
  - Material 3 style: dark / light / AMOLED black, Material You colours on Android 12+ (system accent → CSS variables)
  - rounded cards, 150–250 ms motion, haptics, skeleton loaders
  - edge-to-edge, predictive back
- **Languages:** English / Hinglish / हिंदी, reusing SastaKahan's 3-language strings table. More Indian languages in P4.
- **Every error has a fix button**:
  - "Instagram needs login → Log in"
  - "YouTube changed → Update engine"
  - "Not enough space → Change folder"
  - "Report problem"
- **Onboarding** (3 screens): how to share, where files go, allow notifications + the battery helper. The first start shows "Preparing engine…" while Python unpacks.
- **Accessibility:** TalkBack labels, 48 dp targets, font scaling. Tablet/foldable two-pane in P4.

## 6. Architecture
| Layer | Choice | Why |
|---|---|---|
| UI + pure logic | Capacitor 8 + React 19 + Vite 8 + TypeScript 5.9 + vitest | Same as SastaKahan; you can read and edit TS. `npm run dev` previews the UI in phone Chrome with a mock engine. |
| Native (Kotlin) | youtubedl-android 0.18.1+ (`library`, `ffmpeg`, `aria2c`) + gallery-dl on the same Python. Room DB. User-initiated data transfer job (Android 14+) / dataSync foreground service (≤13). Notifications, MediaStore/SAF, PackageInstaller. | Downloads must survive the UI being closed. UIDT avoids Android 15's 6 h/day dataSync limit. |
| Build/release | GitHub Actions → signed ABI-split APKs (arm64-v8a, armeabi-v7a, x86_64 + universal) → GitHub Releases | Free; reuses the SastaKahan workflow |
| Hotfix config | `config/remote.json` via jsDelivr + purge workflow | Free fixes without a release |

```
Share / Paste / Tile / 1-tap alias
  → core/links.ts   find URL, resolve short link, strip tracking, detect site + kind
  → Engine.getInfo  yt-dlp -J (--flat-playlist) | gallery-dl --dump-json   (cached)
  → Download sheet  core/formats.ts → quality chips + sizes   (1-tap aliases skip this)
  → core/args.ts    DownloadSpec → argv  → Engine.enqueue(job)
NATIVE: Room jobs → Runner (UIDT/FGS) → yt-dlp/gallery-dl process in cache/<job>/
  → progress: notification + JS event → Saver → MediaStore/SAF → "Done" notification (Open/Share)
  → failure: core/errors.ts → friendly fix; extractor error ⇒ update engine, retry once
DAILY (WorkManager): engine updates · app update check · remote config · subscriptions (P3)
```
- **Presets compiled to argv templates:** TS builds the templates and stores them in native code, so 1-tap share downloads work even when the WebView has never opened. The defaults ship as an APK asset generated at build time.
- **Allow-list:** remote config and template options pass through one. `--exec`, `--config-locations` and similar are never allowed.
- **Cookies:** `files/cookies/<site>.txt` (Netscape format), exported from the WebView CookieManager after in-app login. They stay out of backups and logs.
- **Ban-safe defaults:** YouTube gets concurrent fragments = 1 plus a random 2–5 s delay between playlist items (lesson from YTDLnis). Instagram gets polite request sleeps.
- **No Google Play Services**, which keeps IzzyOnDroid/F-Droid possible. QR scanning uses ZXing.
- **Developer release flow:**
  - every push to `main` → CI → **Beta** pre-release
  - "Promote" workflow or a `v*` tag → **Stable** release
  - versionCode = CI run number, as in SastaKahan

**Reuse from `~/work/sasta-kahan`:**
- `.github/workflows/android.yml`: build/sign/release. Add ABI splits, Kotlin, multi-asset releases and beta/stable channels.
- `android/app/build.gradle`: signing from secrets and versionCode from `VERSION_CODE`.
- `src/update.ts`: GitHub Releases check. Add ABI asset choice and channels.
- `android/app/src/main/java/app/sastakahan/ShareInPlugin.java` + `src/native.ts`: share-in and the `registerPlugin` pattern.
- `LoginActivity.java` + `ToolsPlugin.java` (`openLogin`/`clearCookies`): base for site login and cookie export.
- `src/strings.ts` + `src/i18n.ts`: English/Hinglish/हिंदी table.
- `.github/workflows/config.yml`: jsDelivr purge.
- `package.json`: Termux-safe scripts (`node node_modules/...`) and the `typescript@5` pin.

## 7. Repo layout (new public repo `buildcool/oneplace` → `~/work/oneplace`; the name is free)
```
src/core/     links.ts sites.ts formats.ts args.ts presets.ts thumbs.ts template.ts errors.ts update.ts remoteConfig.ts
src/engine/   types.ts (Engine interface) android.ts (Capacitor) mock.ts (browser dev)
src/ui/       Home DownloadSheet Downloads Library Settings Accounts Onboarding (+ Browser Search Subscriptions Tools later)
src/          strings.ts i18n.ts styles.css (design tokens) App.tsx main.tsx
android/app/src/main/java/io/github/buildcool/oneplace/
              EnginePlugin.kt engine/ queue/ storage/ share/ login/ update/   (browser/ player/ tile/ later)
scripts/      live.ts (real yt-dlp/gallery-dl in Termux with our argv) · gen-presets.ts (→ android assets/presets.json)
tests/        vitest suites + live-urls.json (sample URLs per site)
config/       remote.json
docs/         PLAN.md PROMPT.md SITES.md LIMITATIONS.md SPIKE.md
.github/workflows/  android.yml (test → build → beta/stable release) · config.yml (jsDelivr purge)
```

## 8. Roadmap (each phase ends with a GitHub release tested on your phone)
- **P0: setup + engine spike**
  - Create the public GPL-3.0 repo and scaffold it from the SastaKahan pieces.
  - Make a new signing key (`~/.oneplace/release.p12` via openssl) and add it as repo secrets.
  - Set up CI to build ABI-split APKs.
  - Add a debug screen: paste URL → info → download best. Also run gallery-dl on an IG photo post.
  - **Exit:** these download on your phone: YouTube video, Short, YT Music song, IG reel, IG photo carousel, FB reel, X video. `docs/SPIKE.md` records APK size, first-start time and info time.
  - If gallery-dl won't run on the bundled Python, IG photos fall back to a small TS adapter (cookies + native HTTP).
- **P1: MVP v1.0 "share → download":** every item tagged P1 in §4.
- **P2: power downloads (v1.1–1.3):** every P2 item.
- **P3: discover & library (v1.4–1.6):** every P3 item.
- **P4: tools & polish (v1.7+):** every P4 item, plus:
  - GitHub Pages website: landing, APK download, in-browser YouTube thumbnail grabber, "Open in app"
  - IzzyOnDroid + Obtainium listing
- **P5: desktop (optional):**
  - Electron app reusing `src/` UI with a Node engine adapter (yt-dlp + ffmpeg + deno binaries)
  - CI builds for Win/Mac/Linux, auto-update from GitHub Releases
  - phone ↔ PC link handoff via QR / same Wi-Fi

**Right after you approve:** create the repo, save this plan as `docs/PLAN.md` and the prompt as `docs/PROMPT.md`, then do P0 and P1.

## 9. Limitations: what only a server or money can buy
**Needs a server or hosting (OnePlace uses the free workaround):**
| Feature | Why it needs a server | Free workaround |
|---|---|---|
| Website that downloads (paste link in any browser) | Browser CORS + sites block server IPs; you pay for servers + video bandwidth | Android app; website only for landing/APK/thumbnails/"Open in app" |
| iPhone app | Needs a web backend, or a paid Apple account (and Apple rejects downloaders) | none |
| Sync history/settings/subscriptions across devices | Backend + database | Backup/restore file |
| 24×7 channel watching with instant auto-download | Always-on machine | Phone checks every few hours (Android may delay) |
| Instant push (new version, announcements) | Push sender (FCM + server + Play Services) | Check on open + daily |
| Telegram/WhatsApp bot "send link, get file" | Bot runs on a server | Share sheet |
| Browser extension that sends links to your phone from anywhere | Relay server | QR / same Wi-Fi (P5) |
| Crash dashboards & usage analytics | Server or third-party SDK | Local logs + "Report a problem" |
| Beat geo-blocks / IP bans for all users | Paid proxy pool | Your own VPN/proxy setting |
| Cloud conversion of big files on slow phones | Server CPU | On-device ffmpeg (slower) |
| Trending feed / "popular downloads" | Server-side data | Per-site search |
| Instagram stories/private without the user logging in | Account pool on a server (bans, against ToS) | User logs in inside the app |
| Share a download as a link | File hosting + bandwidth | Share the file itself |

**Costs money, but isn't a server:**
- **Google Play:** $25, but YouTube downloaders get rejected or removed. We use GitHub Releases, Obtainium and IzzyOnDroid (free).
- **Android developer verification** (global rollout expected 2027, per news reports):
  - Without registration, users can still install through a one-time "advanced flow" with a 1-day wait.
  - Registering as a verified developer ($25 one-time + govt ID) removes that friction.
  - The free tier covers only 20 devices.
- **iOS:** $99/yr Apple developer account.
- **Desktop:** Windows/Mac code-signing certificates. Without them, users see "unknown publisher" warnings.
- **Custom domain** (optional): the GitHub Pages subdomain is free.

**Not possible even with a server:**
- **DRM content:** Netflix, Prime Video, JioHotstar premium, Zee5, SonyLIV premium, Spotify/Apple Music/Gaana/Wynk audio.
- **Private IG/FB accounts** you don't follow.
- **Quality above the source:** YouTube audio is about 128–160 kbps (256 kbps with Premium cookies). "MP3 320" is only a conversion, and the label says so.
- **Silent install of the very first update.** The user confirms that one. Later self-updates on Android 12+ may be silent.

**Risks we manage:**
- **Sites change often** → engine auto-update (Nightly), self-heal retry, remote announcements.
- **YouTube bot checks** → QuickJS inside the APK solves the JS challenges. Cookies and a PO-token helper are advanced options.
- **Instagram rate-limits logged-out users** → polite delays, login option, spare-account warning.
- **Google often blocks sign-in inside app WebViews** → YouTube cookies via cookies.txt import.
- **APK size** is about 50–70 MB per ABI (Python + ffmpeg + QuickJS).
- **Android background limits** → UIDT jobs on Android 14+, plus the OEM battery helper.
- **Legal:** downloading breaks some sites' terms. We show a disclaimer, support no DRM, and use no YouTube/Instagram logos or branding.

## 10. Master prompt for Claude (paste into a new Claude Code session in Termux)
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

## 11. Verification
- **Termux, every change:**
  - `npm test` (vitest: links, formats, args, thumbs, templates, errors, update) and `npm run typecheck`.
  - `npm run live -- <url> [preset]` runs real yt-dlp/gallery-dl with **our** argv, using `--js-runtimes quickjs:$(command -v qjs)` (QuickJS-ng 0.17 is already installed) and ffmpeg. It prints the chosen format, size and filename.
  - One-time setup needs your OK: `pip install -U "yt-dlp[default]" gallery-dl` and `pkg install ffmpeg`.
- **UI:** `npm run dev`, then open it in phone Chrome with the mock engine.
- **CI:**
  - tests, typecheck, Gradle ABI-split build, Kotlin unit tests (cookie export, job state machine) and lint, then the release
  - no site tests in CI, because GitHub IPs get blocked by YouTube
- **Phone checklist, every release:**
  - YouTube → 1080p MP4 + MP3; Short; YT Music → MP3 with square cover
  - IG reel, IG carousel, IG story (logged in); FB reel; X video
  - thumbnail in every size; 1-tap "· MP3" share alias
  - swipe the app away mid-download → download continues
  - cancel/retry; airplane-mode error message; engine update
  - **app update**: install the older release → publish a new one → update prompt → install → history kept

## 12. Sources
- yt-dlp JavaScript runtime requirement: https://github.com/yt-dlp/yt-dlp/issues/14404 · https://github.com/yt-dlp/yt-dlp/wiki/EJS
- yt-dlp PO Token Guide: https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide
- yt-dlp supported sites: https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md
- gallery-dl supported sites: https://github.com/mikf/gallery-dl/blob/master/docs/supportedsites.md
- youtubedl-android (0.18.1 adds QuickJS, auto `--js-runtimes`): https://github.com/yausername/youtubedl-android · https://github.com/yausername/youtubedl-android/releases
- YTDLnis: https://github.com/deniscerri/ytdlnis/releases · https://f-droid.org/en/packages/com.deniscerri.ytdl
- Seal: https://github.com/JunkFood02/Seal · https://github.com/JunkFood02/Seal/releases
- Snaptube/VidMate: https://uniindia.com/vidmate-vs-snaptube-which-is-the-best-video-downloader-for-android/press-releases/news/3864104.html · https://tribunadejundiai.com.br/post/os-8-melhores-baixadores-de-video-leves-para-androids-em-2026/
- cobalt: https://perplexityaimagazine.com/blog/cobalt-tool/
- Android 15 foreground-service timeout: https://developer.android.com/develop/background-work/services/fg-service-timeout
- User-initiated data transfer jobs: https://developer.android.com/develop/background-work/background-tasks/uidt
- Play Store and downloaders: https://www.androidheadlines.com/2026/05/beyond-the-app-store-why-the-best-media-downloaders-arent-on-google-play.html
- Android developer verification: https://android-developers.googleblog.com/2026/03/android-developer-verification.html · https://median.co/blog/android-developer-verification-2026
