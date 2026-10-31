package io.github.buildcool.oneplace.stream

import org.json.JSONObject

/**
 * Which stream of a link to play (from yt-dlp's -J answer). Videos: YouTube's single HLS playlist with
 * every quality (the player switches quality itself, and it carries no ads), else one file with picture
 * and sound, else the best picture-only file joined with the best sound. Songs: the best sound-only file.
 * [cap] is the highest picture height to use (0: no limit).
 */
object StreamPicker {
    class Pick(
        /** hls · file · merge */
        val kind: String,
        val url: String,
        val audioUrl: String? = null,
        val headers: Map<String, String> = emptyMap(),
        val audioHeaders: Map<String, String> = emptyMap(),
        val live: Boolean = false,
        /** YouTube files are read in pieces of at most 10 MB, as yt-dlp does. */
        val chunked: Boolean = false,
        val height: Int = 0,
    )

    private fun formats(info: JSONObject): List<JSONObject> {
        val a = info.optJSONArray("formats")
        val list = if (a == null) listOf(info) else List(a.length()) { a.optJSONObject(it) }.filterNotNull()
        return list.filter { it.optString("url").startsWith("http") }
    }

    fun headers(f: JSONObject): Map<String, String> {
        val h = f.optJSONObject("http_headers") ?: return emptyMap()
        return h.keys().asSequence().associateWith { h.optString(it) }.filterValues { it.isNotEmpty() }
    }

    private fun codec(f: JSONObject, key: String) = f.optString(key, "none").ifEmpty { "none" }
    private fun hasVideo(f: JSONObject) = codec(f, "vcodec") != "none" || (f.optInt("height") > 0 && codec(f, "vcodec") == "none" && !f.has("vcodec"))
    private fun hasAudio(f: JSONObject) = codec(f, "acodec") != "none" || (!f.has("acodec") && !f.has("vcodec"))
    private fun plain(f: JSONObject) = f.optString("protocol", "https").let { it == "https" || it == "http" }
    private fun hls(f: JSONObject) = f.optString("protocol").startsWith("m3u8")
    private fun height(f: JSONObject) = f.optInt("height", 0)
    private fun bitrate(f: JSONObject) = f.optDouble("tbr", f.optDouble("abr", f.optDouble("vbr", 0.0))).let { if (it.isNaN()) 0.0 else it }
    private fun chunked(f: JSONObject) = f.optJSONObject("downloader_options")?.has("http_chunk_size") == true || f.optString("url").contains(".googlevideo.com/")

    /** H.264 plays on every phone's hardware; AV1 is often software only. */
    private fun codecRank(f: JSONObject): Int {
        val v = codec(f, "vcodec")
        return when {
            v.startsWith("avc") || v.startsWith("h264") -> 3
            v.startsWith("vp9") || v.startsWith("vp09") -> 2
            v.startsWith("av01") -> 0
            else -> 1
        }
    }

    private fun bestAudio(list: List<JSONObject>): JSONObject? =
        list.filter { plain(it) && hasAudio(it) && codec(it, "vcodec") == "none" }
            .maxWithOrNull(compareBy<JSONObject>({ bitrate(it) }, { if (it.optString("ext") == "m4a") 1 else 0 }))

    fun pick(info: JSONObject, audioOnly: Boolean, cap: Int): Pick? {
        val list = formats(info)
        if (list.isEmpty()) return null
        val live = info.optBoolean("is_live")
        val limit = if (cap > 0) cap else Int.MAX_VALUE
        if (audioOnly) {
            bestAudio(list)?.let { return Pick("file", it.optString("url"), headers = headers(it), chunked = chunked(it)) }
        }
        // YouTube: one HLS playlist with all qualities (manifest_url of its HLS formats).
        val master = list.firstOrNull { hls(it) && it.optString("manifest_url").contains("hls_variant") }
        if (master != null) return Pick("hls", master.optString("manifest_url"), headers = headers(master), live = live)
        val muxed = list.filter { plain(it) && hasAudio(it) && codec(it, "vcodec") != "none" }
        val bestMuxed = muxed.filter { height(it) <= limit }.maxWithOrNull(compareBy<JSONObject>({ height(it) }, { codecRank(it) }, { bitrate(it) }))
            ?: muxed.minByOrNull { height(it) }
        val video = list.filter { plain(it) && codec(it, "vcodec") != "none" && codec(it, "acodec") == "none" }
        val bestVideo = video.filter { height(it) <= limit }.maxWithOrNull(compareBy<JSONObject>({ height(it) }, { codecRank(it) }, { bitrate(it) }))
        val audio = bestAudio(list)
        if (bestVideo != null && audio != null && (bestMuxed == null || height(bestVideo) > height(bestMuxed))) {
            return Pick("merge", bestVideo.optString("url"), audio.optString("url"), headers(bestVideo), headers(audio), live, chunked(bestVideo), height(bestVideo))
        }
        if (bestMuxed != null) return Pick("file", bestMuxed.optString("url"), headers = headers(bestMuxed), live = live, chunked = chunked(bestMuxed), height = height(bestMuxed))
        // Other sites: an HLS stream of their own.
        val stream = list.filter { hls(it) }.let { s -> s.filter { height(it) <= limit }.maxByOrNull { height(it) } ?: s.minByOrNull { height(it) } }
        if (stream != null) return Pick("hls", stream.optString("manifest_url").ifEmpty { stream.optString("url") }, headers = headers(stream), live = live, height = height(stream))
        // A sound-only answer for a video request (e.g. a song link): still playable.
        return audio?.let { Pick("file", it.optString("url"), headers = headers(it), chunked = chunked(it)) }
    }

    /** The YouTube id of a watch, Shorts or youtu.be address (for SponsorBlock). */
    fun youtubeId(url: String): String? =
        Regex("""(?:[?&]v=|youtu\.be/|/shorts/|/live/|/embed/)([A-Za-z0-9_-]{11})""").find(url)?.groupValues?.get(1)
}
