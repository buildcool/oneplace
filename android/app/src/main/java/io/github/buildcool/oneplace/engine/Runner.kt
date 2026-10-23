package io.github.buildcool.oneplace.engine

import android.content.Context
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import kotlin.concurrent.thread
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.withContext

/**
 * Runs yt-dlp and gallery-dl with the Python, ffmpeg and QuickJS that youtubedl-android unpacked.
 * Same environment as YoutubeDL.execute(), but we keep stdout even when the exit code is not 0,
 * learn the process id (so cancel also stops ffmpeg) and can run gallery-dl as well.
 */
object Runner {
    class Result(val code: Int, val out: String, val err: String, val ms: Long)

    private class Running(val process: Process) {
        @Volatile
        var pid = -1

        @Volatile
        var killed = false
    }

    private val running = ConcurrentHashMap<String, Running>()
    private const val PID_MARK = "__oneplace_pid__"

    class Paths(ctx: Context) {
        val bin = File(ctx.applicationInfo.nativeLibraryDir)
        private val base = File(ctx.noBackupFilesDir, "youtubedl-android")
        private val packages = File(base, "packages")
        private val pythonDir = File(packages, "python")
        val python = File(bin, "libpython.so")
        val ytdlp = File(base, "yt-dlp/yt-dlp")
        val ffmpeg = File(bin, "libffmpeg.so")
        val qjs = File(bin, "libqjs.so")
        val pythonHome = File(pythonDir, "usr")
        val libPath = listOf(pythonDir, File(packages, "ffmpeg"), File(packages, "aria2c")).joinToString(":") { "${it.absolutePath}/usr/lib" }
        val cert = File(pythonDir, "usr/etc/tls/cert.pem")
        val tmp: File = ctx.cacheDir
    }

    suspend fun ytdlp(ctx: Context, id: String, args: List<String>, keepOut: Boolean = false, onLine: ((String) -> Unit)? = null): Result {
        val p = Paths(ctx)
        val pre = mutableListOf(p.ytdlp.absolutePath, "--ffmpeg-location", p.ffmpeg.absolutePath)
        if (p.qjs.exists()) pre += listOf("--js-runtimes", "quickjs:${p.qjs.absolutePath}")
        return python(ctx, id, pre + args, null, keepOut, onLine)
    }

    suspend fun gallery(ctx: Context, id: String, args: List<String>, keepOut: Boolean = false, onLine: ((String) -> Unit)? = null): Result {
        val p = Paths(ctx)
        // gallery-dl and its pure-Python deps live in files/gdl; yt-dlp's zipapp lets it use yt_dlp for video posts.
        val pythonPath = "${GalleryDl.dir(ctx).absolutePath}:${p.ytdlp.absolutePath}"
        return python(ctx, id, listOf("-m", "gallery_dl") + args, pythonPath, keepOut, onLine)
    }

    private suspend fun python(
        ctx: Context,
        id: String,
        args: List<String>,
        pythonPath: String?,
        keepOut: Boolean,
        onLine: ((String) -> Unit)?,
    ): Result = withContext(Dispatchers.IO) {
        val p = Paths(ctx)
        // `sh` prints its pid and then exec's Python in its place, so we know Python's pid for cancelling.
        val script = "echo $PID_MARK\$\$; exec \"\$0\" \"\$@\""
        val pb = ProcessBuilder(listOf("/system/bin/sh", "-c", script, p.python.absolutePath) + args)
        pb.environment().apply {
            put("LD_LIBRARY_PATH", p.libPath)
            put("SSL_CERT_FILE", p.cert.absolutePath)
            put("PATH", (System.getenv("PATH") ?: "/system/bin") + ":" + p.bin.absolutePath)
            put("PYTHONHOME", p.pythonHome.absolutePath)
            put("HOME", p.pythonHome.absolutePath)
            put("TMPDIR", p.tmp.absolutePath)
            put("PYTHONIOENCODING", "utf-8")
            put("PYTHONUTF8", "1")
            if (pythonPath != null) put("PYTHONPATH", pythonPath)
        }
        val started = System.currentTimeMillis()
        val process = pb.start()
        val r = Running(process)
        running.put(id, r)?.let { old ->
            old.killed = true
            old.process.destroy()
        }
        val handle = currentCoroutineContext()[kotlinx.coroutines.Job]?.invokeOnCompletion { cause ->
            if (cause is CancellationException) kill(id)
        }
        val err = StringBuilder()
        val errThread = thread(name = "op-stderr-$id") {
            runCatching {
                process.errorStream.bufferedReader().forEachLine { line ->
                    synchronized(err) {
                        err.append(line).append('\n')
                        if (err.length > 200_000) err.delete(0, err.length - 100_000)
                    }
                }
            }
        }
        val out = StringBuilder()
        try {
            val reader = process.inputStream.bufferedReader()
            val line = StringBuilder()
            fun flush() {
                if (line.isEmpty()) return
                val s = line.toString()
                line.setLength(0)
                if (r.pid < 0 && s.startsWith(PID_MARK)) {
                    r.pid = s.removePrefix(PID_MARK).trim().toIntOrNull() ?: -1
                    return
                }
                out.append(s).append('\n')
                if (!keepOut && out.length > 64_000) out.delete(0, out.length - 32_000)
                onLine?.invoke(s)
            }
            while (true) {
                val c = reader.read()
                if (c < 0) break
                if (c == '\n'.code || c == '\r'.code) flush() else line.append(c.toChar())
            }
            flush()
            val code = process.waitFor()
            errThread.join(2000)
            Result(if (r.killed) -9 else code, out.toString(), synchronized(err) { err.toString() }, System.currentTimeMillis() - started)
        } finally {
            handle?.dispose()
            running.remove(id, r)
        }
    }

    /** Stop a run and everything it started (ffmpeg, aria2c). */
    fun kill(id: String): Boolean {
        val r = running[id] ?: return false
        r.killed = true
        if (r.pid > 0) killTree(r.pid)
        r.process.destroy()
        return true
    }

    private fun killTree(pid: Int) {
        childrenOf(pid).forEach(::killTree)
        runCatching { android.os.Process.sendSignal(pid, android.os.Process.SIGNAL_KILL) }
    }

    private fun childrenOf(pid: Int): List<Int> =
        File("/proc").listFiles()?.mapNotNull { f -> f.name.toIntOrNull()?.takeIf { parentOf(it) == pid } } ?: emptyList()

    private fun parentOf(pid: Int): Int = try {
        val stat = File("/proc/$pid/stat").readText()
        stat.substring(stat.lastIndexOf(')') + 2).split(' ')[1].toInt()
    } catch (e: Exception) {
        -1
    }
}
