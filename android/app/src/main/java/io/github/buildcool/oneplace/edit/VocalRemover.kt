package io.github.buildcool.oneplace.edit

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import io.github.buildcool.oneplace.Config
import io.github.buildcool.oneplace.engine.Progress
import io.github.buildcool.oneplace.engine.Runner
import io.github.buildcool.oneplace.queue.Job
import io.github.buildcool.oneplace.queue.JobFile
import io.github.buildcool.oneplace.queue.JobStore
import io.github.buildcool.oneplace.storage.Files
import io.github.buildcool.oneplace.storage.Saver
import io.github.buildcool.oneplace.storage.Thumbs
import java.io.BufferedOutputStream
import java.io.Closeable
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.concurrent.thread
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * "Remove vocals": makes a karaoke copy (and/or a vocals-only copy) of a saved song or video, all on the phone.
 * ffmpeg decodes the original to raw sound, [Spleeter] splits it block by block, and one ffmpeg per result
 * encodes it (MP3 with the cover, or the original video with the new sound). Nothing big is written in between.
 */
object VocalRemover {
    /** Error texts start with these so the UI can explain them (src/core/errors.ts). */
    const val NO_SOURCE = "Vocal remover: the original file is gone"
    const val SETUP_FAILED = "Vocal remover download failed"
    const val FAILED = "Vocal remover failed"

    suspend fun run(ctx: Context, job: Job, dir: File, report: (Double, String?) -> Unit): Runner.Result = withContext(Dispatchers.IO) {
        val started = System.currentTimeMillis()
        dir.mkdirs()
        try {
            work(ctx, job, dir, report)
            Runner.Result(0, "", "", System.currentTimeMillis() - started)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            val canceled = job.status == "canceled"
            Runner.Result(if (canceled) -9 else 1, "", if (canceled) "canceled" else (e.message ?: e.toString()), System.currentTimeMillis() - started)
        } finally {
            dir.listFiles()?.forEach { it.delete() }
        }
    }

    private fun work(ctx: Context, job: Job, dir: File, report: (Double, String?) -> Unit) {
        val spec = job.edit ?: throw IOException("$FAILED: nothing to do")
        val src = spec.optJSONObject("source") ?: throw IOException(NO_SOURCE)
        val source = JobStore.get(src.optString("id")) ?: throw IOException(NO_SOURCE)
        val index = src.optInt("index")
        val file = source.files.getOrNull(index) ?: throw IOException(NO_SOURCE)
        if (Files.exists(ctx, file.uri) == false) throw IOException(NO_SOURCE)
        val stems = when (spec.optString("keep")) {
            "vocals" -> listOf("vocals")
            "both" -> listOf("music", "vocals")
            else -> listOf("music")
        }
        val video = spec.optString("as") == "video" && file.mime.startsWith("video/")
        val bitrate = spec.optInt("bitrate", 320).coerceIn(64, 320)

        // 1. The first time: the engine and the voice model.
        if (!Ml.installed(ctx)) {
            val label = Config.text(ctx, "aiSetup", "Getting the vocal remover (one time)")
            try {
                Ml.ensure(ctx, canceled = { job.status == "canceled" }) { done, total -> report(done * 100.0 / total, "$label · ${mb(done)} / ${mb(total)} MB") }
            } catch (e: Exception) {
                if (job.status == "canceled") throw IOException("canceled")
                throw IOException("$SETUP_FAILED: ${e.message}")
            }
        }
        if (job.status == "canceled") throw IOException("canceled")
        report(-1.0, Config.text(ctx, "aiStart", "Starting the vocal remover"))
        try {
            Ml.load(ctx)
        } catch (e: Exception) {
            throw IOException("$FAILED: ${e.message}")
        }

        // 2. ffmpeg needs a path: the file itself when readable, else a copy.
        val path = Files.readablePath(ctx, file.uri) ?: copy(ctx, file, dir)
        val title = file.title ?: (if (source.files.count { Thumbs.isMedia(it) } == 1) source.title else null) ?: titleOf(file.name)
        val ext = when {
            !video -> "mp3"
            Regex("""\.(webm|mkv)$""", RegexOption.IGNORE_CASE).containsMatchIn(file.name) -> "mkv"
            else -> "mp4"
        }
        val cover = file.thumb?.let(::File)?.takeIf { it.isFile }
        val outs = stems.map { stem ->
            val name = if (stem == "music") "Karaoke" else "Vocals"
            Out(stem, "$title ($name)", File(dir, Saver.safeName("$title ($name)").take(180) + ".$ext"))
        }
        val seconds = file.dur.takeIf { it > 0 } ?: length(ctx, file.uri)

        // 3. Decode → split → encode, all streamed.
        val decoder = Runner.startFfmpeg(ctx, job.id, listOf("-nostdin", "-v", "error", "-i", path, "-vn", "-sn", "-dn", "-ac", "2", "-ar", "${Spleeter.RATE}", "-f", "f32le", "pipe:1"))
        val decoderErr = Tail(decoder.errorStream)
        val encoders = outs.mapIndexed { i, o ->
            val args = if (video) videoArgs(path, o, file) else audioArgs(o, file, cover, bitrate)
            val p = Runner.startFfmpeg(ctx, "${job.id}#$i", args)
            o.err = Tail(p.errorStream)
            o.pcm = PcmWriter(BufferedOutputStream(p.outputStream, 1 shl 16))
            p
        }
        val working = Config.text(ctx, "aiWorking", "Removing vocals")
        var written = 0L
        val decoded: Int
        val codes: List<Int>
        try {
            try {
                val threads = Runtime.getRuntime().availableProcessors().coerceIn(2, 4)
                OrtSpleeter(Ml.model(ctx, Ml.VOCALS).path, Ml.model(ctx, Ml.MUSIC).path, threads).use { models ->
                    report(0.0, working)
                    written = Spleeter(models).separate(
                        source = PcmReader(decoder.inputStream),
                        vocals = outs.find { it.stem == "vocals" }?.pcm,
                        music = outs.find { it.stem == "music" }?.pcm,
                        total = (seconds * Spleeter.RATE).toLong(),
                        progress = { report(it * 97, working) },
                        canceled = { job.status == "canceled" },
                    )
                }
            } catch (e: Throwable) {
                // Errors too: a phone that cannot load the engine library throws UnsatisfiedLinkError.
                if (job.status == "canceled") throw IOException("canceled")
                outs.forEach { runCatching { it.pcm?.close() } }
                Thread.sleep(300)
                val why = (outs.map { it.err?.text().orEmpty() } + decoderErr.text()).filter { it.isNotBlank() }.joinToString("\n")
                throw IOException("$FAILED: ${e.message ?: e}\n$why")
            } finally {
                outs.forEach { runCatching { it.pcm?.close() } }
                runCatching { decoder.inputStream.close() }
            }
            decoded = decoder.waitFor()
            codes = encoders.map { it.waitFor() }
        } finally {
            Runner.finished(job.id, decoder)
            encoders.forEachIndexed { i, p ->
                Runner.finished("${job.id}#$i", p)
                p.destroy()
            }
            decoder.destroy()
        }
        if (job.status == "canceled") throw IOException("canceled")
        if (decoded != 0 || written <= 0) throw IOException("$FAILED: could not read the sound of this file\n${decoderErr.text()}")
        codes.forEachIndexed { i, c -> if (c != 0) throw IOException("$FAILED: could not save the result\n${outs[i].err?.text().orEmpty()}") }

        // 4. Save next to the other downloads, with the original's picture.
        report(99.0, Config.text(ctx, "aiSaving", "Saving"))
        for (o in outs) {
            val saved = Saver.publish(ctx, o.file)
            o.file.delete()
            val pic = cover?.let { c -> Thumbs.fileFor(ctx, saved.uri).also { runCatching { c.copyTo(it, overwrite = true) } } }?.takeIf { it.isFile }
            job.addFile(
                saved.copy(
                    title = o.title,
                    artist = file.artist,
                    dur = written.toDouble() / Spleeter.RATE,
                    w = if (video) file.w else 0,
                    h = if (video) file.h else 0,
                    thumb = pic?.absolutePath,
                    stem = o.stem,
                    meta = true,
                ),
            )
        }
    }

    private class Out(val stem: String, val title: String, val file: File) {
        var err: Tail? = null
        var pcm: PcmWriter? = null
    }

    private fun audioArgs(o: Out, f: JobFile, cover: File?, bitrate: Int): List<String> {
        val a = mutableListOf("-v", "error", "-f", "f32le", "-ar", "${Spleeter.RATE}", "-ac", "2", "-i", "pipe:0")
        if (cover != null) a += listOf("-i", cover.path)
        a += listOf("-map", "0:a")
        if (cover != null) a += listOf("-map", "1:v", "-c:v", "copy", "-disposition:v", "attached_pic", "-metadata:s:v", "title=Album cover", "-metadata:s:v", "comment=Cover (front)")
        a += listOf("-c:a", "libmp3lame", "-b:a", "${bitrate}k", "-id3v2_version", "3", "-metadata", "title=${o.title}")
        f.artist?.let { a += listOf("-metadata", "artist=$it") }
        a += listOf("-y", o.file.path)
        return a
    }

    private fun videoArgs(source: String, o: Out, f: JobFile): List<String> {
        val a = mutableListOf(
            "-v", "error", "-f", "f32le", "-ar", "${Spleeter.RATE}", "-ac", "2", "-i", "pipe:0", "-i", source,
            "-map", "1:v:0", "-map", "0:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest",
            "-metadata", "title=${o.title}",
        )
        f.artist?.let { a += listOf("-metadata", "artist=$it") }
        if (o.file.name.endsWith(".mp4")) a += listOf("-movflags", "+faststart")
        a += listOf("-y", o.file.path)
        return a
    }

    private fun copy(ctx: Context, f: JobFile, dir: File): String {
        val out = File(dir, "source." + f.name.substringAfterLast('.', "bin"))
        ctx.contentResolver.openInputStream(Uri.parse(f.uri))?.use { input -> out.outputStream().use { input.copyTo(it, 1 shl 16) } }
            ?: throw IOException(NO_SOURCE)
        return out.path
    }

    private fun length(ctx: Context, uri: String): Double {
        val r = MediaMetadataRetriever()
        return try {
            r.setDataSource(ctx, Uri.parse(uri))
            (r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L) / 1000.0
        } catch (e: Exception) {
            0.0
        } finally {
            runCatching { r.release() }
        }
    }

    private fun mb(bytes: Long) = (bytes + 524_288) / 1_048_576

    /** "01. Song [dQw4w9WgXcQ].f251.webm" → "Song". */
    internal fun titleOf(name: String): String =
        Progress.titleOf(name).replace(Regex("""\s*\[[\w-]{6,}]$"""), "").replace(Regex("""^\d{1,4}\.\s+"""), "").trim().ifEmpty { "Song" }

    /** Interleaved stereo float samples from ffmpeg's stdout (little-endian). */
    private class PcmReader(private val input: InputStream) : PcmIn {
        private val bytes = ByteArray(1 shl 16)
        private var have = 0

        override fun read(buf: FloatArray, frames: Int): Int {
            val want = minOf(frames * 8, bytes.size)
            while (have < 8) {
                val n = input.read(bytes, have, want - have)
                if (n < 0) return -1
                have += n
            }
            val usable = have / 8 * 8
            ByteBuffer.wrap(bytes, 0, usable).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer().get(buf, 0, usable / 4)
            System.arraycopy(bytes, usable, bytes, 0, have - usable)
            have -= usable
            return usable / 8
        }
    }

    private class PcmWriter(private val out: OutputStream) : PcmOut, Closeable {
        private var bytes = ByteArray(0)

        override fun write(buf: FloatArray, frames: Int) {
            val n = frames * 2
            if (bytes.size < n * 4) bytes = ByteArray(n * 4)
            ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer().put(buf, 0, n)
            out.write(bytes, 0, n * 4)
        }

        override fun close() = out.close()
    }

    /** The last lines a process printed on stderr (read on its own thread so the process never blocks). */
    private class Tail(stream: InputStream) {
        private val lines = ArrayDeque<String>()

        init {
            thread(name = "op-ffmpeg-err", isDaemon = true) {
                runCatching {
                    stream.bufferedReader().forEachLine { line ->
                        synchronized(lines) {
                            lines.addLast(line)
                            if (lines.size > 20) lines.removeFirst()
                        }
                    }
                }
            }
        }

        fun text(): String = synchronized(lines) { lines.joinToString("\n") }
    }
}
