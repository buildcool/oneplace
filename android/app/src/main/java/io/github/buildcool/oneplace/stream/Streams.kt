package io.github.buildcool.oneplace.stream

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.MergingMediaSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import io.github.buildcool.oneplace.engine.Engines
import io.github.buildcool.oneplace.engine.Net
import io.github.buildcool.oneplace.queue.Keepalive
import io.github.buildcool.oneplace.queue.strings
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import org.json.JSONObject

/**
 * Playing links instead of files: yt-dlp finds the stream (YouTube with its quick client), StreamPicker
 * chooses one, and it becomes a player source with the stream's own headers. Nothing else is loaded,
 * so there are no ads. Also fetches SponsorBlock's parts to skip.
 */
@OptIn(UnstableApi::class)
object Streams {
    /** Highest picture height on Wi-Fi and on mobile data (0: no limit). Set by the app. */
    @Volatile
    var capWifi = 0

    @Volatile
    var capMobile = 720

    /** SponsorBlock parts to skip, by queue item id. */
    val skips = ConcurrentHashMap<String, List<SponsorBlock.Segment>>()

    fun cap(ctx: Context): Int = if (Keepalive.unmetered(ctx)) capWifi else capMobile

    /** The source for one queue item {id, uri (the link), site, audioOnly, skip: [categories]}. */
    suspend fun resolve(ctx: Context, o: JSONObject): MediaSource {
        val url = o.getString("uri")
        val info = Engines.streamInfo(ctx, url, o.optString("site", "other"))
        val pick = StreamPicker.pick(info, o.optBoolean("audioOnly"), cap(ctx)) ?: throw IOException("Nothing playable in this link")
        val cats = o.optJSONArray("skip").strings()
        val id = StreamPicker.youtubeId(url)
        if (cats.isNotEmpty() && id != null) skips[o.getString("id")] = SponsorBlock.fetch(id, cats)
        return sourceFor(pick)
    }

    private fun http(headers: Map<String, String>): DefaultHttpDataSource.Factory =
        DefaultHttpDataSource.Factory()
            .setUserAgent(headers.entries.firstOrNull { it.key.equals("User-Agent", ignoreCase = true) }?.value ?: Net.UA)
            .setDefaultRequestProperties(headers.filterKeys { !it.equals("User-Agent", ignoreCase = true) && !it.equals("Accept-Encoding", ignoreCase = true) })
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(25_000)

    private fun files(headers: Map<String, String>, chunked: Boolean): DataSource.Factory =
        if (chunked) ChunkedDataSource.Factory(http(headers)) else http(headers)

    fun sourceFor(pick: StreamPicker.Pick): MediaSource {
        fun file(url: String, headers: Map<String, String>) = ProgressiveMediaSource.Factory(files(headers, pick.chunked)).createMediaSource(MediaItem.fromUri(url))
        return when (pick.kind) {
            "hls" -> HlsMediaSource.Factory(http(pick.headers)).createMediaSource(MediaItem.Builder().setUri(pick.url).setMimeType(MimeTypes.APPLICATION_M3U8).build())
            "merge" -> MergingMediaSource(true, file(pick.url, pick.headers), file(pick.audioUrl!!, pick.audioHeaders))
            else -> file(pick.url, pick.headers)
        }
    }
}
