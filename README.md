# OnePlace

Download **videos, music, photos and thumbnails** from YouTube, YouTube Music, Instagram, Facebook, X, TikTok, Reddit, Pinterest, SoundCloud, JioSaavn and 1,000+ other sites, in every quality the site offers.

- **Share → download in 2 taps** from any app, or use the 1-tap share targets **OnePlace · Video / · MP3 / · Thumbnail**.
- **Everything runs on your phone**: [yt-dlp](https://github.com/yt-dlp/yt-dlp), [gallery-dl](https://github.com/mikf/gallery-dl), FFmpeg and QuickJS inside the APK (via [youtubedl-android](https://github.com/yausername/youtubedl-android)). No servers, no ads, no tracking, no account.
- **Self-updating**: the engines update themselves when sites change; the app updates itself from GitHub Releases.
- English, Hinglish and हिंदी.

## Install

Download the APK from [Releases](https://github.com/buildcool/oneplace/releases/latest):

| Your phone | File |
|---|---|
| Most phones (2017+) | `OnePlace-arm64-v8a.apk` |
| Older / budget phones | `OnePlace-armeabi-v7a.apk` |
| Not sure | `OnePlace-universal.apk` (bigger) |

Not on the Play Store: Google does not allow YouTube downloaders there.

## What works

See [docs/SITES.md](docs/SITES.md). Honest limits (DRM, logins, what would need a server) are in [docs/LIMITATIONS.md](docs/LIMITATIONS.md).

## Develop (on the phone, in Termux)

```sh
npm install
npm test                 # unit tests (links, formats, engine arguments, errors, updates)
npm run dev              # UI preview in the phone's browser (http://127.0.0.1:5173)
npm run live -- <url>    # what the real engines see for a link (needs: pip install "yt-dlp[default]" gallery-dl; pkg install ffmpeg)
npm run live -- <url> audio --mp3 192
```

There is no Android SDK on the phone: every push to `main` is built and signed by GitHub Actions (`.github/workflows/android.yml`) and published as a release. Quick fixes for sites go into `config/remote.json` (served by jsDelivr, no rebuild).

- Plan and roadmap: [docs/PLAN.md](docs/PLAN.md)
- Prompt to continue with Claude: [docs/PROMPT.md](docs/PROMPT.md)

## Legal

Download only what you have the right to. Respect creators and each site's terms. OnePlace never supports DRM-protected content.

Licence: GPL-3.0-or-later (youtubedl-android is GPL-3.0). yt-dlp is Unlicense, gallery-dl GPL-2.0, FFmpeg LGPL/GPL, Python PSF, QuickJS MIT.
