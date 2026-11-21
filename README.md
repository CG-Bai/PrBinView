<p align="center">
  <strong>简体中文</strong> | <a href="./README.en.md">English</a>
</p>

# PrBinView · Premiere Pro 单面板极速媒体预览插件（v1.3.8）

面向 **Premiere Pro（2022–2027，Windows 为主 / macOS 基础兼容）** 的纯 **CEP 12 单面板** 媒体池缩略图预览扩展。

旨在优化 Premiere Pro 自带项目面板的浏览体验，像 **DaVinci Resolve（达芬奇）** 一样——左侧栏单击素材箱（文件夹），右侧即刻展示该文件夹内的素材缩略图。

## 界面预览

![PrBinView 界面预览 1](docs/images/Image%2001.png)

![PrBinView 界面预览 2](docs/images/Image%2002.png)

![PrBinView 界面预览 3](docs/images/Image%2003.png)

![PrBinView 界面预览 4](docs/images/Image%2004.png)

## 使用建议与说明

- **推荐搭配原生项目面板使用**：受限于 Premiere Pro 自身的接口限制及作者个人能力，目前无法完整复刻原生项目面板右键菜单中的全部功能。因此**更推荐隐藏本插件的左侧素材箱栏，与 Premiere Pro 原生项目面板搭配使用**——利用双向联动，在原生项目面板单击任意文件夹，本面板右侧即可实时预览素材缩略图。
- **关于开发与反馈**：本项目全程借助 AI 辅助制作，作者本人不懂代码。非常欢迎在 Issues 中提出建议或功能需求，但无法保证一定能够实现，敬请谅解；也欢迎熟悉开发的朋友直接提交 PR 共同完善。
- **平台兼容说明**：主要在 Windows 平台深度适配与测试；macOS 支持核心浏览、缩略图、同步与常见项目管理功能，但部分依赖 Windows 原生接口的增强特性（WinRT 矢量透明渲染、原生菜单联动、自动探测 Photoshop / Audition 及 `.epr` 预设扫描）在 macOS 上会自动降级或不可用。

## 核心功能

- **真正单一面板，开箱即用**：无需额外桥接面板，无需手动启动后台进程；安装后在 Premiere Pro 顶部菜单点击 **窗口 → 扩展 → PrBinView · 媒体池预览**（英文版：**Window → Extensions → PrBinView · 媒体池预览**）即可使用。
- **双向实时同步 & 自动刷新**：
  - 左侧素材箱树、右侧网格/列表与 Pr 原生项目面板实时双向联动；支持拖拽移动素材箱、拖放素材到时间线自动保留原素材与标签颜色、外部文件夹整目录拖入导入。
  - 在 Pr 原生项目面板执行 **Replace Footage（替换素材）**、重命名、更改标签颜色或启动上线恢复时，插件自动检测并刷新缩略图与属性。
- **极速缩略图引擎（含矢量与专业格式）**：
  - 视频 / 专业图像（MP4 / MOV / MXF / MKV / PSD / TIFF / EXR 等）通过 FFmpeg 快速关键帧抽取与视口懒加载；支持 `.ai` / `.pdf` / `.eps` 透明通道缩略图预览。
  - 支持鼠标悬停 60fps 实时擦洗预览与网格 / 详细列表视图切换（帧速率、媒体起止/时长、视频/音频信息等多列排序与自定义列宽）。
- **常用 Pr 原生项目面板操作与快捷键**：
  - 覆盖 Pr 原生素材 / 序列 / 素材箱的常用右键操作（剪切、复制、粘贴、制作副本、隐藏、媒体文件属性、序列设置、自动重构、制作子剪辑、替换素材、链接媒体、使脱机、编辑原始文件 / Audition / Photoshop、导出媒体等）。
  - 键盘 `↑ / ↓ / ← / →` 直接在插件面板内移动选中素材与文件夹（支持 `Shift + 方向键` 多选、`Space` 源监视器预览、`Enter` 打开/进入），不再被时间线播放头抢占；`Delete / Backspace` 仅在素材被序列引用时弹窗提醒。
- **全中文 / 全英文一键切换 & Pr 首选项标签颜色同步**：
  - 右上角 **`中 / EN`** 一键切换全中文 / 全英文界面（按 Pr 原生项目面板术语命名）。
  - 自动读取 Pr 首选项（`Preferences → Labels` / `Adobe Premiere Pro Prefs` / `.prlabelpreset`）中的自定义标签颜色与自定义标签名称。

## 安装方式

### Windows（推荐：一键安装，无需 Node.js）
1. 在 [Releases](https://github.com/CG-Bai/PrBinView/releases) 页面下载并完整解压：
   - **便携全格式版（推荐新手）**：`PrBinView-v1.3.8-win-ffmpeg.zip`（内置单个 `ffmpeg.exe`，无需额外配置即可预览 MXF / ProRes / PSD 等全格式）
   - **轻量版**：`PrBinView-v1.3.8.zip`（仅约 140 KB，适合电脑已装 FFmpeg 或仅预览常见 MP4 / MOV / 图片 / AI 的用户）
2. 双击运行 **`一键安装_Windows.cmd`**（自动复制插件并开启 Adobe CEP 开发者模式 `PlayerDebugMode=1`）。
3. **重启 Premiere Pro**，点击菜单：**窗口 → 扩展 → PrBinView · 媒体池预览**。

### Windows（手动覆盖安装）
1. 将 **`PrBinView`** 文件夹整个复制到：`%APPDATA%\Adobe\CEP\extensions\PrBinView`。
2. 如首次安装未签名 CEP 扩展，运行以下命令开启开发者模式：
   ```cmd
   reg add HKCU\Software\Adobe\CSXS.12 /v PlayerDebugMode /t REG_SZ /d 1 /f
   ```
3. 重启 Premiere Pro 打开面板即可。

### macOS
1. 解压发布包后，双击运行 **`install_macOS.command`**（或在终端中执行 `bash install_macOS.command`）。
2. 重启 Premiere Pro 打开面板即可。

### FFmpeg 说明（可选，推荐用于加速视频 / PSD 缩略图）
面板按以下顺序自动查找 `ffmpeg`（无需 `ffprobe.exe`，单个 `ffmpeg.exe` 即可完成抽帧、雪碧图与媒体属性探测）：
1. 插件目录下的 `PrBinView\bin\ffmpeg.exe`（便携版已内置）
2. 环境变量 `PRBINVIEW_FFMPEG`
3. 系统 `PATH`（如系统已安装 FFmpeg 并加入 PATH 将自动显示「FFmpeg 加速」）

## 常用快捷键

| 快捷键 | 功能 |
| --- | --- |
| `↑ / ↓ / ← / →` | 在右侧素材网格/列表或左侧素材箱树中移动选中项（`Shift + 方向键` 连续多选） |
| `Home / End` | 跳转到首项 / 末项 |
| `Space` | 在源监视器打开选中素材（序列在时间线打开） |
| `Enter` | 进入选中素材箱 / 打开选中素材或序列 |
| `F2` | 就地重命名选中素材或素材箱 |
| `Ctrl + F` | 聚焦搜索框 |
| `Ctrl + A / X / C / V / D` | 全选 / 剪切 / 复制 / 粘贴 / 制作副本 |
| `F5` / `Ctrl + R` | 手动刷新项目结构与首选项标签颜色 |
| `Alt + ← / →` | 素材箱历史后退 / 前进 |
| `Delete` / `Backspace` | 清除选中项（仅在序列中使用时弹窗确认，不删磁盘文件） |
| `Esc` | 关闭菜单 / 弹窗 / 清空搜索 |

## 卸载
双击运行 **`一键卸载_Windows.cmd`**（或手动删除 `%APPDATA%\Adobe\CEP\extensions\PrBinView`）。

如需关闭 Adobe CEP 开发者模式，可手动删除对应注册表键值（Windows）：
```cmd
reg delete HKCU\Software\Adobe\CSXS.12 /v PlayerDebugMode /f
```

## 安全与权限说明

- **零联网、零遥测**：本插件完全在本地运行，不发起任何网络请求，不收集或上传任何用户数据，全部源码开放可审计。
- **未签名扩展配置（`PlayerDebugMode=1`）**：因个人开源插件未使用商业代码签名证书，一键安装脚本会写入当前用户注册表 `CSXS.11 / CSXS.12` 的 `PlayerDebugMode=1`（macOS 为 `defaults write com.adobe.CSXS.11/12 PlayerDebugMode 1`）以允许加载未签名 CEP 扩展。卸载后如无其他未签名扩展需要，可按上文命令自行恢复。
- **Windows 本地辅助脚本（`PrBinView/helpers/*.ps1`）**：
  - `win-dialog.ps1`：调用 Windows 原生 `IFileOpenDialog` 提供现代多选文件 / 文件夹选择器。
  - `render-vector.ps1`：调用 Windows WinRT PDF / Shell 接口为 `.ai` / `.pdf` / `.eps` 生成缩略图。
  - `pr-menu.ps1`：通过 Win32 菜单 / UI Automation 触发 Premiere Pro 原生「链接媒体」与「导出媒体」菜单。
  - 上述脚本调用系统内置 `powershell.exe` 与 .NET/Win32 API，部分杀毒软件可能会出现启发式误报，所有脚本均为明文源码，可直接检查后放心使用。
- **FFmpeg 说明**：本 Git 源码仓库及轻量发布包（`PrBinView-v1.3.8.zip`）不包含任何 FFmpeg 二进制文件；可选的 Windows 便携发布包（`PrBinView-v1.3.8-win-ffmpeg.zip`）在 `PrBinView/bin/` 中附带了来自 [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) 官方构建的 `ffmpeg.exe`（9.1 essentials，遵循 GPL-3.0 协议，并随包附带对应 `FFMPEG-LICENSE.txt`）。

## 开源协议与免责声明

- 本项目采用 **GNU General Public License v3.0（GPL-3.0）** 开源协议发布，详情见 [LICENSE](LICENSE)。Copyright © 2026 **CG-Bai**。
- 本软件按“现状（AS IS）”提供，不附带任何明示或暗示的担保；在使用前建议对重要工程文件做好备份。
- **商标声明**：本项目为独立开源工具，与 Adobe Inc. 无任何官方关联或背书。Adobe、Premiere Pro、Photoshop、Audition、Media Encoder 等均为 Adobe Inc. 的注册商标。
