package io.github.buildcool.oneplace

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import java.security.MessageDigest

/**
 * Is this copy the official OnePlace? Only buildcool's release key (kept off GitHub) can sign as us,
 * so copies built by others show "Unofficial copy" in About whatever they change in the code.
 */
object Official {
    /** SHA-256 of buildcool's release certificate (CN=OnePlace, O=buildcool). Public, as in every APK. */
    const val CERT_SHA256 = "FB4F9C9FAA5ACE29482128FD415966C28A455E993F95991281CED5B207F56434"

    fun isOfficial(ctx: Context): Boolean =
        runCatching { signers(ctx).any { hex(MessageDigest.getInstance("SHA-256").digest(it)) == CERT_SHA256 } }.getOrDefault(false)

    private fun signers(ctx: Context): List<ByteArray> {
        val pm = ctx.packageManager
        return if (Build.VERSION.SDK_INT >= 28) {
            pm.getPackageInfo(ctx.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
                .signingInfo?.apkContentsSigners?.map { it.toByteArray() } ?: emptyList()
        } else {
            @Suppress("DEPRECATION")
            pm.getPackageInfo(ctx.packageName, PackageManager.GET_SIGNATURES).signatures?.map { it.toByteArray() } ?: emptyList()
        }
    }

    internal fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02X".format(it) }
}
