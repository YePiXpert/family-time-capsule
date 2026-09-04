import Foundation
import Social
import UniformTypeIdentifiers

private let appGroup = "group.app.familytimecapsule.mobile.share"
private let maximumItems = 100

final class ShareViewController: SLComposeServiceViewController {
  private let manifestId = UUID().uuidString.lowercased()
  private var copiedItems: [[String: Any]] = []
  private let lock = NSLock()

  override func isContentValid() -> Bool { true }

  override func didSelectPost() {
    guard let inputItems = extensionContext?.inputItems as? [NSExtensionItem] else {
      extensionContext?.cancelRequest(withError: ShareError.noItems)
      return
    }
    let providers = inputItems.flatMap { $0.attachments ?? [] }.prefix(maximumItems)
    let group = DispatchGroup()
    for (index, provider) in providers.enumerated() {
      group.enter()
      copy(provider: provider, index: index) { item in
        if let item {
          self.lock.lock()
          self.copiedItems.append(item)
          try? self.writeManifest(complete: false)
          self.lock.unlock()
        }
        group.leave()
      }
    }
    let text = contentText.trimmingCharacters(in: .whitespacesAndNewlines)
    if !text.isEmpty {
      lock.lock()
      copiedItems.append([
        "externalId": "composer-text",
        "captureId": UUID().uuidString.lowercased(),
        "kind": "text",
        "text": String(text.prefix(5000)),
      ])
      try? writeManifest(complete: false)
      lock.unlock()
    }
    group.notify(queue: .global(qos: .userInitiated)) {
      do {
        try self.writeManifest(complete: true)
        self.extensionContext?.completeRequest(returningItems: nil)
      } catch {
        self.extensionContext?.cancelRequest(withError: error)
      }
    }
  }

  override func configurationItems() -> [Any]! { [] }

  private func copy(provider: NSItemProvider, index: Int, completion: @escaping ([String: Any]?) -> Void) {
    let type = preferredType(for: provider)
    guard let type else {
      completion(errorItem(index: index, message: "unsupported_type"))
      return
    }
    if type == .plainText || type == .url {
      provider.loadItem(forTypeIdentifier: type.identifier, options: nil) { value, error in
        if let error {
          completion(self.errorItem(index: index, message: error.localizedDescription))
          return
        }
        if let text = self.textValue(value) {
          completion([
            "externalId": "item-\(index)",
            "captureId": UUID().uuidString.lowercased(),
            "kind": "text",
            "text": String(text.prefix(5000)),
          ])
        } else {
          completion(self.errorItem(index: index, message: "unreadable_text"))
        }
      }
      return
    }
    // File representations preserve the provider's bytes. Never create a
    // UIImage/AVAsset and re-encode the family's original evidence.
    provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, error in
      if let url {
        do {
          completion(try self.copyFileValue(url, provider: provider, type: type, index: index))
        } catch {
          completion(self.errorItem(index: index, message: error.localizedDescription))
        }
        return
      }
      provider.loadDataRepresentation(forTypeIdentifier: type.identifier) { data, dataError in
        do {
          guard let data else { throw dataError ?? error ?? ShareError.unreadableItem }
          completion(try self.copyFileValue(data, provider: provider, type: type, index: index))
        } catch {
          completion(self.errorItem(index: index, message: error.localizedDescription))
        }
      }
    }
  }

  private func preferredType(for provider: NSItemProvider) -> UTType? {
    let candidates: [UTType] = [.image, .movie, .audio, .pdf, .plainText, .rtf, .url, .data]
    return candidates.first { provider.hasItemConformingToTypeIdentifier($0.identifier) }
  }

  private func textValue(_ value: NSSecureCoding?) -> String? {
    if let text = value as? String { return text }
    if let url = value as? URL { return url.absoluteString }
    if let data = value as? Data { return String(data: data, encoding: .utf8) }
    return nil
  }

  private func copyFileValue(
    _ value: Any?,
    provider: NSItemProvider,
    type: UTType,
    index: Int
  ) throws -> [String: Any] {
    guard let container = FileManager.default.containerURL(
      forSecurityApplicationGroupIdentifier: appGroup) else { throw ShareError.noContainer }
    let itemDirectory = container
      .appendingPathComponent("ShareInbox/\(manifestId)/items", isDirectory: true)
    try FileManager.default.createDirectory(at: itemDirectory, withIntermediateDirectories: true)
    let captureId = UUID().uuidString.lowercased()
    let suppliedName = provider.suggestedName?.components(separatedBy: CharacterSet(charactersIn: "/\\")).last
    let sourceExtension = (value as? URL)?.pathExtension
    let ext = safeExtension(sourceExtension ?? type.preferredFilenameExtension ?? "bin")
    let filename = String((suppliedName ?? "shared-\(index).\(ext)").prefix(200))
    let destination = itemDirectory.appendingPathComponent("\(captureId).\(ext)")
    let temporary = itemDirectory.appendingPathComponent(".\(captureId).part")
    try? FileManager.default.removeItem(at: temporary)
    if let source = value as? URL, source.isFileURL {
      let coordinated = NSFileCoordinator()
      var coordinationError: NSError?
      var copyError: Error?
      coordinated.coordinate(readingItemAt: source, options: [], error: &coordinationError) { readable in
        do { try FileManager.default.copyItem(at: readable, to: temporary) } catch { copyError = error }
      }
      if let coordinationError { throw coordinationError }
      if let copyError { throw copyError }
    } else if let data = value as? Data {
      try data.write(to: temporary, options: [.atomic, .completeFileProtection])
    } else {
      throw ShareError.unreadableItem
    }
    try FileManager.default.moveItem(at: temporary, to: destination)
    return [
      "externalId": "item-\(index)",
      "captureId": captureId,
      "kind": "file",
      "relativePath": "items/\(destination.lastPathComponent)",
      "fileName": filename,
      "mimeType": type.preferredMIMEType ?? "application/octet-stream",
      "mediaType": mediaType(type),
    ]
  }

  private func writeManifest(complete: Bool) throws {
    guard let container = FileManager.default.containerURL(
      forSecurityApplicationGroupIdentifier: appGroup) else { throw ShareError.noContainer }
    let directory = container.appendingPathComponent("ShareInbox/\(manifestId)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let manifest: [String: Any] = [
      "manifestId": manifestId,
      "source": "share",
      "createdAt": ISO8601DateFormatter().string(from: Date()),
      "complete": complete,
      "items": copiedItems,
    ]
    let data = try JSONSerialization.data(withJSONObject: manifest)
    try data.write(to: directory.appendingPathComponent("manifest.json"), options: [.atomic, .completeFileProtection])
  }

  private func errorItem(index: Int, message: String) -> [String: Any] {
    [
      "externalId": "item-\(index)",
      "captureId": UUID().uuidString.lowercased(),
      "kind": "error",
      "error": String(message.prefix(160)),
    ]
  }

  private func safeExtension(_ value: String) -> String {
    let lowered = value.lowercased()
    return lowered.range(of: "^[a-z0-9]{1,8}$", options: .regularExpression) == nil ? "bin" : lowered
  }

  private func mediaType(_ type: UTType) -> String {
    if type.conforms(to: .image) { return "image" }
    if type.conforms(to: .movie) { return "video" }
    if type.conforms(to: .audio) { return "audio" }
    return "document"
  }
}

private enum ShareError: LocalizedError {
  case noItems
  case noContainer
  case unreadableItem

  var errorDescription: String? {
    switch self {
    case .noItems: return "No share items were provided."
    case .noContainer: return "The private App Group container is unavailable."
    case .unreadableItem: return "The shared item could not be copied."
    }
  }
}
