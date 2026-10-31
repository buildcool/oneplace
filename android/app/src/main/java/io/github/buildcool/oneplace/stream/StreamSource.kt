package io.github.buildcool.oneplace.stream

import android.os.Handler
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.Timeline
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.datasource.TransferListener
import androidx.media3.exoplayer.source.CompositeMediaSource
import androidx.media3.exoplayer.source.MediaPeriod
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.upstream.Allocator
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * A queue item played from a link (YouTube, YT Music…). Its stream is looked up only when the player
 * gets to it, so a long queue costs nothing and the next song is found while the current one plays,
 * also with the screen off. Until then the item shows its title and picture.
 */
@OptIn(UnstableApi::class)
class StreamSource(private val item: MediaItem, private val resolve: suspend () -> MediaSource) : CompositeMediaSource<Void>() {
    @Volatile
    private var error: IOException? = null

    @Volatile
    private var released = false
    private var job: Job? = null
    private var child: MediaSource? = null

    override fun getMediaItem(): MediaItem = item

    override fun prepareSourceInternal(mediaTransferListener: TransferListener?) {
        super.prepareSourceInternal(mediaTransferListener)
        released = false
        error = null
        // The player's own thread: the stream is attached there once it is known.
        val handler: Handler = Util.createHandlerForCurrentLooper()
        job = scope.launch {
            try {
                val source = resolve()
                handler.post {
                    if (released) return@post
                    child = source
                    prepareChildSource(null, source)
                }
            } catch (e: CancellationException) {
                // released
            } catch (e: Throwable) {
                error = e as? IOException ?: IOException(e.message ?: "This can't be played", e)
            }
        }
    }

    override fun maybeThrowSourceInfoRefreshError() {
        error?.let { throw it }
        super.maybeThrowSourceInfoRefreshError()
    }

    override fun onChildSourceInfoRefreshed(childSourceId: Void?, mediaSource: MediaSource, newTimeline: Timeline) {
        refreshSourceInfo(newTimeline)
    }

    override fun createPeriod(id: MediaSource.MediaPeriodId, allocator: Allocator, startPositionUs: Long): MediaPeriod =
        child?.createPeriod(id, allocator, startPositionUs) ?: throw IllegalStateException("stream not ready")

    override fun releasePeriod(mediaPeriod: MediaPeriod) {
        child?.releasePeriod(mediaPeriod)
    }

    override fun releaseSourceInternal() {
        released = true
        job?.cancel()
        job = null
        child = null
        super.releaseSourceInternal()
    }

    companion object {
        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    }
}
