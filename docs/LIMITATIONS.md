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
- **Reading a link takes a few seconds** (measured 2026-10-28 in Termux on the user's phone): ~2–4 s for most sites (YouTube with yt-dlp's no-JavaScript client, Instagram, Facebook, Pinterest, SoundCloud, Dailymotion). The site's own servers (~1.5–2.5 s) are the floor; the engine is started ahead of time (saves ~0.5–1 s) and keeps connections open (requests). Downloads that come in pieces fetch 4 at a time except on YouTube (Dailymotion 82 s → 14 s, SoundCloud 24 s → 10 s). Reddit now needs a login and Vimeo blocks non-browser connections in yt-dlp.
- **Downloading the moment you copy a link** is not possible: since Android 10 no app can read the clipboard in the background (only the keyboard and the app in front can). The known workaround (Tasker/Join) needs a PC and ADB. OnePlace starts a freshly copied link as soon as it is opened, from the "Download copied link" Quick Settings tile, or from the 1-tap share targets.
- **Reddit** sometimes blocks anonymous requests from mobile networks; logging in helps.
- **Wi-Fi-only on Android 13 and older:** queued downloads wait until OnePlace is opened again on Wi-Fi (Android 14+ resumes them by itself).

**Player, Library and vocal remover (2026-10-29):**
- **A picture while downloading** comes from the file itself once ~0.5 MB has arrived. That works for most formats (fragmented MP4, WebM, HLS). An MP4 that stores its index at the end gets its picture only when it is finished.
- **The small floating window** (picture-in-picture) needs Android 8+. It can be switched off for OnePlace in the phone's settings; the player then says so.
- **Vocal remover:**
  - **How:** it uses Deezer's Spleeter (2 stems) on the phone: the voice model's 38 MB plus ONNX Runtime's 32 MB engine (about 52 MB to download), fetched on first use.
  - **Quality:** good for karaoke, not studio-clean. A faint voice or a "watery" sound can remain in some songs.
  - **Speed:** about 1 minute for a 4-minute song on a mid-range phone.
  - **Not used:** larger models (UVR MDX-Net) separate better but are ~9× slower, so they are too slow for phones.
- **Files deleted in Gallery** or a file manager are noticed when the Library opens, and shown as "Deleted from phone".
- **In-app browser:**
  - Google doesn't allow signing in inside apps' web views, so YouTube in the browser is signed out unless you logged in through More → Site logins.
  - A file a page builds by itself (a `blob:` download) can't be saved from the browser.
  - Uploading files from the browser (a site's "choose file" button) isn't supported yet.
  - Ad blocking works on the requests pages make; ads drawn by a site's own code (some of YouTube's) are hidden with site rules as well as possible.
  - Streams locked with DRM are shown as protected and never downloaded.
  - Private tabs need a recent Android System WebView; on older ones the option is hidden.
- **YouTube and YT Music in OnePlace's player:**
  - A video starts after OnePlace has read it (about 2–5 s on mobile data); the next song of a queue is read while the current one plays.
  - Age-restricted and members-only videos need a YouTube login (More → Site logins); without it they say so.
  - Shorts play in the page itself; YouTube's ads there are blocked as well as possible, not guaranteed.
  - If YouTube changes something, yt-dlp updates itself; until then a video may not play (Download still tries).
