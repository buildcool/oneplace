package io.github.buildcool.oneplace.edit

import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.CRC32
import java.util.zip.Inflater

/** Bytes of a file somewhere: a web server answering range requests, or a local file in tests. */
interface RangeSource {
    val size: Long

    /** Bytes [start]..[endInclusive]; the caller closes the stream. */
    fun open(start: Long, endInclusive: Long): InputStream
}

class HttpRange(private val url: String, private val userAgent: String) : RangeSource {
    override val size: Long by lazy {
        val c = connect("HEAD", null)
        try {
            if (c.responseCode !in 200..299) throw IOException("HTTP ${c.responseCode} for $url")
            c.contentLengthLong.takeIf { it > 0 } ?: throw IOException("No size for $url")
        } finally {
            c.disconnect()
        }
    }

    override fun open(start: Long, endInclusive: Long): InputStream {
        val c = connect("GET", "bytes=$start-$endInclusive")
        if (c.responseCode != 206) {
            c.disconnect()
            throw IOException("HTTP ${c.responseCode} (range not supported) for $url")
        }
        return c.inputStream
    }

    private fun connect(method: String, range: String?): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15_000
            readTimeout = 30_000
            setRequestProperty("User-Agent", userAgent)
            if (range != null) setRequestProperty("Range", range)
        }
}

/**
 * Reads one file out of a zip (an AAR on Maven Central) with range requests: the directory at the end, then
 * only that file's bytes. Plain ZIP only (no ZIP64), stored or deflated entries.
 */
class RemoteZip(private val src: RangeSource) {
    class Entry(val name: String, val method: Int, val compressedSize: Long, val size: Long, val crc: Long, val headerOffset: Long)

    fun entries(): List<Entry> {
        val tailLen = minOf(src.size, 65_557L).toInt()
        val tail = read(src.size - tailLen, tailLen)
        var eocd = -1
        for (i in tailLen - 22 downTo 0) {
            if (tail.getInt(i) == 0x06054b50) {
                eocd = i
                break
            }
        }
        if (eocd < 0) throw IOException("Not a zip file")
        val count = tail.getShort(eocd + 10).toInt() and 0xffff
        val dirSize = tail.getInt(eocd + 12).toLong() and 0xffffffffL
        val dirOffset = tail.getInt(eocd + 16).toLong() and 0xffffffffL
        val dir = read(dirOffset, dirSize.toInt())
        val list = ArrayList<Entry>(count)
        var p = 0
        repeat(count) {
            if (dir.getInt(p) != 0x02014b50) throw IOException("Broken zip directory")
            val nameLen = dir.getShort(p + 28).toInt() and 0xffff
            val extraLen = dir.getShort(p + 30).toInt() and 0xffff
            val commentLen = dir.getShort(p + 32).toInt() and 0xffff
            val name = String(dir.array(), p + 46, nameLen, Charsets.UTF_8)
            list += Entry(
                name = name,
                method = dir.getShort(p + 10).toInt() and 0xffff,
                compressedSize = dir.getInt(p + 20).toLong() and 0xffffffffL,
                size = dir.getInt(p + 24).toLong() and 0xffffffffL,
                crc = dir.getInt(p + 16).toLong() and 0xffffffffL,
                headerOffset = dir.getInt(p + 42).toLong() and 0xffffffffL,
            )
            p += 46 + nameLen + extraLen + commentLen
        }
        return list
    }

    /** Writes the entry's contents to [out], checking its CRC. [onBytes] gets compressed bytes read so far. */
    fun extract(e: Entry, out: OutputStream, onBytes: (Long) -> Unit = {}) {
        val header = read(e.headerOffset, 30)
        if (header.getInt(0) != 0x04034b50) throw IOException("Broken zip entry ${e.name}")
        val dataStart = e.headerOffset + 30 + (header.getShort(26).toInt() and 0xffff) + (header.getShort(28).toInt() and 0xffff)
        val crc = CRC32()
        var written = 0L
        src.open(dataStart, dataStart + e.compressedSize - 1).use { input ->
            val buf = ByteArray(1 shl 16)
            when (e.method) {
                0 -> {
                    var left = e.compressedSize
                    while (left > 0) {
                        val n = input.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
                        if (n < 0) throw EOFException("Download ended early")
                        out.write(buf, 0, n)
                        crc.update(buf, 0, n)
                        left -= n
                        written += n
                        onBytes(e.compressedSize - left)
                    }
                }
                8 -> {
                    val inf = Inflater(true)
                    val outBuf = ByteArray(1 shl 16)
                    var left = e.compressedSize
                    var padded = false
                    try {
                        while (!inf.finished()) {
                            if (inf.needsInput()) {
                                if (left > 0) {
                                    val n = input.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
                                    if (n < 0) throw EOFException("Download ended early")
                                    left -= n
                                    inf.setInput(buf, 0, n)
                                    onBytes(e.compressedSize - left)
                                } else if (!padded) {
                                    // Raw deflate may want one extra byte to see its end.
                                    padded = true
                                    inf.setInput(ByteArray(1), 0, 1)
                                } else {
                                    throw EOFException("Broken compressed data in ${e.name}")
                                }
                            }
                            val n = inf.inflate(outBuf)
                            if (n > 0) {
                                out.write(outBuf, 0, n)
                                crc.update(outBuf, 0, n)
                                written += n
                            } else if (inf.needsDictionary()) {
                                throw IOException("Unsupported zip data in ${e.name}")
                            }
                        }
                    } finally {
                        inf.end()
                    }
                }
                else -> throw IOException("Unsupported zip method ${e.method}")
            }
        }
        if (written != e.size || crc.value != e.crc) throw IOException("${e.name} arrived damaged")
    }

    private fun read(start: Long, len: Int): ByteBuffer {
        val bytes = ByteArray(len)
        src.open(start, start + len - 1).use { input ->
            var off = 0
            while (off < len) {
                val n = input.read(bytes, off, len - off)
                if (n < 0) throw EOFException("Download ended early")
                off += n
            }
        }
        return ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    }
}
