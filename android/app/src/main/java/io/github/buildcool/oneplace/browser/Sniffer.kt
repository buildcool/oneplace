package io.github.buildcool.oneplace.browser

import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import kotlin.math.roundToLong
import org.json.JSONArray
import org.json.JSONObject

/**
 * The content finder's eyes on the network, like 1DM: every request a page makes passes [classify];
 * media files and stream playlists are then asked about (type, size, qualities, length) off the
 * WebView's threads, with the page's own user agent, referrer and cookies. Streams locked with DRM
 * are reported as such and never offered for download.
 */
object Sniffer {
    class Hit(val url: String, val kind: String, val stream: String?)

    /** Who asks: the page the request came from and how to send cookies. */
    class Ctx(val pageUrl: String, val userAgent: String, val cookie: (String) -> String?)

    private val VIDEO_EXT = setOf("mp4", "m4v", "webm", "mov", "mkv", "flv", "3gp")
    private val AUDIO_EXT = setOf("mp3", "m4a", "aac", "ogg", "oga", "opus", "wav", "flac", "weba")
    private val SEGMENT = Regex("""(\.(m4s|ts|cmfv|cmfa|aac)$)|/(seg|segment|frag|fragment|chunk)[-_]?\d|[?&](bytestart|byterange|range|sq|part)=""", RegexOption.IGNORE_CASE)
    private const val MIN_VIDEO = 100_000L
    private const val MIN_AUDIO = 30_000L

    private val pool = Executors.newFixedThreadPool(2) { r -> Thread(r, "op-sniffer").apply { isDaemon = true } }

    /** Already asked about (per tab and page), so a playing video's many requests are looked at once. */
    private val seen = ConcurrentHashMap<String, Long>()

    /** Scheme, host and path of an address (plain string work: runs on any thread, and in JVM tests). */
    fun parts(url: String): Triple<String, String, String>? {
        val i = url.indexOf("://")
        if (i <= 0) return null
        val rest = url.substring(i + 3)
        val end = rest.indexOfAny(charArrayOf('/', '?', '#')).let { if (it < 0) rest.length else it }
        val host = rest.substring(0, end).substringAfterLast('@').substringBefore(':').lowercase()
        val path = if (end < rest.length && rest[end] == '/') rest.substring(end).substringBefore('?').substringBefore('#') else "/"
        return Triple(url.substring(0, i).lowercase(), host, path)
    }

    /** What a request might be; cheap enough for every request of every page. */
    fun classify(full: String, headers: Map<String, String>?): Hit? {
        val (scheme, host, rawPath) = parts(full) ?: return null
        if (scheme != "http" && scheme != "https" || host.isEmpty()) return null
        // YouTube's own pieces: its videos are found from the page instead.
        if (host.endsWith("googlevideo.com") || host.endsWith("ytimg.com")) return null
        val path = rawPath.lowercase()
        val ext = path.substringAfterLast('/').substringAfterLast('.', "")
        if (ext == "m3u8" || path.contains(".m3u8")) return Hit(full, "video", "hls")
        if (ext == "mpd") return Hit(full, "video", "dash")
        if (SEGMENT.containsMatchIn(full)) return null
        if (ext in VIDEO_EXT) return Hit(full, "video", null)
        if (ext in AUDIO_EXT) return Hit(full, "audio", null)
        // A video or audio element asks for a range from the start; the type is known after asking.
        val range = headers?.entries?.firstOrNull { it.key.equals("Range", ignoreCase = true) }?.value
        if (range != null && range.startsWith("bytes=0-")) return Hit(full, "file", null)
        return null
    }

    /** Forget what was asked for a tab (its page changed). */
    fun reset(tabId: String) {
        seen.keys.removeIf { it.startsWith("$tabId ") }
    }

    /** Ask about [hit] in the background; [done] gets a finder item (or nothing to show). */
    fun probe(tabId: String, hit: Hit, ctx: Ctx, done: (JSONObject) -> Unit) {
        val key = "$tabId ${keyOf(hit.url)}"
        if (seen.putIfAbsent(key, System.currentTimeMillis()) != null) return
        if (seen.size > 4000) seen.clear()
        pool.execute {
            runCatching { inspect(hit, ctx) }.getOrNull()?.let(done)
        }
    }

    /** The same file with a different signature is the same file. */
    fun keyOf(url: String): String {
        val (_, host, path) = parts(url) ?: return url
        return if (Regex("""\.\w{2,4}$""").containsMatchIn(path)) "$host$path" else url
    }

    private fun connect(url: String, ctx: Ctx, method: String = "GET", range: String? = null): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            instanceFollowRedirects = true
            connectTimeout = 10_000
            readTimeout = 15_000
            setRequestProperty("User-Agent", ctx.userAgent)
            setRequestProperty("Referer", ctx.pageUrl)
            ctx.cookie(url)?.let { setRequestProperty("Cookie", it) }
            range?.let { setRequestProperty("Range", it) }
        }

    private fun text(url: String, ctx: Ctx, max: Int): String? {
        val c = connect(url, ctx)
        try {
            if (c.responseCode !in 200..299) return null
            val bytes = c.inputStream.use { input ->
                val out = java.io.ByteArrayOutputStream()
                val buf = ByteArray(16 * 1024)
                while (out.size() < max) {
                    val n = input.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                }
                out.toByteArray()
            }
            return String(bytes, Charsets.UTF_8)
        } finally {
            c.disconnect()
        }
    }

    private fun inspect(hit: Hit, ctx: Ctx): JSONObject? = when (hit.stream) {
        "hls" -> text(hit.url, ctx, 512 * 1024)?.let { hlsItem(hit.url, it, ctx) }
        "dash" -> text(hit.url, ctx, 1024 * 1024)?.let { dashItem(hit.url, it) }
        else -> fileItem(hit, ctx)
    }

    // ---------- plain files ----------

    private fun fileItem(hit: Hit, ctx: Ctx): JSONObject? {
        var type: String? = null
        var size = -1L
        var name: String? = null
        var c = connect(hit.url, ctx, "HEAD")
        try {
            if (c.responseCode in 200..299) {
                type = c.contentType
                size = c.contentLengthLong
                name = c.getHeaderField("Content-Disposition")
            }
        } finally {
            c.disconnect()
        }
        if (type == null) {
            c = connect(hit.url, ctx, range = "bytes=0-0")
            try {
                if (c.responseCode in 200..299) {
                    type = c.contentType
                    size = c.getHeaderField("Content-Range")?.substringAfterLast('/')?.toLongOrNull() ?: c.contentLengthLong.takeIf { c.responseCode == 200 } ?: -1L
                    name = c.getHeaderField("Content-Disposition")
                }
            } finally {
                c.disconnect()
            }
        }
        val mime = type?.substringBefore(';')?.trim()?.lowercase()
        val kind = when {
            mime == null -> hit.kind.takeIf { it != "file" }
            mime.startsWith("video/") -> "video"
            mime.startsWith("audio/") -> "audio"
            mime.contains("mpegurl") -> return null
            mime == "application/octet-stream" || mime == "binary/octet-stream" -> hit.kind.takeIf { it != "file" }
            else -> null
        } ?: return null
        if (size in 0 until (if (kind == "audio") MIN_AUDIO else MIN_VIDEO)) return null
        return JSONObject().put("url", hit.url).put("kind", kind).put("source", "media").apply {
            mime?.let { put("mime", it) }
            if (size > 0) put("size", size)
            fileName(name)?.let { put("title", it) }
        }
    }

    /** attachment; filename="My Song.mp3" → "My Song". */
    fun fileName(disposition: String?): String? {
        disposition ?: return null
        val m = Regex("""filename\*?=(?:UTF-8'')?"?([^";]+)"?""", RegexOption.IGNORE_CASE).find(disposition) ?: return null
        val raw = runCatching { java.net.URLDecoder.decode(m.groupValues[1], "UTF-8") }.getOrDefault(m.groupValues[1])
        return raw.substringBeforeLast('.').trim().take(120).ifBlank { null }
    }

    // ---------- HLS ----------

    class Hls(val master: Boolean, val variants: List<Variant>, val drm: Boolean, val duration: Double, val audioOnly: Boolean)

    class Variant(val bandwidth: Long, val width: Int, val height: Int, val uri: String)

    private val ATTR = Regex("""([A-Z0-9-]+)=("[^"]*"|[^,]*)""")

    fun attrs(line: String): Map<String, String> =
        ATTR.findAll(line.substringAfter(':')).associate { it.groupValues[1] to it.groupValues[2].trim('"') }

    /** SAMPLE-AES and the big DRM systems' key formats; plain AES-128 is ordinary HLS encryption. */
    fun drmKey(line: String): Boolean {
        if (!line.startsWith("#EXT-X-KEY") && !line.startsWith("#EXT-X-SESSION-KEY")) return false
        val a = attrs(line)
        val method = a["METHOD"]?.uppercase() ?: return false
        if (method == "NONE" || method == "AES-128") {
            val format = a["KEYFORMAT"]?.lowercase() ?: return false
            return format != "identity"
        }
        return true
    }

    fun parseHls(text: String, base: String): Hls {
        val lines = text.lineSequence().map { it.trim() }.filter { it.isNotEmpty() }.toList()
        val variants = mutableListOf<Variant>()
        var drm = false
        var duration = 0.0
        var audioOnly = true
        var i = 0
        while (i < lines.size) {
            val line = lines[i]
            if (drmKey(line)) drm = true
            if (line.startsWith("#EXTINF:")) duration += line.removePrefix("#EXTINF:").substringBefore(',').toDoubleOrNull() ?: 0.0
            if (line.startsWith("#EXT-X-STREAM-INF")) {
                val a = attrs(line)
                val res = a["RESOLUTION"]?.split('x')
                val uri = lines.getOrNull(i + 1)?.takeIf { !it.startsWith("#") }
                if (uri != null) {
                    val codecs = a["CODECS"]?.lowercase() ?: ""
                    if (res != null || codecs.isEmpty() || codecs.contains("avc") || codecs.contains("hvc") || codecs.contains("hev") || codecs.contains("vp") || codecs.contains("av01")) audioOnly = false
                    variants += Variant(
                        bandwidth = a["BANDWIDTH"]?.toLongOrNull() ?: 0,
                        width = res?.getOrNull(0)?.toIntOrNull() ?: 0,
                        height = res?.getOrNull(1)?.toIntOrNull() ?: 0,
                        uri = runCatching { URL(URL(base), uri).toString() }.getOrDefault(uri),
                    )
                    i++
                }
            }
            i++
        }
        val master = variants.isNotEmpty()
        return Hls(master, variants, drm, duration, master && audioOnly)
    }

    private fun hlsItem(url: String, text: String, ctx: Ctx): JSONObject? {
        if (!text.trimStart().startsWith("#EXTM3U")) return null
        val hls = parseHls(text, url)
        var duration = hls.duration
        var drm = hls.drm
        if (hls.master) {
            // Length and keys live in the variants' own playlists: read the best one.
            val top = hls.variants.maxByOrNull { it.bandwidth } ?: hls.variants.first()
            text(top.uri, ctx, 512 * 1024)?.let { t ->
                val media = parseHls(t, top.uri)
                duration = media.duration
                drm = drm || media.drm
            }
        }
        val o = JSONObject().put("url", url).put("kind", if (hls.audioOnly) "audio" else "video").put("source", "media").put("stream", "hls")
        if (drm) o.put("drm", true)
        if (duration > 0) o.put("dur", duration.roundToLong())
        if (hls.master) {
            val list = hls.variants.sortedByDescending { it.bandwidth }.distinctBy { if (it.height > 0) it.height.toLong() else it.bandwidth }
            o.put("variants", JSONArray(list.map { v ->
                JSONObject().put("bandwidth", v.bandwidth).apply {
                    if (v.height > 0) put("height", v.height)
                    if (duration > 0 && v.bandwidth > 0) put("size", (v.bandwidth / 8.0 * duration).roundToLong())
                }
            }))
            list.firstOrNull()?.height?.takeIf { it > 0 }?.let { o.put("h", it) }
        }
        return o
    }

    // ---------- DASH ----------

    private val REP = Regex("""<Representation\b([^>]*)>""", RegexOption.IGNORE_CASE)
    private fun xmlAttr(tag: String, name: String) = Regex("""\b$name="([^"]*)"""").find(tag)?.groupValues?.get(1)

    /** "PT1H2M3.5S" → 3723.5 seconds. */
    fun isoSeconds(s: String?): Double {
        val m = Regex("""^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$""").find(s ?: return 0.0) ?: return 0.0
        val (d, h, min, sec) = m.destructured
        return (d.toDoubleOrNull() ?: 0.0) * 86400 + (h.toDoubleOrNull() ?: 0.0) * 3600 + (min.toDoubleOrNull() ?: 0.0) * 60 + (sec.toDoubleOrNull() ?: 0.0)
    }

    fun dashItem(url: String, xml: String): JSONObject? {
        if (!xml.contains("<MPD", ignoreCase = true)) return null
        val drm = xml.contains("<ContentProtection", ignoreCase = true)
        val duration = isoSeconds(xmlAttr(xml.substringAfter("<MPD").substringBefore(">"), "mediaPresentationDuration"))
        val heights = REP.findAll(xml).mapNotNull { r ->
            val tag = r.groupValues[1]
            val h = xmlAttr(tag, "height")?.toIntOrNull() ?: return@mapNotNull null
            h to (xmlAttr(tag, "bandwidth")?.toLongOrNull() ?: 0L)
        }.distinctBy { it.first }.sortedByDescending { it.first }.toList()
        val o = JSONObject().put("url", url).put("kind", if (heights.isEmpty()) "audio" else "video").put("source", "media").put("stream", "dash")
        if (drm) o.put("drm", true)
        if (duration > 0) o.put("dur", duration.roundToLong())
        if (heights.isNotEmpty()) {
            o.put("h", heights.first().first)
            o.put("variants", JSONArray(heights.map { (h, bw) ->
                JSONObject().put("height", h).put("bandwidth", bw).apply { if (duration > 0 && bw > 0) put("size", (bw / 8.0 * duration).roundToLong()) }
            }))
        }
        return o
    }
}
