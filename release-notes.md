## What's new

- **Downloads start much sooner.** On a YouTube link (measured on a Lava phone with Jio 4G):
  - Reading the link: **~6 s** instead of ~13–15 s (the first time YouTube switches to a new player version it still takes ~14 s once).
  - After you tap Download, the first bytes arrive in **~1.5 s** instead of another ~13 s: the download reuses what the sheet already read.
  - **Start now:** while a link is still being read, tap **Video** or **MP3** to start straight away with your usual settings.
  - MP3s with cover art no longer wait up to ~5 s while missing cover images are tried one by one.
- Every other site starts ~2 s faster too (the engine no longer recompiles itself on each run).
- Uses about 40 MB more storage for this (the unpacked engine and YouTube's player cache).

### From v1.0.7 (if you skipped it)

- **Instagram "needs login" explained:** when Instagram won't give a reel to OnePlace without an account, the app says so and offers **Log in** (a spare account is safest).
