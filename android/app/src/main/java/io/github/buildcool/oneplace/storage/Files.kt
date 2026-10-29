package io.github.buildcool.oneplace.storage

import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import io.github.buildcool.oneplace.queue.Job
import io.github.buildcool.oneplace.queue.JobStore
import io.github.buildcool.oneplace.queue.Queue
import java.io.File

/** Saved files after the download: deleted elsewhere, deleted one by one here, and read by ffmpeg. */
object Files {
    @Volatile
    private var lastCheck = 0L

    /** Does this saved file still exist? Null when the phone will not say (then it is kept). */
    fun exists(ctx: Context, uri: String): Boolean? {
        val u = Uri.parse(uri)
        return when (u.scheme) {
            "file" -> u.path?.let { File(it).exists() }
            // Gallery's trash hides files from queries too, which is what the user meant.
            "content" -> try {
                ctx.contentResolver.query(u, arrayOf(MediaStore.MediaColumns._ID), null, null, null)?.use { it.count > 0 }
            } catch (e: Exception) {
                null
            }
            else -> null
        }
    }

    /**
     * Files deleted in Gallery or a file manager: drop them from their downloads. A download with nothing
     * left to play stays in the list as "Deleted from phone" (it can be downloaded again). Returns the changed jobs.
     */
    fun check(ctx: Context, force: Boolean = false): List<Job> {
        val now = System.currentTimeMillis()
        if (!force && now - lastCheck < 30_000) return emptyList()
        lastCheck = now
        val changed = mutableListOf<Job>()
        for (job in JobStore.all()) {
            if (job.status != "done" || job.files.isEmpty()) continue
            var gone = job.files.filter { exists(ctx, it.uri) == false }.map { it.uri }.toSet()
            if (gone.isEmpty()) continue
            // Only subtitles left: they are not worth keeping without their video.
            if (job.files.none { it.uri !in gone && Thumbs.isMedia(it) }) gone = job.files.map { it.uri }.toSet()
            job.files.filter { it.uri in gone }.forEach { Thumbs.forgetFile(ctx, it) }
            job.removeFiles(gone)
            JobStore.save(job)
            changed += job
        }
        return changed
    }

    /** Delete chosen files from the phone (one photo of a post, one song of a playlist…). */
    fun remove(ctx: Context, refs: List<Pair<String, String>>) {
        for ((id, uris) in refs.groupBy({ it.first }, { it.second })) {
            val job = JobStore.get(id) ?: continue
            val set = uris.toSet()
            val files = job.files.filter { it.uri in set }
            Saver.delete(ctx, files)
            files.forEach { Thumbs.forgetFile(ctx, it) }
            job.removeFiles(set)
            if (job.files.none { Thumbs.isMedia(it) }) {
                Queue.remove(ctx, listOf(id), deleteFiles = true)
            } else {
                JobStore.save(job)
                Queue.emit(job, force = true)
            }
        }
    }

    /** A real path to the file when this app may read it directly (ffmpeg needs one to read MP4 and to copy video). */
    fun readablePath(ctx: Context, uri: String): String? {
        val u = Uri.parse(uri)
        if (u.scheme == "file") return u.path?.takeIf { File(it).canRead() }
        @Suppress("DEPRECATION")
        val path = runCatching {
            ctx.contentResolver.query(u, arrayOf(MediaStore.MediaColumns.DATA), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
        }.getOrNull()
        return path?.takeIf { File(it).canRead() }
    }
}
