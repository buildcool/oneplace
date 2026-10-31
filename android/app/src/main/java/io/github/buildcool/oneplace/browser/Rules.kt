package io.github.buildcool.oneplace.browser

import org.json.JSONArray
import org.json.JSONObject

/**
 * Site rules for the browser (config/browser-rules.json in the repo, fetched like remote.json, with a copy
 * inside the app). They come from the network, so everything is checked here: hosts and keys must look
 * right, hiding rules are plain selectors only (no style text, so they can't load anything), and paths
 * must be valid patterns. Whatever looks wrong is dropped.
 */
object Rules {
    class Parsed(
        val blockPaths: List<Pair<String, Regex>>,
        val hide: Map<String, List<String>>,
        val links: Map<String, String>,
        val prune: Map<String, List<String>>,
        /** Host → "chrome" (the phone's Chrome user agent without the WebView mark), for sites that refuse WebViews. */
        val ua: Map<String, String>,
    ) {
        /** What the page script gets (window.__op_cfg). */
        fun pageJson(takeover: Boolean): String = JSONObject()
            .put("hide", JSONObject(hide.mapValues { JSONArray(it.value) }))
            .put("links", JSONObject(links))
            .put("prune", JSONObject(prune.mapValues { JSONArray(it.value) }))
            .put("takeover", takeover)
            .toString()

        fun uaFor(host: String): String? = ua.entries.firstOrNull { host == it.key || host.endsWith(".${it.key}") }?.value
    }

    val EMPTY = Parsed(emptyList(), emptyMap(), emptyMap(), emptyMap(), emptyMap())

    @Volatile
    var current: Parsed = EMPTY

    private val HOST = Regex("""^[a-z0-9-]+(\.[a-z0-9-]+)+$""")
    private val KEY_PATH = Regex("""^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+){0,6}$""")

    fun safeSelector(s: String): Boolean =
        s.isNotBlank() && s.length <= 200 && s.none { it == '{' || it == '}' || it == '@' || it == '\\' || it == '<' } && !s.contains("url(", ignoreCase = true)

    private fun hosts(o: JSONObject?): List<String> = o?.keys()?.asSequence()?.filter { it.length <= 60 && HOST.matches(it) }?.take(100)?.toList() ?: emptyList()

    private fun strings(a: JSONArray?, max: Int): List<String> = if (a == null) emptyList() else (0 until minOf(a.length(), max)).mapNotNull { a.opt(it) as? String }

    fun parse(json: String): Parsed {
        val o = runCatching { JSONObject(json) }.getOrNull() ?: return EMPTY
        val blockPaths = mutableListOf<Pair<String, Regex>>()
        o.optJSONArray("blockPaths")?.let { a ->
            for (i in 0 until minOf(a.length(), 100)) {
                val r = a.optJSONObject(i) ?: continue
                val host = r.optString("host")
                val path = r.optString("path")
                if (!HOST.matches(host) || path.isEmpty() || path.length > 200) continue
                runCatching { Regex(path) }.getOrNull()?.let { blockPaths += host to it }
            }
        }
        val hideObj = o.optJSONObject("hide")
        val hide = hosts(hideObj).associateWith { h -> strings(hideObj!!.optJSONArray(h), 80).filter { safeSelector(it) } }.filterValues { it.isNotEmpty() }
        val linksObj = o.optJSONObject("links")
        val links = hosts(linksObj).associateWith { linksObj!!.optString(it) }.filterValues { safeSelector(it) }
        val pruneObj = o.optJSONObject("prune")
        val prune = hosts(pruneObj).associateWith { h -> strings(pruneObj!!.optJSONArray(h), 30).filter { KEY_PATH.matches(it) } }.filterValues { it.isNotEmpty() }
        val uaObj = o.optJSONObject("ua")
        val ua = hosts(uaObj).associateWith { uaObj!!.optString(it) }.filterValues { it == "chrome" || it == "desktop" }
        return Parsed(blockPaths, hide, links, prune, ua)
    }
}
