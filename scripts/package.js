'use strict';

var fs = require('node:fs');
var path = require('node:path');
var cp = require('node:child_process');

var ROOT = path.resolve(__dirname, '..');
var PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
var VERSION = PKG.version || '1.0.0';
var PLUGIN_SRC = path.join(ROOT, 'PrBinView');
var DIST_DIR = path.join(ROOT, 'dist');
var BUNDLE_NAME = 'PrBinView-v' + VERSION;
var STAGE_DIR = path.join(DIST_DIR, BUNDLE_NAME);
var ZIP_PATH = path.join(DIST_DIR, BUNDLE_NAME + '.zip');

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
  '',
  'if not exist "%EXT_BASE%" mkdir "%EXT_BASE%"',
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
  'rm -rf "$TARGET"',
  'cp -R "$SRC" "$TARGET"',
  '',
  'defaults write com.adobe.CSXS.11 PlayerDebugMode 1 || true',
  'defaults write com.adobe.CSXS.12 PlayerDebugMode 1 || true',
  '',
  'echo "[OK] Installed PrBinView v' + VERSION + ' to: $TARGET"',
  'echo "Restart Premiere Pro and open: Window -> Extensions -> PrBinView"',
  ''
].join('\n');

function main() {
  if (!fs.existsSync(path.join(PLUGIN_SRC, 'CSXS', 'manifest.xml'))) {
    throw new Error('Missing PrBinView/CSXS/manifest.xml');
  }

  fs.mkdirSync(DIST_DIR, { recursive: true });
  if (fs.existsSync(STAGE_DIR)) fs.rmSync(STAGE_DIR, { recursive: true, force: true });
  if (fs.existsSync(ZIP_PATH)) fs.rmSync(ZIP_PATH, { force: true });

  fs.mkdirSync(STAGE_DIR, { recursive: true });
  fs.cpSync(PLUGIN_SRC, path.join(STAGE_DIR, 'PrBinView'), {
    recursive: true,
    filter: function (src) {
      var rel = path.relative(PLUGIN_SRC, src).replace(/\\/g, '/');
      if (!rel) return true;
      if (rel === '.debug' || rel === '.debug.example') return false;
      if (rel === 'bin' || rel.indexOf('bin/') === 0) return false;
      return true;
    }
  });
  fs.copyFileSync(path.join(ROOT, 'README.md'), path.join(STAGE_DIR, 'README.md'));
  var licenseSrc = path.join(ROOT, 'LICENSE');
  if (fs.existsSync(licenseSrc)) {
    fs.copyFileSync(licenseSrc, path.join(STAGE_DIR, 'LICENSE'));
  }
  fs.writeFileSync(path.join(STAGE_DIR, '一键安装_Windows.cmd'), WIN_INSTALL_CMD, 'utf8');
  fs.writeFileSync(path.join(STAGE_DIR, '一键卸载_Windows.cmd'), WIN_UNINSTALL_CMD, 'utf8');
  fs.writeFileSync(path.join(STAGE_DIR, 'install_macOS.command'), MAC_INSTALL_SH, { encoding: 'utf8', mode: 0o755 });

  var psScript = [
    'Add-Type -AssemblyName System.IO.Compression',
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    '$src = ' + JSON.stringify(STAGE_DIR),
    '$dst = ' + JSON.stringify(ZIP_PATH),
    'if (Test-Path $dst) { Remove-Item $dst -Force }',
    '[System.IO.Compression.ZipFile]::CreateFromDirectory($src, $dst, [System.IO.Compression.CompressionLevel]::Optimal, $false, [System.Text.Encoding]::UTF8)',
    '$zip = [System.IO.Compression.ZipFile]::OpenRead($dst)',
    'try { $zip.Entries | ForEach-Object { $_.FullName } } finally { $zip.Dispose() }'
  ].join('; ');

  var out = cp.execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript
  ], { encoding: 'utf8' });

  var entries = out.trim().split(/\r?\n/).filter(Boolean);
  var stat = fs.statSync(ZIP_PATH);
  console.log('[OK] Packaged:', ZIP_PATH, '(' + Math.round(stat.size / 1024) + ' KB, ' + entries.length + ' files)');
  console.log('[OK] Unpacked folder:', STAGE_DIR);
  entries.forEach(function (e) { console.log('  - ' + e); });
}

main();
