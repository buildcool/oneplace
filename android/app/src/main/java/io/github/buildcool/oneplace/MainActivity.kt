package io.github.buildcool.oneplace

import android.content.Intent
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(EnginePlugin::class.java)
        // Cold start from the share sheet: keep the text until the web app asks for it.
        Shares.pending = Shares.textFrom(intent)
        super.onCreate(savedInstanceState)
        // Edge-to-edge; the web UI pads itself with Capacitor's --safe-area-inset-* variables.
        enableEdgeToEdge()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val text = Shares.textFrom(intent) ?: return
        if (!EnginePlugin.deliverShare(text)) Shares.pending = text
    }
}
