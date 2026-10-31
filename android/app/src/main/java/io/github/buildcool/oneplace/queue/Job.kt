package io.github.buildcool.oneplace.queue

import org.json.JSONArray
import org.json.JSONObject

/**
 * A file the job saved, as the UI sees it (content:// URI in MediaStore), plus what the Library shows about it.
 * [cover] (the site's picture for this item) and [meta] (facts and thumbnail done) stay on the phone side.
 */
data class JobFile(
    val uri: String,
    val name: String,
    val mime: String,
    val size: Long,
    val title: String? = null,
    val artist: String? = null,
    /** Seconds; 0 = unknown. */
    val dur: Double = 0.0,
    val w: Int = 0,
    val h: Int = 0,
    /** Small JPEG made on the phone (files/thumbs). */
    val thumb: String? = null,
    /** Vocal remover output: "music" or "vocals". */
    val stem: String? = null,
    val cover: String? = null,
    val meta: Boolean = false,
) {
    fun toJson(): JSONObject = JSONObject().put("uri", uri).put("name", name).put("mime", mime).put("size", size).apply {
        title?.let { put("title", it) }
        artist?.let { put("artist", it) }
        if (dur > 0) put("dur", dur)
        if (w > 0 && h > 0) put("w", w).put("h", h)
        thumb?.let { put("thumb", it) }
        stem?.let { put("stem", it) }
    }

    fun toStoreJson(): JSONObject = toJson().apply {
        cover?.let { put("cover", it) }
        if (meta) put("meta", true)
    }

    companion object {
        fun from(o: JSONObject) = JobFile(
            uri = o.optString("uri"),
            name = o.optString("name"),
            mime = o.optString("mime"),
            size = o.optLong("size"),
            title = o.str("title"),
            artist = o.str("artist"),
            dur = o.optDouble("dur", 0.0).takeUnless { it.isNaN() } ?: 0.0,
            w = o.optInt("w"),
            h = o.optInt("h"),
            thumb = o.str("thumb"),
            stem = o.str("stem"),
            cover = o.str("cover"),
            meta = o.optBoolean("meta"),
        )
    }
}

/** A string value, or null when missing, JSON null or empty. */
fun JSONObject.str(key: String): String? = if (!has(key) || isNull(key)) null else optString(key).ifEmpty { null }

/** Which engine runs and with what arguments (built by the TypeScript side, see src/core/args.ts). */
data class Template(val engine: String, val args: List<String>, val dest: String) {
    fun toJson(): JSONObject = JSONObject().put("engine", engine).put("args", JSONArray(args)).put("dest", dest)

    companion object {
        fun from(o: JSONObject?): Template? =
            o?.let { Template(it.optString("engine", "ytdlp"), it.optJSONArray("args").strings(), it.optString("dest", "video")) }
    }
}

fun JSONArray?.strings(): List<String> = if (this == null) emptyList() else List(length()) { optString(it) }

/** One download. Mirrors the `Job` type in src/core/types.ts plus the native-only fields. */
class Job(
    val id: String,
    var url: String,
    val site: String,
    var title: String,
    var thumb: String?,
    val mode: String,
    val main: Template,
    val fallback: Template?,
    val httpUrls: List<String>,
    val imageFormat: String?,
    val crop: String?,
    /** Size the sheet showed (0 = unknown), for the free-space check. */
    val expectedBytes: Long = 0,
    var status: String = "queued",
    var progress: Double = -1.0,
    var eta: Long = -1,
    var speed: String? = null,
    var line: String? = null,
    var error: String? = null,
    var files: List<JobFile> = emptyList(),
    val createdAt: Long = System.currentTimeMillis(),
    var finishedAt: Long? = null,
    var attempts: Int = 0,
    var usedFallback: Boolean = false,
    var healed: Boolean = false,
    /** The title is still the URL (1-tap shares); replace it with the file name once known. */
    var titleFromFile: Boolean = false,
    /** A frame grabbed from the video while it downloads (local JPEG). */
    var preview: String? = null,
    /** Made from a saved file (vocal remover): {kind, source: {id, index}, keep, as, bitrate}. */
    val edit: JSONObject? = null,
    /** Found in the browser: {referer, userAgent, cookieUrls, private} go with the download. */
    val headers: JSONObject? = null,
) {
    val template: Template get() = if (usedFallback && fallback != null) fallback else main

    /** Files are added by the queue and filled in by Thumbs at the same time: change them under this lock. */
    fun addFile(file: JobFile) = synchronized(this) { files = files + file }

    fun updateFile(uri: String, change: (JobFile) -> JobFile) = synchronized(this) {
        files = files.map { if (it.uri == uri) change(it) else it }
    }

    fun removeFiles(uris: Set<String>) = synchronized(this) { files = files.filter { it.uri !in uris } }

    /** Whole playlist/channel: items are saved one by one and a retry only fetches the missing ones. */
    val isPlaylist: Boolean get() = main.args.contains("--yes-playlist")
    val dest: String get() = template.dest

    /** What the UI gets. */
    fun toJson(): JSONObject = JSONObject()
        .put("id", id)
        .put("url", url)
        .put("site", site)
        .put("title", title)
        .put("thumb", thumb ?: JSONObject.NULL)
        .put("mode", mode)
        .put("dest", dest)
        .put("status", status)
        .put("progress", progress)
        .put("eta", eta)
        .put("speed", speed ?: JSONObject.NULL)
        .put("line", line ?: JSONObject.NULL)
        .put("error", error ?: JSONObject.NULL)
        .put("files", JSONArray(files.map { it.toJson() }))
        .put("createdAt", createdAt)
        .put("finishedAt", finishedAt ?: JSONObject.NULL)
        .put("attempts", attempts)
        .apply {
            preview?.let { put("preview", it) }
            edit?.let { put("edit", it) }
        }

    /** Everything, for the database. */
    fun toStoreJson(): JSONObject = toJson()
        .put("files", JSONArray(synchronized(this) { files }.map { it.toStoreJson() }))
        .put("main", main.toJson())
        .put("fallback", fallback?.toJson() ?: JSONObject.NULL)
        .put("httpUrls", JSONArray(httpUrls))
        .put("imageFormat", imageFormat ?: JSONObject.NULL)
        .put("crop", crop ?: JSONObject.NULL)
        .put("expectedBytes", expectedBytes)
        .put("usedFallback", usedFallback)
        .put("healed", healed)
        .put("titleFromFile", titleFromFile)
        .apply { headers?.let { put("headers", it) } }

    companion object {
        fun fromStore(o: JSONObject): Job = Job(
            id = o.getString("id"),
            url = o.optString("url"),
            site = o.optString("site", "other"),
            title = o.optString("title"),
            thumb = o.str("thumb"),
            mode = o.optString("mode", "video"),
            main = Template.from(o.optJSONObject("main")) ?: Template("ytdlp", emptyList(), "video"),
            fallback = Template.from(o.optJSONObject("fallback")),
            httpUrls = o.optJSONArray("httpUrls").strings(),
            imageFormat = o.str("imageFormat"),
            crop = o.str("crop"),
            expectedBytes = o.optLong("expectedBytes"),
            status = o.optString("status", "queued"),
            progress = o.optDouble("progress", -1.0),
            eta = o.optLong("eta", -1),
            speed = o.str("speed"),
            line = o.str("line"),
            error = o.str("error"),
            files = o.optJSONArray("files")?.let { a -> List(a.length()) { JobFile.from(a.getJSONObject(it)) } } ?: emptyList(),
            createdAt = o.optLong("createdAt", System.currentTimeMillis()),
            finishedAt = if (o.isNull("finishedAt")) null else o.optLong("finishedAt"),
            attempts = o.optInt("attempts"),
            usedFallback = o.optBoolean("usedFallback"),
            healed = o.optBoolean("healed"),
            titleFromFile = o.optBoolean("titleFromFile"),
            preview = o.str("preview"),
            edit = o.optJSONObject("edit"),
            headers = o.optJSONObject("headers"),
        )

        /** A JobRequest from the UI (src/core/types.ts) or a 1-tap share. */
        fun fromRequest(id: String, r: JSONObject): Job {
            val url = r.getString("url")
            val title = r.optString("title").ifBlank { url }
            return Job(
                id = id,
                url = url,
                site = r.optString("site", "other"),
                title = title,
                thumb = r.str("thumb"),
                mode = r.optString("mode", "video"),
                main = Template(r.optString("engine", "ytdlp"), r.optJSONArray("args").strings(), r.optString("dest", "video")),
                fallback = Template.from(r.optJSONObject("fallback")),
                httpUrls = r.optJSONArray("httpUrls").strings(),
                imageFormat = r.str("imageFormat"),
                crop = r.str("crop"),
                expectedBytes = r.optLong("expectedBytes"),
                titleFromFile = title == url || r.optBoolean("titleFromFile"),
                edit = r.optJSONObject("edit"),
                headers = r.optJSONObject("headers"),
            )
        }
    }
}
