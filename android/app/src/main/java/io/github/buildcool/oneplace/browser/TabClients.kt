package io.github.buildcool.oneplace.browser

import android.content.Intent
import android.graphics.Bitmap
import android.net.http.SslError
import android.os.Message
import android.view.View
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.ByteArrayInputStream

/** Addresses a web page must never reach on the phone itself or the home network. */
fun isPrivateHost(host: String?): Boolean {
    val h = host?.lowercase()?.trim('[', ']') ?: return false
    if (h == "localhost" || h.endsWith(".localhost") || h == "::1" || h == "0.0.0.0") return true
    if (h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80:")) return h.contains(':')
    val p = h.split('.').mapNotNull { it.toIntOrNull() }
    if (p.size != 4 || h.count { it == '.' } != 3) return false
    return p[0] == 127 || p[0] == 10 || (p[0] == 192 && p[1] == 168) || (p[0] == 172 && p[1] in 16..31) || (p[0] == 169 && p[1] == 254)
}

/** Requests the browser stops (ads, trackers, private addresses) get this empty answer. */
fun blockedResponse(): WebResourceResponse =
    WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))

class TabClient(private val tab: Tab) : WebViewClient() {
    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        val url = request.url
        if (request.isForMainFrame) return null
        if (isPrivateHost(url.host) && !isPrivateHost(tab.pageHost)) return blockedResponse()
        if (AdBlock.blocks(url, tab.pageHost, Rules.current)) {
            BrowserLayer.blocked(tab)
            return blockedResponse()
        }
        if (BrowserLayer.stopWebPlayer(tab, url)) return blockedResponse()
        Sniffer.classify(url.toString(), request.requestHeaders)?.let { BrowserLayer.sniffed(tab, it) }
        return null
    }

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val uri = request.url
        return when (uri.scheme?.lowercase()) {
            "http", "https" -> {
                if (request.isForMainFrame && isPrivateHost(uri.host) && !isPrivateHost(tab.pageHost)) return true
                if (request.isForMainFrame) BrowserLayer.userAgentFor(tab, uri)
                false
            }
            "about", "blob", "javascript" -> false
            // A page may not replace itself with data it made (a trick of fake login pages).
            "data" -> request.isForMainFrame
            "intent" -> {
                val intent = runCatching { Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME) }.getOrNull()
                val fallback = intent?.getStringExtra("browser_fallback_url")
                if (fallback != null && (fallback.startsWith("https://") || fallback.startsWith("http://"))) {
                    view.loadUrl(fallback)
                } else if (request.hasGesture()) {
                    BrowserLayer.external(tab, uri.toString())
                }
                true
            }
            else -> {
                if (request.hasGesture()) BrowserLayer.external(tab, uri.toString())
                true
            }
        }
    }

    override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
        BrowserLayer.pageStarted(tab, url ?: return)
    }

    override fun onPageFinished(view: WebView, url: String?) {
        BrowserLayer.pageFinished(tab, url ?: return)
    }

    override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
        BrowserLayer.visited(tab, url ?: return)
    }

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        if (!request.isForMainFrame) return
        val code = when (error.errorCode) {
            WebViewClient.ERROR_HOST_LOOKUP -> "dns"
            WebViewClient.ERROR_CONNECT, WebViewClient.ERROR_TIMEOUT, WebViewClient.ERROR_IO -> "connect"
            WebViewClient.ERROR_FAILED_SSL_HANDSHAKE -> "ssl"
            WebViewClient.ERROR_UNSUPPORTED_SCHEME, WebViewClient.ERROR_BAD_URL -> "url"
            else -> "other"
        }
        BrowserLayer.mainError(tab, code, error.description?.toString())
    }

    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
        // Never bypassed: a broken certificate may mean someone is reading or changing the page.
        handler.cancel()
        tab.sslError = true
        BrowserLayer.mainError(tab, "ssl", error.url ?: view.url)
    }

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        BrowserLayer.rendererGone(tab)
        return true
    }
}

class TabChrome(private val tab: Tab) : WebChromeClient() {
    override fun onProgressChanged(view: WebView, newProgress: Int) {
        tab.progress = newProgress
        BrowserLayer.changed(tab)
    }

    override fun onReceivedTitle(view: WebView, title: String?) {
        tab.title = title?.take(300) ?: ""
        BrowserLayer.changed(tab)
    }

    override fun onReceivedIcon(view: WebView, icon: Bitmap?) {
        icon?.let { BrowserLayer.icon(tab, it) }
    }

    override fun onShowCustomView(view: View, callback: WebChromeClient.CustomViewCallback) {
        BrowserLayer.showFullscreen(view, callback)
    }

    override fun onHideCustomView() {
        BrowserLayer.hideFullscreen()
    }

    override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
        if (!isUserGesture) {
            BrowserLayer.popupBlocked(tab)
            return false
        }
        val child = BrowserLayer.openPopup(tab) ?: return false
        (resultMsg.obj as? WebView.WebViewTransport)?.webView = child
        resultMsg.sendToTarget()
        return true
    }

    override fun onCloseWindow(window: WebView) {
        BrowserLayer.closedByPage(tab)
    }

    override fun onPermissionRequest(request: PermissionRequest) {
        request.deny()
    }

    override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback) {
        callback.invoke(origin, false, false)
    }

    /** No grey "play" picture on videos that have not loaded yet. */
    override fun getDefaultVideoPoster(): Bitmap? = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
}
