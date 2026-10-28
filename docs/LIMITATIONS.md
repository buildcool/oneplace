# Limitations

From the plan (docs/PLAN.md §9), kept up to date as we learn.

## What only a server or money can buy
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
- **DRM content:** Netflix, Prime Video, JioHotstar, ZEE5, SonyLIV premium, Disney+, Apple TV+, aha; Spotify/Apple Music/Amazon Music/Gaana/Wynk audio. OnePlace recognises these links and explains instead of trying.
- **Private IG/FB accounts** you don't follow.
- **Quality above the source:** YouTube audio is about 128–160 kbps (256 kbps with Premium cookies). "MP3 320" is only a conversion, and the label says so.
- **Silent install of the very first update.** The user confirms that one. Later self-updates on Android 12+ may be silent.

**Risks we manage:**
- **Instagram without login on Android** → since yt-dlp 2026.07.04, logged-out Instagram needs browser impersonation (curl_cffi), which has no Android build. yt-dlp then reads the reel's web page, which works for most reels but not all; the rest need an in-app login. Online downloader sites don't have this problem because they run on servers.
- **Sites change often** → engine auto-update (Nightly), self-heal retry, remote announcements.
- **YouTube bot checks** → QuickJS inside the APK solves the JS challenges. Cookies and a PO-token helper are advanced options.
- **Instagram rate-limits logged-out users** → polite delays, login option, spare-account warning.
- **Google often blocks sign-in inside app WebViews** → YouTube cookies via cookies.txt import.
- **APK size** is about 50–70 MB per ABI (Python + ffmpeg + QuickJS).
- **Android background limits** → UIDT jobs on Android 14+, plus the OEM battery helper.
- **Legal:** downloading breaks some sites' terms. We show a disclaimer, support no DRM, and use no YouTube/Instagram logos or branding.

**Learned while building (2026-10-23):**
- **Instagram without login:** only reels and video posts work (yt-dlp). Photo posts, carousels, stories and highlights need an in-app login (gallery-dl is redirected to the login page, and Instagram's public embed page no longer exposes images).
- **YouTube reads take a few seconds** (measured 2026-10-28 in Termux on the user's phone): ~6 s once YouTube's current player version has been seen, ~14 s the first time for each new player version (QuickJS has to solve YouTube's JavaScript challenge; yt-dlp's preprocessed-player cache, switched on by OnePlace, makes repeats fast). Python starts from an unpacked, precompiled yt-dlp (~2 s faster than the zip), the download reuses the sheet's read (first bytes ~1.5 s after tapping Download) and "Start now" lets you tap Download while the link is still being read. A faster JavaScript engine than QuickJS is the remaining big win.
- **Reddit** sometimes blocks anonymous requests from mobile networks; logging in helps.
- **Wi-Fi-only on Android 13 and older:** queued downloads wait until OnePlace is opened again on Wi-Fi (Android 14+ resumes them by itself).
