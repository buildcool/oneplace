package io.github.buildcool.oneplace.engine

import android.content.Context
import java.io.File
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import kotlin.concurrent.thread
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray

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

    /** A Python with yt-dlp already loaded, waiting for its command line on stdin (see FastStart's __main__.py). */
    private class Spare(val process: Process, val main: String, val pythonPath: String?)

    private val spareLock = Any()
    private var spare: Spare? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private const val SPARE_IDLE_MS = 3 * 60_000L

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
        // The unpacked copy starts ~2 s sooner than the zip (see FastStart).
        val fast = FastStart.current(ctx)
        val pre = mutableListOf((fast ?: p.ytdlp).absolutePath, "--ffmpeg-location", p.ffmpeg.absolutePath)
        if (p.qjs.exists()) pre += listOf("--js-runtimes", "quickjs:${p.qjs.absolutePath}")
        return python(ctx, id, pre + args, ytdlpPath(ctx), keepOut, onLine, useSpare = fast != null)
    }

    /**
     * requests & co (shipped for gallery-dl in files/gdl) let yt-dlp reuse connections: downloads that come in
     * pieces ran ~3x faster on a phone (Dailymotion 82 s -> 27 s), and sites that need many requests read faster.
     */
    private fun ytdlpPath(ctx: Context): String? = GalleryDl.dir(ctx).takeIf { File(it, "requests").isDirectory }?.absolutePath

    /**
     * Keep one yt-dlp started ahead of time while the app runs: loading Python and yt-dlp takes ~0.5–1 s, so
     * the next read or download starts that much sooner. It quits after a few idle minutes.
     */
    fun prepareSpare(ctx: Context) {
        val app = ctx.applicationContext
        val main = FastStart.current(app)?.absolutePath ?: return
        val pythonPath = ytdlpPath(app)
        synchronized(spareLock) {
            spare?.let { s ->
                if (s.process.alive() && s.main == main && s.pythonPath == pythonPath) return
                s.process.destroy()
            }
            val process = runCatching { start(app, listOf(main, FastStart.WARM), pythonPath) }.getOrNull() ?: return
            val s = Spare(process, main, pythonPath)
            spare = s
            scope.launch {
                delay(SPARE_IDLE_MS)
                synchronized(spareLock) {
                    if (spare === s) {
                        spare = null
                        s.process.destroy()
                    }
                }
            }
        }
    }

    /** Process.isAlive() needs Android 8; this works on 7 too. */
    private fun Process.alive(): Boolean = try {
        exitValue()
        false
    } catch (e: IllegalThreadStateException) {
        true
    }

    /** The spare, when it suits this run; it is handed [args] (everything after the script). */
    private fun takeSpare(main: String, pythonPath: String?, args: List<String>): Process? {
        val s = synchronized(spareLock) { spare.also { spare = null } } ?: return null
        if (!s.process.alive() || s.main != main || s.pythonPath != pythonPath) {
            s.process.destroy()
            return null
        }
        return try {
            s.process.outputStream.bufferedWriter().use { it.write(JSONArray(args).toString() + "\n") }
            s.process
        } catch (e: IOException) {
            s.process.destroy()
            null
        }
    }

    suspend fun gallery(ctx: Context, id: String, args: List<String>, keepOut: Boolean = false, onLine: ((String) -> Unit)? = null): Result {
        val p = Paths(ctx)
        // gallery-dl and its pure-Python deps live in files/gdl; yt-dlp lets it use yt_dlp for video posts.
        val pythonPath = "${GalleryDl.dir(ctx).absolutePath}:${(FastStart.current(ctx) ?: p.ytdlp).absolutePath}"
        return python(ctx, id, listOf("-m", "gallery_dl") + args, pythonPath, keepOut, onLine)
    }

    /** A short Python snippet (FastStart unpacks yt-dlp with one). */
    suspend fun script(ctx: Context, id: String, code: String, args: List<String>): Result =
        python(ctx, id, listOf("-c", code) + args, null, keepOut = false, onLine = null)

    /** True while any engine process runs. */
    fun busy(): Boolean = running.isNotEmpty()

    private suspend fun python(
        ctx: Context,
        id: String,
        args: List<String>,
        pythonPath: String?,
        keepOut: Boolean,
        onLine: ((String) -> Unit)?,
        useSpare: Boolean = false,
    ): Result = withContext(Dispatchers.IO) {
        val started = System.currentTimeMillis()
        val process = (if (useSpare) takeSpare(args[0], pythonPath, args.drop(1)) else null) ?: start(ctx, args, pythonPath)
        // Another spare for the next run, once this one has done its reading.
        if (useSpare) scope.launch {
            delay(4_000)
            prepareSpare(ctx)
        }
        val r = Running(process)
        running.put(id, r)?.let { old ->
            old.killed = true
            old.process.destroy()
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
        // If the caller is cancelled, stop the process too (the read loop below cannot notice cancellation).
        val watcher = launch {
            try {
                awaitCancellation()
            } finally {
                if (running[id] === r) kill(id)
            }
        }
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
            // Unregister first so the watcher does not signal a pid that may already be reused.
            running.remove(id, r)
            watcher.cancel()
        }
    }

    /** `sh` prints its pid and then exec's Python in its place, so we know Python's pid for cancelling. */
    private fun start(ctx: Context, args: List<String>, pythonPath: String?): Process {
        val p = Paths(ctx)
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
        return pb.start()
    }

    /**
     * ffmpeg with raw pipes (the vocal remover streams sound through it). Registered under [id] so cancel
     * stops it; call [finished] when done. stderr must be read by the caller.
     */
    fun startFfmpeg(ctx: Context, id: String, args: List<String>): Process {
        val p = Paths(ctx)
        val pb = ProcessBuilder(listOf(p.ffmpeg.absolutePath, "-hide_banner", "-nostats") + args)
        pb.environment().apply {
            put("LD_LIBRARY_PATH", p.libPath)
            put("TMPDIR", p.tmp.absolutePath)
        }
        val process = pb.start()
        running.put(id, Running(process))?.let { old ->
            old.killed = true
            old.process.destroy()
        }
        return process
    }

    fun finished(id: String, process: Process) {
        running[id]?.takeIf { it.process === process }?.let { running.remove(id, it) }
    }

    /** Stop a job's runs: [id] itself and helpers registered as "id#…" (the vocal remover's encoders). */
    fun killGroup(id: String) {
        kill(id)
        running.keys.filter { it.startsWith("$id#") }.forEach { kill(it) }
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
