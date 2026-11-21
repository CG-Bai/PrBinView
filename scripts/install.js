'use strict';

var fs = require('node:fs');
var path = require('node:path');
var cp = require('node:child_process');

var EXT_DIR_NAME = 'PrBinView';
var PLUGIN_SRC = path.resolve(__dirname, '..', 'PrBinView');

function getExtensionsBaseDir() {
  if (process.platform === 'win32') {
    if (!process.env.APPDATA) throw new Error('APPDATA 环境变量缺失');
    return path.join(process.env.APPDATA, 'Adobe', 'CEP', 'extensions');
  }
  if (process.platform === 'darwin') {
    return path.join(process.env.HOME || '', 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions');
  }
  throw new Error('仅支持 Windows 与 macOS');
}

function checkWinDebugMode() {
  if (process.platform !== 'win32') return true;
  try {
    var out = cp.execFileSync('reg', ['query', 'HKCU\\Software\\Adobe\\CSXS.12', '/v', 'PlayerDebugMode'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return /PlayerDebugMode\s+REG_\w+\s+1/i.test(out);
  } catch (_) {
    return false;
  }
}

function enableWinDebugMode() {
  cp.execFileSync('reg', ['add', 'HKCU\\Software\\Adobe\\CSXS.12', '/v', 'PlayerDebugMode', '/t', 'REG_SZ', '/d', '1', '/f'], {
    stdio: 'inherit'
  });
}

function main() {
  var args = process.argv.slice(2);
  var useLink = args.indexOf('--link') !== -1;
  var doEnableDebug = args.indexOf('--enable-debug') !== -1;
  var baseDir = getExtensionsBaseDir();
  var target = path.join(baseDir, EXT_DIR_NAME);

  fs.mkdirSync(baseDir, { recursive: true });

  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }

  if (useLink) {
    fs.symlinkSync(PLUGIN_SRC, target, 'junction');
    console.log('[OK] 已创建目录联接 (开发实时生效)：');
    console.log('     ' + target + ' -> ' + PLUGIN_SRC);
  } else {
    fs.cpSync(PLUGIN_SRC, target, { recursive: true });
    console.log('[OK] 已安装 PrBinView CEP 12 扩展到：');
    console.log('     ' + target);
  }

  if (process.platform === 'win32') {
    var debugOn = checkWinDebugMode();
    if (!debugOn && doEnableDebug) {
      enableWinDebugMode();
      debugOn = true;
      console.log('[OK] 已开启 CSXS.12 PlayerDebugMode = 1');
    }
    if (debugOn) {
      console.log('[OK] 检测到 CSXS.12 开发者模式已开启 (PlayerDebugMode=1)');
    } else {
      console.log('[提示] 尚未检测到 CSXS.12 PlayerDebugMode=1。本地未签名扩展需要开启它：');
      console.log('       运行：node scripts/install.js --enable-debug');
      console.log('       或执行：reg add HKCU\\Software\\Adobe\\CSXS.12 /v PlayerDebugMode /t REG_SZ /d 1 /f');
    }
  }

  console.log('');
  console.log('下一步：');
  console.log('  1. 重启 Premiere Pro（若当前已打开）');
  console.log('  2. 点击菜单：窗口 → 扩展 → PrBinView · 媒体池预览');
  console.log('  3. 无需开启 UDT，无需启动额外 CMD 窗口，也无需开启桥接面板！');
}

main();
