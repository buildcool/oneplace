package io.github.buildcool.oneplace.stream

import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import org.json.JSONArray

/**
 * Parts of YouTube videos people marked as paid sponsor reads, self-promotion and the like
 * (sponsor.ajay.app, data CC BY-NC-SA 4.0). Only the first 4 characters of the video id's SHA-256 leave
 * the phone, so the server can't tell which video it was.
 */
object SponsorBlock {
    class Segment(val start: Double, val end: Double, val category: String)

    fun prefix(videoId: String): String =
        MessageDigest.getInstance("SHA-256").digest(videoId.toByteArray()).joinToString("") { "%02x".format(it) }.take(4)

    fun url(videoId: String, categories: List<String>): String =
        "https://sponsor.ajay.app/api/skipSegments/${prefix(videoId)}?categories=" + URLEncoder.encode(JSONArray(categories).toString(), "UTF-8")

    /** The answer for many videos with the same prefix → this video's skippable parts, in order. */
    fun parse(json: String, videoId: String): List<Segment> {
        val all = runCatching { JSONArray(json) }.getOrNull() ?: return emptyList()
        for (i in 0 until all.length()) {
            val v = all.optJSONObject(i) ?: continue
            if (v.optString("videoID") != videoId) continue
            val segs = v.optJSONArray("segments") ?: return emptyList()
            return (0 until segs.length()).mapNotNull { j ->
                val s = segs.optJSONObject(j) ?: return@mapNotNull null
                if (s.optString("actionType", "skip") != "skip") return@mapNotNull null
                val r = s.optJSONArray("segment") ?: return@mapNotNull null
                val start = r.optDouble(0)
                val end = r.optDouble(1)
                if (start.isNaN() || end.isNaN() || end - start < 1.0) null else Segment(start, end, s.optString("category"))
            }.sortedBy { it.start }
        }
        return emptyList()
    }

    fun fetch(videoId: String, categories: List<String>): List<Segment> {
        if (categories.isEmpty()) return emptyList()
        val c = (URL(url(videoId, categories)).openConnection() as HttpURLConnection).apply {
            connectTimeout = 6_000
            readTimeout = 8_000
        }
        return try {
            if (c.responseCode != 200) emptyList() else parse(c.inputStream.bufferedReader().use { it.readText() }, videoId)
        } catch (e: Exception) {
            emptyList()
        } finally {
            c.disconnect()
        }
    }
}
