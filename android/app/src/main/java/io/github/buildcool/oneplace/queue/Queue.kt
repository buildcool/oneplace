package io.github.buildcool.oneplace.queue

import android.content.Context
import android.os.StatFs
import io.github.buildcool.oneplace.Config
import io.github.buildcool.oneplace.engine.Engines
import io.github.buildcool.oneplace.engine.InfoCache
import io.github.buildcool.oneplace.engine.Progress
import io.github.buildcool.oneplace.engine.Runner
import io.github.buildcool.oneplace.storage.Saver
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject

/**
 * The download queue. Runs up to N jobs at once inside a user-initiated job (Android 14+) or a
 * foreground service, saves results through MediaStore and heals itself when a site changes:
 * photo posts fall back to gallery-dl, and extractor errors trigger one yt-dlp update and a retry.
 */
object Queue {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val wake = Channel<Unit>(Channel.CONFLATED)
    private val runs = ConcurrentHashMap<String, kotlinx.coroutines.Job>()

    /** True while the queue loop runs. Keep-alive services wait for it to turn false. */
    private val busy = MutableStateFlow(false)

    /** Set when Android stops our keep-alive (time limit, lost network): stop until start() is called again. */
    @Volatile
    var held = false
        private set
    private val lastEmit = ConcurrentHashMap<String, Long>()
    private val lastSave = ConcurrentHashMap<String, Long>()

    /** Source files already copied to shared storage, per job (so nothing is saved twice). */
    private val published = ConcurrentHashMap<String, MutableSet<String>>()

    @Volatile
    private var lastSummary = 0L

    /** EnginePlugin forwards job changes to the UI. */
    @Volatile
    var listener: ((Job) -> Unit)? = null

    val draining: Boolean get() = busy.value

    private val NO_VIDEO = Regex("There is no video in this post|No video could be found|No video formats found|no media found", RegexOption.IGNORE_CASE)

    /** Errors a newer yt-dlp cannot fix, so no self-heal update for them. */
    private val USER_SIDE = Regex(
        "Private video|private account|is private|Video unavailable|has been removed|no longer available|DRM|" +
            "not available in your country|No space left|members[- ]only|Join this channel|confirm your age|Premieres in|" +
            "will begin|Unsupported URL|There is no video in this post|login required|redirect to login",
        RegexOption.IGNORE_CASE,
    )

    fun emit(job: Job, force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (!force && now - (lastEmit[job.id] ?: 0) < 400) return
        lastEmit[job.id] = now
        listener?.invoke(job)
    }

    private fun persist(job: Job) {
        val now = System.currentTimeMillis()
        if (now - (lastSave[job.id] ?: 0) < 3000) return
        lastSave[job.id] = now
        JobStore.save(job)
    }

    private fun summaryTick(ctx: Context) {
        val now = System.currentTimeMillis()
        if (now - lastSummary < 1000) return
        lastSummary = now
        Notifier.updateSummary(ctx)
    }

    fun enqueue(ctx: Context, request: JSONObject): Job {
        JobStore.init(ctx)
        val job = Job.fromRequest(UUID.randomUUID().toString(), request)
        JobStore.put(job)
        emit(job, true)
        start(ctx)
        return job
    }

    /**
     * Run the queue now, in this process, and ask Android to keep the app alive while it works
     * (user-initiated job on Android 14+, foreground service before). Downloads never wait for the
     * keep-alive to start: if Android delays it, they still run while OnePlace is open.
     */
    fun start(ctx: Context) {
        val app = ctx.applicationContext
        held = false
        wake.trySend(Unit)
        if (busy.compareAndSet(false, true)) {
            scope.launch {
                try {
                    loop(app)
                } finally {
                    busy.value = false
                    Notifier.clearSummary(app)
                    // Something was queued while the loop was finishing: go again.
                    if (!held && JobStore.nextQueued() != null && !(Config.wifiOnly(app) && !Keepalive.unmetered(app))) start(app)
                }
            }
        }
        Keepalive.ensure(app)
    }

    /** Keep-alive services wait here until there is nothing left to download. */
    suspend fun awaitIdle() {
        busy.first { !it }
    }

    /** Android is stopping our keep-alive: stop downloads (they stay queued and resume on the next start). */
    fun hold(ctx: Context) {
        held = true
        pauseRunning(ctx)
        wake.trySend(Unit)
    }

    private suspend fun loop(ctx: Context) {
        while (true) {
            var waitingForWifi = false
            while (!held && runs.size < Config.concurrency(ctx)) {
                val next = JobStore.nextQueued() ?: break
                if (Config.wifiOnly(ctx) && !Keepalive.unmetered(ctx)) {
                    waitingForWifi = true
                    JobStore.active().filter { it.status == "queued" }.forEach {
                        it.line = Config.text(ctx, "waitingWifi", "Waiting for Wi-Fi")
                        emit(it, true)
                    }
                    break
                }
                next.status = "running"
                next.progress = -1.0
                next.error = null
                next.line = null
                JobStore.save(next)
                emit(next, true)
                runs[next.id] = scope.launch {
                    try {
                        runJob(ctx, next)
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Throwable) {
                        fail(ctx, next, e.message ?: e.toString())
                    } finally {
                        runs.remove(next.id)
                        wake.trySend(Unit)
                    }
                }
            }
            Notifier.updateSummary(ctx)
            // Nothing running: stop (Wi-Fi-only jobs start again when the app is opened on Wi-Fi).
            if (runs.isEmpty() && (held || waitingForWifi || JobStore.nextQueued() == null)) break
            withTimeoutOrNull(5_000) { wake.receive() }
        }
    }

    private fun cleanup(dir: File) {
        dir.deleteRecursively()
    }

    private suspend fun runJob(ctx: Context, job: Job) {
        if (!Engines.ready) {
            job.line = Config.text(ctx, "preparing", "Getting the engine ready")
            emit(job, true)
        }
        Engines.ensureReady(ctx)
        job.line = null
        if (Config.autoEngineUpdate(ctx) && Engines.olderThan(Engines.ytdlpVersion(ctx), Config.minYtDlp(ctx))) {
            runCatching { Engines.updateYtDlp(ctx) }
        }
        // Downloading, merging and copying into shared storage briefly needs about twice the file size.
        val free = StatFs(ctx.cacheDir.path).availableBytes
        val need = if (job.expectedBytes > 0) job.expectedBytes * 2 + (50L shl 20) else 100L shl 20
        if (free < need) return fail(ctx, job, "No space left on device: about ${need shr 20} MB needed, ${free shr 20} MB free")
        val dir = File(ctx.cacheDir, "jobs/${job.id}")
        fun out() = File(dir, if (job.usedFallback) "b" else "a")
        // Read once: start from the sheet's answer (waiting for it while the sheet is still reading).
        val info = if (job.template.engine == "ytdlp" && !job.isPlaylist && !job.usedFallback) InfoCache.get(ctx, job.url) else null
        var res = execute(ctx, job, job.template, out(), info)
        if (job.status == "canceled") return cleanup(dir)
        if (job.status == "queued") return // paused by the system; resumes later from the .part files
        // The download links in that answer can expire: read the link itself once.
        if (info != null && job.files.isEmpty() && res.code != 0) {
            InfoCache.drop(ctx, job.url)
            res = execute(ctx, job, job.template, out())
            if (job.status == "canceled") return cleanup(dir)
            if (job.status == "queued") return
        }
        // Nothing saved yet: maybe the post only has photos, or the site changed (self-heal once).
        if (job.files.isEmpty() && res.code != 0 && !job.usedFallback && job.fallback != null && NO_VIDEO.containsMatchIn(res.err)) {
            job.usedFallback = true
            res = execute(ctx, job, job.template, out())
        }
        if (job.files.isEmpty() && res.code != 0 && job.template.engine == "ytdlp" && !job.healed &&
            Config.autoEngineUpdate(ctx) && !USER_SIDE.containsMatchIn(res.err)
        ) {
            job.healed = true
            job.line = Config.text(ctx, "updatingEngine", "Updating engine and trying again")
            emit(job, true)
            if (runCatching { Engines.updateYtDlp(ctx) }.getOrDefault(false)) res = execute(ctx, job, job.template, out())
        }
        if (job.status == "canceled") return cleanup(dir)
        if (job.status == "queued") return
        // Files that were not announced while running (thumbnails…) only count when the run succeeded.
        if (res.code == 0) collect(out()).forEach { publishNow(ctx, job, it, deleteSource = true) }
        published.remove(job.id)
        if (job.files.isEmpty()) {
            val why = if (res.code == 0) "Nothing was downloaded.\n${res.err.takeLast(2000)}" else res.err.ifBlank { "exit code ${res.code}" }
            fail(ctx, job, why)
        } else {
            if (job.titleFromFile) {
                job.title = Progress.titleOf(job.files.first().name)
                job.titleFromFile = false
            }
            job.status = "done"
            // Some playlist items failed (deleted, private…): keep what worked and say so.
            job.error = if (res.code != 0) res.err.takeLast(4000) else null
            job.progress = 100.0
            job.eta = 0
            job.speed = null
            job.line = null
            job.finishedAt = System.currentTimeMillis()
            JobStore.save(job)
            emit(job, true)
            Notifier.done(ctx, job)
        }
        cleanup(dir)
    }

    /** Copy a finished file into Movies/Music/Pictures right away (long playlists fill up as they go). */
    private fun publishNow(ctx: Context, job: Job, file: File, deleteSource: Boolean) {
        val done = published.getOrPut(job.id) { ConcurrentHashMap.newKeySet() }
        val path = file.absolutePath
        if (!file.isFile || file.length() == 0L || !done.add(path)) return
        val saved = try {
            Saver.publish(ctx, file)
        } catch (e: Exception) {
            done.remove(path)
            return
        }
        if (deleteSource) file.delete()
        job.files = job.files + saved
        JobStore.save(job)
        emit(job, true)
    }

    /** yt-dlp's record of finished playlist items, so resumes and retries skip them. */
    private fun archiveOf(ctx: Context, id: String) = File(File(ctx.filesDir, "archives").apply { mkdirs() }, "$id.txt")

    private suspend fun execute(ctx: Context, job: Job, t: Template, dir: File, info: File? = null): Runner.Result {
        dir.mkdirs()
        job.progress = -1.0
        job.eta = -1
        job.speed = null
        return when (t.engine) {
            "gallerydl" -> {
                val args = t.args + listOf("-D", dir.absolutePath) + Engines.cookieArgs(ctx, job.site) + job.url
                Runner.gallery(ctx, job.id, args) { line ->
                    // gallery-dl prints each finished file's path ("# " marks files it skipped). Keep the
                    // source until the end, or gallery-dl would download it again when it repeats.
                    if (line.startsWith("/")) {
                        publishNow(ctx, job, File(line.trim()), deleteSource = false)
                        job.line = "${job.files.size}"
                        summaryTick(ctx)
                    }
                }
            }
            "http" -> withContext(Dispatchers.IO) {
                val err = HttpJob.run(job, dir) { p ->
                    job.progress = p
                    emit(job)
                }
                Runner.Result(if (err == null) 0 else 1, "", err ?: "", 0)
            }
            else -> {
                val tracker = Progress(Progress.streamsOf(t.args))
                val archive = if (job.isPlaylist) listOf("--download-archive", archiveOf(ctx, job.id).absolutePath) else emptyList()
                // From the sheet's answer when there is one: no second read of the link.
                val target = if (info != null) listOf("--load-info-json", info.absolutePath) else listOf(job.url)
                val args = t.args +
                    listOf("-P", dir.absolutePath, "--cache-dir", Engines.cacheDir(ctx), "--progress-template", Progress.TEMPLATE) +
                    // --print would make yt-dlp quiet; --no-quiet keeps the progress lines we read.
                    listOf("--no-quiet", "--print", "after_move:${Progress.FILE_MARK} %(filepath)s") +
                    archive + Engines.cookieArgs(ctx, job.site) + Config.siteArgs(ctx, job.site) + target
                Runner.ytdlp(ctx, job.id, args) { line ->
                    if (line.startsWith(Progress.FILE_MARK)) {
                        publishNow(ctx, job, File(line.removePrefix(Progress.FILE_MARK).trim()), deleteSource = true)
                        return@ytdlp
                    }
                    if (tracker.feed(line)) {
                        job.progress = tracker.percent
                        job.eta = tracker.eta
                        job.speed = tracker.speed
                        job.line = if (tracker.processing) line.take(120) else null
                        if (job.titleFromFile) tracker.destination?.let { job.title = Progress.titleOf(it) }
                        emit(job)
                        persist(job)
                        summaryTick(ctx)
                    }
                }
            }
        }
    }

    /** yt-dlp's per-format pieces before merging ("Title.f137.mp4"). */
    private val PIECE = Regex("""\.f\d+(-\d+)?\.\w+$""")

    /** Finished files in a job folder (partial, temporary and not-yet-merged files are skipped). */
    private fun collect(dir: File): List<File> =
        dir.walkTopDown().filter { f ->
            f.isFile && f.length() > 0 && !f.name.startsWith(".") &&
                !f.name.endsWith(".part") && !f.name.endsWith(".ytdl") && !f.name.endsWith(".temp") &&
                !f.name.contains(".part-Frag") && !f.name.endsWith(".tmp") && !f.name.endsWith(".json") &&
                !PIECE.containsMatchIn(f.name)
        }.sortedBy { it.name }.toList()

    private fun fail(ctx: Context, job: Job, error: String) {
        job.status = "failed"
        job.error = error.takeLast(4000)
        job.line = null
        job.speed = null
        job.finishedAt = System.currentTimeMillis()
        JobStore.save(job)
        emit(job, true)
        Notifier.failed(ctx, job)
    }

    fun cancel(ctx: Context, id: String) {
        val job = JobStore.get(id) ?: return
        if (job.status != "running" && job.status != "queued") return
        val wasQueued = job.status == "queued"
        job.status = "canceled"
        job.speed = null
        job.line = null
        Runner.kill(id)
        published.remove(id)
        JobStore.save(job)
        emit(job, true)
        Notifier.updateSummary(ctx)
        if (wasQueued) cleanup(File(ctx.cacheDir, "jobs/$id"))
    }

    fun retry(ctx: Context, id: String) {
        val job = JobStore.get(id) ?: return
        if (job.status == "running") return
        job.status = "queued"
        job.error = null
        job.progress = -1.0
        job.attempts++
        job.usedFallback = false
        job.healed = false
        // Playlists keep what they already saved; the download archive makes the retry fetch only the rest.
        if (!job.isPlaylist) job.files = emptyList()
        job.finishedAt = null
        JobStore.save(job)
        emit(job, true)
        Notifier.cancel(ctx, job)
        start(ctx)
    }

    fun remove(ctx: Context, ids: List<String>, deleteFiles: Boolean) {
        for (id in ids) {
            val job = JobStore.get(id) ?: continue
            cancel(ctx, id)
            if (deleteFiles) Saver.delete(ctx, job.files)
            Notifier.cancel(ctx, job)
            archiveOf(ctx, id).delete()
            JobStore.remove(id)
            lastEmit.remove(id)
            lastSave.remove(id)
        }
    }

    /** The system is stopping us (time limit, low memory): stop running downloads and queue them again. */
    fun pauseRunning(ctx: Context) {
        JobStore.active().filter { it.status == "running" }.forEach { job ->
            job.status = "queued"
            job.speed = null
            Runner.kill(job.id)
            JobStore.save(job)
            emit(job, true)
        }
        Notifier.updateSummary(ctx)
    }
}
