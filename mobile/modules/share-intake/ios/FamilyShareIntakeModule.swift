import ExpoModulesCore
import Foundation
import ImageIO

private let shareGroup = "group.app.familytimecapsule.mobile.share"
/// 与 JS 的 brand.ts 对齐；旧名字只出现在一次性迁移与排空旧收件箱的路上。
private let documentsRoot = "anan-v1"
private let sharedInbox = "AnanLocalInbox"
private let legacySharedInbox = "XiaomeiLocalInbox"

public final class FamilyShareIntakeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FamilyShareIntake")

    AsyncFunction("consumePendingAsync") { () -> String in
      try self.takeOverSharedManifests()
      let manifests = try self.localManifests().compactMap { url -> Any? in
        let data = try Data(contentsOf: url, options: .mappedIfSafe)
        return try JSONSerialization.jsonObject(with: data)
      }
      let data = try JSONSerialization.data(withJSONObject: manifests)
      return String(decoding: data, as: UTF8.self)
    }

    AsyncFunction("acknowledgeAsync") { (manifestId: String) in
      guard UUID(uuidString: manifestId) != nil else {
        throw InvalidManifestIdException()
      }
      try? FileManager.default.removeItem(at: self.localManifestDirectory()
        .appendingPathComponent("\(manifestId).json"))
    }
  }

  /** Best-effort EXIF capture time and GPS for shared photos; never fails the takeover. */
  private func attachCaptureMetadata(_ item: inout [String: Any], at url: URL) {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any]
    else { return }
    if let exif = properties[kCGImagePropertyExifDictionary as String] as? [String: Any],
       let taken = exif[kCGImagePropertyExifDateTimeOriginal as String] as? String {
      let parts = taken.split(separator: " ")
      if parts.count == 2 {
        let day = parts[0].split(separator: ":").joined(separator: "-")
        if day.count == 10, parts[1].split(separator: ":").count == 3 {
          item["capturedAt"] = "\(day)T\(parts[1])"
        }
      }
    }
    if let gps = properties[kCGImagePropertyGPSDictionary as String] as? [String: Any],
       let latitude = gps[kCGImagePropertyGPSLatitude as String] as? Double,
       let longitude = gps[kCGImagePropertyGPSLongitude as String] as? Double,
       abs(latitude) <= 90, abs(longitude) <= 180 {
      item["latitude"] = (gps[kCGImagePropertyGPSLatitudeRef as String] as? String) == "S"
        ? -abs(latitude) : latitude
      item["longitude"] = (gps[kCGImagePropertyGPSLongitudeRef as String] as? String) == "W"
        ? -abs(longitude) : longitude
    }
  }

  private func localManifestDirectory() throws -> URL {
    let documents = try FileManager.default.url(
      for: .documentDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true)
    let directory = documents.appendingPathComponent("\(documentsRoot)/intake/manifests", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
  }

  private func capturesDirectory() throws -> URL {
    let documents = try FileManager.default.url(
      for: .documentDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true)
    let directory = documents.appendingPathComponent("\(documentsRoot)/intake/originals", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
  }

  private func localManifests() throws -> [URL] {
    try FileManager.default.contentsOfDirectory(
      at: localManifestDirectory(),
      includingPropertiesForKeys: nil)
      .filter { $0.pathExtension == "json" }
      .sorted { $0.lastPathComponent < $1.lastPathComponent }
  }

  private func takeOverSharedManifests() throws {
    guard let container = FileManager.default.containerURL(
      forSecurityApplicationGroupIdentifier: shareGroup) else { return }
    // 改名前排队的分享还躺在旧收件箱里，一并排空；扩展只往新的那个写。
    for name in [sharedInbox, legacySharedInbox] {
      try takeOverSharedManifests(in: container.appendingPathComponent(name, isDirectory: true))
    }
  }

  private func takeOverSharedManifests(in inbox: URL) throws {
    guard let batches = try? FileManager.default.contentsOfDirectory(
      at: inbox,
      includingPropertiesForKeys: [.contentModificationDateKey]) else { return }

    for batch in batches where UUID(uuidString: batch.lastPathComponent) != nil {
      guard batch.resolvingSymlinksInPath().path == inbox.resolvingSymlinksInPath()
        .appendingPathComponent(batch.lastPathComponent).path else { continue }
      let sourceManifest = batch.appendingPathComponent("manifest.json")
      guard let sourceData = try? Data(contentsOf: sourceManifest, options: .mappedIfSafe),
            var manifest = try? JSONSerialization.jsonObject(with: sourceData) as? [String: Any],
            manifest["manifestId"] as? String == batch.lastPathComponent,
            let items = manifest["items"] as? [[String: Any]], items.count <= 100 else { continue }
      let complete = manifest["complete"] as? Bool == true

      var localItems: [[String: Any]] = []
      var allCopied = true
      for item in items {
        guard item["kind"] as? String == "file" else {
          localItems.append(item)
          continue
        }
        guard let relativePath = item["relativePath"] as? String,
              let captureId = item["captureId"] as? String,
              UUID(uuidString: captureId) != nil,
              relativePath.range(of: "^items/[a-zA-Z0-9-]+\\.[a-z0-9]{1,8}$", options: .regularExpression) != nil else {
          allCopied = false
          break
        }
        var localItem = item
        let source = batch.appendingPathComponent(relativePath)
        guard source.deletingPathExtension().lastPathComponent == captureId,
              source.resolvingSymlinksInPath().path == inbox.resolvingSymlinksInPath()
                .appendingPathComponent(batch.lastPathComponent).appendingPathComponent(relativePath).path,
              (try? source.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true else {
          allCopied = false
          break
        }
        let ext = source.pathExtension.isEmpty ? "bin" : source.pathExtension
        let destination = try capturesDirectory().appendingPathComponent("\(captureId).\(ext)")
        do {
          guard destination.resolvingSymlinksInPath().path == destination.deletingLastPathComponent()
            .resolvingSymlinksInPath().appendingPathComponent(destination.lastPathComponent).path else {
            throw InvalidManifestIdException()
          }
          if !FileManager.default.fileExists(atPath: destination.path) {
            let temporary = destination.deletingLastPathComponent()
              .appendingPathComponent(".\(destination.lastPathComponent).part")
            try? FileManager.default.removeItem(at: temporary)
            try FileManager.default.copyItem(at: source, to: temporary)
            try FileManager.default.moveItem(at: temporary, to: destination)
          }
          localItem.removeValue(forKey: "relativePath")
          localItem["localUri"] = destination.absoluteString
          self.attachCaptureMetadata(&localItem, at: destination)
          localItems.append(localItem)
        } catch {
          allCopied = false
          break
        }
      }
      guard allCopied else { continue }
      manifest["items"] = localItems
      let destination = try localManifestDirectory()
        .appendingPathComponent("\(batch.lastPathComponent).json")
      if !FileManager.default.fileExists(atPath: destination.path) {
        let data = try JSONSerialization.data(withJSONObject: manifest)
        try data.write(to: destination, options: [.atomic, .completeFileProtection])
        // Only this newly written snapshot owns all completed shared items.
        // An older local snapshot may still be waiting for the JS/SQLite ack.
        if complete { try? FileManager.default.removeItem(at: batch) }
      }
      // Partial snapshots remain in the App Group: the extension may still be
      // copying a slow provider, or may have exited after preserving some files.
      // Replaying a later snapshot adds only unseen capture IDs in SQLite.
    }
  }
}

private final class InvalidManifestIdException: Exception {
  override var reason: String { "Invalid share manifest id" }
}
