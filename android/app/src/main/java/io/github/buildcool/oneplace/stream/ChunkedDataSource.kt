package io.github.buildcool.oneplace.stream

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.TransferListener

/**
 * Reads a long file in pieces of at most [chunk] bytes, one request each, like yt-dlp does for YouTube:
 * YouTube slows down or drops single requests that run past ~10 MB. To the player it is one stream.
 */
@OptIn(UnstableApi::class)
class ChunkedDataSource(private val upstream: HttpDataSource, private val chunk: Long = CHUNK) : DataSource {
    private var spec: DataSpec? = null
    private var pos = 0L
    private var end = UNSET
    private var chunkEnd = 0L
    private var total = UNSET
    private var opened = false

    override fun addTransferListener(transferListener: TransferListener) = upstream.addTransferListener(transferListener)

    override fun open(dataSpec: DataSpec): Long {
        spec = dataSpec
        pos = dataSpec.position
        end = if (dataSpec.length == C.LENGTH_UNSET.toLong()) UNSET else dataSpec.position + dataSpec.length
        total = UNSET
        openPiece()
        return when {
            end != UNSET -> end - dataSpec.position
            total != UNSET -> total - dataSpec.position
            else -> C.LENGTH_UNSET.toLong()
        }
    }

    private fun openPiece() {
        val s = spec ?: return
        val want = nextLength(pos, end, chunk)
        upstream.open(s.subrange(pos - s.position, want))
        opened = true
        chunkEnd = pos + want
        if (total == UNSET) total = totalOf(upstream.responseHeaders)
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        while (true) {
            val n = upstream.read(buffer, offset, length)
            if (n != C.RESULT_END_OF_INPUT) {
                pos += n
                return n
            }
            if (!more(pos, chunkEnd, end, total)) return C.RESULT_END_OF_INPUT
            upstream.close()
            openPiece()
        }
    }

    override fun getUri(): Uri? = upstream.uri

    override fun getResponseHeaders(): Map<String, List<String>> = upstream.responseHeaders

    override fun close() {
        if (!opened) return
        opened = false
        upstream.close()
    }

    class Factory(private val upstream: HttpDataSource.Factory, private val chunk: Long = CHUNK) : DataSource.Factory {
        override fun createDataSource(): DataSource = ChunkedDataSource(upstream.createDataSource(), chunk)
    }

    companion object {
        const val CHUNK = 10L * 1024 * 1024
        const val UNSET = -1L

        /** Bytes to ask for next: a full piece, or what is left of a bounded request. */
        fun nextLength(pos: Long, end: Long, chunk: Long): Long = if (end == UNSET) chunk else minOf(chunk, end - pos)

        /** After a piece ended at [pos]: is there more to read? (A short piece means the file ended.) */
        fun more(pos: Long, chunkEnd: Long, end: Long, total: Long): Boolean =
            pos >= chunkEnd && (end == UNSET || pos < end) && (total == UNSET || pos < total)

        /** "Content-Range: bytes 0-1048575/34567890" → 34567890. */
        fun totalOf(headers: Map<String, List<String>>): Long {
            val v = headers.entries.firstOrNull { it.key.equals("Content-Range", ignoreCase = true) }?.value?.firstOrNull() ?: return UNSET
            return v.substringAfterLast('/').trim().toLongOrNull() ?: UNSET
        }
    }
}
