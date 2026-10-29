package io.github.buildcool.oneplace.engine

import java.util.Locale
import org.json.JSONObject

/**
 * Reads yt-dlp's output while it downloads. Progress lines come from our --progress-template
 * ("[op] downloaded total speed eta"); "Destination:" lines tell which stream (video, then audio) is running.
 * Pure Kotlin, so it is unit-tested on the JVM.
 */
class Progress(private val streams: Int) {
    var percent = -1.0
        private set
    var eta = -1L
        private set
    var speed: String? = null
        private set
    /** File name (no folder) of the newest "Destination:" line. */
    var destination: String? = null
        private set
    /** True once ffmpeg post-processing (merge, convert, embed) has started. */
    var processing = false
        private set

    private var stream = 0
    private var destsInItem = 0
    private var item = 1
    private var items = 1

    /** Returns true when something the UI shows has changed. */
    fun feed(line: String): Boolean {
        val l = line.trim()
        if (l.startsWith(MARK)) return progressLine(l.removePrefix(MARK).trim())
        ITEM.find(l)?.let { m ->
            item = m.groupValues[1].toInt()
            items = m.groupValues[2].toInt().coerceAtLeast(1)
            stream = 0
            destsInItem = 0
            processing = false
            return true
        }
        DEST.find(l)?.let { m ->
            if (!l.startsWith("[download]")) {
                processing = true
                return true
            }
            destination = m.groupValues[1].substringAfterLast('/')
            // first file of an item is the video (or the only stream), the next one the audio
            stream = destsInItem++
            processing = false
            return true
        }
        if (POST.containsMatchIn(l)) {
            processing = true
            percent = maxOf(percent, overall(1.0))
            return true
        }
        return false
    }

    private fun progressLine(rest: String): Boolean {
        val p = rest.split(' ')
        val done = p.getOrNull(0)?.toDoubleOrNull() ?: return false
        val total = p.getOrNull(1)?.toDoubleOrNull()
        val bps = p.getOrNull(2)?.toDoubleOrNull()
        eta = p.getOrNull(3)?.toDoubleOrNull()?.toLong() ?: -1L
        speed = bps?.let(::speedText)
        if (total != null && total > 0) percent = overall((done / total).coerceIn(0.0, 1.0))
        return true
    }

    /** Video gets 85 % of the bar and audio 15 % when two streams are merged; playlists split it per item. */
    private fun overall(fraction: Double): Double {
        val inItem = if (streams >= 2) {
            if (stream == 0) fraction * 0.85 else 0.85 + 0.15 * fraction
        } else fraction
        return ((item - 1 + inItem) / items * 100).coerceIn(0.0, 100.0)
    }

    /** What yt-dlp told us about a finished file. */
    class FileLine(
        val path: String,
        val title: String? = null,
        val thumbnail: String? = null,
        val duration: Double = 0.0,
        val width: Int = 0,
        val height: Int = 0,
        val artist: String? = null,
    )

    companion object {
        const val MARK = "[op]"

        /** Printed by yt-dlp (--print after_move) once a file is completely finished, with what we know about it. */
        const val FILE_MARK = "[opfile]"

        /** Printed by yt-dlp (--print before_dl) when an item starts downloading: its title and picture. */
        const val INFO_MARK = "[opinfo]"

        /** The two --print options added to every yt-dlp download. JSON keeps any title safe on one line. */
        val PRINTS = listOf(
            "--print", "before_dl:$INFO_MARK %(.{title,thumbnail})j",
            "--print", "after_move:$FILE_MARK %(.{filepath,title,thumbnail,duration,width,height,uploader,channel,artist})j",
        )

        fun fileLine(line: String): FileLine? {
            if (!line.startsWith(FILE_MARK)) return null
            val rest = line.removePrefix(FILE_MARK).trim()
            if (!rest.startsWith("{")) return rest.takeIf { it.isNotEmpty() }?.let { FileLine(it) }
            val o = runCatching { JSONObject(rest) }.getOrNull() ?: return null
            val path = o.text("filepath") ?: return null
            return FileLine(
                path = path,
                title = o.text("title"),
                thumbnail = o.text("thumbnail")?.takeIf { it.startsWith("http") },
                duration = o.optDouble("duration", 0.0).takeUnless { it.isNaN() } ?: 0.0,
                width = o.optInt("width"),
                height = o.optInt("height"),
                artist = o.text("artist") ?: o.text("uploader") ?: o.text("channel"),
            )
        }

        /** Title and picture of the item that is starting (null when the line is something else). */
        fun infoLine(line: String): Pair<String?, String?>? {
            if (!line.startsWith(INFO_MARK)) return null
            val o = runCatching { JSONObject(line.removePrefix(INFO_MARK).trim()) }.getOrNull() ?: return Pair(null, null)
            return Pair(o.text("title"), o.text("thumbnail")?.takeIf { it.startsWith("http") })
        }

        private fun JSONObject.text(key: String): String? =
            if (!has(key) || isNull(key)) null else optString(key).trim().takeIf { it.isNotEmpty() && it != "NA" }

        /** Appended to every yt-dlp download so progress is machine-readable. */
        const val TEMPLATE =
            "download:[op] %(progress.downloaded_bytes)s %(progress.total_bytes,progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s"

        private val ITEM = Regex("""Downloading item (\d+) of (\d+)""")
        private val DEST = Regex("""Destination: (.+)$""")
        private val POST = Regex("""^\[(Merger|ExtractAudio|EmbedThumbnail|Metadata|FixupM\w+|ThumbnailsConvertor|VideoConvertor|VideoRemuxer|SplitChapters|ModifyChapters|SponsorBlock)]""")

        fun speedText(bps: Double): String {
            val units = arrayOf("B/s", "KB/s", "MB/s", "GB/s")
            var v = bps
            var i = 0
            while (v >= 1000 && i < units.size - 1) {
                v /= 1024
                i++
            }
            return if (v >= 10 || i == 0) "${v.toInt()} ${units[i]}" else String.format(Locale.US, "%.1f %s", v, units[i])
        }

        /** Two streams (video + audio) when the first -f choice merges ("137+140/…" or "bv*+ba/b"). */
        fun streamsOf(args: List<String>): Int {
            val i = args.indexOf("-f")
            if (i < 0 || i + 1 >= args.size) return 1
            if (args.contains("-x")) return 1
            return if (args[i + 1].substringBefore('/').contains('+')) 2 else 1
        }

        /** "Title.f137.mp4" → "Title". */
        fun titleOf(fileName: String): String =
            fileName.substringBeforeLast('.').replace(Regex("""\.f\d+(-\d+)?$"""), "").trim()
    }
}
