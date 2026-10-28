package io.github.buildcool.oneplace.engine

import android.content.Context
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Makes yt-dlp start faster.
 *
 * yt-dlp comes as a zip of 1,000+ .py files that Python compiles again on every run (~2 s on a phone).
 * Unpacked into a folder, Python keeps the compiled files. Our own __main__.py also switches on
 * yt-dlp's cache of YouTube's preprocessed player: QuickJS then solves YouTube's JS challenge in ~1 s
 * instead of ~8 s once a player version has been seen. yt-dlp leaves that cache off because each
 * player is ~4 MB and old ones are never deleted, so the old ones are deleted here. It also checks
 * yt-dlp's guessed cover images at once instead of one by one (up to ~5 s saved per MP3).
 */
object FastStart {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val mutex = Mutex()

    private const val READY = ".ready"
    private const val SOLVER_CACHE = "challenge-solver"
    private const val KEEP_PLAYERS = 4
    private const val MAX_PLAYER_AGE = 14L * 24 * 3600_000

    private const val UNZIP = "import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])"

    private val MAIN = """
        # Written by OnePlace. Starts yt-dlp like its zip does, with two speed-ups:
        # - YouTube links: yt-dlp's cache of the preprocessed player is switched on (OnePlace deletes old players).
        # - Cover images: yt-dlp tries its guessed "best" thumbnails one by one, and for older YouTube videos
        #   and many music tracks most of them do not exist (~1 s each on a phone). Check them all at once.
        import sys

        if any('youtu' in a for a in sys.argv[1:]):
            try:
                from yt_dlp.extractor.youtube.jsc._builtin.ejs import EJSBaseJCP
                EJSBaseJCP._ENABLE_PREPROCESSED_PLAYER_CACHE = True
            except Exception:
                pass

        import yt_dlp


        def _check_thumbnails_at_once():
            from concurrent.futures import ThreadPoolExecutor
            from yt_dlp.networking import HEADRequest
            from yt_dlp.networking.exceptions import HTTPError

            write = yt_dlp.YoutubeDL._write_thumbnails

            def missing(ydl, t):
                try:
                    ydl.urlopen(HEADRequest(t['url'], headers=t.get('http_headers') or {})).close()
                except HTTPError as e:
                    return e.status == 404
                except Exception:
                    pass
                return False

            def patched(self, label, info_dict, *args, **kwargs):
                thumbs = info_dict.get('thumbnails') or []
                if self.params.get('writethumbnail') and not self.params.get('write_all_thumbnails'):
                    # Sorted worst to best; the guessed ones come without a size.
                    guessed = [t for t in thumbs[-8:] if not t.get('width')]
                    if len(guessed) > 1:
                        pool = ThreadPoolExecutor(len(guessed))
                        checks = [pool.submit(missing, self, t) for t in guessed]
                        gone = []
                        # Best first; stop at the first one that exists.
                        for t, check in reversed(list(zip(guessed, checks))):
                            if not check.result():
                                break
                            gone.append(t)
                        pool.shutdown(wait=False)
                        if gone and len(gone) < len(thumbs):
                            info_dict['thumbnails'] = [t for t in thumbs if not any(t is g for g in gone)]
                return write(self, label, info_dict, *args, **kwargs)

            yt_dlp.YoutubeDL._write_thumbnails = patched


        try:
            _check_thumbnails_at_once()
        except Exception:
            pass

        if __name__ == '__main__':
            yt_dlp.main()
    """.trimIndent() + "\n"

    private fun base(ctx: Context) = File(ctx.noBackupFilesDir, "ytdlp-fast")

    /** Changes whenever youtubedl-android replaces the yt-dlp zip (first start, updates). */
    private fun stamp(zip: File) = "${zip.length()}-${zip.lastModified()}"

    /** The unpacked yt-dlp that matches the current zip, or null until it is ready (callers then use the zip). */
    fun current(ctx: Context): File? {
        val zip = Runner.Paths(ctx).ytdlp
        if (!zip.isFile) return null
        return File(base(ctx), stamp(zip)).takeIf { File(it, READY).isFile }
    }

    /** Unpack in the background: after start-up and after each yt-dlp update. */
    fun refreshSoon(ctx: Context) {
        val app = ctx.applicationContext
        scope.launch { runCatching { refresh(app) } }
    }

    private suspend fun refresh(ctx: Context): Unit = mutex.withLock {
        val players = File(Engines.cacheDir(ctx), SOLVER_CACHE)
        prunePlayers(players)
        val zip = Runner.Paths(ctx).ytdlp
        if (!zip.isFile || current(ctx) != null) return@withLock
        val dir = File(base(ctx), stamp(zip))
        dir.deleteRecursively()
        val r = Runner.script(ctx, "faststart", UNZIP, listOf(zip.absolutePath, dir.absolutePath))
        if (r.code != 0 || !File(dir, "yt_dlp").isDirectory) {
            dir.deleteRecursively()
            return@withLock
        }
        File(dir, "__main__.py").writeText(MAIN)
        // Players preprocessed by an older solver may not suit a new one.
        val solver = File(dir, "yt_dlp/extractor/youtube/jsc/_builtin/vendor/_info.py").takeIf { it.isFile }?.readText() ?: ""
        val solverMark = File(base(ctx), "solver.txt")
        if (!solverMark.isFile || solverMark.readText() != solver) {
            players.deleteRecursively()
            solverMark.writeText(solver)
        }
        File(dir, READY).writeText(zip.length().toString())
        // Older copies go too, unless a download may still be importing from one.
        if (!Runner.busy()) base(ctx).listFiles()?.filter { it.isDirectory && it != dir }?.forEach { it.deleteRecursively() }
    }

    /** Keep the newest few players: YouTube moves to new player versions every few days. */
    internal fun prunePlayers(dir: File, now: Long = System.currentTimeMillis()) {
        val files = dir.listFiles()?.filter { it.isFile }?.sortedByDescending { it.lastModified() } ?: return
        files.forEachIndexed { i, f -> if (i >= KEEP_PLAYERS || now - f.lastModified() > MAX_PLAYER_AGE) f.delete() }
    }
}
