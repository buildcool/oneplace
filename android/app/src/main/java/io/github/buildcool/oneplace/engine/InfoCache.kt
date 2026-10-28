package io.github.buildcool.oneplace.engine

import android.content.Context
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The download sheet has already read the link (`yt-dlp -J`). Keeping that answer for a while lets
 * the download start straight away with --load-info-json instead of reading the link a second time.
 */
object InfoCache {
    /** The download links inside an answer stay valid for hours; one hour is on the safe side. */
    private const val MAX_AGE = 60 * 60_000L

    /** Links being read right now: a download of the same link waits for the answer. */
    private val reading = ConcurrentHashMap<String, CompletableDeferred<Unit>>()

    private fun dir(ctx: Context) = File(ctx.cacheDir, "info").apply { mkdirs() }

    private fun fileOf(ctx: Context, url: String): File {
        val hash = MessageDigest.getInstance("SHA-1").digest(url.toByteArray()).joinToString("") { "%02x".format(it) }
        return File(dir(ctx), "$hash.json")
    }

    fun begin(url: String): CompletableDeferred<Unit> = CompletableDeferred<Unit>().also { reading[url] = it }

    fun end(url: String, gate: CompletableDeferred<Unit>) {
        reading.remove(url, gate)
        gate.complete(Unit)
    }

    fun put(ctx: Context, url: String, json: String) {
        runCatching {
            val now = System.currentTimeMillis()
            dir(ctx).listFiles()?.forEach { if (now - it.lastModified() > MAX_AGE) it.delete() }
            val f = fileOf(ctx, url)
            val tmp = File(f.path + ".tmp")
            tmp.writeText(json)
            if (!tmp.renameTo(f)) tmp.delete()
        }
    }

    /** A recent answer for [url]; waits up to [waitMs] while the sheet is still reading it. */
    suspend fun get(ctx: Context, url: String, waitMs: Long = 120_000): File? {
        reading[url]?.let { gate -> withTimeoutOrNull(waitMs) { gate.await() } }
        return fileOf(ctx, url).takeIf { it.isFile && System.currentTimeMillis() - it.lastModified() < MAX_AGE }
    }

    fun drop(ctx: Context, url: String) {
        fileOf(ctx, url).delete()
    }
}
