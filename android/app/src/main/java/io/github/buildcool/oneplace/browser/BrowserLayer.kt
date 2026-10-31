package io.github.buildcool.oneplace.browser

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.pm.ActivityInfo
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.net.ConnectivityManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.ContextThemeWrapper
import android.view.Gravity
import android.view.PixelCopy
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewDatabase
import android.widget.FrameLayout
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.ProfileStore
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.getcapacitor.JSObject
import io.github.buildcool.oneplace.R
import java.io.File
import java.lang.ref.WeakReference
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import org.json.JSONArray
import org.json.JSONObject

/**
 * The in-app browser's pages. Each tab is a WebView inside one container that sits next to the app's own
 * WebView (like the video player's picture). While a page is shown the container is on top, exactly in
 * the area the app's bars leave free, so touches and the keyboard go straight to the page. When the app
 * opens a sheet over the page, the container moves behind the app's (then transparent) WebView, so the
 * sheet slides over the real page. At most three tabs keep a live WebView; the others keep their history
 * and come back when opened. Everything here runs on the main thread unless it says otherwise.
 */
@SuppressLint("StaticFieldLeak")
object BrowserLayer {
    private const val LIVE_MAX = 3
    private const val PRIVATE = "oneplace-private"
    private const val THUMB_SCALE = 0.4f

    /** PluginBrowser sends these to the UI. */
    @Volatile
    var emit: ((String, JSObject) -> Unit)? = null

    private val main = Handler(Looper.getMainLooper())
    private var activity: WeakReference<Activity>? = null
    private var appWeb: WeakReference<WebView>? = null
    private var container: FrameLayout? = null
    private var pull: TextView? = null
    private val tabs = LinkedHashMap<String, Tab>()
    private var activeId: String? = null

    private var top = 0
    private var bottom = 0
    private var visible = false
    private var overlay = false
    private var onTop: Boolean? = null
    private var pageKeyboard = false
    private var secured = false
    private var resumedId: String? = null

    /** v1.0.18: YouTube and YT Music play in OnePlace's player. */
    @Volatile
    var takeover = false
        private set
    private var thirdPartyCookies = false
    private var darkPages = true
    private var appDark = false
    private var hideBars = true
    private var rulesJson = ""

    private var fullscreenView: View? = null
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null
    private var orientationBefore = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED

    private val dirty = LinkedHashSet<String>()
    private var flushPosted = false
    private var collapsed = false
    private var scrollAcc = 0

    val privateTabs: Boolean get() = WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)

    private fun dp(v: Int): Int = (v * (activity?.get()?.resources?.displayMetrics?.density ?: 2f)).roundToInt()

    // ---------- the container ----------

    fun attach(a: Activity, app: WebView) {
        val old = container
        if (old != null && old.context === a && old.parent != null) return
        // A new screen (the old one was recreated): the old pages can't move along.
        if (old != null) {
            tabs.values.forEach { destroyWeb(it, alive = false) }
            tabs.clear()
            activeId = null
            resumedId = null
            (old.parent as? ViewGroup)?.removeView(old)
            container = null
        }
        activity = WeakReference(a)
        appWeb = WeakReference(app)
        val parent = app.parent as? ViewGroup ?: return
        val c = FrameLayout(a).apply { visibility = View.GONE }
        parent.addView(c, ViewGroup.MarginLayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        container = c
        onTop = null
        val p = TextView(a).apply {
            text = "↻"
            textSize = 20f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(0xEE1F1D33.toInt())
            }
            elevation = dp(6).toFloat()
            alpha = 0f
        }
        c.addView(p, FrameLayout.LayoutParams(dp(42), dp(42), Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply { topMargin = dp(10) })
        pull = p
        ViewCompat.setOnApplyWindowInsetsListener(c) { _, insets ->
            keyboard(insets.isVisible(WindowInsetsCompat.Type.ime()))
            insets
        }
        app.setBackgroundColor(Color.TRANSPARENT)
    }

    /** The page area in CSS pixels of the app (from the top and the bottom of the screen). */
    fun layout(topCss: Double, bottomCss: Double, show: Boolean, over: Boolean) {
        val d = activity?.get()?.resources?.displayMetrics?.density ?: return
        top = (topCss * d).roundToInt()
        bottom = (bottomCss * d).roundToInt()
        visible = show
        overlay = over
        applyLayout()
    }

    private fun applyLayout() {
        val c = container ?: return
        val lp = c.layoutParams as? ViewGroup.MarginLayoutParams ?: return
        if (lp.topMargin != top || lp.bottomMargin != bottom) {
            lp.topMargin = top
            lp.bottomMargin = bottom
            c.layoutParams = lp
        }
        c.visibility = if (visible) View.VISIBLE else View.GONE
        val wantTop = visible && !overlay
        if (onTop != wantTop) {
            onTop = wantTop
            if (wantTop) c.bringToFront() else appWeb?.get()?.bringToFront()
            (c.parent as? View)?.invalidate()
        }
        // Only the page on screen runs its timers and media.
        val want = if (visible) active() else null
        if (want?.id != resumedId) {
            resumedId?.let { tabs[it]?.web?.onPause() }
            want?.web?.onResume()
            resumedId = want?.id
        }
        secure()
    }

    private fun active(): Tab? = activeId?.let { tabs[it] }

    /** No screenshots of private tabs. */
    private fun secure() {
        val a = activity?.get() ?: return
        val want = visible && active()?.isPrivate == true
        if (want == secured) return
        secured = want
        if (want) a.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE) else a.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }

    private fun keyboard(open: Boolean) {
        val inPage = open && active()?.web?.hasFocus() == true
        if (inPage == pageKeyboard) return
        pageKeyboard = inPage
        send("keyboard", JSObject().put("open", inPage))
    }

    // ---------- tabs ----------

    private fun cookies(priv: Boolean): CookieManager =
        if (priv && privateTabs) runCatching { ProfileStore.getInstance().getOrCreateProfile(PRIVATE).cookieManager }.getOrDefault(CookieManager.getInstance())
        else CookieManager.getInstance()

    /** Cookies for an address, from the right cookie jar (private tabs have their own). Any thread. */
    fun cookieFor(url: String, priv: Boolean): String? {
        if (Looper.myLooper() == Looper.getMainLooper()) return runCatching { cookies(priv).getCookie(url) }.getOrNull()
        val latch = CountDownLatch(1)
        var out: String? = null
        main.post {
            out = runCatching { cookies(priv).getCookie(url) }.getOrNull()
            latch.countDown()
        }
        latch.await(3, TimeUnit.SECONDS)
        return out
    }

    private fun defaultUa(ctx: Context): String = runCatching { WebSettings.getDefaultUserAgent(ctx) }.getOrDefault("")

    /** The phone's Chrome, without the "this is an app's WebView" marks. */
    private fun chromeUa(ctx: Context) = defaultUa(ctx).replace("; wv", "").replace(Regex("""Version/[\d.]+ """), "")

    private fun desktopUa(ctx: Context): String {
        val v = Regex("""Chrome/([\d.]+)""").find(defaultUa(ctx))?.groupValues?.get(1) ?: "131.0.0.0"
        return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$v Safari/537.36"
    }

    /** Desktop mode, or a site that only works with a normal browser's user agent (rules). */
    fun userAgentFor(tab: Tab, uri: Uri) {
        val w = tab.web ?: return
        val ctx = w.context
        val rule = uri.host?.let { Rules.current.uaFor(it) }
        val want = when {
            tab.desktop || rule == "desktop" -> desktopUa(ctx)
            rule == "chrome" -> chromeUa(ctx)
            else -> defaultUa(ctx)
        }
        if (w.settings.userAgentString != want) w.settings.userAgentString = want
        tab.userAgent = want
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWeb(tab: Tab): TabWebView? {
        val a = activity?.get() ?: return null
        val c = container ?: return null
        val dark = appDark && darkPages
        val w = TabWebView(ContextThemeWrapper(a, if (dark) R.style.OnePlace_WebDark else R.style.OnePlace_WebLight), tab)
        if (tab.isPrivate && privateTabs) {
            runCatching {
                ProfileStore.getInstance().getOrCreateProfile(PRIVATE)
                WebViewCompat.setProfile(w, PRIVATE)
            }
        }
        w.setBackgroundColor(if (dark) 0xFF0E0D17.toInt() else Color.WHITE)
        w.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = true
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = false
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            loadWithOverviewMode = true
            useWideViewPort = true
            builtInZoomControls = true
            displayZoomControls = false
            setSupportZoom(true)
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) WebSettingsCompat.setAlgorithmicDarkeningAllowed(w.settings, dark)
        tab.userAgent = if (tab.desktop) desktopUa(a) else defaultUa(a)
        w.settings.userAgentString = tab.userAgent
        cookies(tab.isPrivate).apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(w, thirdPartyCookies)
        }
        w.webViewClient = TabClient(tab)
        w.webChromeClient = TabChrome(tab)
        w.setDownloadListener { url, ua, disposition, mime, length -> download(tab, url, ua, disposition, mime, length) }
        w.setFindListener { activeMatch, count, done ->
            if (done) send("find", JSObject().put("id", tab.id).put("index", if (count > 0) activeMatch + 1 else 0).put("count", count))
        }
        w.setOnScrollChangeListener { _, _, y, _, oldY -> if (tab.id == activeId) scrolled(y, oldY) }
        w.onPull = { p -> pulled(p) }
        w.onRefresh = { w.reload() }
        w.onTap = { tab.lastTap = System.currentTimeMillis() }
        w.setOnLongClickListener { if (PageBridge.earlyScripts) false else hitTest(tab, w) }
        PageBridge.attach(a, tab, w)
        w.visibility = View.GONE
        // Pages start paused; applyLayout() resumes the one on screen.
        if (tab.id != activeId || !visible) w.onPause()
        c.addView(w, 0, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        tab.web = w
        return w
    }

    /** Old WebViews without the page script: long-press on links and photos from the WebView itself. */
    private fun hitTest(tab: Tab, w: WebView): Boolean {
        val r = w.hitTestResult
        val extra = r.extra ?: return false
        val e = JSObject().put("id", tab.id)
        when (r.type) {
            WebView.HitTestResult.SRC_ANCHOR_TYPE -> e.put("link", extra)
            WebView.HitTestResult.IMAGE_TYPE, WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE -> e.put("image", extra)
            else -> return false
        }
        send("context", e)
        return true
    }

    private fun destroyWeb(tab: Tab, alive: Boolean = true) {
        val w = tab.web ?: return
        tab.web = null
        tab.script = null
        if (alive) {
            runCatching {
                w.stopLoading()
                w.onPause()
            }
        }
        (w.parent as? ViewGroup)?.removeView(w)
        runCatching { w.destroy() }
    }

    /** Keep at most three live pages; the others keep their history in memory. */
    private fun trimLive() {
        val live = tabs.values.filter { it.web != null && it.id != activeId }.sortedByDescending { it.lastUsed }
        live.drop(LIVE_MAX - 1).forEach { sleep(it) }
    }

    private fun sleep(tab: Tab) {
        val w = tab.web ?: return
        val b = Bundle()
        runCatching { w.saveState(b) }
        tab.saved = b
        tab.savedBack = w.canGoBack()
        tab.savedForward = w.canGoForward()
        destroyWeb(tab)
    }

    private fun load(tab: Tab, url: String) {
        val w = tab.web ?: return
        val uri = Uri.parse(url)
        tab.url = url
        tab.pageHost = uri.host
        userAgentFor(tab, uri)
        w.loadUrl(url)
    }

    fun open(id: String, url: String, priv: Boolean, background: Boolean) {
        val tab = tabs.getOrPut(id) { Tab(id, priv) }
        if (!background) return select(id, url)
        if (tab.web == null) createWeb(tab)
        if (url.isNotEmpty()) load(tab, url)
        tab.lastUsed = System.currentTimeMillis() - 1
        trimLive()
        changedNow(tab)
    }

    /** Show a tab (creating or waking its page). [url] opens a tab the app remembered from before. */
    fun select(id: String, url: String = "", priv: Boolean = false) {
        val tab = tabs.getOrPut(id) { Tab(id, priv) }
        activeId = id
        tab.lastUsed = System.currentTimeMillis()
        if (tab.web == null) {
            val w = createWeb(tab)
            val saved = tab.saved
            tab.saved = null
            if (w != null && saved != null && w.restoreState(saved) != null) {
                tab.url = w.url ?: tab.url
                tab.pageHost = Uri.parse(tab.url).host
            } else if (url.isNotEmpty() || tab.url.isNotEmpty()) {
                load(tab, url.ifEmpty { tab.url })
            }
        } else if (url.isNotEmpty() && tab.url.isEmpty()) {
            load(tab, url)
        }
        tabs.values.forEach { t -> t.web?.visibility = if (t === tab) View.VISIBLE else View.GONE }
        collapsed = false
        scrollAcc = 0
        trimLive()
        applyLayout()
        changedNow(tab)
    }

    fun navigate(id: String, url: String) {
        val tab = tabs[id] ?: return select(id, url)
        if (tab.web == null) {
            tab.saved = null
            createWeb(tab)
            tab.web?.visibility = if (id == activeId) View.VISIBLE else View.GONE
        }
        tab.error = null
        load(tab, url)
    }

    fun close(id: String) {
        val tab = tabs.remove(id) ?: return
        destroyWeb(tab)
        if (activeId == id) activeId = null
        if (tab.isPrivate) {
            tab.thumb?.let { File(it).delete() }
            if (tabs.values.none { it.isPrivate }) main.postDelayed({ deletePrivate() }, 800)
        }
        applyLayout()
    }

    fun deletePrivate() {
        if (tabs.values.any { it.isPrivate } || !privateTabs) return
        runCatching { ProfileStore.getInstance().deleteProfile(PRIVATE) }
    }

    /** Android back inside a page: leave full screen, else go back. False: nothing to go back to. */
    fun back(id: String): Boolean {
        if (fullscreenView != null) {
            hideFullscreen()
            return true
        }
        val w = tabs[id]?.web ?: return false
        if (!w.canGoBack()) return false
        w.goBack()
        return true
    }

    fun forward(id: String) {
        tabs[id]?.web?.takeIf { it.canGoForward() }?.goForward()
    }

    fun reload(id: String) {
        val tab = tabs[id] ?: return
        val w = tab.web
        if (w == null) select(id) else if (tab.error != null && tab.url.isNotEmpty()) load(tab, tab.url) else w.reload()
    }

    fun stop(id: String) {
        tabs[id]?.web?.stopLoading()
    }

    fun find(id: String, query: String, next: Boolean?, clear: Boolean) {
        val w = tabs[id]?.web ?: return
        when {
            clear -> w.clearMatches()
            next != null -> w.findNext(next)
            else -> w.findAllAsync(query)
        }
    }

    fun desktop(id: String, on: Boolean) {
        val tab = tabs[id] ?: return
        tab.desktop = on
        val w = tab.web ?: return
        userAgentFor(tab, Uri.parse(tab.url))
        w.settings.loadWithOverviewMode = true
        w.reload()
        changedNow(tab)
    }

    fun state(): JSObject = JSObject()
        .put("tabs", JSONArray(tabs.values.map { it.state() }))
        .put("active", activeId)
        .put("privateOk", privateTabs)

    /** Low memory: only the tab on screen keeps a live page. */
    fun trim() {
        tabs.values.filter { it.web != null && it.id != activeId }.forEach { sleep(it) }
    }

    fun appPaused() {
        resumedId?.let { tabs[it]?.web?.onPause() }
        resumedId = null
        CookieManager.getInstance().flush()
    }

    fun appResumed() {
        applyLayout()
    }

    fun destroy() {
        tabs.values.forEach { destroyWeb(it) }
        (container?.parent as? ViewGroup)?.removeView(container)
        container = null
        pull = null
    }

    // ---------- settings ----------

    fun configure(ctx: Context, o: JSONObject) {
        val level = o.optString("adblock", "standard")
        val wasLevel = AdBlock.level
        AdBlock.init(ctx, level)
        if (level == "strong" && wasLevel != "strong") thread(name = "op-adblock-get") { runCatching { AdBlock.refresh(ctx.applicationContext) } }
        val dark = o.optBoolean("appDark", appDark)
        val darkP = o.optBoolean("darkPages", darkPages)
        val third = o.optBoolean("thirdPartyCookies", thirdPartyCookies)
        val take = o.optBoolean("takeover", takeover)
        val rules = o.optString("rules", rulesJson)
        hideBars = o.optBoolean("hideBars", hideBars)
        val looksChanged = dark != appDark || darkP != darkPages
        val scriptChanged = take != takeover || rules != rulesJson
        appDark = dark
        darkPages = darkP
        takeover = take
        if (rules != rulesJson) {
            rulesJson = rules
            Rules.current = Rules.parse(rules)
        }
        if (third != thirdPartyCookies) {
            thirdPartyCookies = third
            tabs.values.forEach { t -> t.web?.let { cookies(t.isPrivate).setAcceptThirdPartyCookies(it, third) } }
        }
        if (scriptChanged) tabs.values.forEach { t -> t.web?.let { PageBridge.refresh(ctx, t, it) } }
        // Light/dark pages need new page views: keep each tab's history and swap them.
        if (looksChanged) {
            val live = tabs.values.filter { it.web != null }
            live.forEach { sleep(it) }
            activeId?.let { id -> if (visible) select(id) }
        }
    }

    fun clearData(ctx: Context, cookies: Boolean, cache: Boolean) {
        if (cookies) {
            CookieManager.getInstance().removeAllCookies(null)
            CookieManager.getInstance().flush()
            WebStorage.getInstance().deleteAllData()
            runCatching { WebViewDatabase.getInstance(ctx).clearHttpAuthUsernamePassword() }
            // Site logins are cookies too: downloads stop using them.
            File(ctx.filesDir, "cookies").listFiles()?.forEach { it.delete() }
        }
        if (cache) {
            val w = tabs.values.firstNotNullOfOrNull { it.web }
            if (w != null) w.clearCache(true) else runCatching { WebView(ctx).apply { clearCache(true) }.destroy() }
            File(ctx.filesDir, "browser/thumbs").listFiles()?.forEach { it.delete() }
            File(ctx.filesDir, "browser/icons").listFiles()?.forEach { it.delete() }
        }
    }

    // ---------- what pages report ----------

    private fun send(event: String, data: JSObject) {
        emit?.invoke(event, data)
    }

    /** Tab details changed; sent at most ~8 times a second per tab. */
    fun changed(tab: Tab) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            main.post { changed(tab) }
            return
        }
        dirty += tab.id
        if (flushPosted) return
        flushPosted = true
        main.postDelayed({
            flushPosted = false
            val ids = dirty.toList()
            dirty.clear()
            ids.forEach { id -> tabs[id]?.let { send("tab", it.state()) } }
        }, 120)
    }

    private fun changedNow(tab: Tab) {
        dirty -= tab.id
        send("tab", tab.state())
    }

    fun pageStarted(tab: Tab, url: String) {
        tab.url = url
        tab.pageHost = Uri.parse(url).host
        tab.loading = true
        tab.error = null
        tab.sslError = false
        tab.blocked = 0
        tab.image = null
        tab.pageTitle = null
        tab.theme = null
        Sniffer.reset(tab.id)
        send("finder", JSObject().put("id", tab.id).put("reset", true))
        if (tab.id == activeId) bars(false)
        changedNow(tab)
    }

    fun pageFinished(tab: Tab, url: String) {
        tab.loading = false
        tab.progress = 100
        tab.web?.let { PageBridge.lateInject(it.context, it) }
        changedNow(tab)
        if (tab.id == activeId && !tab.isPrivate) main.postDelayed({ if (tab.id == activeId) capture(tab) }, 1500)
    }

    fun visited(tab: Tab, url: String) {
        if (url.startsWith("data:") || url == "about:blank") return
        tab.url = url
        tab.pageHost = Uri.parse(url).host
        changed(tab)
    }

    fun mainError(tab: Tab, code: String, desc: String?) {
        val offline = code == "connect" || code == "dns"
        val net = activity?.get()?.getSystemService(ConnectivityManager::class.java)?.activeNetwork
        tab.error = JSONObject().put("code", if (offline && net == null) "offline" else code).apply { desc?.let { put("desc", it.take(300)) } }
        tab.loading = false
        changedNow(tab)
    }

    fun rendererGone(tab: Tab) {
        main.post {
            val w = tab.web ?: return@post
            tab.web = null
            tab.script = null
            (w.parent as? ViewGroup)?.removeView(w)
            runCatching { w.destroy() }
            tab.saved = null
            tab.error = JSONObject().put("code", "crash")
            tab.loading = false
            changedNow(tab)
        }
    }

    /** From the WebView's network threads. */
    fun blocked(tab: Tab) {
        main.post {
            tab.blocked++
            changed(tab)
        }
    }

    fun sniffed(tab: Tab, hit: Sniffer.Hit) {
        val ctx = Sniffer.Ctx(tab.url, tab.userAgent) { u -> cookieFor(u, tab.isPrivate) }
        Sniffer.probe(tab.id, hit, ctx) { item -> main.post { if (tabs.containsKey(tab.id)) found(tab, JSONArray().put(item)) } }
    }

    fun found(tab: Tab, items: JSONArray) {
        send("finder", JSObject().put("id", tab.id).put("items", items))
    }

    fun inView(tab: Tab, item: JSONObject?) {
        send("finder", JSObject().put("id", tab.id).put("view", item ?: JSONObject.NULL))
    }

    fun context(tab: Tab, e: JSObject) {
        send("context", e.put("id", tab.id).put("page", tab.url))
    }

    fun external(tab: Tab, url: String) {
        send("external", JSObject().put("id", tab.id).put("url", url))
    }

    fun popupBlocked(tab: Tab) {
        send("popup", JSObject().put("id", tab.id))
    }

    /** A page opened a window after a tap: a new tab next to it. */
    fun openPopup(parent: Tab): WebView? {
        val id = "p${System.currentTimeMillis().toString(36)}"
        val tab = Tab(id, parent.isPrivate)
        tabs[id] = tab
        val w = createWeb(tab) ?: return null
        send("newTab", JSObject().put("id", id).put("parent", parent.id).put("private", parent.isPrivate))
        return w
    }

    fun closedByPage(tab: Tab) {
        send("closed", JSObject().put("id", tab.id))
    }

    private fun download(tab: Tab, url: String, ua: String?, disposition: String?, mime: String?, length: Long) {
        val name = runCatching { URLUtil.guessFileName(url, disposition, mime) }.getOrNull()
        send("download", JSObject().put("id", tab.id).put("url", url).put("page", tab.url).put("ua", ua ?: tab.userAgent).put("mime", mime ?: "").put("size", length).put("name", name ?: ""))
    }

    fun icon(tab: Tab, bmp: Bitmap) {
        if (tab.isPrivate) return
        val ctx = activity?.get()?.applicationContext ?: return
        val host = tab.pageHost ?: return
        val copy = runCatching { Bitmap.createScaledBitmap(bmp, min(bmp.width, 96), min(bmp.height, 96), true) }.getOrNull() ?: return
        thread(name = "op-icon") {
            val f = File(File(ctx.filesDir, "browser/icons").apply { mkdirs() }, sha1(host).take(16) + ".png")
            val ok = runCatching { f.outputStream().use { copy.compress(Bitmap.CompressFormat.PNG, 100, it) } }.isSuccess
            if (ok) main.post {
                tab.icon = f.absolutePath
                changed(tab)
            }
        }
    }

    private fun sha1(s: String) = MessageDigest.getInstance("SHA-1").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }

    // ---------- bars, pull to reload ----------

    private fun scrolled(y: Int, oldY: Int) {
        if (!hideBars) return
        val dy = y - oldY
        if (y <= dp(8)) {
            scrollAcc = 0
            bars(false)
            return
        }
        scrollAcc = if ((dy > 0) == (scrollAcc > 0)) scrollAcc + dy else dy
        if (scrollAcc > dp(28) && y > dp(64)) bars(true) else if (scrollAcc < -dp(28)) bars(false)
    }

    private fun bars(collapse: Boolean) {
        if (collapse == collapsed) return
        collapsed = collapse
        send("bars", JSObject().put("collapsed", collapse))
    }

    private fun pulled(progress: Float) {
        val p = pull ?: return
        if (progress <= 0f) {
            p.animate().alpha(0f).translationY(0f).setDuration(150).start()
            return
        }
        p.animate().cancel()
        val shown = min(progress, 1.3f)
        p.alpha = min(1f, progress * 1.2f)
        p.translationY = shown * dp(36)
        p.rotation = progress * 300f
        val s = 0.6f + 0.4f * min(1f, progress)
        p.scaleX = s
        p.scaleY = s
        p.setTextColor(if (progress >= 1f) 0xFFB9ADFF.toInt() else Color.WHITE)
    }

    // ---------- full screen videos ----------

    fun showFullscreen(view: View, cb: WebChromeClient.CustomViewCallback) {
        val a = activity?.get()
        if (a == null || fullscreenView != null) {
            cb.onCustomViewHidden()
            return
        }
        view.setBackgroundColor(Color.BLACK)
        (a.window.decorView as ViewGroup).addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        fullscreenView = view
        fullscreenCallback = cb
        orientationBefore = a.requestedOrientation
        a.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR
        WindowCompat.getInsetsController(a.window, a.window.decorView).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }
        send("fullscreen", JSObject().put("on", true))
    }

    /** The page told the size of its full-screen video: wide ones turn the phone sideways. */
    fun fullscreenSize(w: Int, h: Int) {
        val a = activity?.get() ?: return
        if (fullscreenView == null || w <= 0 || h <= 0) return
        a.requestedOrientation = if (w > h) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE else ActivityInfo.SCREEN_ORIENTATION_SENSOR
    }

    fun hideFullscreen() {
        val v = fullscreenView ?: return
        fullscreenView = null
        (v.parent as? ViewGroup)?.removeView(v)
        val cb = fullscreenCallback
        fullscreenCallback = null
        runCatching { cb?.onCustomViewHidden() }
        activity?.get()?.let { a ->
            a.requestedOrientation = orientationBefore
            WindowCompat.getInsetsController(a.window, a.window.decorView).show(WindowInsetsCompat.Type.systemBars())
        }
        send("fullscreen", JSObject().put("on", false))
    }

    // ---------- tab pictures ----------

    fun capture(tab: Tab, done: (() -> Unit)? = null) {
        val a = activity?.get()
        val w = tab.web
        val c = container
        if (a == null || w == null || c == null || !w.isAttachedToWindow || w.visibility != View.VISIBLE || c.visibility != View.VISIBLE || onTop != true || w.width == 0 || w.height == 0) {
            done?.invoke()
            return
        }
        val bmp = Bitmap.createBitmap(max(1, (w.width * THUMB_SCALE).toInt()), max(1, (w.height * THUMB_SCALE).toInt()), Bitmap.Config.ARGB_8888)
        val save = {
            val dir = if (tab.isPrivate) File(a.cacheDir, "browser-private") else File(a.filesDir, "browser/thumbs")
            thread(name = "op-thumb") {
                dir.mkdirs()
                val f = File(dir, "${tab.id}.jpg")
                val ok = runCatching { f.outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 72, it) } }.isSuccess
                main.post {
                    if (ok) {
                        tab.thumb = f.absolutePath
                        tab.thumbAt = System.currentTimeMillis()
                        changedNow(tab)
                    }
                    done?.invoke()
                }
            }
        }
        if (Build.VERSION.SDK_INT >= 26) {
            val loc = IntArray(2)
            w.getLocationInWindow(loc)
            val ok = runCatching {
                PixelCopy.request(a.window, Rect(loc[0], loc[1], loc[0] + w.width, loc[1] + w.height), bmp, { r -> if (r == PixelCopy.SUCCESS) save() else done?.invoke() }, main)
            }.isSuccess
            if (!ok) done?.invoke()
        } else {
            runCatching {
                val canvas = Canvas(bmp)
                canvas.scale(THUMB_SCALE, THUMB_SCALE)
                w.draw(canvas)
            }
            save()
        }
    }

    fun captureActive(done: () -> Unit) {
        val t = active() ?: return done()
        capture(t, done)
    }

    // ---------- YouTube in OnePlace's player (v1.0.18) ----------

    /** While a YouTube page plays in OnePlace's player, the page's own player loads nothing. */
    fun stopWebPlayer(tab: Tab, url: Uri): Boolean {
        if (!takeover) return false
        val host = url.host ?: return false
        if (!host.endsWith("googlevideo.com") || !url.path.orEmpty().contains("videoplayback")) return false
        val page = tab.pageHost ?: return false
        val path = Uri.parse(tab.url).path.orEmpty()
        return page == "music.youtube.com" || ((page.endsWith("youtube.com")) && path.startsWith("/watch"))
    }

    fun play(tab: Tab, m: JSONObject, origin: Uri) {
        if (!takeover) return
        val host = origin.host ?: return
        if (host != "youtube.com" && !host.endsWith(".youtube.com")) return
        val url = m.optString("url")
        if (!url.startsWith("https://")) return
        val e = JSObject().put("id", tab.id).put("url", url).put("music", host == "music.youtube.com")
        m.optString("title").takeIf { it.isNotBlank() }?.let { e.put("title", it.take(300)) }
        m.optString("thumb").takeIf { it.startsWith("https://") }?.let { e.put("thumb", it) }
        m.optString("artist").takeIf { it.isNotBlank() }?.let { e.put("artist", it.take(200)) }
        send("play", e)
    }
}
