package io.github.buildcool.oneplace.engine

import android.content.Context
import com.yausername.aria2c.Aria2c
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import io.github.buildcool.oneplace.Config
import io.github.buildcool.oneplace.login.Cookies
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** Engine set-up, versions, updates and the "what's in this link?" step. */
object Engines {
    @Volatile
    var ready = false
        private set

    @Volatile
    var preparing = false
        private set

    @Volatile
    var error: String? = null
        private set

    /** Called whenever ready/preparing/versions change (EnginePlugin forwards it to the UI). */
    @Volatile
    var onStatus: (() -> Unit)? = null

    private val mutex = Mutex()
    private val infoRuns = ConcurrentHashMap.newKeySet<String>()
    private val counter = AtomicInteger()

    @Volatile
    private var lastSelfHeal = 0L

    fun cacheDir(ctx: Context): String = File(ctx.filesDir, "ytdlp-cache").apply { mkdirs() }.absolutePath

    /** Unpack Python/ffmpeg/gallery-dl (first start, ~10 s) and fetch the newest yt-dlp. */
    suspend fun prepare(ctx: Context): Boolean = mutex.withLock {
        if (ready) return@withLock true
        preparing = true
        error = null
        onStatus?.invoke()
        try {
            withContext(Dispatchers.IO) {
                YoutubeDL.getInstance().init(ctx)
                FFmpeg.getInstance().init(ctx)
                runCatching { Aria2c.getInstance().init(ctx) }
                runCatching { GalleryDl.ensureInstalled(ctx) }
                ready = true
                // The yt-dlp inside the library is months old; YouTube needs the newest one.
                if (YoutubeDL.getInstance().version(ctx) == null) runCatching { updateNow(ctx) }
                FastStart.refreshSoon(ctx)
            }
        } catch (e: Throwable) {
            error = e.message ?: e.toString()
        } finally {
            preparing = false
            onStatus?.invoke()
        }
        ready
    }

    suspend fun ensureReady(ctx: Context) {
        if (!ready) prepare(ctx)
        if (!ready) throw IllegalStateException(error ?: "The download engine is not ready")
    }

    private fun updateNow(ctx: Context): Boolean {
        val channel = if (Config.ytdlpChannel(ctx) == "stable") YoutubeDL.UpdateChannel._STABLE else YoutubeDL.UpdateChannel._NIGHTLY
        val done = YoutubeDL.getInstance().updateYoutubeDL(ctx, channel) == YoutubeDL.UpdateStatus.DONE
        if (done) FastStart.refreshSoon(ctx)
        return done
    }

    /** Newest yt-dlp. Without [force] it runs at most every 10 minutes (used for self-healing). */
    suspend fun updateYtDlp(ctx: Context, force: Boolean = false): Boolean = withContext(Dispatchers.IO) {
        ensureReady(ctx)
        val now = System.currentTimeMillis()
        if (!force && now - lastSelfHeal < 10 * 60_000) return@withContext false
        lastSelfHeal = now
        updateNow(ctx).also { onStatus?.invoke() }
    }

    /** yt-dlp + gallery-dl. True when either changed. */
    suspend fun updateAll(ctx: Context): Boolean = withContext(Dispatchers.IO) {
        ensureReady(ctx)
        val a = runCatching { updateYtDlp(ctx, force = true) }.getOrDefault(false)
        val b = runCatching { GalleryDl.update(ctx) }.getOrDefault(false)
        onStatus?.invoke()
        a || b
    }

    fun ytdlpVersion(ctx: Context): String = YoutubeDL.getInstance().version(ctx) ?: "2025.11.12 (built in)"

    fun galleryVersion(ctx: Context): String? = GalleryDl.version(ctx)

    /** Remote config can ask for at least this yt-dlp version (e.g. right after YouTube changes something). */
    fun olderThan(version: String?, min: String?): Boolean {
        if (version == null || min == null) return false
        val a = version.split('.', ' ').mapNotNull { it.toIntOrNull() }
        val b = min.split('.').mapNotNull { it.toIntOrNull() }
        for (i in 0 until maxOf(a.size, b.size)) {
            val x = a.getOrElse(i) { 0 }
            val y = b.getOrElse(i) { 0 }
            if (x != y) return x < y
        }
        return false
    }

    /**
     * YouTube's visionos client needs no JavaScript challenge: reading a link takes ~3.5 s instead of ~6 s
     * (~14 s for a new player version), with the same qualities. Not with a YouTube login (that client
     * ignores cookies), not when remote config sets YouTube options, and remote config can switch it off.
     */
    fun fastArgs(ctx: Context, site: String): List<String> =
        if ((site == "youtube" || site == "ytmusic") && Config.fastYouTube(ctx) && Cookies.file(ctx, site) == null && Config.siteArgs(ctx, site).isEmpty()) {
            listOf("--extractor-args", "youtube:player_client=visionos")
        } else {
            emptyList()
        }

    /** True when yt-dlp's -J output lists at least one format. */
    private fun hasFormats(out: String): Boolean {
        val start = out.indexOf('{')
        if (start < 0) return false
        return runCatching { (JSONObject(out.substring(start)).optJSONArray("formats")?.length() ?: 0) > 0 }.getOrDefault(false)
    }

    fun cookieArgs(ctx: Context, site: String): List<String> =
        Cookies.file(ctx, site)?.let { listOf("--cookies", it.absolutePath) } ?: emptyList()

    /** Run an engine in "list only" mode (yt-dlp -J, gallery-dl -j) and return its JSON. */
    suspend fun info(ctx: Context, url: String, engine: String, args: List<String>, site: String): JSONObject {
        ensureReady(ctx)
        val id = "info-${counter.incrementAndGet()}"
        infoRuns += id
        // A single video read by yt-dlp is kept, so its download can start without reading it again.
        val keep = engine != "gallerydl" && "--no-playlist" in args
        val gate = if (keep) InfoCache.begin(url) else null
        try {
            val r = if (engine == "gallerydl") {
                Runner.gallery(ctx, id, args + cookieArgs(ctx, site) + url, keepOut = true)
            } else {
                val extra = listOf("--cache-dir", cacheDir(ctx)) + cookieArgs(ctx, site) + Config.siteArgs(ctx, site)
                val fast = if (keep) fastArgs(ctx, site) else emptyList()
                val first = Runner.ytdlp(ctx, id, args + extra + fast + url, keepOut = true)
                // The quick client can miss a video (or YouTube can change it): then ask the usual clients.
                if (fast.isEmpty() || first.code == -9 || hasFormats(first.out)) first else Runner.ytdlp(ctx, id, args + extra + url, keepOut = true)
            }
            if (r.code == -9) throw CancellationException("canceled")
            val out = r.out.trim()
            val start = out.indexOfFirst { it == '{' || it == '[' }
            val json = if (start >= 0) out.substring(start) else ""
            if (json.isEmpty() || json == "null") throw Exception(r.err.ifBlank { "exit code ${r.code}" })
            if (keep) InfoCache.put(ctx, url, json)
            return JSONObject().put("engine", engine).put("json", json).put("ms", r.ms)
        } finally {
            infoRuns -= id
            gate?.let { InfoCache.end(url, it) }
        }
    }

    fun cancelInfo() {
        infoRuns.toList().forEach { Runner.kill(it) }
    }
}
