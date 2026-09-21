package app.familytimecapsule.speechrecognition

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class FamilySpeechRecognitionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FamilySpeechRecognition")
    AsyncFunction("availabilityAsync") { _: String -> "unavailable" }
    AsyncFunction("transcribeFileAsync") { _: String, _: String ->
      require(false) { "UNAVAILABLE" }
    }
    AsyncFunction("cancelAsync") { }
  }
}
