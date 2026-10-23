package io.github.buildcool.oneplace.queue

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import io.github.buildcool.oneplace.engine.Net
import io.github.buildcool.oneplace.storage.Saver
import java.io.File

/** Plain file downloads (thumbnails): try each URL until one works, then convert/crop the image if asked. */
object HttpJob {
    fun run(job: Job, dir: File, progress: (Double) -> Unit): String? {
        var lastError: String? = null
        for (url in job.httpUrls) {
            val tmp = File(dir, "download.tmp")
            try {
                val type = Net.download(url, tmp, mapOf("Referer" to job.url), progress)
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

    private fun extFor(type: String?, url: String): String {
        val t = type?.lowercase() ?: ""
        return when {
            "jpeg" in t || "jpg" in t -> "jpg"
            "png" in t -> "png"
            "webp" in t -> "webp"
            "gif" in t -> "gif"
            "avif" in t -> "avif"
            else -> url.substringBefore('?').substringAfterLast('.', "jpg").take(4).lowercase()
        }
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
