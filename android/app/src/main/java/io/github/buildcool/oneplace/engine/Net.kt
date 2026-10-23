package io.github.buildcool.oneplace.engine

import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/** Small HTTP helpers (short-link redirects, update downloads, thumbnails). */
object Net {
    const val UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"

    private fun open(url: String, follow: Boolean): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            instanceFollowRedirects = follow
            connectTimeout = 15_000
            readTimeout = 30_000
            setRequestProperty("User-Agent", UA)
            setRequestProperty("Accept-Language", "en-US,en;q=0.9")
        }

    /** Follow redirects of a short link (fb.watch, pin.it, vm.tiktok…) and return where it lands. */
    fun resolve(url: String): String {
        var cur = url
        repeat(8) {
            val c = open(cur, follow = false)
            try {
                val code = c.responseCode
                val loc = c.getHeaderField("Location")
                if (code !in 300..399 || loc.isNullOrBlank()) return cur
                cur = URL(URL(cur), loc).toString()
            } finally {
                c.disconnect()
            }
        }
        return cur
    }

    fun text(url: String): String {
        val c = open(url, follow = true)
        try {
            if (c.responseCode !in 200..299) throw java.io.IOException("HTTP ${c.responseCode} for $url")
            return c.inputStream.bufferedReader().use { it.readText() }
        } finally {
            c.disconnect()
        }
    }

    /** Download to [file]; [progress] gets 0..100 (or -1 when the size is unknown). Returns the content type. */
    fun download(url: String, file: File, headers: Map<String, String> = emptyMap(), progress: ((Double) -> Unit)? = null): String? {
        val c = open(url, follow = true)
        headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
        try {
            if (c.responseCode !in 200..299) throw java.io.IOException("HTTP ${c.responseCode}")
            val total = c.contentLengthLong
            var done = 0L
            var last = 0L
            c.inputStream.use { input ->
                file.outputStream().use { out ->
                    val buf = ByteArray(1 shl 16)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        done += n
                        val now = System.currentTimeMillis()
                        if (progress != null && now - last > 250) {
                            last = now
                            progress(if (total > 0) done * 100.0 / total else -1.0)
                        }
                    }
                }
            }
            progress?.invoke(100.0)
            return c.contentType
        } finally {
            c.disconnect()
        }
    }
}
