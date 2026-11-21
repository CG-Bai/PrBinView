<p align="center">
  <a href="./README.md">简体中文</a> | <strong>English</strong>
</p>

# PrBinView · Fast Single-Panel Media Bin Previewer for Premiere Pro (v1.3.7)

A pure **CEP 12 single-panel** media bin thumbnail preview extension for **Adobe Premiere Pro (2022–2027, primarily tested on Windows / basic macOS support)**.

Built to improve the browsing experience of Premiere Pro's built-in Project panel with a **DaVinci Resolve-style** workflow—click any bin in the left sidebar and immediately browse thumbnails of its media items on the right.

## Screenshots

![PrBinView Preview 1](docs/images/Image%2001.png)

![PrBinView Preview 2](docs/images/Image%2002.png)

![PrBinView Preview 3](docs/images/Image%2003.png)

![PrBinView Preview 4](docs/images/Image%2004.png)

## Usage Tips & Notes

- **Recommended workflow**: Due to limitations in Premiere Pro's extension APIs and my own development constraints, this plugin cannot replicate every single item in the native Project panel context menu. **It is recommended to collapse PrBinView's left sidebar and use it alongside Premiere Pro's native Project panel**—thanks to two-way sync, clicking any bin in the native Project panel instantly displays its media thumbnails inside PrBinView.
- **About this project**: This project was built entirely with AI assistance, and I am not a programmer. Feature requests and bug reports via Issues are welcome, though I cannot guarantee that every request can be implemented. Pull Requests from developers are always appreciated!
- **Platform compatibility**: Primarily developed and tested on **Windows**. **macOS** supports core browsing, thumbnails, sync, and common project operations, while Windows-specific enhancements (WinRT vector transparency rendering, native menu automation, auto-detecting Photoshop / Audition, and `.epr` preset scanning) gracefully fall back or are unavailable on macOS.

## Key Features

- **True Single Panel, Ready Out of the Box**: No extra bridge panels or manual background processes required. After installation, open it in Premiere Pro via **Window → Extensions → PrBinView · 媒体池预览**.
- **Real-Time Two-Way Sync & Auto Refresh**:
  - Live two-way synchronization between the left bin tree, right grid/list view, and Premiere Pro's native Project panel. Supports drag-and-drop bin organization, dragging clips to the Timeline while preserving original ProjectItems and label colors, and dragging external OS folders directly to import with subfolder structure preserved.
  - Automatically detects and refreshes thumbnails and metadata when you perform **Replace Footage**, rename items, change label colors, or bring offline clips back online in the native Project panel.
- **High-Speed Thumbnail Engine (Video, Pro Images & Vectors)**:
  - Fast keyframe extraction and viewport lazy-loading via FFmpeg for video and professional image formats (MP4 / MOV / MXF / MKV / PSD / TIFF / EXR, etc.), plus transparent thumbnail rendering for `.ai` / `.pdf` / `.eps` files.
  - Supports 60fps hover scrubbing and switching between Grid and List views (sortable columns for Frame Rate, Media Start/End/Duration, Video/Audio Info, and customizable column widths).
- **Common Native Project Panel Actions & Shortcuts**:
  - Covers frequently used context menu actions for clips, sequences, and bins (Cut, Copy, Paste, Duplicate, Hide, Properties, Sequence Settings, Auto Reframe, Make Subclip, Replace Footage, Link Media, Make Offline, Edit Original / Edit in Adobe Audition / Edit in Adobe Photoshop, Export Media, etc.).
  - Arrow keys (`↑ / ↓ / ← / →`) navigate media items and bins directly inside the panel (`Shift + Arrows` for multi-select, `Space` to preview in Source Monitor, `Enter` to open/enter) without fighting the Timeline playhead; `Delete / Backspace` prompts only when selected clips are referenced in sequences.
- **One-Click Chinese / English UI & Custom Label Color Sync**:
  - Click **`中 / EN`** in the top-right corner to toggle between Chinese and English UI (aligned with native Premiere Pro terminology).
  - Automatically reads custom label colors and custom label names from Premiere Pro preferences (`Preferences → Labels` / `Adobe Premiere Pro Prefs` / `.prlabelpreset`).

## Installation

### Windows (Recommended: One-Click Installer, No Node.js Required)
1. Download and fully extract a release package from [Releases](https://github.com/CG-Bai/PrBinView/releases):
   - **Windows Portable Edition (Recommended)**: `PrBinView-v1.3.7-win-ffmpeg.zip` (bundles a single `ffmpeg.exe` for out-of-the-box MXF / ProRes / PSD / EXR previews)
   - **Lightweight Edition**: `PrBinView-v1.3.7.zip` (~120 KB, ideal if FFmpeg is already in your `PATH` or you only preview standard MP4 / MOV / Image / AI files)
2. Double-click **`一键安装_Windows.cmd`** (automatically copies the extension and enables Adobe CEP `PlayerDebugMode=1`).
3. **Restart Premiere Pro**, then open **Window → Extensions → PrBinView · 媒体池预览**.

### Windows (Manual Installation)
1. Copy the entire **`PrBinView`** folder to: `%APPDATA%\Adobe\CEP\extensions\PrBinView`.
2. If this is your first unsigned CEP extension, enable CEP debug mode:
   ```cmd
   reg add HKCU\Software\Adobe\CSXS.12 /v PlayerDebugMode /t REG_SZ /d 1 /f
   ```
3. Restart Premiere Pro and open the panel.

### macOS
1. Extract the release zip and double-click **`install_macOS.command`** (or run `bash install_macOS.command` in Terminal).
2. Restart Premiere Pro and open the panel.

### FFmpeg Setup (Optional, Recommended for Faster Video / PSD Thumbnails)
PrBinView looks for `ffmpeg` in the following order (only a single `ffmpeg.exe` is needed; `ffprobe.exe` is optional):
1. `PrBinView\bin\ffmpeg.exe` inside the extension directory (included in the Portable Edition)
2. Environment variable `PRBINVIEW_FFMPEG`
3. System `PATH` (if FFmpeg is in your `PATH`, the status bar will automatically show `FFmpeg`)

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `↑ / ↓ / ← / →` | Navigate media grid/list or bin tree (`Shift + Arrows` to multi-select) |
| `Home / End` | Jump to first / last item |
| `Space` | Open selected media in Source Monitor (or sequence in Timeline) |
| `Enter` | Enter selected bin / open selected clip or sequence |
| `F2` | Rename selected clip or bin inline |
| `Ctrl + F` | Focus search box |
| `Ctrl + A / X / C / V / D` | Select All / Cut / Copy / Paste / Duplicate |
| `F5` / `Ctrl + R` | Refresh project tree and label color preferences |
| `Alt + ← / →` | Bin navigation history Back / Forward |
| `Delete` / `Backspace` | Clear selected items from project (warns if used in sequences; never deletes files on disk) |
| `Esc` | Close menu / modal / clear search |

## Uninstall
Double-click **`一键卸载_Windows.cmd`** (or manually delete `%APPDATA%\Adobe\CEP\extensions\PrBinView`).

To disable Adobe CEP debug mode afterward on Windows:
```cmd
reg delete HKCU\Software\Adobe\CSXS.12 /v PlayerDebugMode /f
```

## Security & Permissions

- **Zero Network & Zero Telemetry**: Runs 100% locally. Makes no network requests and collects no user data. All source code is open and auditable.
- **Unsigned Extension Mode (`PlayerDebugMode=1`)**: Because this free open-source extension does not use a commercial code-signing certificate, the installer enables `PlayerDebugMode=1` for `CSXS.11 / CSXS.12` (or `defaults write com.adobe.CSXS.11/12 PlayerDebugMode 1` on macOS) so Premiere Pro can load unsigned CEP extensions. You can revert this setting anytime after uninstalling.
- **Windows Local Helper Scripts (`PrBinView/helpers/*.ps1`)**:
  - `win-dialog.ps1`: Invokes native Windows `IFileOpenDialog` for modern multi-file / multi-folder pickers.
  - `render-vector.ps1`: Uses Windows WinRT PDF / Shell APIs to render `.ai` / `.pdf` / `.eps` thumbnails.
  - `pr-menu.ps1`: Uses Win32 Menu / UI Automation to trigger Premiere Pro's native **Link Media** and **Export Media** menus.
  - Because these scripts invoke `powershell.exe` and .NET/Win32 APIs, some antivirus tools may raise heuristic false positives. All helper scripts are plain text and fully inspectable.
- **FFmpeg Notice**: This Git source repository and the lightweight release (`PrBinView-v1.3.7.zip`) do not contain FFmpeg binaries. The optional Windows Portable release (`PrBinView-v1.3.7-win-ffmpeg.zip`) bundles a single `ffmpeg.exe` (9.1 essentials from [gyan.dev](https://www.gyan.dev/ffmpeg/builds/), licensed under GPL-3.0, with `FFMPEG-LICENSE.txt` included in `PrBinView/bin/`).

## License & Disclaimer

- Released under the **GNU General Public License v3.0 (GPL-3.0)**. See [LICENSE](LICENSE) for details. Copyright © 2026 **CG-Bai**.
- This software is provided **"AS IS"**, without warranty of any kind. Please back up important project files before use.
- **Trademark Notice**: This is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Adobe Inc. Adobe, Premiere Pro, Photoshop, Audition, and Media Encoder are registered trademarks of Adobe Inc.
