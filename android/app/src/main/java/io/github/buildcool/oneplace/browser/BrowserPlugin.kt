package io.github.buildcool.oneplace.browser

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import androidx.webkit.ServiceWorkerClientCompat
import androidx.webkit.ServiceWorkerControllerCompat
import androidx.webkit.WebViewFeature
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.WebViewListener
import com.getcapacitor.annotation.CapacitorPlugin
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/** Bridge for the in-app browser (src/engine/browser.ts ↔ BrowserLayer). */
@CapacitorPlugin(name = "Browser")
class BrowserPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun load() {
        BrowserLayer.emit = { event, data -> notifyListeners(event, data) }
        AdBlock.init(context)
        // Left over from a private tab when the app was closed.
        BrowserLayer.deletePrivate()
        // Pages share one drawing process with the app's own screen: if a heavy page takes it down,
        // start the screen again instead of closing the app (tabs come back from the app's list).
        bridge.addWebViewListener(object : WebViewListener() {
            override fun onRenderProcessGone(webView: WebView?, detail: RenderProcessGoneDetail?): Boolean {
                activity?.let { a -> a.runOnUiThread { a.recreate() } }
                return true
            }
        })
        // Requests made by sites' service workers skip the pages' own hooks: block ads there too.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE) &&
            WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_SHOULD_INTERCEPT_REQUEST)
        ) {
            ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(object : ServiceWorkerClientCompat() {
                override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? =
                    if (!request.isForMainFrame && AdBlock.blocks(request.url, null, Rules.current)) blockedResponse() else null
            })
        }
    }

    override fun handleOnPause() {
        BrowserLayer.appPaused()
        super.handleOnPause()
    }

    override fun handleOnResume() {
        super.handleOnResume()
        BrowserLayer.appResumed()
    }

    override fun handleOnDestroy() {
        scope.cancel()
        BrowserLayer.destroy()
        super.handleOnDestroy()
    }

    private fun main(call: PluginCall, block: () -> Unit) {
        bridge.executeOnMainThread {
            try {
                BrowserLayer.attach(activity, bridge.webView)
                block()
            } catch (e: Exception) {
                call.reject(e.message ?: e.toString())
            }
        }
    }

    private fun id(call: PluginCall): String? = call.getString("id")

    @PluginMethod
    fun layout(call: PluginCall) {
        main(call) {
            BrowserLayer.layout(call.getDouble("top") ?: 0.0, call.getDouble("bottom") ?: 0.0, call.getBoolean("visible", false) == true, call.getBoolean("overlay", false) == true)
            call.resolve()
        }
    }

    @PluginMethod
    fun open(call: PluginCall) {
        val id = id(call) ?: return call.reject("id missing")
        main(call) {
            BrowserLayer.open(id, call.getString("url") ?: "", call.getBoolean("private", false) == true, call.getBoolean("background", false) == true)
            call.resolve()
        }
    }

    @PluginMethod
    fun select(call: PluginCall) {
        val id = id(call) ?: return call.reject("id missing")
        main(call) {
            BrowserLayer.select(id, call.getString("url") ?: "", call.getBoolean("private", false) == true)
            call.resolve()
        }
    }

    @PluginMethod
    fun navigate(call: PluginCall) {
        val id = id(call) ?: return call.reject("id missing")
        val url = call.getString("url") ?: return call.reject("url missing")
        main(call) {
            BrowserLayer.navigate(id, url)
            call.resolve()
        }
    }

    @PluginMethod
    fun close(call: PluginCall) {
        val id = id(call) ?: return call.reject("id missing")
        main(call) {
            BrowserLayer.close(id)
            call.resolve()
        }
    }

    @PluginMethod
    fun back(call: PluginCall) {
        val id = id(call) ?: return call.reject("id missing")
        main(call) { call.resolve(JSObject().put("value", BrowserLayer.back(id))) }
    }

    @PluginMethod
    fun forward(call: PluginCall) {
        val id = id(call) ?: return call.reject("id missing")
        main(call) {
            BrowserLayer.forward(id)
            call.resolve()
        }
    }

    @PluginMethod
    fun reload(call: PluginCall) {
        val id = id(call) ?: return call.reject("id missing")
        main(call) {
            BrowserLayer.reload(id)
            call.resolve()
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        val id = id(call) ?: return call.reject("id missing")
        main(call) {
            BrowserLayer.stop(id)
            call.resolve()
        }
    }

    @PluginMethod
    fun find(call: PluginCall) {
        val id = id(call) ?: return call.reject("id missing")
        main(call) {
            BrowserLayer.find(id, call.getString("query") ?: "", call.getBoolean("next"), call.getBoolean("clear", false) == true)
            call.resolve()
        }
    }

    @PluginMethod
    fun desktop(call: PluginCall) {
        val id = id(call) ?: return call.reject("id missing")
        main(call) {
            BrowserLayer.desktop(id, call.getBoolean("on", false) == true)
            call.resolve()
        }
    }

    /** A fresh picture of the tab on screen for the tab switcher (before a sheet covers it). */
    @PluginMethod
    fun capture(call: PluginCall) {
        main(call) { BrowserLayer.captureActive { call.resolve() } }
    }

    @PluginMethod
    fun state(call: PluginCall) {
        main(call) { call.resolve(BrowserLayer.state()) }
    }

    @PluginMethod
    fun configure(call: PluginCall) {
        val json = call.getString("json") ?: return call.reject("json missing")
        main(call) {
            BrowserLayer.configure(context, JSONObject(json))
            call.resolve()
        }
    }

    @PluginMethod
    fun exitFullscreen(call: PluginCall) {
        main(call) {
            BrowserLayer.hideFullscreen()
            call.resolve()
        }
    }

    /** The ad blocker for one site: switch it, or only read it. */
    @PluginMethod
    fun site(call: PluginCall) {
        val host = call.getString("host")?.lowercase() ?: return call.reject("host missing")
        call.getBoolean("adblock")?.let { AdBlock.setAllowed(context, host, !it) }
        call.resolve(JSObject().put("adblock", AdBlock.level != "off" && !AdBlock.isAllowed(host)).put("level", AdBlock.level))
    }

    @PluginMethod
    fun clearData(call: PluginCall) {
        main(call) {
            BrowserLayer.clearData(context, call.getBoolean("cookies", false) == true, call.getBoolean("cache", false) == true)
            call.resolve()
        }
    }

    /** An app link the user agreed to open (never one a page opened by itself). */
    @PluginMethod
    fun openApp(call: PluginCall) {
        val url = call.getString("url") ?: return call.reject("url missing")
        main(call) {
            val intent = if (url.startsWith("intent:")) {
                Intent.parseUri(url, Intent.URI_INTENT_SCHEME).apply {
                    // Only apps that agree to be opened from a browser; never a hidden part of an app.
                    addCategory(Intent.CATEGORY_BROWSABLE)
                    component = null
                    selector = null
                }
            } else {
                Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)
            }
            try {
                activity.startActivity(intent)
                call.resolve(JSObject().put("value", true))
            } catch (e: ActivityNotFoundException) {
                call.resolve(JSObject().put("value", false))
            }
        }
    }

    @PluginMethod
    fun shareText(call: PluginCall) {
        val text = call.getString("text") ?: return call.reject("text missing")
        main(call) {
            val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
            activity.startActivity(Intent.createChooser(send, null))
            call.resolve()
        }
    }

    /** Search suggestions from the chosen search engine (OpenSearch JSON). */
    @PluginMethod
    fun suggest(call: PluginCall) {
        val template = call.getString("template") ?: return call.reject("template missing")
        val q = call.getString("q")?.trim()?.take(200) ?: ""
        if (q.isEmpty() || !template.startsWith("https://")) return call.resolve(JSObject().put("items", JSONArray()))
        scope.launch {
            val items = runCatching {
                val c = (URL(template.replace("%s", URLEncoder.encode(q, "UTF-8"))).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 5_000
                    readTimeout = 5_000
                }
                try {
                    if (c.responseCode != 200) return@runCatching JSONArray()
                    val text = c.inputStream.bufferedReader().use { it.readText() }.take(64_000)
                    JSONArray(text).optJSONArray(1) ?: JSONArray()
                } finally {
                    c.disconnect()
                }
            }.getOrDefault(JSONArray())
            call.resolve(JSObject().put("items", items))
        }
    }
}
