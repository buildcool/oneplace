package io.github.buildcool.oneplace.edit

import android.content.Context
import android.os.Build
import io.github.buildcool.oneplace.BuildConfig
import io.github.buildcool.oneplace.engine.Net
import java.io.File
import java.io.IOException
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * The vocal remover's parts, downloaded the first time it is used (so the APK stays small for everyone):
 * ONNX Runtime's engine library, taken straight out of the official AAR on Maven Central, and Spleeter's two
 * networks from Hugging Face. Every file is checked against a SHA-256 fixed in the app.
 */
object Ml {
    class Model(val name: String, val size: Long, val sha256: String)

    /** sherpa-onnx's fp16 export of Deezer Spleeter 2-stems (MIT), pinned to one commit. */
    private const val MODEL_BASE = "https://huggingface.co/csukuangfj/sherpa-onnx-spleeter-2stems-fp16/resolve/93ba771920ade509f8cbd6825b1a90856c797e08/"
    val VOCALS = Model("vocals.fp16.onnx", 19_681_017, "24cef84aedcd1fe87c0b743ef3370ad34dc1fabf6c9014d6128a75a538c7b668")
    val MUSIC = Model("accompaniment.fp16.onnx", 19_681_024, "d14cea55793cc531a5875f5f4da08207d1c5ab9292e8e0099a104eecb014fcc0")
    private val MODELS = listOf(VOCALS, MUSIC)

    /** Download size of the engine library (compressed in the AAR, arm64); the UI shows the total before asking. */
    private const val RUNTIME_DOWNLOAD = 12_900_000L
    const val DOWNLOAD = RUNTIME_DOWNLOAD + 19_681_017 + 19_681_024

    private val aarUrl get() =
        "https://repo1.maven.org/maven2/com/microsoft/onnxruntime/onnxruntime-android/${BuildConfig.ORT_VERSION}/onnxruntime-android-${BuildConfig.ORT_VERSION}.aar"

    fun dir(ctx: Context): File = File(ctx.noBackupFilesDir, "vocal-remover")

    /** Same file name as in the APK, so ONNX Runtime's JNI part finds it by name; one folder per version. */
    private fun runtime(ctx: Context) = File(dir(ctx), "ort-${BuildConfig.ORT_VERSION}/libonnxruntime.so")

    fun model(ctx: Context, m: Model) = File(dir(ctx), m.name)

    fun installed(ctx: Context): Boolean = runtime(ctx).isFile && MODELS.all { model(ctx, it).length() == it.size }

    fun bytes(ctx: Context): Long = dir(ctx).walkTopDown().filter { it.isFile }.sumOf { it.length() }

    fun delete(ctx: Context) {
        dir(ctx).deleteRecursively()
    }

    /** The CPU type of the libraries this app runs with (the APK's, not just the phone's best). */
    fun abi(ctx: Context): String = when (File(ctx.applicationInfo.nativeLibraryDir).name) {
        "arm64" -> "arm64-v8a"
        "arm" -> "armeabi-v7a"
        "x86_64" -> "x86_64"
        "x86" -> "x86"
        else -> Build.SUPPORTED_ABIS.firstOrNull() ?: "arm64-v8a"
    }

    /** Fetch whatever is missing. [progress] gets (bytes done, bytes in all). Throws with a readable reason. */
    fun ensure(ctx: Context, canceled: () -> Boolean = { false }, progress: (Long, Long) -> Unit) {
        if (installed(ctx)) return
        val folder = dir(ctx).apply { mkdirs() }
        // Older engine versions (from earlier app versions) are of no use now.
        folder.listFiles { f -> f.name.startsWith("ort-") && f != runtime(ctx).parentFile }?.forEach { it.deleteRecursively() }
        val needRuntime = !runtime(ctx).isFile
        val missing = MODELS.filter { model(ctx, it).length() != it.size }
        val total = (if (needRuntime) RUNTIME_DOWNLOAD else 0L) + missing.sumOf { it.size }
        var before = 0L
        val step = { done: Long ->
            if (canceled()) throw IOException("canceled")
            progress(done, total)
        }
        if (needRuntime) {
            fetchRuntime(ctx) { step(it) }
            before += RUNTIME_DOWNLOAD
        }
        for (m in missing) {
            val start = before
            fetchModel(ctx, m) { step(start + it) }
            before += m.size
        }
        progress(total, total)
    }

    private fun fetchRuntime(ctx: Context, progress: (Long) -> Unit) {
        val abi = abi(ctx)
        val want = BuildConfig.ORT_SO_SHA256.split(';').associate { it.substringBefore('=') to it.substringAfter('=') }[abi]
            ?: throw IOException("No vocal remover engine for $abi phones")
        val zip = RemoteZip(HttpRange(aarUrl, Net.UA))
        val entry = zip.entries().find { it.name == "jni/$abi/libonnxruntime.so" } ?: throw IOException("Engine for $abi not found")
        val tmp = File(dir(ctx), "runtime.tmp")
        val digest = MessageDigest.getInstance("SHA-256")
        try {
            val stream = tmp.outputStream()
            // Android 14+ wants code loaded at runtime to be read-only: mark it so before writing (as documented).
            tmp.setReadOnly()
            DigestOut(stream, digest).use { out -> zip.extract(entry, out) { progress(it * RUNTIME_DOWNLOAD / entry.compressedSize) } }
            if (hex(digest.digest()) != want) throw IOException("The vocal remover engine did not match its checksum")
            runtime(ctx).parentFile?.mkdirs()
            if (!tmp.renameTo(runtime(ctx))) throw IOException("Could not save the vocal remover engine")
        } finally {
            tmp.delete()
        }
    }

    /** Resumable: a broken download continues where it stopped. */
    private fun fetchModel(ctx: Context, m: Model, progress: (Long) -> Unit) {
        val part = File(dir(ctx), "${m.name}.part")
        if (part.length() > m.size) part.delete()
        var tries = 0
        while (part.length() < m.size) {
            if (tries++ >= 6) throw IOException("The voice model download keeps stopping. Please try again on a better connection.")
            try {
                download(MODEL_BASE + m.name, part, m.size, progress)
            } catch (e: IOException) {
                if (tries >= 6 || e.message == "canceled") throw e
                Thread.sleep(1500L * tries)
            }
        }
        if (sha256(part) != m.sha256) {
            part.delete()
            throw IOException("The voice model did not match its checksum. Please try again.")
        }
        if (!part.renameTo(model(ctx, m))) throw IOException("Could not save the voice model")
    }

    private fun download(url: String, part: File, size: Long, progress: (Long) -> Unit) {
        val have = part.length()
        val c = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 30_000
            setRequestProperty("User-Agent", Net.UA)
            if (have > 0) setRequestProperty("Range", "bytes=$have-")
        }
        try {
            val code = c.responseCode
            if (code !in 200..299) throw IOException("HTTP $code while downloading the voice model")
            // The server ignored the range: start over.
            val append = have > 0 && code == 206
            var done = if (append) have else 0L
            c.inputStream.use { input ->
                java.io.FileOutputStream(part, append).use { out ->
                    val buf = ByteArray(1 shl 16)
                    var last = 0L
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        done += n
                        if (done > size) throw IOException("The voice model is bigger than expected")
                        val now = System.currentTimeMillis()
                        if (now - last > 300) {
                            last = now
                            progress(done)
                        }
                    }
                }
            }
            progress(done)
        } finally {
            c.disconnect()
        }
    }

    @Volatile
    private var loaded = false

    /** Load the engine library before ONNX Runtime's own small JNI part asks for it by name. */
    @Synchronized
    fun load(ctx: Context) {
        if (loaded) return
        val lib = runtime(ctx)
        if (!lib.isFile) throw IOException("The vocal remover is not downloaded")
        if (lib.canWrite()) lib.setReadOnly()
        try {
            System.load(lib.absolutePath)
        } catch (e: UnsatisfiedLinkError) {
            throw IOException("This phone could not start the vocal remover: ${e.message}")
        } catch (e: SecurityException) {
            throw IOException("This phone could not start the vocal remover: ${e.message}")
        }
        loaded = true
    }

    private fun sha256(f: File): String {
        val d = MessageDigest.getInstance("SHA-256")
        f.inputStream().use { input ->
            val buf = ByteArray(1 shl 16)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                d.update(buf, 0, n)
            }
        }
        return hex(d.digest())
    }

    internal fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }

    private class DigestOut(private val out: OutputStream, private val d: MessageDigest) : OutputStream() {
        override fun write(b: Int) {
            out.write(b)
            d.update(b.toByte())
        }

        override fun write(b: ByteArray, off: Int, len: Int) {
            out.write(b, off, len)
            d.update(b, off, len)
        }

        override fun close() = out.close()
    }
}
