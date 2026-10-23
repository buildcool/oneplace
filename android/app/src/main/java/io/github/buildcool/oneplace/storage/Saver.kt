package io.github.buildcool.oneplace.storage

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import io.github.buildcool.oneplace.queue.JobFile
import java.io.File

/**
 * Moves finished files from the job's cache folder into shared storage through MediaStore, so videos show
 * up in Gallery (Movies/OnePlace), songs in music apps (Music/OnePlace) and photos in Pictures/OnePlace.
 */
object Saver {
    private const val FOLDER = "OnePlace"

    private val MIME = mapOf(
        "mp4" to "video/mp4", "m4v" to "video/mp4", "mkv" to "video/x-matroska", "webm" to "video/webm",
        "mov" to "video/quicktime", "3gp" to "video/3gpp", "ts" to "video/mp2t",
        "mp3" to "audio/mpeg", "m4a" to "audio/mp4", "aac" to "audio/aac", "opus" to "audio/ogg", "ogg" to "audio/ogg",
        "flac" to "audio/flac", "wav" to "audio/x-wav",
        "jpg" to "image/jpeg", "jpeg" to "image/jpeg", "png" to "image/png", "webp" to "image/webp", "gif" to "image/gif",
        "heic" to "image/heic", "avif" to "image/avif",
        "srt" to "application/x-subrip", "vtt" to "text/vtt", "lrc" to "text/plain", "txt" to "text/plain",
    )

    fun mimeOf(name: String): String {
        val ext = name.substringAfterLast('.', "").lowercase()
        return MIME[ext] ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
    }

    /** Characters that break file names on SD cards (FAT) or in MediaStore. */
    fun safeName(name: String): String {
        val clean = name.replace(Regex("""[\\/:*?"<>|\u0000-\u001f]"""), "_").trim().trimStart('.')
        return clean.ifEmpty { "download" }.let { if (it.length > 200) it.take(190) + "." + it.substringAfterLast('.', "") else it }
    }

    private class Place(val collection: Uri, val dir: String)

    private fun placeFor(mime: String): Place {
        val vol = if (Build.VERSION.SDK_INT >= 29) MediaStore.VOLUME_EXTERNAL_PRIMARY else "external"
        return when {
            mime.startsWith("video/") -> Place(MediaStore.Video.Media.getContentUri(vol), Environment.DIRECTORY_MOVIES)
            mime.startsWith("audio/") -> Place(MediaStore.Audio.Media.getContentUri(vol), Environment.DIRECTORY_MUSIC)
            mime.startsWith("image/") -> Place(MediaStore.Images.Media.getContentUri(vol), Environment.DIRECTORY_PICTURES)
            Build.VERSION.SDK_INT >= 29 -> Place(MediaStore.Downloads.getContentUri(vol), Environment.DIRECTORY_DOWNLOADS)
            else -> Place(MediaStore.Files.getContentUri(vol), Environment.DIRECTORY_DOWNLOADS)
        }
    }

    fun publish(ctx: Context, file: File): JobFile {
        val mime = mimeOf(file.name)
        val place = placeFor(mime)
        val name = safeName(file.name)
        val resolver = ctx.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
        }
        if (Build.VERSION.SDK_INT >= 29) {
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, "${place.dir}/$FOLDER")
            values.put(MediaStore.MediaColumns.IS_PENDING, 1)
            val uri = resolver.insert(place.collection, values) ?: throw IllegalStateException("Could not save $name")
            try {
                resolver.openOutputStream(uri)!!.use { out -> file.inputStream().use { it.copyTo(out, 1 shl 16) } }
                resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
            } catch (e: Exception) {
                resolver.delete(uri, null, null)
                throw e
            }
            return JobFile(uri.toString(), displayName(ctx, uri) ?: name, mime, file.length())
        }
        // Android 7–9: copy into the public folder, then register it (needs the storage permission).
        @Suppress("DEPRECATION")
        val folder = File(Environment.getExternalStoragePublicDirectory(place.dir), FOLDER).apply { mkdirs() }
        val target = unique(folder, name)
        file.copyTo(target, overwrite = false)
        @Suppress("DEPRECATION")
        values.put(MediaStore.MediaColumns.DATA, target.absolutePath)
        val uri = resolver.insert(place.collection, values) ?: Uri.fromFile(target)
        return JobFile(uri.toString(), target.name, mime, target.length())
    }

    private fun unique(dir: File, name: String): File {
        var f = File(dir, name)
        var i = 1
        val base = name.substringBeforeLast('.')
        val ext = name.substringAfterLast('.', "")
        while (f.exists()) f = File(dir, if (ext.isEmpty()) "$base ($i)" else "$base (${i++}).$ext")
        return f
    }

    private fun displayName(ctx: Context, uri: Uri): String? = runCatching {
        ctx.contentResolver.query(uri, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }
    }.getOrNull()

    fun delete(ctx: Context, files: List<JobFile>) {
        for (f in files) runCatching { ctx.contentResolver.delete(Uri.parse(f.uri), null, null) }
    }

    fun openIntent(file: JobFile): Intent =
        Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(file.uri), file.mime)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)

    fun shareIntent(files: List<JobFile>, title: String): Intent {
        val send = if (files.size == 1) {
            Intent(Intent.ACTION_SEND).setType(files[0].mime).putExtra(Intent.EXTRA_STREAM, Uri.parse(files[0].uri))
        } else {
            Intent(Intent.ACTION_SEND_MULTIPLE).setType(commonMime(files))
                .putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList(files.map { Uri.parse(it.uri) }))
        }
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        return Intent.createChooser(send, title).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }

    private fun commonMime(files: List<JobFile>): String {
        val kinds = files.map { it.mime.substringBefore('/') }.toSet()
        return if (kinds.size == 1) "${kinds.first()}/*" else "*/*"
    }
}
