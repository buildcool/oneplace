package io.github.buildcool.oneplace.share

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import io.github.buildcool.oneplace.Config
import io.github.buildcool.oneplace.Shares
import io.github.buildcool.oneplace.queue.Queue
import org.json.JSONArray
import org.json.JSONObject

/**
 * "OnePlace · Video / · MP3 / · Thumbnail" in the share menu: queue the link with the saved defaults
 * and show a toast, without opening the app.
 */
class QuickActivity : ComponentActivity() {
    private var pendingUrl: String? = null

    private val storagePermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val url = pendingUrl
        if (granted && url != null) go(url) else finish()
    }

    private val action: String
        get() = when (intent.component?.className?.substringAfterLast('.')) {
            "QuickAudio" -> "audio"
            "QuickThumb" -> "thumbnail"
            else -> "video"
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val url = Shares.textFrom(intent)?.let(Shares::firstUrl)
        if (url == null) {
            toast(Config.text(this, "noLink", "No link found in what you shared"))
            finish()
            return
        }
        if (Build.VERSION.SDK_INT < 29 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED
        ) {
            pendingUrl = url
            storagePermission.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            return
        }
        go(url)
    }

    private fun go(url: String) {
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
