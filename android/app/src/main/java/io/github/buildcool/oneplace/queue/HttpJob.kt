package io.github.buildcool.oneplace.queue

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import io.github.buildcool.oneplace.browser.BrowserLayer
import io.github.buildcool.oneplace.engine.Net
import io.github.buildcool.oneplace.storage.Saver
import java.io.File

/**
 * Plain file downloads (thumbnails, and photos/files found in the browser): try each URL until one works,
 * then convert/crop the image if asked. Browser files carry the page's address, user agent and cookies.
 */
object HttpJob {
    fun run(job: Job, dir: File, progress: (Double) -> Unit): String? {
        var lastError: String? = null
        for (url in job.httpUrls) {
            val tmp = File(dir, "download.tmp")
            try {
                val type = Net.download(url, tmp, headersFor(job, url), progress)
                val ext = extFor(type, url)
                val base = Saver.safeName(job.title).take(150).ifBlank { "thumbnail" }
                val raw = File(dir, "$base.$ext")
                tmp.renameTo(raw)
                convert(raw, job.imageFormat, job.crop == "square")
                return null
            } catch (e: Exception) {
                lastError = "${e.message} ($url)"
                tmp.delete()
            }
        }
        return lastError ?: "No file to download"
    }

    private fun headersFor(job: Job, url: String): Map<String, String> {
        val h = job.headers ?: return mapOf("Referer" to job.url)
        val out = HashMap<String, String>()
        h.optString("referer").takeIf { it.startsWith("http") }?.let { out["Referer"] = it }
        h.optString("userAgent").takeIf { it.isNotBlank() }?.let { out["User-Agent"] = it }
        BrowserLayer.cookieFor(url, h.optBoolean("private"))?.let { out["Cookie"] = it }
        return out
    }

    private val TYPES = listOf(
        "jpeg" to "jpg", "jpg" to "jpg", "png" to "png", "webp" to "webp", "gif" to "gif", "avif" to "avif", "heic" to "heic",
        "video/mp4" to "mp4", "video/webm" to "webm", "video/quicktime" to "mov", "video/x-matroska" to "mkv", "video/3gpp" to "3gp",
        "audio/mpeg" to "mp3", "audio/mp4" to "m4a", "audio/x-m4a" to "m4a", "audio/aac" to "aac", "audio/ogg" to "ogg", "audio/opus" to "opus",
        "audio/wav" to "wav", "audio/x-wav" to "wav", "audio/flac" to "flac", "application/pdf" to "pdf", "application/zip" to "zip",
        "android.package-archive" to "apk", "text/plain" to "txt",
    )

    private fun extFor(type: String?, url: String): String {
        val t = type?.lowercase() ?: ""
        TYPES.firstOrNull { it.first in t }?.let { return it.second }
        val fromUrl = url.substringBefore('?').substringAfterLast('/').substringAfterLast('.', "").lowercase()
        return fromUrl.takeIf { it.length in 2..4 && it.all(Char::isLetterOrDigit) } ?: if (t.startsWith("image/")) "jpg" else "bin"
    }

    /** Re-encode to JPG/PNG/WebP and/or crop to a centred square. "original" keeps the bytes as they are. */
    @Suppress("DEPRECATION") // CompressFormat.WEBP: the lossy/lossless variants need Android 11
    private fun convert(file: File, format: String?, square: Boolean) {
        val target = when (format) {
            "jpg" -> "jpg"
            "png" -> "png"
            "webp" -> "webp"
            else -> null
        }
        val currentExt = file.extension.lowercase()
        if (!square && (target == null || target == currentExt || (target == "jpg" && currentExt == "jpeg"))) return
        var bmp = BitmapFactory.decodeFile(file.path) ?: return
        if (square && bmp.width != bmp.height) {
            val side = minOf(bmp.width, bmp.height)
            bmp = Bitmap.createBitmap(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side)
        }
        val ext = target ?: currentExt.takeIf { it == "png" || it == "webp" } ?: "jpg"
        val out = File(file.parentFile, file.nameWithoutExtension + "." + ext)
        val fmt = when (ext) {
            "png" -> Bitmap.CompressFormat.PNG
            "webp" -> Bitmap.CompressFormat.WEBP
            else -> Bitmap.CompressFormat.JPEG
        }
        val tmp = File(file.parentFile, "convert.tmp")
        tmp.outputStream().use { bmp.compress(fmt, 95, it) }
        file.delete()
        tmp.renameTo(out)
    }
}
