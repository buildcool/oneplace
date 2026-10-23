package io.github.buildcool.oneplace

import android.content.Intent
import android.net.Uri

/** Text that other apps share with OnePlace, and a few link helpers for the 1-tap targets. */
object Shares {
    /** Shared before the UI was ready (cold start); the UI asks for it once. */
    @Volatile
    var pending: String? = null

    fun textFrom(intent: Intent?): String? {
        intent ?: return null
        return when (intent.action) {
            Intent.ACTION_SEND -> {
                val text = intent.getStringExtra(Intent.EXTRA_TEXT)
                val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)
                when {
                    text == null -> subject
                    subject != null && !text.contains(subject) -> "$subject $text"
                    else -> text
                }
            }
            Intent.ACTION_PROCESS_TEXT -> intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString()
            Intent.ACTION_VIEW -> intent.dataString
            else -> null
        }
    }

    private val URL = Regex("""https?://[A-Za-z0-9\-._~:/?#\[\]@!$&()*+,;=%]+""")

    fun firstUrl(text: String): String? = URL.find(text)?.value?.trimEnd('.', ',', ';', ':', '!', '?', '\'', '"', ')', ']')

    /** Same ids as src/core/sites.ts, for picking a login's cookies and per-site options. */
    fun siteOf(url: String): String {
        val host = runCatching { Uri.parse(url).host }.getOrNull()?.lowercase()?.removePrefix("www.")?.removePrefix("m.") ?: return "other"
        return when {
            host == "music.youtube.com" -> "ytmusic"
            host == "youtu.be" || host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com") -> "youtube"
            host.endsWith("instagram.com") || host == "instagr.am" -> "instagram"
            host.endsWith("facebook.com") || host == "fb.watch" || host == "fb.com" -> "facebook"
            host == "x.com" || host == "twitter.com" || host == "t.co" -> "x"
            host.endsWith("tiktok.com") -> "tiktok"
            host.endsWith("reddit.com") || host == "redd.it" -> "reddit"
            host.contains("pinterest.") || host == "pin.it" -> "pinterest"
            host.startsWith("threads.") -> "threads"
            host.endsWith("snapchat.com") -> "snapchat"
            host.endsWith("soundcloud.com") -> "soundcloud"
            host.endsWith("jiosaavn.com") -> "jiosaavn"
            host.endsWith("vimeo.com") -> "vimeo"
            host.endsWith("twitch.tv") -> "twitch"
            else -> "other"
        }
    }
}
