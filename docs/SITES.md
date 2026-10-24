# Supported sites

Status from tests in Termux with the same engine arguments the app uses (`npm run live -- <url>`), 2026-10-23.
"Works" means the link was read and/or downloaded without a login from a phone connection.

| Site | Status | Notes |
|---|---|---|
| YouTube (videos, Shorts) | ✅ Works | 144p–4K, H.264/VP9; MP3 with square cover + tags verified. First read ~13 s (YouTube JS challenge), faster later. |
| YouTube Music | ✅ Works | Same engine as YouTube; tags from YT Music metadata |
| Instagram reels / video posts | ✅ Works | yt-dlp, no login (720p) |
| Instagram photos, carousels, stories, highlights | 🔑 Login | gallery-dl gets "redirect to login page" without a login → More → Site logins → Instagram |
| Facebook reels / videos | ✅ Works | Public videos without login |
| X (Twitter) | ✅ Works | Multi-video posts come as a list |
| Reddit | ⚠️ Varies | Reddit sometimes blocks anonymous requests ("blocked by network security"); login helps |
| JioSaavn songs | ✅ Works | 320 kbps (tested 2026-10-24) |
| TikTok, Pinterest, Vimeo, Dailymotion, Twitch, SoundCloud, Bandcamp … | ✅ Expected | yt-dlp/gallery-dl extractors exist; not yet re-tested here |
| Threads, ShareChat, Moj, Terabox | 🧪 Best effort | Not in either engine yet; planned: in-app browser media detection (P3) |
| MX Player, Amazon miniTV | ⚠️ Broken now | yt-dlp has extractors, but both failed on 2026-10-24 ("Unable to extract", "Failed to parse JSON"); may work again after an engine update |
| SonyLIV (free videos, trailers) | 🧪 Untested | yt-dlp has an extractor; premium is DRM; may need a login OnePlace doesn't have yet |
| Netflix, Prime Video, JioHotstar, ZEE5, Disney+, Apple TV+, aha, Spotify, Apple Music, Amazon Music, Gaana, Wynk | ❌ Never | DRM-protected. Tested 2026-10-24: Netflix times out, Prime Video/ZEE5 → yt-dlp "known to use DRM", JioHotstar → "only for registered users" (and DRM). The app now says "can't be downloaded" as soon as such a link is shared. |

Please report results from your phone with **More → Engine test → Copy results**.
