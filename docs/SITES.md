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
| TikTok, Pinterest, Vimeo, Dailymotion, Twitch, SoundCloud, JioSaavn, Bandcamp … | ✅ Expected | yt-dlp/gallery-dl extractors exist; not yet re-tested here |
| Threads, ShareChat, Moj, Terabox | 🧪 Best effort | Not in either engine yet; planned: in-app browser media detection (P3) |
| Netflix, Prime Video, JioHotstar premium, Spotify, Apple Music | ❌ Never | DRM-protected |

Please report results from your phone with **More → Engine test → Copy results**.
