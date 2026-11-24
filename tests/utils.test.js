'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var U = require('../PrBinView/js/utils.js');

test('pathToFileUrl encodes Windows, Chinese, spaces, #, %, ? and UNC paths safely', function () {
  assert.equal(
    U.pathToFileUrl('D:\\素材\\A机位\\100% 实拍 #1?.mp4'),
    'file:///D:/%E7%B4%A0%E6%9D%90/A%E6%9C%BA%E4%BD%8D/100%25%20%E5%AE%9E%E6%8B%8D%20%231%3F.mp4'
  );
  assert.equal(
    U.pathToFileUrl('\\\\?\\C:\\Work\\clip 1.mov'),
    'file:///C:/Work/clip%201.mov'
  );
  assert.equal(
    U.pathToFileUrl('\\\\NAS01\\Share\\视频\\shot.mxf'),
    'file://NAS01/Share/%E8%A7%86%E9%A2%91/shot.mxf'
  );
  assert.equal(
    U.pathToFileUrl('\\\\?\\UNC\\NAS01\\Share\\a b.mp4'),
    'file://NAS01/Share/a%20b.mp4'
  );
});

test('detectKind classifies bins, sequences, videos, images, audio, and unsupported vectors', function () {
  assert.equal(U.detectKind({ isBin: true, name: 'Footage' }), 'bin');
  assert.equal(U.detectKind({ isSeq: true, name: 'MainEdit' }), 'sequence');
  assert.equal(U.detectKind({ path: 'D:/a.mp4', name: 'a.mp4' }), 'video');
  assert.equal(U.detectKind({ path: 'D:/a.mxf', name: 'a.mxf' }), 'video');
  assert.equal(U.detectKind({ path: 'D:/a.psd', name: 'a.psd' }), 'image');
  assert.equal(U.detectKind({ path: 'D:/a.png', name: 'a.png' }), 'image');
  assert.equal(U.detectKind({ path: 'D:/a.wav', name: 'a.wav' }), 'audio');
  assert.equal(U.detectKind({ path: 'D:/logo.ai', name: 'logo.ai' }), 'image');
  assert.equal(U.isVectorExt('ai'), true);
  assert.equal(U.isVectorExt('pdf'), true);
  assert.equal(U.isUnsupportedPreviewExt('ai'), false);
  assert.equal(U.isUnsupportedPreviewExt('mogrt'), true);
  assert.equal(U.isProImageExt('psd'), true);
  assert.equal(U.isWebImageExt('png'), true);
});

test('buildTreeIndex computes recursive media counts and collectItems filters cleanly', function () {
  var raw = [
    { id: 'r', pid: '', name: 'Proj', isBin: true },
    { id: 'b1', pid: 'r', name: '素材', isBin: true },
    { id: 'b2', pid: 'b1', name: 'A机位', isBin: true },
    { id: 'v1', pid: 'b2', name: 'A002.mp4', path: 'D:/A002.mp4', label: 4 },
    { id: 'v2', pid: 'b2', name: 'A001.mp4', path: 'D:/A001.mp4', label: 1 },
    { id: 'a1', pid: 'b1', name: 'bgm.wav', path: 'D:/bgm.wav', label: 5 },
    { id: 's1', pid: 'r', name: '主序列', isSeq: true, label: 13 }
  ];
  var index = U.buildTreeIndex(raw, 'r');

  assert.equal(index.mediaCounts.get('r'), 4);
  assert.equal(index.mediaCounts.get('b1'), 3);
  assert.equal(index.mediaCounts.get('b2'), 2);
  assert.equal(index.directMediaCounts.get('b1'), 1);

  /* Direct children of b1: bin b2 first, then audio a1 */
  var direct = U.collectItems(index, 'b1', {});
  assert.deepEqual(direct.map(function (n) { return n.id; }), ['b2', 'a1']);

  /* Flattened subfolders of b1: all 3 media items (no bins) */
  var flat = U.collectItems(index, 'b1', { includeSubfolders: true, sortBy: 'name', sortDir: 'asc' });
  assert.deepEqual(flat.map(function (n) { return n.id; }), ['v2', 'v1', 'a1']);

  /* Global search across project */
  var hit = U.collectItems(index, 'b2', { query: 'bgm', globalSearch: true });
  assert.deepEqual(hit.map(function (n) { return n.id; }), ['a1']);

  /* Ancestor breadcrumbs */
  var chain = U.getAncestors(index.nodes, 'b2');
  assert.deepEqual(chain.map(function (n) { return n.id; }), ['r', 'b1', 'b2']);
});

test('validateMove blocks cyclic bin moves and deduplicates nested selections', function () {
  var raw = [
    { id: 'r', pid: '', name: 'Root', isBin: true },
    { id: 'b1', pid: 'r', name: 'Parent', isBin: true },
    { id: 'b2', pid: 'b1', name: 'Child', isBin: true },
    { id: 'b3', pid: 'r', name: 'Target', isBin: true },
    { id: 'c1', pid: 'b2', name: 'clip.mp4', path: 'D:/clip.mp4' }
  ];
  var index = U.buildTreeIndex(raw, 'r');

  assert.throws(function () {
    U.validateMove(index.nodes, ['b1'], 'b2');
  }, /移入自身或子素材箱/);

  assert.throws(function () {
    U.validateMove(index.nodes, ['r'], 'b3');
  }, /不能移动工程根目录/);

  /* Selecting both parent bin b1 and descendant clip c1 should only move top-level b1 */
  var plan = U.validateMove(index.nodes, ['b1', 'c1'], 'b3');
  assert.deepEqual(plan, ['b1']);
});

test('multi-column sorting handles FPS, SMPTE timecode, resolution area, and folder sorting accurately', function () {
  var raw = [
    { id: 'r', pid: '', name: 'Proj', isBin: true },
    { id: 'b2', pid: 'r', name: 'OBS', isBin: true, label: 4 },
    { id: 'b1', pid: 'r', name: 'Bin', isBin: true, label: 7 },
    { id: 'c1', pid: 'b2', name: 'clip1.mp4', path: 'D:/1.mp4', meta: { fps: '25.00 fps', mediaDuration: '00:01:26:21', videoInfo: '1920 x 1080 (1.0)' } },
    { id: 'c2', pid: 'b2', name: 'clip2.mp4', path: 'D:/2.mp4', meta: { fps: '120.00 fps', mediaDuration: '00:00:54:00', videoInfo: '3840 x 2160 (1.0)' } },
    { id: 'c3', pid: 'b2', name: 'clip3.mp4', path: 'D:/3.mp4', meta: { fps: '59.94 fps', mediaDuration: '00:00:03:13', videoInfo: '2560 x 1440 (1.0)' } },
    { id: 'c4', pid: 'b1', name: 'a.mp4', path: 'D:/a.mp4' }
  ];
  var index = U.buildTreeIndex(raw, 'r');

  /* FPS numeric sort (120 > 59.94 > 25) */
  var byFpsDesc = U.collectItems(index, 'b2', { sortBy: 'fps', sortDir: 'desc' });
  assert.deepEqual(byFpsDesc.map(function (n) { return n.id; }), ['c2', 'c3', 'c1']);

  /* Timecode duration sort */
  var byDurAsc = U.collectItems(index, 'b2', { sortBy: 'mediaDuration', sortDir: 'asc' });
  assert.deepEqual(byDurAsc.map(function (n) { return n.id; }), ['c3', 'c2', 'c1']);

  /* Resolution area sort */
  var byResDesc = U.collectItems(index, 'b2', { sortBy: 'videoInfo', sortDir: 'desc' });
  assert.deepEqual(byResDesc.map(function (n) { return n.id; }), ['c2', 'c3', 'c1']);

  /* Left folder tree sort: name / count / label / order */
  var rootBins = index.subBinsByParent.get('r');
  assert.deepEqual(U.sortFolderList(rootBins, index.mediaCounts, 'name', 'asc').map(function (b) { return b.id; }), ['b1', 'b2']);
  assert.deepEqual(U.sortFolderList(rootBins, index.mediaCounts, 'count', 'desc').map(function (b) { return b.id; }), ['b2', 'b1']);
  assert.deepEqual(U.sortFolderList(rootBins, index.mediaCounts, 'label', 'desc').map(function (b) { return b.id; }), ['b1', 'b2']);
  assert.deepEqual(U.sortFolderList(rootBins, index.mediaCounts, 'order', 'asc').map(function (b) { return b.id; }), ['b2', 'b1']);
});

test('scanExternalPaths recursively scans folders while ignoring OS junk files', function () {
  var Bridge = require('../PrBinView/js/cep-bridge.js');
  var pathMod = require('node:path');
  var treeMap = {
    'd:\\drop\\assets': { dir: true, entries: ['Background.mp4', 'Thumbs.db', '.DS_Store', 'Sub', '.git'] },
    'd:\\drop\\assets\\background.mp4': { file: true },
    'd:\\drop\\assets\\thumbs.db': { file: true },
    'd:\\drop\\assets\\.ds_store': { file: true },
    'd:\\drop\\assets\\sub': { dir: true, entries: ['clip.mov'] },
    'd:\\drop\\assets\\sub\\clip.mov': { file: true },
    'd:\\drop\\assets\\.git': { dir: true, entries: ['HEAD'] },
    'd:\\drop\\single.png': { file: true }
  };
  var mockFs = {
    statSync: function (p) {
      var entry = treeMap[String(p).toLowerCase()];
      if (!entry) throw new Error('ENOENT');
      return { isDirectory: function () { return !!entry.dir; }, isFile: function () { return !!entry.file; } };
    },
    readdirSync: function (p) {
      var entry = treeMap[String(p).toLowerCase()];
      return entry ? entry.entries : [];
    }
  };
  var plan = Bridge.scanExternalPaths(mockFs, pathMod, ['D:\\drop\\Assets', 'D:\\drop\\single.png']);
  assert.equal(plan.files.length, 1);
  assert.equal(plan.folders.length, 1);
  assert.equal(plan.folders[0].name, 'Assets');
  assert.equal(plan.folders[0].files.length, 1);
  assert.equal(plan.folders[0].dirs.length, 1);
  assert.equal(plan.folders[0].dirs[0].name, 'Sub');
  assert.equal(plan.totalFiles, 3);
});

test('uriToPath normalizes Adobe CEP file:/// URIs, encoded Chinese/spaces, and native paths', function () {
  assert.equal(
    U.uriToPath('file:///C:/Users/Alice/AppData/Roaming/Adobe/CEP/extensions/PrBinView'),
    'C:/Users/Alice/AppData/Roaming/Adobe/CEP/extensions/PrBinView'
  );
  assert.equal(
    U.uriToPath('file:///C:/Users/My%20User/%E6%8F%92%E4%BB%B6/PrBinView'),
    'C:/Users/My User/插件/PrBinView'
  );
  assert.equal(
    U.uriToPath('/C:/Program%20Files/PrBinView'),
    'C:/Program Files/PrBinView'
  );
  assert.equal(
    U.uriToPath('file:///Library/Application%20Support/Adobe/CEP/extensions/PrBinView'),
    '/Library/Application Support/Adobe/CEP/extensions/PrBinView'
  );
  assert.equal(
    U.uriToPath('C:\\Users\\Alice\\PrBinView'),
    'C:/Users/Alice/PrBinView'
  );
});

test('matchOfflineClipsInPaths matches offline clips by filename and prefers same parent folder', function () {
  var Bridge = require('../PrBinView/js/cep-bridge');
  var offline = [
    { id: '1', name: 'background.mp4', path: 'D:\\Old\\003-Render\\background.mp4' },
    { id: '2', name: 'background01.mp4', path: 'D:\\Old\\003-Render\\background01.mp4' },
    { id: '3', name: 'missing.mov', path: 'D:\\Old\\003-Render\\missing.mov' }
  ];
  var found = [
    'E:\\Backup\\Other\\background.mp4',
    'E:\\Backup\\003-Render\\background.mp4',
    'E:\\Backup\\003-Render\\background01.mp4'
  ];
  var pairs = Bridge.matchOfflineClipsInPaths(offline, found);
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].id, '1');
  assert.equal(pairs[0].newPath, 'E:\\Backup\\003-Render\\background.mp4');
  assert.equal(pairs[1].id, '2');
  assert.equal(pairs[1].newPath, 'E:\\Backup\\003-Render\\background01.mp4');
});

test('i18n has 100% key/placeholder parity between zh and en and switches Premiere-native names dynamically', function () {
  var I18n = require('../PrBinView/js/i18n');
  var zhKeys = Object.keys(I18n.DICT.zh).sort();
  var enKeys = Object.keys(I18n.DICT.en).sort();
  assert.deepEqual(zhKeys, enKeys, 'zh and en dictionary keys must match 1-to-1');

  /* Verify placeholder tokens ({name}, {n}, etc.) match in every zh/en pair */
  zhKeys.forEach(function (k) {
    var zhVars = (I18n.DICT.zh[k].match(/\{[a-zA-Z0-9_]+\}/g) || []).sort();
    var enVars = (I18n.DICT.en[k].match(/\{[a-zA-Z0-9_]+\}/g) || []).sort();
    assert.deepEqual(zhVars, enVars, 'Placeholder mismatch for i18n key: ' + k);
    assert.ok(I18n.DICT.zh[k].length > 0 && I18n.DICT.en[k].length > 0);
  });

  assert.equal(I18n.LABELS.zh.length, 16);
  assert.equal(I18n.LABELS.en.length, 16);
  assert.deepEqual(Object.keys(I18n.COLUMNS.zh).sort(), Object.keys(I18n.COLUMNS.en).sort());
  assert.deepEqual(Object.keys(I18n.KINDS.zh).sort(), Object.keys(I18n.KINDS.en).sort());

  try {
    I18n.setLang('en');
    assert.equal(U.columnLabel('fps'), 'Frame Rate');
    assert.equal(U.columnLabel('mediaDuration'), 'Media Duration');
    assert.equal(U.labelName(0), 'Violet');
    assert.equal(U.labelName(7), 'Mango');
    assert.equal(U.kindLabel('bin'), 'Bin');
    assert.equal(I18n.t('menu.replaceFootage'), 'Replace Footage…');
    assert.equal(I18n.t('menu.linkMedia'), 'Link Media…');
    assert.equal(I18n.t('menu.makeOffline'), 'Make Offline…');
    assert.equal(U.getColumnCellText({ isBin: false, offline: true }, 'status'), 'Offline');
    assert.equal(U.getColumnCellText({ isBin: false, offline: false }, 'status'), 'Online');

    I18n.setLang('zh');
    assert.equal(U.columnLabel('fps'), '帧速率');
    assert.equal(U.columnLabel('mediaDuration'), '媒体时长');
    assert.equal(U.labelName(0), '紫罗兰');
    assert.equal(U.kindLabel('bin'), '素材箱');
    assert.equal(I18n.t('menu.replaceFootage'), '替换素材…');
    assert.equal(U.getColumnCellText({ isBin: false, offline: true }, 'status'), '脱机');
    assert.equal(U.getColumnCellText({ isBin: false, offline: false }, 'status'), '在线');
  } finally {
    I18n.setLang('zh');
  }

  /* Verify every static t('...') / tr('...') key used across runtime JS exists in both zh & en */
  var fs = require('node:fs');
  var path = require('node:path');
  var jsDir = path.resolve(__dirname, '..', 'PrBinView', 'js');
  ['utils.js', 'cep-bridge.js', 'tree-view.js', 'grid-view.js', 'app.js'].forEach(function (fname) {
    var src = fs.readFileSync(path.join(jsDir, fname), 'utf8');
    var re = /\b(?:t|tr)\(\s*'([a-zA-Z0-9_.-]+)'\s*[,)]/g;
    var m;
    while ((m = re.exec(src)) !== null) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(I18n.DICT.zh, m[1]) &&
        Object.prototype.hasOwnProperty.call(I18n.DICT.en, m[1]),
        'Missing i18n key "' + m[1] + '" referenced in ' + fname
      );
    }
  });
});

test('Premiere label prefs parser auto-detects BGR/ARGB/RGBA/Hex colors, parses .prlabelpreset, and preserves bilingual defaults', function () {
  var I18n = require('../PrBinView/js/i18n');

  /* 1. Premiere Pro 24-bit BGR integer format (Windows COLORREF / asl.clip.label.color) */
  var bgrXml = '<Properties>' +
    '<BE.Prefs.LabelColors.1 Type="1">13408882</BE.Prefs.LabelColors.1>' + /* 0xCC9A72 -> #729acc (Iris) */
    '<BE.Prefs.LabelColors.7 Type="1">4758495</BE.Prefs.LabelColors.7>' +  /* 0x489BDF -> #df9b48 (Mango) */
    '<BE.Prefs.LabelColors.6 Type="1">4465407</BE.Prefs.LabelColors.6>' +  /* 0x4422FF -> #ff2244 (Custom Red) */
    '<BE.Prefs.LabelNames.1 Type="4">Iris</BE.Prefs.LabelNames.1>' +
    '<BE.Prefs.LabelNames.6 Type="4">特效镜头</BE.Prefs.LabelNames.6>' +
    '<BE.Prefs.LabelColorPreset Type="4">StudioPreset</BE.Prefs.LabelColorPreset>' +
    '<BE.Prefs.LabelDefaults.Bin Type="1">11</BE.Prefs.LabelDefaults.Bin>' +
    '</Properties>';
  var p1 = U.parsePremierePrefsLabels(bgrXml);
  assert.equal(p1.colors[1], '#729acc');
  assert.equal(p1.colors[7], '#df9b48');
  assert.equal(p1.colors[6], '#ff2244');
  assert.equal(p1.names[1], 'Iris');
  assert.equal(p1.names[6], '特效镜头');
  assert.equal(p1.presetName, 'StudioPreset');
  assert.equal(p1.defaultBinLabel, 11);

  var namedBinXml = '<Properties><BE.Prefs.DefaultLabels.Bin>芒果黄</BE.Prefs.DefaultLabels.Bin></Properties>';
  assert.equal(U.parsePremierePrefsLabels(namedBinXml).defaultBinLabel, 7);

  /* 2. 32-bit ARGB unsigned integer format (0xFFRRGGBB) */
  var argbList = U.resolveLabelColorList({
    0: 0xff9c7ad6,
    4: 0xff4ea4dc,
    7: 0xffdf9b48,
    15: 0xff00ff88
  });
  assert.equal(argbList[0], '#9c7ad6');
  assert.equal(argbList[4], '#4ea4dc');
  assert.equal(argbList[7], '#df9b48');
  assert.equal(argbList[15], '#00ff88');

  /* 3. 32-bit RGBA unsigned integer format (0xRRGGBBFF) */
  var rgbaList = U.resolveLabelColorList({
    4: 0x4ea4dcff,
    7: 0xdf9b48ff,
    13: 0x6cb85bff
  });
  assert.equal(rgbaList[4], '#4ea4dc');
  assert.equal(rgbaList[7], '#df9b48');
  assert.equal(rgbaList[13], '#6cb85b');

  /* 4. .prlabelpreset JSON format */
  var presetJson = JSON.stringify({
    labels: [
      { index: 0, name: 'Violet', color: '#aa66ff' },
      { index: 2, name: 'B-Roll', color: { r: 0.1, g: 0.8, b: 0.6 } }
    ]
  });
  var parsedPreset = U.parseLabelPresetText(presetJson);
  assert.equal(parsedPreset.colors[0], '#aa66ff');
  assert.equal(parsedPreset.colors[2], '#1acc99');
  assert.equal(parsedPreset.names[2], 'B-Roll');

  /* 5. applyCustomLabels keeps default names bilingual while honoring custom user names */
  try {
    var applied = U.applyCustomLabels(p1);
    assert.equal(applied.changed, true);
    assert.equal(U.labelColor(6), '#ff2244');
    assert.equal(U.labelName(6), '特效镜头'); /* custom name overrides in zh */
    assert.equal(U.labelName(1), '鸢尾花');   /* default "Iris" still renders zh in zh mode */

    I18n.setLang('en');
    assert.equal(U.labelName(6), '特效镜头'); /* custom name stays preserved in en */
    assert.equal(U.labelName(1), 'Iris');     /* default renders en in en mode */
  } finally {
    I18n.setLang('zh');
    U.resetCustomLabels();
  }
  assert.equal(U.labelColor(6), U.DEFAULT_LABEL_COLORS[6].color);
  assert.equal(U.labelName(6), '玫瑰红');
});

test('Premiere .kys shortcut parser decodes virtualkeys, finds active preset, and extracts Reveal In Project binding', function () {
  /* 1. Standard 0x80000000 + ASCII virtualkeys and Premiere internal function keys */
  var keyF = U.decodePremiereVirtualKey('2147483718'); /* 0x80000000 + 'F'(70) */
  assert.equal(keyF.vk, 70);
  assert.equal(keyF.keyLabel, 'F');
  assert.equal(keyF.domKey, 'f');

  var key5 = U.decodePremiereVirtualKey('2147483701'); /* 0x80000000 + '5'(53) */
  assert.equal(key5.vk, 53);
  assert.equal(key5.keyLabel, '5');

  var keyF5 = U.decodePremiereVirtualKey('11'); /* Premiere F5 */
  assert.equal(keyF5.vk, 116);
  assert.equal(keyF5.keyLabel, 'F5');
  assert.equal(keyF5.isFunc, true);

  var keyF8 = U.decodePremiereVirtualKey('14'); /* Premiere F8 */
  assert.equal(keyF8.vk, 119);
  assert.equal(keyF8.keyLabel, 'F8');

  /* 2. Parse Reveal In Project with Alt+F while ignoring unrelated Reveal commands */
  var kysAltF = '<PremiereData><context.global>' +
    '<item.1 Version="1"><virtualkey>2147483717</virtualkey><modifier.ctrl>true</modifier.ctrl><modifier.alt>false</modifier.alt><modifier.shift>false</modifier.shift><commandname>cmd.edit.revealinexplorer</commandname></item.1>' +
    '<item.2 Version="1"><virtualkey>2147483718</virtualkey><modifier.ctrl>false</modifier.ctrl><modifier.alt>true</modifier.alt><modifier.shift>false</modifier.shift><commandname>cmd.edit.revealinproject</commandname></item.2>' +
    '</context.global></PremiereData>';
  var p1 = U.parsePremiereKysRevealShortcut(kysAltF, 'DaVinci Resolve (pr快捷键)');
  assert.ok(p1);
  assert.equal(p1.label, 'Alt+F');
  assert.equal(p1.vk, 70);
  assert.equal(p1.winMods, 1);
  assert.equal(p1.alt, true);
  assert.equal(p1.ctrl, false);
  assert.equal(p1.shift, false);

  /* 3. Custom Ctrl+Shift+R binding */
  var kysCustom = '<PremiereData><item.9 Version="1">' +
    '<virtualkey>2147483730</virtualkey>' + /* 'R' = 82 */
    '<modifier.ctrl>true</modifier.ctrl><modifier.alt>false</modifier.alt><modifier.shift>true</modifier.shift>' +
    '<commandname>cmd.clip.reveal.in.project</commandname></item.9></PremiereData>';
  var p2 = U.parsePremiereKysRevealShortcut(kysCustom, 'MyCustom');
  assert.ok(p2);
  assert.equal(p2.label, 'Ctrl+Shift+R');
  assert.equal(p2.vk, 82);
  assert.equal(p2.winMods, 6); /* MOD_CONTROL(2) | MOD_SHIFT(4) */

  /* 4. Bare function key F8 is accepted, bare letter without modifier is safely ignored */
  var kysF8 = '<PremiereData><item.1 Version="1"><virtualkey>14</virtualkey><modifier.ctrl>false</modifier.ctrl><modifier.alt>false</modifier.alt><modifier.shift>false</modifier.shift><commandname>clip.revealInProject</commandname></item.1></PremiereData>';
  var p3 = U.parsePremiereKysRevealShortcut(kysF8, 'FnPreset');
  assert.ok(p3);
  assert.equal(p3.label, 'F8');
  assert.equal(p3.winMods, 0);
  assert.equal(p3.vk, 119);

  var kysBareLetter = '<PremiereData><item.1 Version="1"><virtualkey>2147483718</virtualkey><modifier.ctrl>false</modifier.ctrl><modifier.alt>false</modifier.alt><modifier.shift>false</modifier.shift><commandname>cmd.edit.revealinproject</commandname></item.1></PremiereData>';
  assert.equal(U.parsePremiereKysRevealShortcut(kysBareLetter, 'Bare'), null);

  /* 5. Match active .kys filename from Adobe Premiere Pro Prefs XML (including Chinese names) */
  var prefsXml = '<Properties><FE.Prefs.ActiveKeyboardShortcutPreset>DaVinci Resolve (pr快捷键)</FE.Prefs.ActiveKeyboardShortcutPreset></Properties>';
  var active = U.findActiveKysFromPrefs(prefsXml, ['Adobe Premiere Pro Defaults.kys', 'DaVinci Resolve (pr快捷键).kys']);
  assert.equal(active, 'DaVinci Resolve (pr快捷键).kys');
});
