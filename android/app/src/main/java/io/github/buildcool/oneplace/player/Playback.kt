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

    fun load(ctx: Context, items: JSONArray, index: Int, positionMs: Long, video: Boolean): Unit = withPlayer(ctx) { p ->
        val list = (0 until items.length()).map { item(items.getJSONObject(it)) }
        if (list.isEmpty()) return@withPlayer
        sleepAt = 0
        setVideo(p, video)
        p.setMediaItems(list, index.coerceIn(0, list.size - 1), positionMs.coerceAtLeast(0))
        p.prepare()
        p.play()
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
            emit()
            if (p.isPlaying) main.postDelayed(this, 250)
        }
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
