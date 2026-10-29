package io.github.buildcool.oneplace

import io.github.buildcool.oneplace.edit.PcmIn
import io.github.buildcool.oneplace.edit.PcmOut
import io.github.buildcool.oneplace.edit.RangeSource
import io.github.buildcool.oneplace.edit.RealFft
import io.github.buildcool.oneplace.edit.RemoteZip
import io.github.buildcool.oneplace.edit.Spleeter
import io.github.buildcool.oneplace.edit.StemModels
import io.github.buildcool.oneplace.edit.VocalRemover
import io.github.buildcool.oneplace.engine.Progress
import io.github.buildcool.oneplace.player.subtitleLanguage
import io.github.buildcool.oneplace.queue.JobFile
import io.github.buildcool.oneplace.storage.Thumbs
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.Random
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MediaLogicTest {
    /** Interleaved samples at each end where one frame covers a sample (they fade in/out). */
    private val EDGE = 2 * Spleeter.N_FFT

    @Test
    fun realFftMatchesTheDefinitionAndInverts() {
        val n = 64
        val r = Random(1)
        val x = FloatArray(n) { r.nextFloat() * 2 - 1 }
        val re = FloatArray(n / 2 + 1)
        val im = FloatArray(n / 2 + 1)
        val fft = RealFft(n)
        fft.forward(x, 0, re, im, 0)
        for (k in 0..n / 2) {
            var sr = 0.0
            var si = 0.0
            for (t in 0 until n) {
                sr += x[t] * cos(2 * PI * k * t / n)
                si -= x[t] * sin(2 * PI * k * t / n)
            }
            assertEquals("re $k", sr, re[k].toDouble(), 1e-4)
            assertEquals("im $k", si, im[k].toDouble(), 1e-4)
        }
        val back = FloatArray(n)
        fft.inverse(re, im, 0, back, 0)
        for (t in 0 until n) assertEquals(x[t], back[t], 1e-5f)
    }

    /** A fake network: the "voice" is a smooth share of each bin, the rest is music (shapes like Spleeter's). */
    private class FakeModels : StemModels {
        var calls = 0
        var lastX: FloatArray? = null

        override fun run(x: FloatArray): Pair<FloatArray, FloatArray> {
            calls++
            lastX = x.copyOf()
            val v = FloatArray(x.size) { i -> x[i] * (0.2f + 0.6f * abs(sin(i * 0.37f))) }
            val a = FloatArray(x.size) { i -> x[i] * (0.3f + 0.5f * abs(cos(i * 0.11f))) }
            return Pair(v, a)
        }
    }

    private class Source(private val pcm: FloatArray, private val chunk: Int) : PcmIn {
        private var pos = 0

        override fun read(buf: FloatArray, frames: Int): Int {
            val left = pcm.size / 2 - pos
            if (left <= 0) return -1
            val n = minOf(frames, chunk, left)
            System.arraycopy(pcm, pos * 2, buf, 0, n * 2)
            pos += n
            return n
        }
    }

    private class Sink : PcmOut {
        private var all = FloatArray(1 shl 16)
        private var n = 0

        override fun write(buf: FloatArray, frames: Int) {
            if (n + frames * 2 > all.size) all = all.copyOf(maxOf(all.size * 2, n + frames * 2))
            System.arraycopy(buf, 0, all, n, frames * 2)
            n += frames * 2
        }

        fun samples() = all.copyOf(n)
    }

    @Test
    fun voiceAndMusicAddUpToTheSongAcrossBlocks() {
        val r = Random(2)
        val frames = Spleeter.SPAN + 300_000 // more than one block
        val mix = FloatArray(frames * 2) { (r.nextFloat() * 2 - 1) * 0.5f }
        val models = FakeModels()
        val voice = Sink()
        val music = Sink()
        val written = Spleeter(models).separate(Source(mix, 7_777), voice, music, frames.toLong(), {}, { false })
        assertEquals(frames.toLong(), written)
        assertEquals(2, models.calls)
        val v = voice.samples()
        val m = music.samples()
        assertEquals(mix.size, v.size)
        assertEquals(mix.size, m.size)
        // The first and last few samples have (almost) no window weight and come out silent, as intended.
        var worst = 0f
        for (i in EDGE until mix.size - EDGE) worst = maxOf(worst, abs(v[i] + m[i] - mix[i]))
        assertTrue("worst $worst", worst < 2e-3f)
    }

    @Test
    fun soundEndingRightAfterABlockIsWrittenCompletely() {
        // EOF is only noticed after a full block: the last ~70 ms must still come out.
        for (frames in listOf(Spleeter.SPAN, Spleeter.SPAN + Spleeter.BLOCK * Spleeter.HOP)) {
            val r = Random(frames.toLong())
            val mix = FloatArray(frames * 2) { r.nextFloat() - 0.5f }
            val voice = Sink()
            val music = Sink()
            val written = Spleeter(FakeModels()).separate(Source(mix, 4096), voice, music, frames.toLong(), {}, { false })
            assertEquals(frames.toLong(), written)
            val v = voice.samples()
            val m = music.samples()
            assertEquals(mix.size, m.size)
            var worst = 0f
            for (i in EDGE until mix.size - EDGE) worst = maxOf(worst, abs(v[i] + m[i] - mix[i]))
            assertTrue("worst $worst", worst < 2e-3f)
            // The edges fade instead of clicking: no division by a near-zero window weight.
            for (i in 0 until EDGE) assertTrue("edge ${v[i]} ${m[mix.size - 1 - i]}", abs(v[i]) <= 4f && abs(m[mix.size - 1 - i]) <= 4f)
        }
    }

    @Test
    fun theNetworkSeesBinsInChannelFrameBinOrder() {
        // A 1077 Hz tone (bin 100) on the left only.
        val frames = 30_000
        val bin = 100
        val mix = FloatArray(frames * 2) { i -> if (i % 2 == 0) sin(2 * PI * bin * (i / 2) / Spleeter.N_FFT).toFloat() else 0f }
        val models = FakeModels()
        Spleeter(models).separate(Source(mix, 4096), null, Sink(), frames.toLong(), {}, { false })
        val x = models.lastX!!
        val left = (0 until Spleeter.MODEL_BINS).maxByOrNull { x[3 * Spleeter.MODEL_BINS + it] }
        assertEquals(bin, left)
        val right = (0 until Spleeter.MODEL_BINS).maxOf { x[Spleeter.BLOCK * Spleeter.MODEL_BINS + 3 * Spleeter.MODEL_BINS + it] }
        assertTrue(right < 1e-3f)
        // Frames after the end of the sound stay silent.
        assertEquals(0f, x[(Spleeter.BLOCK - 1) * Spleeter.MODEL_BINS + bin], 0f)
    }

    @Test
    fun soundAbove11kHzStaysWithTheMusic() {
        val frames = 40_000
        val bin = 1500 // ~16 kHz, above what the networks see
        val mix = FloatArray(frames * 2) { i -> 0.5f * sin(2 * PI * bin * (i / 2) / Spleeter.N_FFT).toFloat() }
        val voice = Sink()
        val music = Sink()
        Spleeter(FakeModels()).separate(Source(mix, 1000), voice, music, frames.toLong(), {}, { false })
        val v = voice.samples()
        val m = music.samples()
        var vMax = 0f
        var mErr = 0f
        for (i in Spleeter.N_FFT * 2 until mix.size - Spleeter.N_FFT * 2) {
            vMax = maxOf(vMax, abs(v[i]))
            mErr = maxOf(mErr, abs(m[i] - mix[i]))
        }
        assertTrue("voice $vMax", vMax < 1e-3f)
        assertTrue("music $mErr", mErr < 1e-3f)
    }

    @Test
    fun overlapWeightsCoverTheEdges() {
        assertEquals(0f, Spleeter.weight(0, 100), 0f)
        assertEquals(1.5f, Spleeter.weight(5000, 100), 1e-4f)
        assertTrue(Spleeter.weight(10, 100) > 0f)
        assertEquals(1L, Spleeter.framesFor(10))
        assertEquals(1L, Spleeter.framesFor(4096))
        assertEquals(2L, Spleeter.framesFor(4097))
        assertEquals(2L, Spleeter.framesFor(5120))
    }

    @Test
    fun canceledSeparationStops() {
        val frames = Spleeter.SPAN * 2
        val models = FakeModels()
        Spleeter(models).separate(Source(FloatArray(frames * 2), 50_000), null, Sink(), frames.toLong(), {}, { models.calls >= 1 })
        assertEquals(1, models.calls)
    }

    private class Bytes(private val data: ByteArray) : RangeSource {
        var requests = 0
        override val size: Long get() = data.size.toLong()

        override fun open(start: Long, endInclusive: Long): java.io.InputStream {
            requests++
            return ByteArrayInputStream(data, start.toInt(), (endInclusive - start + 1).toInt())
        }
    }

    @Test
    fun remoteZipReadsOneEntry() {
        val r = Random(3)
        val big = ByteArray(300_000) { (r.nextInt(16)).toByte() }
        val stored = "plain text".toByteArray()
        val zipBytes = ByteArrayOutputStream().also { bos ->
            ZipOutputStream(bos).use { z ->
                z.putNextEntry(ZipEntry("classes.jar"))
                z.write(ByteArray(1000))
                z.closeEntry()
                z.putNextEntry(ZipEntry("jni/arm64-v8a/libonnxruntime.so"))
                z.write(big)
                z.closeEntry()
                z.putNextEntry(ZipEntry("note.txt").apply {
                    method = ZipEntry.STORED
                    size = stored.size.toLong()
                    compressedSize = stored.size.toLong()
                    crc = java.util.zip.CRC32().apply { update(stored) }.value
                })
                z.write(stored)
                z.closeEntry()
            }
        }.toByteArray()
        val src = Bytes(zipBytes)
        val zip = RemoteZip(src)
        val entries = zip.entries()
        assertEquals(listOf("classes.jar", "jni/arm64-v8a/libonnxruntime.so", "note.txt"), entries.map { it.name })
        val out = ByteArrayOutputStream()
        zip.extract(entries[1], out)
        assertArrayEquals(big, out.toByteArray())
        val text = ByteArrayOutputStream()
        zip.extract(entries[2], text)
        assertArrayEquals(stored, text.toByteArray())
    }

    @Test
    fun ytDlpFileAndInfoLines() {
        val f = Progress.fileLine(
            """[opfile] {"filepath": "/x/Me at the zoo [jNQXAC9IVRw].mp4", "title": "Me at the zoo", "thumbnail": "https://i.ytimg.com/vi/x/hq.jpg", "duration": 19, "width": 320, "height": 240, "uploader": "jawed"}""",
        )!!
        assertEquals("/x/Me at the zoo [jNQXAC9IVRw].mp4", f.path)
        assertEquals("Me at the zoo", f.title)
        assertEquals(19.0, f.duration, 0.0)
        assertEquals(320, f.width)
        assertEquals("jawed", f.artist)
        assertEquals("https://i.ytimg.com/vi/x/hq.jpg", f.thumbnail)
        assertEquals("/x/a.mp3", Progress.fileLine("[opfile] /x/a.mp3")!!.path)
        assertNull(Progress.fileLine("[download] 50%"))
        val (title, thumb) = Progress.infoLine("""[opinfo] {"title": "Song हि", "thumbnail": "NA"}""")!!
        assertEquals("Song हि", title)
        assertNull(thumb)
        assertNull(Progress.infoLine("[opfile] {}"))
        assertTrue(Progress.PRINTS.contains("--print"))
    }

    @Test
    fun jobFilesKeepTheirFactsButOnlyShowWhatTheUiNeeds() {
        val f = JobFile("content://m/1", "a.mp4", "video/mp4", 10, title = "A", dur = 61.5, w = 1920, h = 1080, thumb = "/t/x.jpg", cover = "https://c", meta = true)
        val ui = f.toJson()
        assertEquals("A", ui.getString("title"))
        assertEquals(1920, ui.getInt("w"))
        assertTrue(!ui.has("cover") && !ui.has("meta"))
        val back = JobFile.from(JSONObject(f.toStoreJson().toString()))
        assertEquals(f, back)
        val old = JobFile.from(JSONObject("""{"uri":"u","name":"n","mime":"audio/mpeg","size":5}"""))
        assertEquals(0.0, old.dur, 0.0)
        assertNull(old.thumb)
    }

    @Test
    fun thumbnailsAndNames() {
        assertEquals(Thumbs.nameFor("content://a"), Thumbs.nameFor("content://a"))
        assertTrue(Thumbs.nameFor("content://a") != Thumbs.nameFor("content://b"))
        assertEquals(Pair(1080, 1920), Thumbs.upright(1920, 1080, 90))
        assertEquals(Pair(1920, 1080), Thumbs.upright(1920, 1080, 0))
        assertEquals(1, Thumbs.sample(640, 480))
        assertEquals(4, Thumbs.sample(4000, 3000))
        assertEquals("Song", VocalRemover.titleOf("01. Song [dQw4w9WgXcQ].f251.webm"))
        assertEquals("en", subtitleLanguage("Film [y].en.srt"))
        assertEquals("pt-BR", subtitleLanguage("Film [y].pt-BR.vtt"))
        assertNull(subtitleLanguage("Film.srt"))
    }
}
