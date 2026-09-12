# Release simulator regression

`smoke-ios-regression.py` installs the unchanged Release simulator app on a new
iPhone simulator. A separate XCUITest runner drives UIKit controls and the real
Expo/AVPlayer implementation. SQLite records and media are synthetic; remote
tests use ordinary login against a loopback-only protocol fixture. No test code
or alternate startup path is compiled into the app or unsigned IPA.

On macOS with Xcode, FFmpeg (`libx264` and `libx265`), and the `xcodeproj` Ruby gem:

```sh
python3 scripts/smoke-ios-regression.py path/to/Release-iphonesimulator/app.app --output build/native-regression
```

Evidence includes native first-frame events, advancing/paused/seeked playback,
reader close/reopen, authenticated range reads, error recovery, card and keyboard
frames, screenshots, and XCTest scrolling/frame/hitch metrics for 400 records.
The source codec probes identify the generated HEVC fixture; the report states
whether the simulator played it directly or used a compatibility transcode.

Dispatch `mobile-build.yml` with `profile_baseline_sha` set to a full ancestor SHA
to build that version from `git archive` and measure it with the identical test
on the same CI host/runtime. The comparison and raw samples are artifacts. Timing
includes simulator/automation overhead and does not establish device performance.
Installed iPhone/Android acceptance and verification of the owner's deployed
server remain separate from this synthetic simulator suite.

The Linux command below checks only the fixture transport, not native playback:

```sh
python3 -m unittest discover -s scripts/ios-regression -p 'test_*.py'
```
