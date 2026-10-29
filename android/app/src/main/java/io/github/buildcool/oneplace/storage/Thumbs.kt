package io.github.buildcool.oneplace.storage

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.util.Size
import io.github.buildcool.oneplace.engine.Net
import io.github.buildcool.oneplace.queue.Job
import io.github.buildcool.oneplace.queue.JobFile
import io.github.buildcool.oneplace.queue.JobStore
import io.github.buildcool.oneplace.queue.Queue
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import kotlin.math.max
import kotlin.math.roundToInt
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit

/**
 * Pictures and facts for the Library, made on the phone so it is fast and works offline: the site's cover
 * (shrunk), else a frame from the video, the song's own cover or a small copy of the photo; plus length and
 * width × height. Also grabs a frame from a video while it is still downloading.
 */
object Thumbs {
    private const val MAX = 640
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val gate = Semaphore(2)

    @Volatile
    private var backfilled = false

    fun dir(ctx: Context): File = File(ctx.filesDir, "thumbs").apply { mkdirs() }

    /** The same saved file always gets the same picture name. */
    fun nameFor(uri: String): String = sha1(uri).take(20) + ".jpg"

    fun fileFor(ctx: Context, uri: String) = File(dir(ctx), nameFor(uri))

    internal fun sha1(s: String): String = MessageDigest.getInstance("SHA-1").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }

    private fun liveFile(ctx: Context, jobId: String) = File(dir(ctx), "live-$jobId.jpg")

    fun isMedia(f: JobFile) = f.mime.startsWith("video/") || f.mime.startsWith("audio/") || f.mime.startsWith("image/")

    /** After the queue saved a file: make its picture and read its facts in the background, then update the UI. */
    fun later(ctx: Context, job: Job, uri: String) {
        val app = ctx.applicationContext
        scope.launch { gate.withPermit { fill(app, job, uri) } }
    }

    /** Downloads from before this version: give them pictures too, newest first, once per file. */
    fun backfill(ctx: Context) {
        if (backfilled) return
        backfilled = true
        val app = ctx.applicationContext
        scope.launch {
            delay(4_000)
            for (job in JobStore.all()) {
                if (job.status != "done") continue
                for (f in job.files) if (!f.meta && isMedia(f)) gate.withPermit { fill(app, job, f.uri) }
            }
        }
    }

    private fun fill(ctx: Context, job: Job, uri: String) {
        val file = job.files.find { it.uri == uri } ?: return
        if (file.meta) return
        val made = runCatching { make(ctx, job, file) }.getOrElse { file.copy(meta = true) }
        job.updateFile(uri) { made }
        if (JobStore.get(job.id) === job) {
            JobStore.save(job)
            Queue.emit(job, force = true)
        }
    }

    /** Picture and facts for one file. A missing picture is fine: the UI shows an icon. */
    fun make(ctx: Context, job: Job, f: JobFile): JobFile {
        val out = fileFor(ctx, f.uri)
        val uri = Uri.parse(f.uri)
        var ok = out.length() > 0
        // The job's picture is the whole playlist's, so items only use their own.
        val cover = f.cover ?: job.thumb?.takeIf { !job.isPlaylist && job.edit == null && it.startsWith("http") }
        if (!ok && f.mime.startsWith("image/")) ok = save(photo(ctx, uri), out)
        if (!ok && cover != null) ok = save(download(cover), out)
        if (!ok) ok = save(fromMedia(ctx, uri, f), out)
        val known = if (f.dur > 0 && (f.w > 0 || f.mime.startsWith("audio/"))) f else facts(ctx, uri, f)
        return known.copy(thumb = if (ok) out.absolutePath else known.thumb, meta = true)
    }

    /** A frame from a video that is still downloading (most formats can be read before they are complete). */
    fun liveFrame(ctx: Context, job: Job, partial: File): Boolean {
        val bmp = retriever { r ->
            r.setDataSource(partial.absolutePath)
            frameAt(r, 1_000_000) ?: frameAt(r, 0)
        } ?: return false
        val out = liveFile(ctx, job.id)
        if (!save(bmp, out)) return false
        job.preview = out.absolutePath
        return true
    }

    fun forget(ctx: Context, job: Job) {
        job.files.forEach { forgetFile(ctx, it) }
        liveFile(ctx, job.id).delete()
    }

    fun forgetFile(ctx: Context, f: JobFile) {
        fileFor(ctx, f.uri).delete()
    }

    // ---------- pictures ----------

    private fun photo(ctx: Context, uri: Uri): Bitmap? = runCatching {
        if (Build.VERSION.SDK_INT >= 29) return@runCatching ctx.contentResolver.loadThumbnail(uri, Size(MAX, MAX), null)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        val opts = BitmapFactory.Options().apply { inSampleSize = sample(bounds.outWidth, bounds.outHeight) }
        ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) }
    }.getOrNull()

    private fun download(url: String): Bitmap? = runCatching {
        val c = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 10_000
            readTimeout = 15_000
            setRequestProperty("User-Agent", Net.UA)
        }
        try {
            if (c.responseCode !in 200..299) return@runCatching null
            val buf = ByteArrayOutputStream()
            c.inputStream.use { input ->
                val chunk = ByteArray(1 shl 14)
                while (true) {
                    val n = input.read(chunk)
                    if (n < 0) break
                    buf.write(chunk, 0, n)
                    if (buf.size() > 12 shl 20) return@runCatching null
                }
            }
            decode(buf.toByteArray())
        } finally {
            c.disconnect()
        }
    }.getOrNull()

    private fun fromMedia(ctx: Context, uri: Uri, f: JobFile): Bitmap? {
        if (f.mime.startsWith("video/")) {
            retriever { r ->
                r.setDataSource(ctx, uri)
                val ms = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: (f.dur * 1000).toLong()
                // A little way in: many videos start on a black frame.
                frameAt(r, (ms * 0.15).toLong().coerceIn(0, 5_000) * 1000) ?: frameAt(r, 0)
            }?.let { return it }
        }
        if (f.mime.startsWith("audio/")) {
            retriever { r ->
                r.setDataSource(ctx, uri)
                r.embeddedPicture?.let { decode(it) }
            }?.let { return it }
        }
        return if (Build.VERSION.SDK_INT >= 29) runCatching { ctx.contentResolver.loadThumbnail(uri, Size(MAX, MAX), null) }.getOrNull() else null
    }

    private fun frameAt(r: MediaMetadataRetriever, us: Long): Bitmap? =
        if (Build.VERSION.SDK_INT >= 27) {
            r.getScaledFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, MAX, MAX)
        } else {
            r.getFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
        }

    private inline fun <T> retriever(block: (MediaMetadataRetriever) -> T?): T? {
        val r = MediaMetadataRetriever()
        return try {
            block(r)
        } catch (e: Exception) {
            null
        } finally {
            runCatching { r.release() }
        }
    }

    private fun decode(bytes: ByteArray): Bitmap? {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, o)
        if (o.outWidth <= 0) return null
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample(o.outWidth, o.outHeight) })
    }

    /** Power-of-two shrink while decoding, keeping the long side at least [MAX]. */
    internal fun sample(w: Int, h: Int): Int {
        var s = 1
        while (max(w, h) / (s * 2) >= MAX) s *= 2
        return s
    }

    private fun save(bmp: Bitmap?, out: File): Boolean {
        bmp ?: return false
        return try {
            val scale = minOf(1f, MAX.toFloat() / max(bmp.width, bmp.height))
            val b = if (scale < 1f) Bitmap.createScaledBitmap(bmp, max(1, (bmp.width * scale).roundToInt()), max(1, (bmp.height * scale).roundToInt()), true) else bmp
            val tmp = File(out.path + ".tmp")
            tmp.outputStream().use { b.compress(Bitmap.CompressFormat.JPEG, 82, it) }
            if (b !== bmp) b.recycle()
            tmp.renameTo(out)
        } catch (e: Exception) {
            false
        }
    }

    // ---------- facts ----------

    private fun facts(ctx: Context, uri: Uri, f: JobFile): JobFile {
        if (f.mime.startsWith("image/")) {
            val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            runCatching { ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, o) } }
            return if (o.outWidth > 0 && f.w <= 0) f.copy(w = o.outWidth, h = o.outHeight) else f
        }
        return retriever { r ->
            r.setDataSource(ctx, uri)
            val ms = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
            val (w, h) = upright(
                r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0,
                r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0,
                r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0,
            )
            f.copy(
                dur = if (f.dur > 0) f.dur else ms / 1000.0,
                w = if (f.w > 0) f.w else w,
                h = if (f.h > 0) f.h else h,
                artist = f.artist ?: r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST)?.takeIf { it.isNotBlank() },
            )
        } ?: f
    }

    /** Phones store some videos sideways with a rotation flag: report the size as it is shown. */
    internal fun upright(w: Int, h: Int, rotation: Int): Pair<Int, Int> = if (rotation == 90 || rotation == 270) Pair(h, w) else Pair(w, h)
}
