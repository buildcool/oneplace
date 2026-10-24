package io.github.buildcool.oneplace.queue

import org.json.JSONArray
import org.json.JSONObject

/** A file the job saved, as the UI sees it (content:// URI in MediaStore). */
data class JobFile(val uri: String, val name: String, val mime: String, val size: Long) {
    fun toJson(): JSONObject = JSONObject().put("uri", uri).put("name", name).put("mime", mime).put("size", size)

    companion object {
        fun from(o: JSONObject) = JobFile(o.optString("uri"), o.optString("name"), o.optString("mime"), o.optLong("size"))
    }
}

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
) {
    val template: Template get() = if (usedFallback && fallback != null) fallback else main

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

    /** Everything, for the database. */
    fun toStoreJson(): JSONObject = toJson()
        .put("main", main.toJson())
        .put("fallback", fallback?.toJson() ?: JSONObject.NULL)
        .put("httpUrls", JSONArray(httpUrls))
        .put("imageFormat", imageFormat ?: JSONObject.NULL)
        .put("crop", crop ?: JSONObject.NULL)
        .put("expectedBytes", expectedBytes)
        .put("usedFallback", usedFallback)
        .put("healed", healed)
        .put("titleFromFile", titleFromFile)

    companion object {
        private fun JSONObject.str(key: String): String? = if (isNull(key)) null else optString(key).ifEmpty { null }

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
            )
        }
    }
}
