package io.github.buildcool.oneplace.browser

import android.content.Context
import android.net.Uri
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.getcapacitor.JSObject
import org.json.JSONArray
import org.json.JSONObject

/**
 * The page script (assets/browser/inject.js, from src/page/inject.ts) and what it tells us. It is added
 * before any of the page's own scripts run, in every frame; its messages arrive through a "OnePlace"
 * object only it and the page can see. A page could send anything, so messages are only hints:
 * checked, trimmed, and never acted on without a tap in the app.
 */
object PageBridge {
    private var source: String? = null

    val earlyScripts: Boolean get() = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
    private val messages: Boolean get() = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)

    private fun source(ctx: Context): String =
        source ?: runCatching { ctx.assets.open("browser/inject.js").bufferedReader().use { it.readText() } }.getOrDefault("").also { source = it }

    fun script(ctx: Context): String = "window.__op_cfg=${Rules.current.pageJson(BrowserLayer.takeover)};\n${source(ctx)}"

    fun attach(ctx: Context, tab: Tab, web: WebView) {
        if (messages) {
            WebViewCompat.addWebMessageListener(web, "OnePlace", setOf("*")) { _, message, origin, isMainFrame, _ ->
                handle(tab, message.data, origin, isMainFrame)
            }
        }
        refresh(ctx, tab, web)
    }

    /** New rules: pages opened from now on get them. */
    fun refresh(ctx: Context, tab: Tab, web: WebView) {
        if (!earlyScripts || !messages) return
        runCatching { tab.script?.remove() }
        tab.script = runCatching { WebViewCompat.addDocumentStartJavaScript(web, script(ctx), setOf("*")) }.getOrNull()
    }

    /** Old WebViews without early scripts: add it once the page has loaded (it then scans what is there). */
    fun lateInject(ctx: Context, web: WebView) {
        if (earlyScripts || !messages) return
        web.evaluateJavascript(script(ctx), null)
    }

    private fun httpUrl(v: Any?): String? = (v as? String)?.takeIf { (it.startsWith("https://") || it.startsWith("http://")) && it.length < 4096 }

    private fun text(v: Any?, max: Int = 200): String? = (v as? String)?.trim()?.takeIf { it.isNotEmpty() }?.take(max)

    private fun num(o: JSONObject, key: String): Long? = o.optLong(key, -1).takeIf { it > 0 && it < 1_000_000_000_000L }

    private fun handle(tab: Tab, data: String?, origin: Uri, isMainFrame: Boolean) {
        if (data == null || data.length > 200_000) return
        val m = runCatching { JSONObject(data) }.getOrNull() ?: return
        when (m.optString("t")) {
            "meta" -> if (isMainFrame) {
                tab.pageTitle = text(m.opt("title"), 300)
                tab.image = httpUrl(m.opt("image"))
                tab.theme = text(m.opt("theme"), 40)?.takeIf { Regex("""^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|[a-zA-Z]+)$""").matches(it) }
                BrowserLayer.changed(tab)
            }
            "media" -> {
                val items = m.optJSONArray("items") ?: return
                val out = JSONArray()
                for (i in 0 until minOf(items.length(), 60)) {
                    val o = items.optJSONObject(i) ?: continue
                    val url = httpUrl(o.opt("url")) ?: continue
                    val kind = o.optString("kind").takeIf { it == "video" || it == "audio" || it == "image" } ?: continue
                    val item = JSONObject().put("url", url).put("kind", kind).put("source", if (kind == "image") "image" else "media")
                    httpUrl(o.opt("thumb"))?.let { item.put("thumb", it) }
                    text(o.opt("title"))?.let { item.put("title", it) }
                    num(o, "w")?.let { item.put("w", it) }
                    num(o, "h")?.let { item.put("h", it) }
                    num(o, "dur")?.let { item.put("dur", it) }
                    out.put(item)
                    if (kind != "image") {
                        val hit = Sniffer.classify(url, null) ?: Sniffer.Hit(url, kind, null)
                        BrowserLayer.sniffed(tab, hit)
                    }
                }
                if (out.length() > 0) BrowserLayer.found(tab, out)
            }
            "links" -> if (isMainFrame) {
                val items = m.optJSONArray("items") ?: return
                val out = JSONArray()
                for (i in 0 until minOf(items.length(), 60)) {
                    val o = items.optJSONObject(i) ?: continue
                    val url = httpUrl(o.opt("url")) ?: continue
                    out.put(JSONObject().put("url", url).put("kind", "video").put("source", "link").apply {
                        text(o.opt("title"))?.let { put("title", it) }
                        httpUrl(o.opt("thumb"))?.let { put("thumb", it) }
                    })
                }
                if (out.length() > 0) BrowserLayer.found(tab, out)
            }
            "view" -> if (isMainFrame) {
                val o = m.optJSONObject("item")
                val url = o?.let { httpUrl(it.opt("url")) }
                val item = if (o == null || url == null) null else JSONObject().put("url", url)
                    .put("kind", o.optString("kind").takeIf { it == "video" || it == "audio" || it == "image" } ?: "video")
                    .put("source", if (o.optBoolean("link")) "link" else "media")
                    .apply {
                        httpUrl(o.opt("thumb"))?.let { put("thumb", it) }
                        num(o, "w")?.let { put("w", it) }
                        num(o, "h")?.let { put("h", it) }
                        num(o, "dur")?.let { put("dur", it) }
                    }
                BrowserLayer.inView(tab, item)
            }
            "ctx" -> {
                val e = JSObject().put("id", tab.id)
                httpUrl(m.opt("link"))?.let { e.put("link", it) }
                text(m.opt("linkText"))?.let { e.put("linkText", it) }
                httpUrl(m.opt("image"))?.let { e.put("image", it) }
                httpUrl(m.opt("video"))?.let { e.put("video", it) }
                httpUrl(m.opt("poster"))?.let { e.put("poster", it) }
                httpUrl(m.opt("post"))?.let { e.put("post", it) }
                if (e.length() > 1) BrowserLayer.context(tab, e)
            }
            "fs" -> BrowserLayer.fullscreenSize(m.optInt("w"), m.optInt("h"))
            "tap" -> if (isMainFrame) tab.lastTap = System.currentTimeMillis()
            "play" -> if (isMainFrame) BrowserLayer.play(tab, m, origin)
        }
    }
}
