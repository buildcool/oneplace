# P0 spike: does the engine work on a phone?

## In Termux (same engine arguments as the app), 2026-10-23

| Test | Result |
|---|---|
| YouTube video info (`dQw4w9WgXcQ`) | ✅ 13.0 s first read; 8 qualities 144p–4K with sizes; audio source ≈130 kbps |
| YouTube 720p pick (`-S res:720,…,vcodec:h264,acodec:m4a`) | ✅ chose `136+140` (H.264 + AAC, MP4) |
| YouTube → MP3 128 with cover | ✅ 3.4 MB MP3, 128 kbps, **720×720 square cover**, title/artist/date tags |
| Instagram reel | ✅ 4.1 s, 720p + 472p (no login) |
| Instagram post (video carousel) | ✅ yt-dlp lists 3 items (no login) |
| Instagram photos (gallery-dl) | 🔑 needs login ("redirect to login page") |
| Facebook reel | ✅ 5.5 s, 480p/360p |
| X post with 2 videos | ✅ 4.7 s, listed as 2 items |
| gallery-dl bundle on a bare Python (`python -S`) | ✅ requests/urllib3/certifi load from the bundle (1.36 MB zip) |
| gallery-dl using yt-dlp from the official zipapp on `PYTHONPATH` | ✅ (zipapp also carries the YouTube EJS solver) |

## On the phone (fill in after installing the first APK)

Open **More → Engine test**, paste each link, run, then **Copy results** and paste them here.

| Test | Result |
|---|---|
| APK size (arm64-v8a) | |
| First start ("Preparing engine…") | |
| YouTube video info | |
| YouTube Short | |
| YouTube Music song | |
| Instagram reel | |
| Instagram photo carousel (after login) | |
| Facebook reel | |
| X video | |
