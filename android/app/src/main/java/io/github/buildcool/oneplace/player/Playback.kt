package io.github.buildcool.oneplace.player

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.core.content.ContextCompat
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.VideoSize
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.getcapacitor.JSObject
import com.google.common.util.concurrent.ListenableFuture
import io.github.buildcool.oneplace.engine.InfoCache
import io.github.buildcool.oneplace.stream.StreamSource
import io.github.buildcool.oneplace.stream.Streams
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/** "Film [id].en.srt" → "en" (yt-dlp puts the language before the extension). */
internal fun subtitleLanguage(name: String): String? =
    Regex("""\.([a-zA-Z]{2,3}(?:-[\w]{2,8})?)\.(srt|vtt)$""").find(name)?.groupValues?.get(1)

/**
 * OnePlace's side of the player, used on the main thread. A MediaController keeps [PlayerService] bound
 * (and in front while playing); commands go straight to its ExoPlayer, which lives in the same process.
 */
object Playback {
    private val main = Handler(Looper.getMainLooper())
    private var controller: MediaController? = null
    private var connecting: ListenableFuture<MediaController>? = null
    private val waiting = mutableListOf<(ExoPlayer) -> Unit>()
    private var attached: ExoPlayer? = null

    /** Gets every state change (PlayerPlugin sends it to the UI). */
    @Volatile
    var listener: ((JSObject) -> Unit)? = null

    /** Called when playing starts or stops (the floating window's button follows it). */
    @Volatile
    var onPlaying: ((Boolean) -> Unit)? = null

    var videoShown = false
        private set
    private var subsOn = true

    /** Sleep timer: when to stop (ms since 1970), -1 at the end of this song, 0 off. */
    private var sleepAt = 0L

    /** SponsorBlock: told when a part was skipped ({category, from, to}). */
    @Volatile
    var onSkipped: ((JSObject) -> Unit)? = null
    private var app: Context? = null
    private var mediaFactory: DefaultMediaSourceFactory? = null

    /** Items played from links: what they were loaded with, to look a link up again when it expires. */
    private val specs = HashMap<String, JSONObject>()
    private val retried = HashMap<String, Long>()
    private val skipped = HashSet<String>()

    /** Highest picture height picked in the player (-1: automatic for the network). */
    private var manualCap = -1

    fun current(): ExoPlayer? = attached?.takeIf { it === PlayerService.current }

    /** Run [block] with the player, starting the service first if needed. */
    fun withPlayer(ctx: Context, block: (ExoPlayer) -> Unit) {
        val p = PlayerService.current
        if (p != null && controller?.isConnected == true) {
            attach(p)
            block(p)
            return
        }
        waiting += block
        if (connecting != null) return
        val app = ctx.applicationContext
        val f = MediaController.Builder(app, SessionToken(app, ComponentName(app, PlayerService::class.java))).buildAsync()
        connecting = f
        f.addListener({
            connecting = null
            val c = runCatching { f.get() }.getOrNull()
            val todo = waiting.toList()
            waiting.clear()
            val exo = PlayerService.current
            if (c == null || exo == null) return@addListener
            controller?.takeIf { it !== c }?.release()
            controller = c
            attach(exo)
            todo.forEach { runCatching { it(exo) } }
            emit()
        }, ContextCompat.getMainExecutor(app))
    }

    private fun attach(p: ExoPlayer) {
        if (attached === p) return
        attached?.removeListener(events)
        p.addListener(events)
        attached = p
    }

    @OptIn(UnstableApi::class)
    fun load(ctx: Context, items: JSONArray, index: Int, positionMs: Long, video: Boolean): Unit = withPlayer(ctx) { p ->
        val list = sources(ctx, items)
        if (list.isEmpty()) return@withPlayer
        sleepAt = 0
        manualCap = -1
        skipped.clear()
        setVideo(p, video)
        applyQuality(p)
        p.setMediaSources(list, index.coerceIn(0, list.size - 1), positionMs.coerceAtLeast(0))
        p.prepare()
        p.play()
    }

    /** More items at the end of the queue (the next songs of a radio, "Up next"). */
    @OptIn(UnstableApi::class)
    fun append(ctx: Context, items: JSONArray): Unit = withPlayer(ctx) { p ->
        val list = sources(ctx, items)
        if (list.isNotEmpty()) p.addMediaSources(list)
        emit()
    }

    @OptIn(UnstableApi::class)
    private fun sources(ctx: Context, items: JSONArray): List<MediaSource> {
        val a = ctx.applicationContext
        app = a
        val factory = mediaFactory ?: DefaultMediaSourceFactory(a).also { mediaFactory = it }
        return (0 until items.length()).map { i ->
            val o = items.getJSONObject(i)
            if (o.optBoolean("stream")) streamSource(a, o) else factory.createMediaSource(item(o))
        }
    }

    @OptIn(UnstableApi::class)
    private fun streamSource(ctx: Context, o: JSONObject): MediaSource {
        specs[o.getString("id")] = o
        return StreamSource(item(o)) { Streams.resolve(ctx, o) }
    }

    /** Quality limit for streams: the one picked in the player, else the network's (Wi-Fi / mobile data). */
    private fun applyQuality(p: ExoPlayer) {
        val cap = if (manualCap >= 0) manualCap else app?.let { Streams.cap(it) } ?: 0
        val size = p.videoSize
        val b = p.trackSelectionParameters.buildUpon()
        when {
            cap <= 0 -> b.clearVideoSizeConstraints()
            // Upright videos (Shorts) are limited by their width, like "720p" means for them.
            size.width in 1 until size.height -> b.setMaxVideoSize(cap, Int.MAX_VALUE)
            else -> b.setMaxVideoSize(Int.MAX_VALUE, cap)
        }
        p.trackSelectionParameters = b.build()
    }

    /** Heights of the qualities the current stream has (for the player's quality menu). */
    private fun heights(p: ExoPlayer): JSONArray {
        val out = sortedSetOf<Int>(compareByDescending { it })
        for (g in p.currentTracks.groups) {
            if (g.type != C.TRACK_TYPE_VIDEO) continue
            for (i in 0 until g.length) g.getTrackFormat(i).height.takeIf { it > 0 }?.let { h -> out += minOf(h, g.getTrackFormat(i).width.takeIf { it > 0 } ?: h) }
        }
        return JSONArray(out.toList())
    }

    private fun item(o: JSONObject): MediaItem {
        val art = o.optString("art").ifEmpty { null }?.let { if (it.startsWith("/")) Uri.fromFile(File(it)) else Uri.parse(it) }
        val meta = MediaMetadata.Builder()
            .setTitle(o.optString("title"))
            .setArtist(o.optString("artist").ifEmpty { null })
            .setArtworkUri(art)
            .build()
        val subs = o.optJSONArray("subs")?.let { a -> (0 until a.length()).map { a.getJSONObject(it) } }.orEmpty().map { s ->
            val name = s.optString("name")
            MediaItem.SubtitleConfiguration.Builder(Uri.parse(s.getString("uri")))
                .setMimeType(if (name.endsWith(".vtt", ignoreCase = true)) MimeTypes.TEXT_VTT else MimeTypes.APPLICATION_SUBRIP)
                .setLanguage(subtitleLanguage(name))
                .setLabel(subtitleLanguage(name))
                .setSelectionFlags(C.SELECTION_FLAG_DEFAULT)
                .build()
        }
        return MediaItem.Builder()
            .setMediaId(o.getString("id"))
            .setUri(Uri.parse(o.getString("uri")))
            .setMediaMetadata(meta)
            .setSubtitleConfigurations(subs)
            .build()
    }

    @OptIn(UnstableApi::class)
    fun control(ctx: Context, action: String, value: Double): Unit = withPlayer(ctx) { p ->
        when (action) {
            "play" -> {
                if (p.playbackState == Player.STATE_ENDED) p.seekTo(0)
                if (p.playbackState == Player.STATE_IDLE) p.prepare()
                p.play()
            }
            "pause" -> p.pause()
            "toggle" -> if (p.isPlaying) p.pause() else control(ctx, "play", 0.0)
            "seek" -> p.seekTo((value * 1000).toLong().coerceAtLeast(0))
            "seekBy" -> {
                val to = p.currentPosition + (value * 1000).toLong()
                val dur = p.duration.takeIf { it != C.TIME_UNSET } ?: Long.MAX_VALUE
                p.seekTo(to.coerceIn(0, dur))
            }
            "next" -> if (p.hasNextMediaItem()) p.seekToNextMediaItem()
            "prev" -> if (p.currentPosition > 3000 || !p.hasPreviousMediaItem()) p.seekTo(0) else p.seekToPreviousMediaItem()
            "jump" -> value.toInt().takeIf { it in 0 until p.mediaItemCount }?.let { p.seekTo(it, 0) }
            "speed" -> p.playbackParameters = PlaybackParameters(value.toFloat().coerceIn(0.25f, 3f))
            "shuffle" -> p.shuffleModeEnabled = value != 0.0
            "repeat" -> p.repeatMode = when (value.toInt()) {
                1 -> Player.REPEAT_MODE_ALL
                2 -> Player.REPEAT_MODE_ONE
                else -> Player.REPEAT_MODE_OFF
            }
            "sleep" -> {
                sleepAt = when {
                    value > 0 -> System.currentTimeMillis() + (value * 60_000).toLong()
                    value < 0 -> -1
                    else -> 0
                }
                tick()
            }
            // Dragging the seek bar or swiping: the picture follows the finger (Media3 scrubbing mode keeps
            // the many seeks cheap and holds playback), then one exact seek where the finger stopped.
            "scrubStart" -> p.isScrubbingModeEnabled = true
            "scrub" -> p.seekTo((value * 1000).toLong().coerceAtLeast(0))
            "scrubEnd" -> {
                p.isScrubbingModeEnabled = false
                p.seekTo((value * 1000).toLong().coerceAtLeast(0))
            }
            "quality" -> {
                manualCap = value.toInt()
                applyQuality(p)
            }
            "subs" -> {
                subsOn = value != 0.0
                p.trackSelectionParameters = p.trackSelectionParameters.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, !subsOn).build()
            }
            "stop" -> {
                sleepAt = 0
                p.isScrubbingModeEnabled = false
                p.stop()
                p.clearMediaItems()
            }
        }
        emit()
    }

    /** Picture on screen, or sound only (the video track is switched off so the phone does not decode it). */
    fun setVideo(p: ExoPlayer, show: Boolean) {
        videoShown = show
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_VIDEO, !show).build()
        emit()
    }

    fun state(): JSObject {
        val p = current() ?: return JSObject().put("idle", true).put("video", false).put("subs", subsOn).put("sleepAt", sleepAt)
        val dur = p.duration
        val o = JSObject()
            .put("index", p.currentMediaItemIndex)
            .put("count", p.mediaItemCount)
            .put("playing", p.isPlaying)
            .put("playWhenReady", p.playWhenReady)
            .put("buffering", p.playbackState == Player.STATE_BUFFERING)
            .put("ended", p.playbackState == Player.STATE_ENDED)
            .put("idle", p.mediaItemCount == 0 || (p.playbackState == Player.STATE_IDLE && p.playerError == null))
            .put("position", p.currentPosition / 1000.0)
            .put("duration", if (dur == C.TIME_UNSET) 0.0 else dur / 1000.0)
            .put("buffered", p.bufferedPosition / 1000.0)
            .put("speed", p.playbackParameters.speed.toDouble())
            .put("shuffle", p.shuffleModeEnabled)
            .put(
                "repeat",
                when (p.repeatMode) {
                    Player.REPEAT_MODE_ONE -> "one"
                    Player.REPEAT_MODE_ALL -> "all"
                    else -> "off"
                },
            )
            .put("videoW", p.videoSize.width)
            .put("videoH", p.videoSize.height)
            .put("video", videoShown)
            .put("subs", subsOn)
            .put("sleepAt", sleepAt)
            .put("live", p.isCurrentMediaItemLive)
            .put("heights", heights(p))
            .put("quality", manualCap)
        p.currentMediaItem?.mediaId?.let { o.put("id", it) }
        p.playerError?.let { o.put("error", it.errorCodeName + (it.message?.let { m -> ": $m" } ?: "")) }
        return o
    }

    private fun emit() {
        listener?.invoke(state())
    }

    private val events = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) {
            emit()
            if (player.isPlaying) tick()
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            onPlaying?.invoke(isPlaying)
        }

        override fun onVideoSizeChanged(videoSize: VideoSize) {
            current()?.let { if (manualCap > 0 || (app?.let { a -> Streams.cap(a) } ?: 0) > 0) applyQuality(it) }
        }

        /** A link that expired (403 after hours on pause): look it up again and go on at the same second. */
        @OptIn(UnstableApi::class)
        override fun onPlayerError(error: PlaybackException) {
            val p = current() ?: return
            val ctx = app ?: return
            val id = p.currentMediaItem?.mediaId ?: return
            val spec = specs[id] ?: return
            var cause: Throwable? = error
            while (cause != null && cause !is HttpDataSource.InvalidResponseCodeException) cause = cause.cause
            val code = (cause as? HttpDataSource.InvalidResponseCodeException)?.responseCode ?: return
            if (code != 403 && code != 410) return
            val now = System.currentTimeMillis()
            if (now - (retried[id] ?: 0L) < 60_000) return
            retried[id] = now
            InfoCache.drop(ctx, spec.getString("uri"))
            val i = p.currentMediaItemIndex
            val at = p.currentPosition
            p.removeMediaItem(i)
            p.addMediaSource(i, streamSource(ctx, spec))
            p.seekTo(i, at)
            p.prepare()
            p.play()
        }

        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            // Sleep timer "after this song".
            if (sleepAt == -1L && reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO) {
                sleepAt = 0
                current()?.pause()
            }
        }
    }

    /** While playing: report the time four times a second and run the sleep timer. */
    private val ticker = object : Runnable {
        override fun run() {
            val p = current() ?: return
            if (sleepAt > 0 && System.currentTimeMillis() >= sleepAt) {
                sleepAt = 0
                p.pause()
            }
            skipSponsors(p)
            emit()
            if (p.isPlaying) main.postDelayed(this, 250)
        }
    }

    /** Jump over a part SponsorBlock marked (once per play, so going back to it lets it play). */
    private fun skipSponsors(p: ExoPlayer) {
        val id = p.currentMediaItem?.mediaId ?: return
        val segs = Streams.skips[id] ?: return
        val pos = p.currentPosition / 1000.0
        val s = segs.firstOrNull { pos >= it.start && pos < it.end - 0.4 } ?: return
        if (!skipped.add("$id@${s.start}")) return
        p.seekTo((s.end * 1000).toLong())
        onSkipped?.invoke(JSObject().put("category", s.category).put("from", s.start).put("to", s.end))
    }

    private fun tick() {
        main.removeCallbacks(ticker)
        main.postDelayed(ticker, 250)
    }

    /** The UI is gone for good: let the service run on its own (music keeps playing). */
    fun disconnect() {
        main.removeCallbacks(ticker)
        attached?.removeListener(events)
        attached = null
        controller?.release()
        controller = null
    }
}
