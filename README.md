# Checkpoint

A compact Windows task widget with optional always-on-top mode.

## Run on Windows

Download the portable EXE or installer from [GitHub Releases](https://github.com/athuljohny77/Checkpoint/releases/latest). The portable app needs no installation or separate Node.js runtime. Keep the executable somewhere permanent and writable. Launch at Windows sign-in is enabled by default and can be disabled in Settings; the portable startup entry points to this executable.

- **Ctrl + Shift + Space** opens quick capture in the center of the display under your pointer, even while another app is focused.
- Type a task and press **Enter** to choose its priority, then **1** for Low, **2** for Medium, or **3** for High to save. You can also click a priority. **Esc** returns from the priority picker to your draft; press it again to dismiss capture. An unfinished draft stays there until you save it or quit.
- Check a task to strike it through; uncheck it to reopen it.
- Use the pin beside the window buttons to toggle always-on-top mode. This preference is saved. Closing it keeps Checkpoint in the system tray. Double-click the tray icon to reopen it. Right-click → **Quit Checkpoint** to exit fully.
- Change the global shortcut in **Settings & shortcuts** if another app uses it. Alternatives are **Ctrl + Alt + Space** and **Ctrl + Shift + K**.
- **Ctrl + Shift + M** rolls the window into a title bar displaying the active task count. Press it again to restore the previous height. Settings also offers **Ctrl + Alt + M** and **Ctrl + Shift + Up**.
- The app remembers its window location and size across relaunches and Windows restarts. If a monitor is disconnected, the window is kept within an available display. Rolling up does not overwrite the expanded height.
- In the main window, **Ctrl + N** focuses the task input and **/** focuses search.

Tasks support priorities, searching, sorting, editing, and deletion with an eight-second Undo action. A single filter row offers **All / Active / Done**. Tasks sort **High → Medium → Low** within the active and completed groups; the selected sort breaks ties within a priority. Choose a priority beside the main task input or change it directly on a task. Existing starred tasks migrate to High, and other existing tasks to Medium. GSAP animates additions, reordering, dialogs, capture confirmation, and window roll-up; completing a task triggers a small burst of confetti in the app's theme colors. Renderer effects respect reduced-motion preferences. No sample tasks are added to your real task list.

Completed tasks are permanently deleted **24 hours after completion** by default. Settings can disable cleanup or change retention to 1–365 days. Cleanup runs when Checkpoint opens and every minute while it runs; reopening a task clears its completion time. Settings also displays the app version and **by Athul Johny © 2026**.

## Updates and releases

**Settings → Check for updates** checks the latest stable release in `athuljohny77/Checkpoint`. Review its notes, choose **Install update…**, and confirm **Download and install**. Checkpoint verifies the SHA-256 checksum before closing, installing, and reopening. The portable launcher is replaced at its existing path; the previous launcher is retained as `.previous`. The installer distribution uses the matching NSIS update. Tasks and preferences stay in the same data folder.

Packaged builds check 15 seconds after launch and every six hours while running. A Windows tray notification and tray menu entry open the update settings. Checks never install or download an EXE without confirmation. Windows notification preferences may suppress the balloon; the menu entry remains available. Update errors can be retried from Settings. Versions before 1.3.0 require the first download manually.

The **Windows release** GitHub Actions workflow runs on a version change pushed to `main`, a `v*` tag, or manual dispatch. Bump `package.json` and `package-lock.json` together (`npm version patch --no-git-tag-version`), optionally add `release-notes/vX.Y.Z.md`, and push to `main`. The workflow tests and builds both Windows EXEs, generates `SHA256SUMS.txt`, creates tag `vX.Y.Z` with release notes, uploads every asset to a draft, and publishes only after all uploads succeed. Published versions are never overwritten; bump the version for another release. Repository Actions must have the workflow's requested `contents: write` permission.

## Development

Requires Windows and Node.js 22 or later.

```powershell
npm.cmd ci
npm.cmd start
npm.cmd test
npm.cmd run test:e2e
npm.cmd run build
```

`npm.cmd` works in PowerShell without changing its execution policy. `npm.cmd run build:installer` optionally creates an NSIS installer. Release artifacts are unsigned; Windows may display a publisher warning. Release signing should be configured before public distribution.

The end-to-end suite verifies OS shortcut registration, capture positioning, task flows, and restart persistence. Its native keypress test skips when Windows denies access to the input desktop or synthetic input. In that case, manually verify **Ctrl + Shift + Space** while another app is focused and while Checkpoint is in the tray.

## Local data

Tasks and preferences are saved in `%APPDATA%\Checkpoint\tasks.json`. Changes are written to a temporary file and atomically replace the previous save. If existing data cannot be parsed, the original is preserved as `tasks.json.recovered-<timestamp>` and a recovery notice appears in the app. Back up this folder to move tasks to another device. Delete/Undo history lasts only for the current session.

Task management works offline with no accounts, analytics, remote fonts, or cloud task storage. Update checks contact the public GitHub Releases API; task text is never sent. Task data is stored as plain JSON under your Windows account. Renderer windows are sandboxed, with context isolation and a narrow IPC bridge. Release notes are rendered as plain text, and update network access and installation run in the main process.

## Structure

- `src/main.cjs`: Windows lifecycle, global shortcut, tray, windows, validated IPC.
- `src/store.cjs`: Task validation, storage, recovery, and undo.
- `src/preload.cjs`: Limited renderer API.
- `src/renderer/`: Main interface and quick capture.
- `tests/`: Store tests and an Electron end-to-end test using an isolated temporary data directory.
- `scripts/generate-icon.cjs`: Regenerates the original PNG and ICO app mark.
- `artifacts/`: Screenshots produced by the end-to-end test with isolated example tasks.

The Figma reference could not be accessed during the initial implementation. This version uses an original charcoal-and-lime interface; it is not a verified match to that file.

Built with Electron. See its [global shortcut documentation](https://www.electronjs.org/docs/latest/api/global-shortcut) for platform behavior.
