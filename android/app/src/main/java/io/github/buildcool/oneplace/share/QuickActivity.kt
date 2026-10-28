package io.github.buildcool.oneplace.share

import android.Manifest
import android.content.ClipboardManager
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import io.github.buildcool.oneplace.Config
import io.github.buildcool.oneplace.Shares
import io.github.buildcool.oneplace.engine.Runner
import io.github.buildcool.oneplace.queue.Queue
import org.json.JSONArray
import org.json.JSONObject

/**
 * "OnePlace · Video / · MP3 / · Thumbnail" in the share menu, and the "Download copied link" tile:
 * queue the link with the saved defaults and show a toast, without opening the app.
 */
class QuickActivity : ComponentActivity() {
    companion object {
        /** From the Quick Settings tile: download the copied link. */
        const val ACTION_COPIED = "io.github.buildcool.oneplace.COPIED"

        /** Like isMusic() in src/core/settings.ts: these copied links download as audio. */
        private val MUSIC_SITES = setOf("ytmusic", "soundcloud", "jiosaavn", "bandcamp", "mixcloud", "audiomack")
    }

    private var pending: Pair<String, String>? = null
    private var waitingForClipboard = false

    private val storagePermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val p = pending
        if (granted && p != null) go(p.first, p.second) else finish()
    }

    /** Which share entry was picked. */
    private val shareAction: String
        get() = when (intent.component?.className?.substringAfterLast('.')) {
            "QuickAudio" -> "audio"
            "QuickThumb" -> "thumbnail"
            else -> "video"
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Python and yt-dlp start loading now; the download is about to need them.
        Runner.prepareSpare(applicationContext)
        if (intent.action == ACTION_COPIED) {
            // Android hands out the clipboard only once this window has focus (onWindowFocusChanged).
            waitingForClipboard = true
            window.decorView.postDelayed({ if (waitingForClipboard) finish() }, 3000)
            return
        }
        val url = Shares.textFrom(intent)?.let(Shares::firstUrl)
        if (url == null) {
            toast(Config.text(this, "noLink", "No link found in what you shared"))
            finish()
            return
        }
        start(url, shareAction)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (!hasFocus || !waitingForClipboard) return
        waitingForClipboard = false
        val clip = runCatching { getSystemService(ClipboardManager::class.java)?.primaryClip }.getOrNull()
        val url = clip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(this)?.toString()?.let(Shares::firstUrl)
        if (url == null) {
            toast(Config.text(this, "noCopied", "Copy a video link first, then tap the tile"))
            finish()
            return
        }
        start(url, if (Shares.siteOf(url) in MUSIC_SITES) "audio" else "video")
    }

    private fun start(url: String, action: String) {
        if (Build.VERSION.SDK_INT < 29 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED
        ) {
            pending = url to action
            storagePermission.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            return
        }
        go(url, action)
    }

    private fun go(url: String, action: String) {
        val q = Config.quick(this, action)
        if (q == null) {
            finish()
            return
        }
        val request = JSONObject()
            .put("url", url)
            .put("site", Shares.siteOf(url))
            .put("title", url)
            .put("titleFromFile", true)
            .put("mode", q.mode)
            .put("engine", q.main.engine)
            .put("args", JSONArray(q.main.args))
            .put("dest", q.main.dest)
        q.fallback?.let { request.put("fallback", it.toJson()) }
        // Queue while this (invisible) activity is in front: Android only lets visible apps start user-initiated jobs.
        Queue.enqueue(applicationContext, request)
        toast(Config.text(this, "added", "Added to OnePlace"))
        finish()
    }

    private fun toast(text: String) = Toast.makeText(applicationContext, text, Toast.LENGTH_SHORT).show()
}
