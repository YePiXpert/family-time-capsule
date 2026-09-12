#!/usr/bin/env ruby
# The runner drives the already-installed, unmodified Release application. It is
# deliberately a separate project: no test flags or test code enter the IPA.
require 'xcodeproj'
require 'fileutils'

destination = File.expand_path(ARGV.fetch(0))
FileUtils.mkdir_p(destination)
info_path = File.join(destination, 'Info.plist')
Xcodeproj::Plist.write_to_path({
  'CFBundleExecutable' => '$(EXECUTABLE_NAME)',
  'CFBundleIdentifier' => '$(PRODUCT_BUNDLE_IDENTIFIER)',
  'CFBundleInfoDictionaryVersion' => '6.0',
  'CFBundleName' => '$(PRODUCT_NAME)',
  'CFBundlePackageType' => 'BNDL',
  'CFBundleShortVersionString' => '1.0',
  'CFBundleVersion' => '1',
  'NSAppTransportSecurity' => { 'NSAllowsLocalNetworking' => true },
}, info_path)
project = Xcodeproj::Project.new(File.join(destination, 'NativeRegression.xcodeproj'))
target = project.new_target(:ui_test_bundle, 'NativeRegression', :ios, '16.0', nil, :swift)
target.add_file_references([project.main_group.new_file(File.join(__dir__, 'NativeRegressionTests.swift'))])
target.build_configurations.each do |configuration|
  configuration.build_settings.merge!({
    'PRODUCT_BUNDLE_IDENTIFIER' => 'app.familytimecapsule.regression',
    'INFOPLIST_FILE' => info_path,
    'SWIFT_VERSION' => '5.0',
    'ENABLE_TESTING_SEARCH_PATHS' => 'YES',
    'TARGETED_DEVICE_FAMILY' => '1',
    'CODE_SIGN_IDENTITY' => '-',
    'CODE_SIGNING_ALLOWED' => 'YES',
    'TEST_TARGET_NAME' => '',
    'ENABLE_USER_SCRIPT_SANDBOXING' => 'YES',
  })
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.add_test_target(target)
scheme.test_action.build_configuration = 'Release'
scheme.save_as(project.path, 'NativeRegression', true)
