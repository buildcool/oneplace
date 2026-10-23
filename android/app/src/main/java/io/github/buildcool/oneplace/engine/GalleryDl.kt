package io.github.buildcool.oneplace.engine

import android.content.Context
import io.github.buildcool.oneplace.BuildConfig
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.util.zip.ZipInputStream
import org.json.JSONObject

/**
 * gallery-dl (photos, carousels, stories, profiles) runs on the same Python as yt-dlp. The APK carries
 * gallery-dl plus requests/urllib3/idna/charset_normalizer/certifi as assets/gdl.zip (built in CI);
 * newer gallery-dl versions come straight from PyPI.
 */
object GalleryDl {
    private const val ASSET = "gdl.zip"

    fun dir(ctx: Context) = File(ctx.filesDir, "gdl")

    /** Unpack the bundle on first start and after every app update. */
    fun ensureInstalled(ctx: Context) {
        val dir = dir(ctx)
        val stamp = BuildConfig.VERSION_CODE.toString()
        val marker = File(dir, ".from-apk")
        if (marker.exists() && marker.readText() == stamp && File(dir, "gallery_dl").isDirectory) return
        val tmp = File(ctx.filesDir, "gdl.tmp").apply {
            deleteRecursively()
            mkdirs()
        }
        ctx.assets.open(ASSET).use { unzip(it, tmp) }
        dir.deleteRecursively()
        if (!tmp.renameTo(dir)) throw IOException("could not install gallery-dl")
        marker.writeText(stamp)
    }

    fun version(ctx: Context): String? = runCatching {
        Regex("""__version__\s*=\s*["']([^"']+)""").find(File(dir(ctx), "gallery_dl/version.py").readText())?.groupValues?.get(1)
    }.getOrNull()

    /** Install the newest gallery-dl wheel from PyPI. True when the version changed. */
    fun update(ctx: Context): Boolean {
        val info = JSONObject(Net.text("https://pypi.org/pypi/gallery-dl/json"))
        val latest = info.getJSONObject("info").getString("version")
        if (latest == version(ctx)) return false
        val urls = info.getJSONArray("urls")
        val wheel = (0 until urls.length()).map { urls.getJSONObject(it) }
            .firstOrNull { it.optString("filename").endsWith("py3-none-any.whl") } ?: return false
        val file = File(ctx.cacheDir, "gallery_dl.whl")
        Net.download(wheel.getString("url"), file)
        val tmp = File(ctx.filesDir, "gdl.new").apply {
            deleteRecursively()
            mkdirs()
        }
        try {
            file.inputStream().use { unzip(it, tmp) { name -> name.startsWith("gallery_dl/") } }
            val target = File(dir(ctx), "gallery_dl")
            val old = File(dir(ctx), "gallery_dl.old").apply { deleteRecursively() }
            target.renameTo(old)
            if (!File(tmp, "gallery_dl").renameTo(target)) {
                old.renameTo(target)
                return false
            }
            old.deleteRecursively()
            return true
        } finally {
            file.delete()
            tmp.deleteRecursively()
        }
    }

    fun unzip(input: InputStream, dest: File, keep: (String) -> Boolean = { true }) {
        val root = dest.canonicalPath + File.separator
        ZipInputStream(input.buffered()).use { zip ->
            while (true) {
                val e = zip.nextEntry ?: break
                if (!keep(e.name)) continue
                val out = File(dest, e.name)
                if (!out.canonicalPath.startsWith(root)) continue // never write outside the folder
                if (e.isDirectory) out.mkdirs()
                else {
                    out.parentFile?.mkdirs()
                    out.outputStream().use { zip.copyTo(it) }
                }
            }
        }
    }
}
