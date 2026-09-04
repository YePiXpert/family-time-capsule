const fs = require("node:fs");
const path = require("node:path");
const {
  IOSConfig,
  withAndroidManifest,
  withDangerousMod,
  withEntitlementsPlist,
  withXcodeProject,
} = require("expo/config-plugins");

const EXTENSION_NAME = "FamilyShareExtension";
const EXTENSION_BUNDLE_ID = "app.familytimecapsule.mobile.share";
const APP_GROUP = "group.app.familytimecapsule.mobile.share";

function withShareIntentFilters(config) {
  return withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application?.[0];
    const activities = application?.activity ?? [];
    const activity = activities.find((entry) => entry.$?.["android:name"] === ".MainActivity");
    if (!activity) throw new Error("MainActivity was not generated");
    activity["intent-filter"] ??= [];
    if (!activity["intent-filter"].some((filter) =>
      filter.action?.some((action) => action.$?.["android:name"] === "android.intent.action.SEND"))) {
      activity["intent-filter"].push({
        action: [
          { $: { "android:name": "android.intent.action.SEND" } },
          { $: { "android:name": "android.intent.action.SEND_MULTIPLE" } },
        ],
        category: [{ $: { "android:name": "android.intent.category.DEFAULT" } }],
        data: [
          "text/plain", "text/uri-list", "image/*", "video/*", "audio/*",
          "application/pdf", "text/markdown", "text/rtf", "application/rtf",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ].map((mime) => ({ $: { "android:mimeType": mime } })),
      });
    }
    return mod;
  });
}

function withSharedContainer(config) {
  return withEntitlementsPlist(config, (mod) => {
    const groups = new Set(mod.modResults["com.apple.security.application-groups"] ?? []);
    groups.add(APP_GROUP);
    mod.modResults["com.apple.security.application-groups"] = [...groups];
    return mod;
  });
}

function withShareExtensionFiles(config) {
  return withDangerousMod(config, ["ios", async (mod) => {
    const source = path.join(mod.modRequest.projectRoot, "plugins/share-extension");
    const destination = path.join(mod.modRequest.platformProjectRoot, EXTENSION_NAME);
    await fs.promises.mkdir(destination, { recursive: true });
    for (const filename of [
      "ShareViewController.swift",
      "FamilyShareExtension-Info.plist",
      "FamilyShareExtension.entitlements",
    ]) {
      await fs.promises.copyFile(path.join(source, filename), path.join(destination, filename));
    }
    return mod;
  }]);
}

function withShareExtensionTarget(config) {
  return withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const nativeTargets = project.pbxNativeTargetSection();
    let targetEntry = Object.entries(nativeTargets).find(([key, value]) =>
      !key.endsWith("_comment") && String(value.name).replaceAll('"', "") === EXTENSION_NAME);
    let target;
    if (targetEntry) {
      target = { uuid: targetEntry[0], pbxNativeTarget: targetEntry[1] };
    } else {
      // node-xcode only writes dependencies when these otherwise-optional
      // sections already exist in a fresh Expo project.
      project.hash.project.objects.PBXTargetDependency ??= {};
      project.hash.project.objects.PBXContainerItemProxy ??= {};
      target = project.addTarget(
        EXTENSION_NAME,
        "app_extension",
        EXTENSION_NAME,
        EXTENSION_BUNDLE_ID,
      );
      project.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", target.uuid);
      project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);
    }

    IOSConfig.XcodeUtils.ensureGroupRecursively(project, EXTENSION_NAME);
    IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
      filepath: `${EXTENSION_NAME}/ShareViewController.swift`,
      groupName: EXTENSION_NAME,
      project,
      targetUuid: target.uuid,
      verbose: true,
    });

    const configList = project.pbxXCConfigurationList()[target.pbxNativeTarget.buildConfigurationList];
    const configurations = project.pbxXCBuildConfigurationSection();
    for (const reference of configList.buildConfigurations) {
      const buildSettings = configurations[reference.value].buildSettings;
      buildSettings.APPLICATION_EXTENSION_API_ONLY = "YES";
      buildSettings.CODE_SIGN_ENTITLEMENTS = `"${EXTENSION_NAME}/FamilyShareExtension.entitlements"`;
      buildSettings.CURRENT_PROJECT_VERSION = `"${config.ios?.buildNumber ?? "1"}"`;
      buildSettings.GENERATE_INFOPLIST_FILE = "NO";
      buildSettings.INFOPLIST_FILE = `"${EXTENSION_NAME}/FamilyShareExtension-Info.plist"`;
      buildSettings.IPHONEOS_DEPLOYMENT_TARGET = "16.4";
      buildSettings.MARKETING_VERSION = `"${config.version ?? "1.0.0"}"`;
      buildSettings.PRODUCT_BUNDLE_IDENTIFIER = `"${EXTENSION_BUNDLE_ID}"`;
      buildSettings.PRODUCT_MODULE_NAME = "$(PRODUCT_NAME:c99extidentifier)";
      buildSettings.SKIP_INSTALL = "YES";
      buildSettings.SWIFT_VERSION = "5.0";
      buildSettings.TARGETED_DEVICE_FAMILY = '"1,2"';
    }
    return mod;
  });
}

module.exports = function withNativeShareIntake(config) {
  config = withShareIntentFilters(config);
  config = withSharedContainer(config);
  config = withShareExtensionFiles(config);
  return withShareExtensionTarget(config);
};
