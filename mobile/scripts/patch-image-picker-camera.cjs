const fs = require("node:fs");
const path = require("node:path");

// UIKit throws an Objective-C exception (not a catchable JS rejection) when
// sourceType/cameraDevice is unavailable, including on the iOS simulator.
const manifest = require.resolve("expo-image-picker/package.json");
const picker = JSON.parse(fs.readFileSync(manifest, "utf8"));
if (picker.version !== "57.0.16") {
  throw new Error(`Review the camera availability patch for expo-image-picker ${picker.version}`);
}
const file = path.join(path.dirname(manifest), "ios/ImagePickerModule.swift");
const original = `    if sourceType == .camera {
      picker.sourceType = .camera
      picker.cameraDevice = options.cameraType == .front ? .front : .rear
    }`;
const replacement = `    if sourceType == .camera {
      let cameraDevice: UIImagePickerController.CameraDevice = options.cameraType == .front ? .front : .rear
      guard UIImagePickerController.isSourceTypeAvailable(.camera),
            UIImagePickerController.isCameraDeviceAvailable(cameraDevice) else {
        return pickingContext.promise.reject("ERR_CAMERA_UNAVAILABLE", "The requested camera is unavailable")
      }
      picker.sourceType = .camera
      picker.cameraDevice = cameraDevice
    }`;
const source = fs.readFileSync(file, "utf8");
if (!(source.includes(replacement) && !source.includes(original))) {
  if (source.split(original).length !== 2 || source.includes(replacement)) {
    throw new Error("Unexpected image picker camera setup; review compatibility before building");
  }
  fs.writeFileSync(file, source.replace(original, replacement));
}
console.log("iOS image picker camera availability guard verified.");
