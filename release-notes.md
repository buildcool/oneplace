## What's new

- **Every site is faster now, not just YouTube** (measured on a Lava phone with Jio 4G):
  - Videos and songs that arrive in pieces download 2–6× faster: the engine keeps its connection open and fetches 4 pieces at a time (Dailymotion video 82 s → 14 s, SoundCloud song 24 s → 10 s).
  - Sites that need several requests read much faster (an X post: 15.6 s → 8.9 s).
  - The engine is started ahead of time, so every link starts ~0.5–1 s sooner (Instagram 3.2 → 2.7 s, Pinterest 3.1 → 2.1 s).
- **Made by buildcool:** the maker's name is now shown on Home, in About and at the bottom of More. About also says whether you have the **official build** (signed by buildcool) or an unofficial copy.
- Licence: still GPL-3.0 (the youtubedl-android engine requires it), now with extra terms: every copy must keep the "Made by buildcool" credit, and changed copies must use their own name and icon. See NOTICE and TRADEMARKS.md.

### From v1.0.9 (if you skipped it)

- Copied links start downloading by themselves when you open OnePlace, the "Download copied link" Quick Settings tile, and YouTube links read twice as fast.
