'use strict';

var fs = require('node:fs');
var path = require('node:path');
var cp = require('node:child_process');

var ROOT = path.resolve(__dirname, '..');
var PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
var VERSION = PKG.version || '1.0.0';
var PLUGIN_SRC = path.join(ROOT, 'PrBinView');
var DIST_DIR = path.join(ROOT, 'dist');

var WIN_INSTALL_CMD = [
  '@echo off',
  'chcp 65001 >nul',
  'setlocal',
  'cd /d "%~dp0"',
  '',
  'echo ============================================================',
  'echo   PrBinView v' + VERSION + ' - Premiere Pro CEP 12 插件一键安装',
  'echo ============================================================',
  'echo.',
  '',
  'if not exist "%~dp0PrBinView\\CSXS\\manifest.xml" (',
  '  echo [错误] 未在当前目录找到 PrBinView 插件文件夹，请先完整解压压缩包再运行！',
  '  echo.',
  '  pause',
  '  exit /b 1',
  ')',
  '',
  'set "EXT_BASE=%APPDATA%\\Adobe\\CEP\\extensions"',
  'set "TARGET=%EXT_BASE%\\PrBinView"',
  'set "LEGACY=%EXT_BASE%\\com.antigravity.prbinview"',
  '',
  'if not exist "%EXT_BASE%" mkdir "%EXT_BASE%"',
  'if exist "%LEGACY%" rmdir /s /q "%LEGACY%"',
  'if exist "%TARGET%" rmdir /s /q "%TARGET%"',
  '',
  'xcopy "%~dp0PrBinView" "%TARGET%\\" /E /I /Y /Q /H >nul',
  'if errorlevel 1 (',
  '  echo [错误] 复制插件文件失败，请关闭 Premiere Pro 后重试。',
  '  echo.',
  '  pause',
  '  exit /b 1',
  ')',
  '',
  'reg add "HKCU\\Software\\Adobe\\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1',
  'reg add "HKCU\\Software\\Adobe\\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1',
  '',
  'echo [OK] 已安装 PrBinView v' + VERSION + ' 到：',
  'echo      %TARGET%',
  'echo [OK] 已自动开启 Adobe CEP 开发者模式 (CSXS.11 / CSXS.12 PlayerDebugMode=1)',
  'echo.',
  'echo 下一步：',
  'echo   1. 完全重启 Adobe Premiere Pro',
  'echo   2. 顶部菜单点击：窗口 - 扩展 - PrBinView · 媒体池预览',
  'echo      (English: Window - Extensions - PrBinView · 媒体池预览)',
  'echo.',
  'pause',
  ''
].join('\r\n');

var WIN_UNINSTALL_CMD = [
  '@echo off',
  'chcp 65001 >nul',
  'setlocal',
  '',
  'set "EXT_BASE=%APPDATA%\\Adobe\\CEP\\extensions"',
  'set "REMOVED=0"',
  '',
  'if exist "%EXT_BASE%\\PrBinView" (',
  '  rmdir /s /q "%EXT_BASE%\\PrBinView"',
  '  echo [OK] 已卸载：%EXT_BASE%\\PrBinView',
  '  set "REMOVED=1"',
  ')',
  'if exist "%EXT_BASE%\\com.antigravity.prbinview" (',
  '  rmdir /s /q "%EXT_BASE%\\com.antigravity.prbinview"',
  '  echo [OK] 已清理旧版本：%EXT_BASE%\\com.antigravity.prbinview',
  '  set "REMOVED=1"',
  ')',
  'if "%REMOVED%"=="0" (',
  '  echo [提示] 未发现已安装的 PrBinView 插件。',
  ')',
  'echo.',
  'pause',
  ''
].join('\r\n');

var MAC_INSTALL_SH = [
  '#!/bin/bash',
  'set -e',
  'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
  'SRC="$SCRIPT_DIR/PrBinView"',
  'EXT_BASE="$HOME/Library/Application Support/Adobe/CEP/extensions"',
  'TARGET="$EXT_BASE/PrBinView"',
  '',
  'if [ ! -f "$SRC/CSXS/manifest.xml" ]; then',
  '  echo "[Error] PrBinView folder not found next to this script."',
  '  exit 1',
  'fi',
  '',
  'mkdir -p "$EXT_BASE"',
  'rm -rf "$TARGET" "$EXT_BASE/com.antigravity.prbinview"',
  'cp -R "$SRC" "$TARGET"',
  '',
  'defaults write com.adobe.CSXS.11 PlayerDebugMode 1 || true',
  'defaults write com.adobe.CSXS.12 PlayerDebugMode 1 || true',
  '',
  'echo "[OK] Installed PrBinView v' + VERSION + ' to: $TARGET"',
  'echo "Restart Premiere Pro and open: Window -> Extensions -> PrBinView"',
  ''
].join('\n');

var FFMPEG_NOTICE = [
  'FFmpeg Binary Attribution & License Notice',
  '==========================================',
  '',
  'This Windows portable edition of PrBinView includes an unmodified ffmpeg.exe',
  'binary for fast local video/image thumbnail extraction and media probing.',
  '',
  '- Project: FFmpeg (https://ffmpeg.org/)',
  '- Windows Build: gyan.dev FFmpeg Release Essentials (https://www.gyan.dev/ffmpeg/builds/)',
  '- License: GNU General Public License v3.0 (see FFMPEG-LICENSE.txt in this folder)',
  '- Source Code: https://ffmpeg.org/download.html',
  ''
].join('\r\n');

function parseArgs(argv) {
  var out = { ffmpegSource: '' };
  for (var i = 0; i < argv.length; i++) {
    if (argv[i] === '--ffmpeg' && argv[i + 1]) {
      out.ffmpegSource = argv[++i];
    } else if (argv[i].indexOf('--ffmpeg=') === 0) {
      out.ffmpegSource = argv[i].slice('--ffmpeg='.length);
    }
  }
  return out;
}

function resolveFfmpegSource(inputPath) {
  if (!inputPath) return null;
  var p = path.resolve(inputPath);
  if (!fs.existsSync(p)) throw new Error('FFmpeg path not found: ' + p);
  var st = fs.statSync(p);
  var exePath = '';
  var baseDir = '';
  if (st.isFile()) {
    exePath = p;
    baseDir = path.dirname(p);
  } else {
    baseDir = p;
    var candidates = [
      path.join(p, 'bin', 'ffmpeg.exe'),
      path.join(p, 'ffmpeg.exe')
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (fs.existsSync(candidates[i])) { exePath = candidates[i]; break; }
    }
  }
  if (!exePath || !fs.existsSync(exePath)) {
    throw new Error('Could not locate ffmpeg.exe inside: ' + p);
  }
  var licenseCandidates = [
    path.join(baseDir, 'LICENSE'),
    path.join(baseDir, 'LICENSE.txt'),
    path.join(path.dirname(baseDir), 'LICENSE'),
    path.join(path.dirname(baseDir), 'LICENSE.txt')
  ];
  var licensePath = '';
  for (var j = 0; j < licenseCandidates.length; j++) {
    if (fs.existsSync(licenseCandidates[j]) && fs.statSync(licenseCandidates[j]).isFile()) {
      licensePath = licenseCandidates[j];
      break;
    }
  }
  return { exePath: exePath, licensePath: licensePath };
}

function buildBundle(bundleName, ffmpegInfo, includeMacScript) {
  var stageDir = path.join(DIST_DIR, bundleName);
  var zipPath = path.join(DIST_DIR, bundleName + '.zip');

  if (fs.existsSync(stageDir)) fs.rmSync(stageDir, { recursive: true, force: true });
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true });
  fs.mkdirSync(stageDir, { recursive: true });

  /* Copy plugin excluding any stray local bin/ directory so lightweight stays truly lightweight */
  fs.cpSync(PLUGIN_SRC, path.join(stageDir, 'PrBinView'), {
    recursive: true,
    filter: function (src) {
      var rel = path.relative(PLUGIN_SRC, src);
      return rel !== 'bin' && rel.indexOf('bin' + path.sep) !== 0 && rel !== '.debug';
    }
  });

  if (ffmpegInfo) {
    var binDir = path.join(stageDir, 'PrBinView', 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.copyFileSync(ffmpegInfo.exePath, path.join(binDir, 'ffmpeg.exe'));
    if (ffmpegInfo.licensePath) {
      fs.copyFileSync(ffmpegInfo.licensePath, path.join(binDir, 'FFMPEG-LICENSE.txt'));
    }
    fs.writeFileSync(path.join(binDir, 'FFMPEG-README.txt'), FFMPEG_NOTICE, 'utf8');
  }

  fs.copyFileSync(path.join(ROOT, 'README.md'), path.join(stageDir, 'README.md'));
  if (fs.existsSync(path.join(ROOT, 'README.en.md'))) {
    fs.copyFileSync(path.join(ROOT, 'README.en.md'), path.join(stageDir, 'README.en.md'));
  }
  if (fs.existsSync(path.join(ROOT, 'LICENSE'))) {
    fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(stageDir, 'LICENSE'));
  }
  fs.writeFileSync(path.join(stageDir, '一键安装_Windows.cmd'), WIN_INSTALL_CMD, 'utf8');
  fs.writeFileSync(path.join(stageDir, '一键卸载_Windows.cmd'), WIN_UNINSTALL_CMD, 'utf8');
  if (includeMacScript) {
    fs.writeFileSync(path.join(stageDir, 'install_macOS.command'), MAC_INSTALL_SH, { encoding: 'utf8', mode: 0o755 });
  }

  var psScript = [
    'Add-Type -AssemblyName System.IO.Compression',
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    '$src = ' + JSON.stringify(stageDir),
    '$dst = ' + JSON.stringify(zipPath),
    'if (Test-Path $dst) { Remove-Item $dst -Force }',
    '[System.IO.Compression.ZipFile]::CreateFromDirectory($src, $dst, [System.IO.Compression.CompressionLevel]::Optimal, $false, [System.Text.Encoding]::UTF8)',
    '$zip = [System.IO.Compression.ZipFile]::OpenRead($dst)',
    'try { $zip.Entries | ForEach-Object { $_.FullName } } finally { $zip.Dispose() }'
  ].join('; ');

  var out = cp.execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript
  ], { encoding: 'utf8' });

  var entries = out.trim().split(/\r?\n/).filter(Boolean);
  var stat = fs.statSync(zipPath);
  var sizeStr = stat.size >= 1048576
    ? ((stat.size / 1048576).toFixed(2) + ' MB')
    : (Math.round(stat.size / 1024) + ' KB');
  console.log('[OK] Packaged:', zipPath, '(' + sizeStr + ', ' + entries.length + ' files)');
  entries.forEach(function (e) { console.log('  - ' + e); });
}

function main() {
  if (!fs.existsSync(path.join(PLUGIN_SRC, 'CSXS', 'manifest.xml'))) {
    throw new Error('Missing PrBinView/CSXS/manifest.xml');
  }
  var opts = parseArgs(process.argv.slice(2));
  fs.mkdirSync(DIST_DIR, { recursive: true });

  /* 1. Lightweight cross-platform bundle */
  buildBundle('PrBinView-v' + VERSION, null, true);

  /* 2. Optional Windows single-binary FFmpeg portable bundle */
  if (opts.ffmpegSource) {
    var ffInfo = resolveFfmpegSource(opts.ffmpegSource);
    buildBundle('PrBinView-v' + VERSION + '-win-ffmpeg', ffInfo, false);
  }
}

main();
