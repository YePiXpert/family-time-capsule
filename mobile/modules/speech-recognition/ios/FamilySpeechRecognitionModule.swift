import ExpoModulesCore
import Speech

public class FamilySpeechRecognitionModule: Module {
  // 所有状态都在主队列读写；授权弹窗返回时也必须检查这一段是否仍有效。
  private var task: SFSpeechRecognitionTask?
  private var recognizer: SFSpeechRecognizer?
  private var pending: Promise?
  private var requestId: UUID?

  public func definition() -> ModuleDefinition {
    Name("FamilySpeechRecognition")

    AsyncFunction("availabilityAsync") { (locale: String) -> String in
      let authorization = SFSpeechRecognizer.authorizationStatus()
      guard authorization != .denied, authorization != .restricted,
            let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)),
            recognizer.isAvailable, recognizer.supportsOnDeviceRecognition else {
        return "unavailable"
      }
      return "on-device"
    }

    AsyncFunction("transcribeFileAsync") { (uri: String, locale: String, promise: Promise) in
      DispatchQueue.main.async {
        self.cancelCurrent()
        let id = UUID()
        self.requestId = id
        self.pending = promise
        if SFSpeechRecognizer.authorizationStatus() == .notDetermined {
          SFSpeechRecognizer.requestAuthorization { _ in
            DispatchQueue.main.async { self.start(uri: uri, locale: locale, id: id) }
          }
        } else {
          self.start(uri: uri, locale: locale, id: id)
        }
      }
    }

    AsyncFunction("cancelAsync") {
      DispatchQueue.main.async { self.cancelCurrent() }
    }
  }

  private func cancelCurrent() {
    let promise = pending
    let oldTask = task
    requestId = nil
    pending = nil
    task = nil
    recognizer = nil
    oldTask?.cancel()
    promise?.reject(SpeechCanceledException())
  }

  private func fail(_ error: Exception, id: UUID) {
    guard requestId == id else { return }
    let promise = pending
    let oldTask = task
    pending = nil
    task = nil
    recognizer = nil
    requestId = nil
    oldTask?.cancel()
    promise?.reject(error)
  }

  private func start(uri: String, locale: String, id: UUID) {
    guard requestId == id else { return }
    guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
      fail(SpeechDeniedException(), id: id)
      return
    }
    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)),
          recognizer.isAvailable, recognizer.supportsOnDeviceRecognition else {
      fail(SpeechUnavailableException(), id: id)
      return
    }
    guard let url = URL(string: uri), url.isFileURL else {
      fail(SpeechFailedException(), id: id)
      return
    }
    self.recognizer = recognizer
    let request = SFSpeechURLRecognitionRequest(url: url)
    request.requiresOnDeviceRecognition = true
    request.shouldReportPartialResults = false
    request.taskHint = .dictation
    if #available(iOS 16, *) { request.addsPunctuation = true }
    task = recognizer.recognitionTask(with: request) { result, error in
      DispatchQueue.main.async {
        guard self.requestId == id else { return }
        if let error = error as NSError? {
          if error.domain == "kAFAssistantErrorDomain" && error.code == 1110 {
            self.complete("", id: id)
          } else if self.task?.state == .canceling ||
                      (error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled) {
            self.fail(SpeechCanceledException(), id: id)
          } else {
            self.fail(SpeechFailedException("这次没能转成文字，录音已保存。" + error.localizedDescription), id: id)
          }
        } else if let result = result, result.isFinal {
          self.complete(result.bestTranscription.formattedString, id: id)
        }
      }
    }
  }

  private func complete(_ text: String, id: UUID) {
    guard requestId == id else { return }
    let promise = pending
    pending = nil
    task = nil
    recognizer = nil
    requestId = nil
    promise?.resolve(text)
  }
}

private final class SpeechUnavailableException: Exception {
  override var code: String { "UNAVAILABLE" }
  override var reason: String { "这台手机暂时无法本机转文字，录音已保存。" }
}
private final class SpeechDeniedException: Exception {
  override var code: String { "DENIED" }
  override var reason: String { "没有语音识别权限，可在系统设置里开启；录音已保存。" }
}
private final class SpeechCanceledException: Exception {
  override var code: String { "CANCELED" }
  override var reason: String { "已停止转文字，录音已保存。" }
}
private final class SpeechFailedException: Exception {
  private let message: String
  init(_ message: String = "这次没能转成文字，录音已保存。") {
    self.message = message
    super.init()
  }
  override var code: String { "FAILED" }
  override var reason: String { message }
}
