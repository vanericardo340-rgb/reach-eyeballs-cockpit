# Cockpit for macOS

A native Mac window around https://reach-eyeballs-cockpit.vercel.app (Electron 33).
The app always loads the live site, so Cockpit updates appear without a new build.

- Stays signed in between launches and remembers its window size.
- Links to other sites (Google Docs/Sheets, Miro, ClickUp…) open in the default browser.
- Cockpit pages opened from the app (e.g. the Weight / EOD overviews) open in app windows.
- Menu: View → Reload (⌘R), Go to Today (⌘⇧H), zoom; Navigate → Back (⌘[), Forward (⌘]), Open in Browser (⌘⇧O).

## Build (from Linux or macOS)

1. Download `electron-v33.2.1-darwin-arm64.zip` and `-darwin-x64.zip` from the Electron releases into a folder.
2. `npm i @electron/packager@18` and package with `platform: "darwin"`, `arch: ["arm64","x64"]`,
   `electronZipDir` set to that folder, `icon: "icon.icns"`, `appBundleId: "com.reacheyeballs.cockpit"`.
3. Ad-hoc sign each `Cockpit.app` (required on Apple silicon): `rcodesign sign Cockpit.app`
   (or on a Mac: `codesign --force --deep --sign - Cockpit.app`).
4. Zip with symlinks kept: `zip -qry Cockpit-Mac-AppleSilicon.zip Cockpit.app`.

The app is not notarised (that needs a paid Apple Developer ID), so the first launch needs
System Settings → Privacy & Security → Open Anyway.
