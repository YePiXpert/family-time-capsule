package app.familytimecapsule.shareintake

import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.provider.OpenableColumns
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.time.Instant
import java.util.UUID
import java.util.concurrent.Executors

private const val HANDLED_EXTRA = "app.familytimecapsule.shareintake.HANDLED"
private const val MAX_SHARE_ITEMS = 100

class FamilyShareIntakeModule : Module() {
  private val copyExecutor = Executors.newSingleThreadExecutor()

  override fun definition() = ModuleDefinition {
    Name("FamilyShareIntake")

    OnNewIntent { intent ->
      scheduleIntent(intent)
    }

    AsyncFunction("consumePendingAsync") {
      appContext.currentActivity?.intent?.let { scheduleIntent(it) }
      // A barrier behind every scheduled URI copy guarantees that JS only sees
      // manifests whose app-private files are already durable.
      copyExecutor.submit<String> {
        val context = requireNotNull(appContext.reactContext) { "React context is unavailable" }
        val manifests = File(context.filesDir, "share-intake/manifests")
        val result = JSONArray()
        manifests.listFiles()
          ?.filter { it.isFile && it.extension == "json" }
          ?.sortedBy { it.name }
          ?.forEach { file ->
            runCatching { result.put(JSONObject(file.readText(Charsets.UTF_8))) }
          }
        result.toString()
      }.get()
    }

    AsyncFunction("acknowledgeAsync") { manifestId: String ->
      require(manifestId.matches(Regex("^[0-9a-fA-F-]{36}$"))) { "Invalid manifest id" }
      val context = requireNotNull(appContext.reactContext) { "React context is unavailable" }
      File(context.filesDir, "share-intake/manifests/$manifestId.json").delete()
    }

    OnDestroy {
      copyExecutor.shutdown()
    }
  }

  @Synchronized
  private fun scheduleIntent(intent: Intent) {
    if (intent.getBooleanExtra(HANDLED_EXTRA, false)) return
    if (intent.action != Intent.ACTION_SEND && intent.action != Intent.ACTION_SEND_MULTIPLE) return
    intent.putExtra(HANDLED_EXTRA, true)
    val copy = Intent(intent)
    copyExecutor.execute { processIntent(copy) }
  }

  private fun processIntent(intent: Intent) {
    val context = appContext.reactContext ?: return
    val manifestId = UUID.randomUUID().toString()
    val items = JSONArray()
    val uris = linkedSetOf<Uri>()

    @Suppress("DEPRECATION")
    if (intent.action == Intent.ACTION_SEND) {
      intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)?.let(uris::add)
    } else {
      @Suppress("DEPRECATION")
      intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)?.let(uris::addAll)
    }
    intent.clipData?.let { clip ->
      for (index in 0 until clip.itemCount) clip.getItemAt(index).uri?.let(uris::add)
    }

    uris.take(MAX_SHARE_ITEMS).forEachIndexed { index, uri ->
      if (uri.scheme == "http" || uri.scheme == "https") {
        items.put(textItem("uri-$index", uri.toString()))
      } else {
        items.put(copyUri(manifestId, index, uri, intent.type))
      }
    }
    val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.trim()
    if (!text.isNullOrEmpty() && items.length() < MAX_SHARE_ITEMS) {
      items.put(textItem("text-0", text))
    }
    if (items.length() == 0) return

    val manifest = JSONObject().apply {
      put("manifestId", manifestId)
      put("source", "share")
      put("createdAt", Instant.now().toString())
      put("complete", true)
      put("items", items)
    }
    val directory = File(context.filesDir, "share-intake/manifests").apply { mkdirs() }
    val temporary = File(directory, "$manifestId.json.part")
    temporary.writeText(manifest.toString(), Charsets.UTF_8)
    if (!temporary.renameTo(File(directory, "$manifestId.json"))) temporary.delete()
  }

  private fun textItem(externalId: String, text: String) = JSONObject().apply {
    put("externalId", externalId)
    put("captureId", UUID.randomUUID().toString())
    put("kind", "text")
    put("text", text.take(5000))
  }

  private fun copyUri(manifestId: String, index: Int, uri: Uri, fallbackMime: String?): JSONObject {
    val context = requireNotNull(appContext.reactContext)
    val resolver = context.contentResolver
    val externalId = "item-$index"
    val captureId = UUID.randomUUID().toString()
    return try {
      val declaredName = queryDisplayName(uri) ?: "shared-$index"
      val mime = resolver.getType(uri) ?: fallbackMime ?: "application/octet-stream"
      val mediaType = mediaType(mime, declaredName)
        ?: throw IllegalArgumentException("unsupported_type")
      val extension = safeExtension(declaredName, mime)
      val destination = File(context.filesDir, "captures/$captureId$extension")
      destination.parentFile?.mkdirs()
      val temporary = File(destination.parentFile, ".${destination.name}.$manifestId.part")
      resolver.openInputStream(uri).use { input ->
        requireNotNull(input) { "unreadable_uri" }
        FileOutputStream(temporary).use { output -> input.copyTo(output, 64 * 1024) }
      }
      if (!temporary.renameTo(destination)) {
        temporary.delete()
        throw IllegalStateException("copy_failed")
      }
      JSONObject().apply {
        put("externalId", externalId)
        put("captureId", captureId)
        put("kind", "file")
        put("localUri", Uri.fromFile(destination).toString())
        put("fileName", declaredName.take(200))
        put("mimeType", mime)
        put("mediaType", mediaType)
      }
    } catch (error: Throwable) {
      JSONObject().apply {
        put("externalId", externalId)
        put("captureId", captureId)
        put("kind", "error")
        put("error", (error.message ?: "copy_failed").take(160))
      }
    }
  }

  private fun queryDisplayName(uri: Uri): String? {
    val resolver = appContext.reactContext?.contentResolver ?: return null
    var cursor: Cursor? = null
    return try {
      cursor = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
      if (cursor?.moveToFirst() == true) cursor.getString(0)?.substringAfterLast('/')?.substringAfterLast('\\') else null
    } catch (_: Throwable) {
      null
    } finally {
      cursor?.close()
    }
  }

  private fun mediaType(mime: String, filename: String): String? = when {
    mime.startsWith("image/") -> "image"
    mime.startsWith("video/") -> "video"
    mime.startsWith("audio/") -> "audio"
    mime in setOf(
      "application/pdf", "text/plain", "text/markdown", "text/rtf",
      "application/rtf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ) -> "document"
    filename.lowercase().endsWith(".md") || filename.lowercase().endsWith(".txt") ||
      filename.lowercase().endsWith(".rtf") || filename.lowercase().endsWith(".pdf") ||
      filename.lowercase().endsWith(".docx") -> "document"
    else -> null
  }

  private fun safeExtension(filename: String, mime: String): String {
    val candidate = filename.substringAfterLast('.', "").lowercase()
    if (candidate.matches(Regex("^[a-z0-9]{1,8}$"))) return ".$candidate"
    return when {
      mime.startsWith("image/") -> ".jpg"
      mime.startsWith("video/") -> ".mp4"
      mime.startsWith("audio/") -> ".m4a"
      mime == "application/pdf" -> ".pdf"
      else -> ".bin"
    }
  }
}
