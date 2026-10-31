package io.github.buildcool.oneplace.browser

import android.annotation.SuppressLint
import android.content.Context
import android.os.Bundle
import android.view.MotionEvent
import android.webkit.WebView
import androidx.webkit.ScriptHandler
import com.getcapacitor.JSObject
import org.json.JSONObject

/** One browser tab. Its WebView may be freed to save memory (then [saved] keeps its history). */
class Tab(val id: String, val isPrivate: Boolean) {
    var web: TabWebView? = null

    @Volatile
    var url = ""

    /** The page's host, read on the WebView's network threads (ad blocker's per-site switch). */
    @Volatile
    var pageHost: String? = null
    var title = ""
    var icon: String? = null
    var thumb: String? = null
    var thumbAt = 0L
    var progress = 0
    var loading = false
    var sslError = false
    var blocked = 0
    var theme: String? = null
    var desktop = false
    var error: JSONObject? = null
    var image: String? = null
    var pageTitle: String? = null
    var saved: Bundle? = null
    var savedBack = false
    var savedForward = false
    var lastUsed = System.currentTimeMillis()

    /** Last tap inside the page (v1.0.18: YouTube links tapped by the user, not opened by the page). */
    @Volatile
    var lastTap = 0L
    var script: ScriptHandler? = null
    var userAgent = ""

    fun state(): JSObject = JSObject()
        .put("id", id)
        .put("url", url)
        .put("title", title)
        .put("progress", progress)
        .put("loading", loading)
        .put("canBack", web?.canGoBack() ?: savedBack)
        .put("canForward", web?.canGoForward() ?: savedForward)
        .put("secure", url.startsWith("https://") && !sslError)
        .put("blocked", blocked)
        .put("desktop", desktop)
        .put("private", isPrivate)
        .apply {
            icon?.let { put("icon", it) }
            thumb?.let {
                put("thumb", it)
                put("thumbAt", thumbAt)
            }
            theme?.let { put("theme", it) }
            error?.let { put("error", it) }
            image?.let { put("image", it) }
            pageTitle?.let { put("pageTitle", it) }
            if (userAgent.isNotEmpty()) put("userAgent", userAgent)
        }
}

/**
 * The page view. It reports scrolling (the bar shrinks while reading) and a pull down at the very top of
 * the page (reload). The pull counts only when the page itself is at its top: WebView reports an
 * over-scroll for the page's own scrolling only, so lists and reels inside a page never trigger it.
 */
@SuppressLint("ViewConstructor")
class TabWebView(ctx: Context, val tab: Tab) : WebView(ctx) {
    var onPull: ((Float) -> Unit)? = null
    var onRefresh: (() -> Unit)? = null
    var onTap: (() -> Unit)? = null
    private var downY = 0f
    private var downX = 0f
    private var atTopOnDown = false
    private var overscrolled = false
    private var pulling = false
    private val threshold = 110 * resources.displayMetrics.density

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(ev: MotionEvent): Boolean {
        when (ev.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downY = ev.y
                downX = ev.x
                atTopOnDown = scrollY == 0
                overscrolled = false
                pulling = false
            }
            MotionEvent.ACTION_MOVE -> {
                val d = ev.y - downY
                if (atTopOnDown && overscrolled && scrollY == 0 && d > 0) {
                    pulling = true
                    onPull?.invoke(d / threshold)
                } else if (pulling && d <= 0) {
                    pulling = false
                    onPull?.invoke(0f)
                }
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                val d = ev.y - downY
                if (pulling) {
                    pulling = false
                    onPull?.invoke(0f)
                    if (ev.actionMasked == MotionEvent.ACTION_UP && d >= threshold) onRefresh?.invoke()
                }
                if (ev.actionMasked == MotionEvent.ACTION_UP && kotlin.math.abs(d) < 24 && kotlin.math.abs(ev.x - downX) < 24) onTap?.invoke()
            }
        }
        return super.onTouchEvent(ev)
    }

    override fun onOverScrolled(scrollX: Int, scrollY: Int, clampedX: Boolean, clampedY: Boolean) {
        super.onOverScrolled(scrollX, scrollY, clampedX, clampedY)
        if (clampedY && scrollY == 0) overscrolled = true
    }
}
