package io.github.buildcool.oneplace.player

import android.app.Activity
import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.annotation.OptIn
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView

/**
 * The video picture, drawn by a PlayerView placed behind the WebView. While a video is open the page is
 * transparent there (html.video-open), so the web UI's controls float on top of the native video.
 */
@OptIn(UnstableApi::class)
object VideoLayer {
    private var view: PlayerView? = null

    val shown: Boolean get() = view?.let { it.visibility == View.VISIBLE && it.player != null } == true

    fun show(activity: Activity, webView: WebView, player: Player, fill: Boolean) {
        val parent = webView.parent as? ViewGroup ?: return
        val v = view?.takeIf { it.context === activity } ?: PlayerView(activity).apply {
            useController = false
            setShutterBackgroundColor(Color.BLACK)
            setKeepContentOnPlayerReset(true)
            setBackgroundColor(Color.BLACK)
        }.also { view = it }
        if (v.parent !== parent) {
            (v.parent as? ViewGroup)?.removeView(v)
            parent.addView(v, 0, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        v.visibility = View.VISIBLE
        v.resizeMode = if (fill) AspectRatioFrameLayout.RESIZE_MODE_ZOOM else AspectRatioFrameLayout.RESIZE_MODE_FIT
        if (v.player !== player) v.player = player
        webView.setBackgroundColor(Color.TRANSPARENT)
    }

    fun hide() {
        view?.let {
            it.player = null
            it.visibility = View.GONE
        }
    }
}
