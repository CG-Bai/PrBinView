'use strict';

var fs = require('node:fs');
var path = require('node:path');

var NAMES = ['PrBinView'];

function getBaseDir() {
  if (process.platform === 'win32') {
    if (!process.env.APPDATA) throw new Error('APPDATA 环境变量缺失');
    return path.join(process.env.APPDATA, 'Adobe', 'CEP', 'extensions');
  }
  if (process.platform === 'darwin') {
    return path.join(process.env.HOME || '', 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions');
  }
  throw new Error('仅支持 Windows 与 macOS');
}

var base = getBaseDir();
var removed = 0;
for (var i = 0; i < NAMES.length; i++) {
  var target = path.join(base, NAMES[i]);
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
    console.log('[OK] 已卸载 PrBinView 扩展：' + target);
    removed++;
  }
}
if (!removed) {
  console.log('[提示] 未发现已安装的 PrBinView 扩展：' + path.join(base, 'PrBinView'));
}
