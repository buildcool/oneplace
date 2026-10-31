package io.github.buildcool.oneplace

import android.content.ComponentCallbacks2
import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.Lifecycle
import com.getcapacitor.BridgeActivity
import io.github.buildcool.oneplace.browser.BrowserLayer
import io.github.buildcool.oneplace.browser.BrowserPlugin
import io.github.buildcool.oneplace.player.Pip
import io.github.buildcool.oneplace.player.Playback
import io.github.buildcool.oneplace.player.PlayerPlugin

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(EnginePlugin::class.java)
        registerPlugin(PlayerPlugin::class.java)
        registerPlugin(BrowserPlugin::class.java)
        // Cold start from the share sheet or a "Downloaded" notification: keep it until the web app asks.
        Shares.pending = Shares.textFrom(intent)
        Shares.pendingOpen = intent?.getStringExtra(EXTRA_OPEN)
        super.onCreate(savedInstanceState)
        // Edge-to-edge; the web UI pads itself with Capacitor's --safe-area-inset-* variables.
        enableEdgeToEdge()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra(EXTRA_OPEN)?.let { id ->
            if (!EnginePlugin.deliverOpen(id)) Shares.pendingOpen = id
            return
        }
        val text = Shares.textFrom(intent) ?: return
        if (!EnginePlugin.deliverShare(text)) Shares.pending = text
    }

    /** Home pressed while a video plays: the floating window on Android 8–11 (12+ does it by itself). */
    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        Pip.onUserLeave(this)
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        PlayerPlugin.pipChanged(isInPictureInPictureMode)
        // Closed with its ✕ (the app is no longer on screen): stop the sound too.
        if (!isInPictureInPictureMode && !lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) Playback.current()?.pause()
    }

    /** Short of memory (or the app left the screen): browser tabs not on screen let go of their pages; they keep their history. */
    @Suppress("DEPRECATION")
    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) BrowserLayer.trim()
    }

    override fun onStop() {
        if (Pip.active(this)) Playback.current()?.pause()
        super.onStop()
    }

    companion object {
        /** Show this download in the app (from its "Downloaded" notification). */
        const val EXTRA_OPEN = "oneplace.open"

        /** Opened from the player's notification. */
        const val EXTRA_PLAYER = "oneplace.player"
    }
}
