(function (root) {
  'use strict';

  var I18n = root.PrI18n || (typeof require === 'function' ? require('./i18n') : null);
  function tr(key, vars) { return I18n ? I18n.t(key, vars) : key; }

  var WEB_IMAGE_EXT = /^(jpe?g|png|webp|gif|bmp|svg|ico)$/i;
  var PRO_IMAGE_EXT = /^(psd|psb|tiff?|tga|exr|dpx|heic|heif|avif|raw|cr2|cr3|nef|arw|dng)$/i;
  var VECTOR_EXT = /^(ai|pdf|eps)$/i;
  var AUDIO_EXT = /^(wav|wave|mp3|aac|m4a|aiff?|flac|ogg|opus|wma|ac3)$/i;
  var NATIVE_VIDEO_EXT = /^(mp4|m4v|webm|mov)$/i;
  var OTHER_VIDEO_EXT = /^(mxf|mkv|avi|mts|m2ts|mpg|mpeg|wmv|asf|ts|flv|f4v|vob|ogv|3gp|r3d|braw|crm|dv|rmvb)$/i;
  var UNSUPPORTED_PREVIEW_EXT = /^(indd|aep|prproj|mogrt|srt|ass|vtt|xml|edl|aaf|cube|look)$/i;

  var DEFAULT_LABEL_COLORS = [
    { index: 0, name: '紫罗兰', color: '#9c7ad6' },
    { index: 1, name: '鸢尾花', color: '#7888d6' },
    { index: 2, name: '加勒比海', color: '#45b8ac' },
    { index: 3, name: '薰衣草', color: '#c48cc4' },
    { index: 4, name: '蔚蓝', color: '#4ea4dc' },
    { index: 5, name: '森林绿', color: '#539e6d' },
    { index: 6, name: '玫瑰红', color: '#d4748c' },
    { index: 7, name: '芒果黄', color: '#df9b48' },
    { index: 8, name: '紫色', color: '#8d53b8' },
    { index: 9, name: '蓝色', color: '#3b6fd8' },
    { index: 10, name: '蓝绿色', color: '#34999b' },
    { index: 11, name: '洋红', color: '#cf509d' },
    { index: 12, name: '棕褐色', color: '#b59c72' },
    { index: 13, name: '绿色', color: '#6cb85b' },
    { index: 14, name: '棕色', color: '#8a6246' },
    { index: 15, name: '黄色', color: '#d9c14a' }
  ];

  var LABEL_COLORS = DEFAULT_LABEL_COLORS.map(function (c) {
    return { index: c.index, name: c.name, color: c.color, customName: '' };
  });

  var BUILTIN_LABEL_ALIASES = [
    ['violet', '紫罗兰'],
    ['iris', '鸢尾花', '鸢尾蓝'],
    ['caribbean', '加勒比海', '加勒比蓝'],
    ['lavender', '薰衣草'],
    ['cerulean', '蔚蓝', '天蓝色', '天蓝'],
    ['forest', '森林绿', '森林'],
    ['rose', '玫瑰红', '玫瑰'],
    ['mango', '芒果黄', '芒果橙', '芒果'],
    ['purple', '紫色', '深紫色'],
    ['blue', '蓝色', '钴蓝色'],
    ['teal', '蓝绿色', '青色'],
    ['magenta', '洋红', '品红'],
    ['tan', '棕褐色', '棕褐'],
    ['green', '绿色', '亮绿色'],
    ['brown', '棕色', '深棕色'],
    ['yellow', '黄色', '柠檬黄']
  ];

  var KIND_LABEL = {
    bin: '素材箱',
    sequence: '序列',
    video: '视频',
    image: '图片',
    audio: '音频',
    other: '其他'
  };

  var KIND_ORDER = {
    bin: 0,
    sequence: 1,
    video: 2,
    image: 3,
    audio: 4,
    other: 5
  };

  var MEDIA_COLUMNS = [
    { id: 'label',         label: '标签',     width: 34,  minWidth: 28,  visible: true,  isLabel: true },
    { id: 'name',          label: '名称',     width: 240, minWidth: 140, visible: true,  locked: true },
    { id: 'fps',           label: '帧速率',   width: 82,  minWidth: 64,  visible: true,  needsMeta: true },
    { id: 'mediaStart',    label: '媒体起始', width: 92,  minWidth: 74,  visible: true,  mono: true, needsMeta: true },
    { id: 'mediaEnd',      label: '媒体结束', width: 92,  minWidth: 74,  visible: true,  mono: true, needsMeta: true },
    { id: 'mediaDuration', label: '媒体时长', width: 92,  minWidth: 74,  visible: true,  mono: true, needsMeta: true },
    { id: 'videoIn',       label: '视频入点', width: 92,  minWidth: 74,  visible: true,  mono: true, accent: true, needsMeta: true },
    { id: 'videoOut',      label: '视频出点', width: 92,  minWidth: 74,  visible: true,  mono: true, accent: true, needsMeta: true },
    { id: 'videoDuration', label: '视频时长', width: 92,  minWidth: 74,  visible: true,  mono: true, needsMeta: true },
    { id: 'videoInfo',     label: '视频信息', width: 138, minWidth: 96,  visible: true,  needsMeta: true },
    { id: 'audioInfo',     label: '音频信息', width: 186, minWidth: 110, visible: true,  needsMeta: true },
    { id: 'status',        label: '状态',     width: 66,  minWidth: 52,  visible: true },
    { id: 'kind',          label: '类型',     width: 68,  minWidth: 54,  visible: false },
    { id: 'description',   label: '描述',     width: 130, minWidth: 80,  visible: false, needsMeta: true },
    { id: 'logNote',       label: '备注',     width: 130, minWidth: 80,  visible: false, needsMeta: true },
    { id: 'path',          label: '文件路径', width: 240, minWidth: 120, visible: false }
  ];

  function parseTimecodeValue(str) {
    var s = String(str || '').trim();
    if (!s) return -1;
    var m = s.match(/^(\d+)[:;](\d+)[:;](\d+)[:;](\d+)$/);
    if (m) {
      return (((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000) + Number(m[4]);
    }
    var m2 = s.match(/^(\d+)[:;](\d+)$/);
    if (m2) return (Number(m2[1]) * 60 + Number(m2[2])) * 1000;
    var n = parseFloat(s);
    return Number.isFinite(n) ? n : -1;
  }

  function parseFpsValue(str) {
    var m = String(str || '').match(/(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : -1;
  }

  function parseResolutionArea(str) {
    var m = String(str || '').match(/(\d+)\s*[x×]\s*(\d+)/i);
    return m ? (Number(m[1]) * Number(m[2])) : -1;
  }

  function parseAudioRate(str) {
    var m = String(str || '').match(/(\d+(?:\.\d+)?)\s*(k?hz)/i);
    if (!m) return -1;
    var v = Number(m[1]);
    return /^k/i.test(m[2]) ? v * 1000 : v;
  }

  function getColumnCellText(node, colId) {
    if (!node) return '';
    var m = node.meta || {};
    switch (colId) {
      case 'name': return node.name;
      case 'fps': return m.fps || '';
      case 'mediaStart': return m.mediaStart || '';
      case 'mediaEnd': return m.mediaEnd || '';
      case 'mediaDuration': return m.mediaDuration || '';
      case 'videoIn': return m.videoIn || '';
      case 'videoOut': return m.videoOut || '';
      case 'videoDuration': return m.videoDuration || '';
      case 'videoInfo': return m.videoInfo || '';
      case 'audioInfo': return m.audioInfo || '';
      case 'status': {
        if (node.isBin) return '';
        var rawSt = m.status || (node.offline ? 'Offline' : 'Online');
        if (node.offline || /^offline$/i.test(rawSt)) return tr('card.statusOffline');
        if (/^online$/i.test(rawSt)) return tr('card.statusOnline');
        return rawSt;
      }
      case 'kind': return kindLabel(node.kind);
      case 'description': return m.description || '';
      case 'logNote': return m.logNote || '';
      case 'path': return node.path || '';
      default: return '';
    }
  }

  function nodeRequire(name) {
    try {
      if (typeof window !== 'undefined' && window.cep_node && typeof window.cep_node.require === 'function') {
        return window.cep_node.require(name);
      }
      if (typeof require === 'function') {
        return require(name);
      }
    } catch (_) {}
    return null;
  }

  function nodeProcess() {
    if (typeof process !== 'undefined' && process && process.platform) return process;
    if (typeof window !== 'undefined' && window.cep_node && window.cep_node.process) return window.cep_node.process;
    return null;
  }

  function cleanPath(p) {
    var s = String(p || '').replace(/\\/g, '/');
    if (/^\/\/\?\/UNC\//i.test(s)) s = '//' + s.slice(8);
    else if (s.indexOf('//?/') === 0) s = s.slice(4);
    return s;
  }

  /* Convert Adobe CEP file:/// URIs or /C:/... paths into clean OS filesystem paths */
  function uriToPath(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    if (/^file:\/\//i.test(s)) {
      s = s.replace(/^file:\/\/localhost/i, '');
      s = s.replace(/^file:\/\//i, '');
      try { s = decodeURIComponent(s); } catch (_) {
        try { s = decodeURI(s); } catch (_2) {}
      }
    } else if (/%[0-9A-Fa-f]{2}/.test(s)) {
      try { s = decodeURI(s); } catch (_) {}
    }
    if (/^\/+[A-Za-z]:/.test(s)) {
      s = s.replace(/^\/+/, '');
    }
    return cleanPath(s);
  }

  function normKey(p) {
    return cleanPath(p).toLowerCase();
  }

  function pathToFileUrl(nativePath) {
    if (!nativePath) return '';
    var p = cleanPath(nativePath);
    if (/^file:\/\//i.test(p)) return p;
    if (p.indexOf('//') === 0) {
      var parts = p.slice(2).split('/');
      var host = parts.shift() || '';
      return 'file://' + host + '/' + parts.map(encodeURIComponent).join('/');
    }
    var segs = p.split('/').map(function (seg, idx) {
      if (idx === 0 && /^[A-Za-z]:$/.test(seg)) return seg;
      return encodeURIComponent(seg);
    });
    var prefix = /^[A-Za-z]:\//.test(p) ? 'file:///' : 'file://';
    return prefix + segs.join('/');
  }

  function extOf(pathOrName) {
    var s = String(pathOrName || '');
    var m = s.match(/\.([^./\\]+)$/);
    return m ? m[1].toLowerCase() : '';
  }

  function detectKind(raw) {
    if (raw.isBin) return 'bin';
    if (raw.isSeq) return 'sequence';
    var ext = extOf(raw.path || raw.name);
    if (WEB_IMAGE_EXT.test(ext) || PRO_IMAGE_EXT.test(ext) || VECTOR_EXT.test(ext)) return 'image';
    if (AUDIO_EXT.test(ext)) return 'audio';
    if (NATIVE_VIDEO_EXT.test(ext) || OTHER_VIDEO_EXT.test(ext)) return 'video';
    if (UNSUPPORTED_PREVIEW_EXT.test(ext)) return 'other';
    return raw.path ? 'video' : 'other';
  }

  function isWebImageExt(ext) { return WEB_IMAGE_EXT.test(ext || ''); }
  function isProImageExt(ext) { return PRO_IMAGE_EXT.test(ext || ''); }
  function isVectorExt(ext) { return VECTOR_EXT.test(ext || ''); }
  function isNativeVideoExt(ext) { return NATIVE_VIDEO_EXT.test(ext || ''); }
  function isUnsupportedPreviewExt(ext) { return UNSUPPORTED_PREVIEW_EXT.test(ext || ''); }

  function labelColor(index) {
    var i = Number(index);
    if (!Number.isFinite(i) || i < 0) i = 0;
    return LABEL_COLORS[i % LABEL_COLORS.length].color;
  }

  function labelName(index) {
    var i = Number(index);
    if (!Number.isFinite(i) || i < 0) i = 0;
    var slot = LABEL_COLORS[i % LABEL_COLORS.length];
    if (slot && slot.customName) return slot.customName;
    if (I18n) return I18n.labelName(i);
    return slot.name;
  }

  function clampByte(n) {
    var v = Math.round(Number(n));
    if (!Number.isFinite(v)) return 0;
    return v < 0 ? 0 : (v > 255 ? 255 : v);
  }

  function rgbToHex(r, g, b) {
    function hex2(v) {
      var s = clampByte(v).toString(16);
      return s.length < 2 ? ('0' + s) : s;
    }
    return '#' + hex2(r) + hex2(g) + hex2(b);
  }

  function hexToRgb(hex) {
    var s = String(hex || '').trim().replace(/^#/, '');
    if (!/^[0-9a-f]{6}$/i.test(s)) return null;
    return [
      parseInt(s.slice(0, 2), 16),
      parseInt(s.slice(2, 4), 16),
      parseInt(s.slice(4, 6), 16)
    ];
  }

  function decodeXmlText(str) {
    return String(str || '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); })
      .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/&amp;/g, '&');
  }

  function isDefaultLabelName(index, candidate) {
    var s = String(candidate || '').trim();
    if (!s) return true;
    if (/^BE\.Prefs\.Label/i.test(s)) return true;
    var i = Number(index);
    if (!Number.isFinite(i) || i < 0 || i >= BUILTIN_LABEL_ALIASES.length) return false;
    var low = s.toLowerCase();
    var aliases = BUILTIN_LABEL_ALIASES[i];
    for (var k = 0; k < aliases.length; k++) {
      if (low === aliases[k].toLowerCase()) return true;
    }
    return false;
  }

  function parseLabelColorValue(raw) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'object') {
      var r = raw.r !== undefined ? raw.r : (raw.red !== undefined ? raw.red : raw.R);
      var g = raw.g !== undefined ? raw.g : (raw.green !== undefined ? raw.green : raw.G);
      var b = raw.b !== undefined ? raw.b : (raw.blue !== undefined ? raw.blue : raw.B);
      if (r !== undefined && g !== undefined && b !== undefined) {
        var rn = Number(r), gn = Number(g), bn = Number(b);
        if (Number.isFinite(rn) && Number.isFinite(gn) && Number.isFinite(bn)) {
          var isFloat = (rn <= 1 && gn <= 1 && bn <= 1) && (
            String(r).indexOf('.') !== -1 || String(g).indexOf('.') !== -1 || String(b).indexOf('.') !== -1
          );
          if (isFloat) return { kind: 'hex', hex: rgbToHex(rn * 255, gn * 255, bn * 255) };
          return { kind: 'hex', hex: rgbToHex(rn, gn, bn) };
        }
      }
      if (raw.hex !== undefined) return parseLabelColorValue(raw.hex);
      if (raw.color !== undefined) return parseLabelColorValue(raw.color);
      return null;
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return { kind: 'int', value: Math.trunc(raw) };
    }
    var s = String(raw).trim();
    if (!s) return null;

    /* #RGB, #RRGGBB, #AARRGGBB */
    var mHash = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
    if (mHash) {
      var h = mHash[1].toLowerCase();
      if (h.length === 3) {
        return { kind: 'hex', hex: '#' + h[0] + h[0] + h[1] + h[1] + h[2] + h[2] };
      }
      if (h.length === 8) {
        /* #AARRGGBB (most common in Adobe/Qt) vs #RRGGBBFF */
        if (h.slice(0, 2) === 'ff') return { kind: 'hex', hex: '#' + h.slice(2, 8) };
        if (h.slice(6, 8) === 'ff') return { kind: 'hex', hex: '#' + h.slice(0, 6) };
        return { kind: 'hex', hex: '#' + h.slice(2, 8) };
      }
      return { kind: 'hex', hex: '#' + h };
    }

    /* 0xRRGGBB or 0xAARRGGBB */
    var mHex = s.match(/^0x([0-9a-f]{6}|[0-9a-f]{8})$/i);
    if (mHex) {
      return { kind: 'int', value: parseInt(mHex[1], 16) };
    }

    /* rgb(r,g,b) or rgba(r,g,b,a) */
    var mRgb = s.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/i);
    if (mRgb) {
      return { kind: 'hex', hex: rgbToHex(Number(mRgb[1]), Number(mRgb[2]), Number(mRgb[3])) };
    }

    /* Comma or space triplet: "156,122,214" or "0.61 0.48 0.84" */
    var mTrip = s.match(/^([0-9.]+)\s*[,\s]\s*([0-9.]+)\s*[,\s]\s*([0-9.]+)(?:\s*[,\s]\s*[0-9.]+)?$/);
    if (mTrip) {
      var a = Number(mTrip[1]), b2 = Number(mTrip[2]), c = Number(mTrip[3]);
      if (Number.isFinite(a) && Number.isFinite(b2) && Number.isFinite(c)) {
        var unitFloat = (a <= 1 && b2 <= 1 && c <= 1) &&
          (mTrip[1].indexOf('.') !== -1 || mTrip[2].indexOf('.') !== -1 || mTrip[3].indexOf('.') !== -1);
        return { kind: 'hex', hex: unitFloat ? rgbToHex(a * 255, b2 * 255, c * 255) : rgbToHex(a, b2, c) };
      }
    }

    /* Signed or unsigned decimal integer (Premiere Pro BE.Prefs.LabelColors / asl.clip.label.color) */
    if (/^-?\d{1,11}$/.test(s)) {
      var n = Number(s);
      if (Number.isFinite(n)) return { kind: 'int', value: Math.trunc(n) };
    }

    return null;
  }

  function decodePackedInt(val, layout) {
    var u = val >>> 0;
    if (layout === 'bgr') {
      return [u & 0xff, (u >>> 8) & 0xff, (u >>> 16) & 0xff];
    }
    if (layout === 'rgba') {
      return [(u >>> 24) & 0xff, (u >>> 16) & 0xff, (u >>> 8) & 0xff];
    }
    return [(u >>> 16) & 0xff, (u >>> 8) & 0xff, u & 0xff];
  }

  function resolveLabelColorList(rawByIndex) {
    var out = new Array(16);
    var ints = [];
    for (var i = 0; i < 16; i++) {
      out[i] = '';
      var parsed = parseLabelColorValue(rawByIndex ? rawByIndex[i] : null);
      if (!parsed) continue;
      if (parsed.kind === 'hex') {
        out[i] = parsed.hex;
      } else if (parsed.kind === 'int') {
        ints.push({ index: i, value: parsed.value });
      }
    }
    if (!ints.length) return out;

    /* Choose best packed integer byte layout (rgb / bgr / rgba) using Premiere's 16 default anchors */
    var chosen = 'rgb';
    if (ints.length === 1) {
      var v0 = ints[0].value;
      var u0 = v0 >>> 0;
      if (v0 >= 0 && v0 <= 0xffffff) chosen = 'bgr';
      else if ((u0 & 0xff) === 0xff && (u0 >>> 24) !== 0xff) chosen = 'rgba';
      else chosen = 'rgb';
    } else {
      var canRgba = ints.every(function (e) { return ((e.value >>> 0) & 0xff) === 0xff; }) &&
        ints.some(function (e) { var top = (e.value >>> 0) >>> 24; return top !== 0xff && top !== 0x00; });
      var layouts = canRgba ? ['rgb', 'bgr', 'rgba'] : ['rgb', 'bgr'];
      var bestScore = Infinity;
      for (var li = 0; li < layouts.length; li++) {
        var lay = layouts[li];
        var score = 0;
        for (var j = 0; j < ints.length; j++) {
          var item = ints[j];
          var rgb = decodePackedInt(item.value, lay);
          var ref = hexToRgb(DEFAULT_LABEL_COLORS[item.index].color);
          if (ref) {
            var dr = rgb[0] - ref[0];
            var dg = rgb[1] - ref[1];
            var db = rgb[2] - ref[2];
            score += (dr * dr + dg * dg + db * db);
          }
        }
        if (score < bestScore) {
          bestScore = score;
          chosen = lay;
        }
      }
    }

    for (var k = 0; k < ints.length; k++) {
      var cRgb = decodePackedInt(ints[k].value, chosen);
      out[ints[k].index] = rgbToHex(cRgb[0], cRgb[1], cRgb[2]);
    }
    return out;
  }

  function parsePremierePrefsLabels(xmlText) {
    var rawColors = new Array(16);
    var names = new Array(16);
    for (var i = 0; i < 16; i++) { rawColors[i] = ''; names[i] = ''; }
    var presetName = '';
    var text = String(xmlText || '');
    if (!text) return { colors: rawColors, names: names, presetName: '' };

    var m;
    var reColor = /<BE\.Prefs\.LabelColors?\.(\d+)(?:\s[^>]*)?>([^<]+)<\/BE\.Prefs\.LabelColors?\.\1>/gi;
    while ((m = reColor.exec(text)) !== null) {
      var idx = Number(m[1]);
      if (idx >= 0 && idx < 16 && !rawColors[idx]) {
        rawColors[idx] = decodeXmlText(m[2]).trim();
      }
    }

    var reName = /<BE\.Prefs\.LabelNames?\.(\d+)(?:\s[^>]*)?>([^<]*)<\/BE\.Prefs\.LabelNames?\.\1>/gi;
    while ((m = reName.exec(text)) !== null) {
      var nIdx = Number(m[1]);
      if (nIdx >= 0 && nIdx < 16 && !names[nIdx]) {
        names[nIdx] = decodeXmlText(m[2]).trim();
      }
    }

    var mPreset = text.match(/<[^>]*(?:LabelColorPreset|CurrentLabelColorPreset|LabelPreset)(?:\s[^>]*)?>([^<]+)<\/[^>]+>/i);
    if (mPreset && mPreset[1]) {
      presetName = decodeXmlText(mPreset[1]).trim();
    }

    return {
      colors: resolveLabelColorList(rawColors),
      names: names,
      presetName: presetName
    };
  }

  function parseLabelPresetText(text) {
    var raw = String(text || '').trim();
    var rawColors = new Array(16);
    var names = new Array(16);
    for (var i = 0; i < 16; i++) { rawColors[i] = ''; names[i] = ''; }
    if (!raw) return { colors: rawColors, names: names };

    if (raw.charAt(0) === '{' || raw.charAt(0) === '[') {
      try {
        var obj = JSON.parse(raw);
        var list = Array.isArray(obj) ? obj
          : (Array.isArray(obj.labels) ? obj.labels
          : (Array.isArray(obj.labelColors) ? obj.labelColors
          : (Array.isArray(obj.colors) ? obj.colors
          : (Array.isArray(obj.Labels) ? obj.Labels : null))));
        if (list) {
          for (var j = 0; j < list.length && j < 16; j++) {
            var entry = list[j];
            if (!entry) continue;
            var slot = (typeof entry === 'object' && Number.isInteger(entry.index) && entry.index >= 0 && entry.index < 16)
              ? entry.index : j;
            if (typeof entry === 'string' || typeof entry === 'number') {
              rawColors[slot] = entry;
            } else if (typeof entry === 'object') {
              var colVal = entry.color !== undefined ? entry.color
                : (entry.hex !== undefined ? entry.hex
                : (entry.Color !== undefined ? entry.Color
                : (entry.rgb !== undefined ? entry.rgb : entry)));
              rawColors[slot] = colVal;
              var nmVal = entry.name !== undefined ? entry.name
                : (entry.label !== undefined ? entry.label
                : (entry.Name !== undefined ? entry.Name : ''));
              if (nmVal) names[slot] = String(nmVal).trim();
            }
          }
          return { colors: resolveLabelColorList(rawColors), names: names };
        }
        /* Keyed object format: { "0": { ... } } or { "BE.Prefs.LabelColors.0": ... } */
        if (obj && typeof obj === 'object') {
          Object.keys(obj).forEach(function (k) {
            var km = k.match(/(\d+)$/);
            if (!km) return;
            var slotIdx = Number(km[1]);
            if (slotIdx < 0 || slotIdx >= 16) return;
            if (/name/i.test(k)) {
              names[slotIdx] = String(obj[k] || '').trim();
            } else if (/color/i.test(k) || /^\d+$/.test(k)) {
              var v = obj[k];
              if (v && typeof v === 'object' && (v.name || v.label)) {
                names[slotIdx] = String(v.name || v.label).trim();
              }
              rawColors[slotIdx] = v;
            }
          });
          return { colors: resolveLabelColorList(rawColors), names: names };
        }
      } catch (_) {}
    }

    var xmlParsed = parsePremierePrefsLabels(raw);
    return { colors: xmlParsed.colors, names: xmlParsed.names };
  }

  function getLabelPaletteSig() {
    var parts = [];
    for (var i = 0; i < LABEL_COLORS.length; i++) {
      parts.push(LABEL_COLORS[i].color + ':' + (LABEL_COLORS[i].customName || ''));
    }
    return parts.join('|');
  }

  function applyCustomLabels(spec) {
    var prevSig = getLabelPaletteSig();
    var colors = (spec && Array.isArray(spec.colors)) ? spec.colors : [];
    var names = (spec && Array.isArray(spec.names)) ? spec.names : [];
    var customColorCount = 0;
    var customNameCount = 0;

    for (var i = 0; i < LABEL_COLORS.length; i++) {
      var def = DEFAULT_LABEL_COLORS[i];
      var nextColor = def.color;
      var rawC = colors[i];
      if (typeof rawC === 'string' && /^#[0-9a-f]{6}$/i.test(rawC.trim())) {
        nextColor = rawC.trim().toLowerCase();
        if (nextColor !== def.color.toLowerCase()) customColorCount += 1;
      }
      LABEL_COLORS[i].color = nextColor;

      var rawN = typeof names[i] === 'string' ? names[i].trim() : '';
      if (rawN && !isDefaultLabelName(i, rawN)) {
        LABEL_COLORS[i].customName = rawN;
        customNameCount += 1;
      } else {
        LABEL_COLORS[i].customName = '';
      }
    }

    var nextSig = getLabelPaletteSig();
    return {
      changed: nextSig !== prevSig,
      customColorCount: customColorCount,
      customNameCount: customNameCount,
      sig: nextSig
    };
  }

  function resetCustomLabels() {
    return applyCustomLabels({ colors: [], names: [] });
  }

  function kindLabel(kind) {
    if (I18n) return I18n.kindLabel(kind);
    return KIND_LABEL[kind] || KIND_LABEL.other;
  }

  function columnLabel(colId) {
    if (I18n) return I18n.columnLabel(colId);
    for (var i = 0; i < MEDIA_COLUMNS.length; i++) {
      if (MEDIA_COLUMNS[i].id === colId) return MEDIA_COLUMNS[i].label;
    }
    return colId;
  }

  function buildTreeIndex(rawNodes, rootId) {
    var nodes = new Map();
    var childrenByParent = new Map();
    var subBinsByParent = new Map();

    for (var i = 0; i < rawNodes.length; i++) {
      var r = rawNodes[i];
      var kind = detectKind(r);
      var ext = kind === 'bin' || kind === 'sequence' ? '' : extOf(r.path || r.name);
      var node = {
        id: String(r.id),
        pid: r.pid ? String(r.pid) : '',
        name: String(r.name || ''),
        kind: kind,
        ext: ext,
        isBin: !!r.isBin,
        isSeq: !!r.isSeq,
        seqId: r.seqId ? String(r.seqId) : '',
        path: r.path ? String(r.path) : '',
        offline: !!r.offline,
        label: Number.isFinite(Number(r.label)) ? Number(r.label) : 0,
        childCount: Number(r.childCount) || 0,
        rawOrder: i,
        meta: r.meta || null,
        demoThumb: r.demoThumb || '',
        demoDuration: Number(r.demoDuration) || 0,
        demoRes: r.demoRes || ''
      };
      nodes.set(node.id, node);
      if (node.isBin) {
        childrenByParent.set(node.id, []);
        subBinsByParent.set(node.id, []);
      }
    }

    nodes.forEach(function (node) {
      if (!node.pid || !nodes.has(node.pid)) return;
      var list = childrenByParent.get(node.pid);
      if (list) list.push(node);
      if (node.isBin) {
        var bList = subBinsByParent.get(node.pid);
        if (bList) bList.push(node);
      }
    });

    var collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
    subBinsByParent.forEach(function (list) {
      list.sort(function (a, b) { return collator.compare(a.name, b.name); });
    });

    var mediaCounts = new Map();
    var directMediaCounts = new Map();

    function calcCount(binId) {
      if (mediaCounts.has(binId)) return mediaCounts.get(binId);
      var kids = childrenByParent.get(binId) || [];
      var direct = 0;
      var total = 0;
      for (var j = 0; j < kids.length; j++) {
        if (kids[j].isBin) {
          total += calcCount(kids[j].id);
        } else {
          direct += 1;
          total += 1;
        }
      }
      directMediaCounts.set(binId, direct);
      mediaCounts.set(binId, total);
      return total;
    }

    if (rootId && nodes.has(rootId)) {
      calcCount(rootId);
    }
    nodes.forEach(function (n) {
      if (n.isBin && !mediaCounts.has(n.id)) calcCount(n.id);
    });

    return {
      rootId: rootId,
      nodes: nodes,
      childrenByParent: childrenByParent,
      subBinsByParent: subBinsByParent,
      mediaCounts: mediaCounts,
      directMediaCounts: directMediaCounts
    };
  }

  function getAncestors(nodes, id) {
    var chain = [];
    var seen = new Set();
    var cur = id;
    while (cur && nodes.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      var n = nodes.get(cur);
      chain.unshift(n);
      cur = n.pid;
    }
    return chain;
  }

  function sortFolderList(bins, mediaCounts, sortBy, sortDir) {
    var list = (bins || []).slice();
    var dir = sortDir === 'desc' ? -1 : 1;
    var mode = sortBy || 'name';
    var collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
    list.sort(function (a, b) {
      var cmp = 0;
      if (mode === 'order') {
        cmp = (a.rawOrder || 0) - (b.rawOrder || 0);
      } else if (mode === 'count') {
        var ca = (mediaCounts && mediaCounts.get(a.id)) || 0;
        var cb = (mediaCounts && mediaCounts.get(b.id)) || 0;
        cmp = ca - cb;
      } else if (mode === 'label') {
        cmp = (a.label || 0) - (b.label || 0);
      } else {
        cmp = collator.compare(a.name, b.name);
      }
      if (cmp !== 0) return cmp * dir;
      return collator.compare(a.name, b.name);
    });
    return list;
  }

  function compareNumericMissingLast(va, vb, dir) {
    var aEmpty = va < 0;
    var bEmpty = vb < 0;
    if (aEmpty && bEmpty) return 0;
    if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
    return (va - vb) * dir;
  }

  function collectItems(index, folderId, opts) {
    var options = opts || {};
    var query = String(options.query || '').trim().toLowerCase();
    var globalSearch = !!options.globalSearch;
    var includeSubfolders = !!options.includeSubfolders;
    var typeFilter = options.type || 'all';
    var sortBy = options.sortBy || 'name';
    var sortDir = options.sortDir === 'desc' ? -1 : 1;

    var pool = [];
    if (query && globalSearch) {
      index.nodes.forEach(function (n) {
        if (n.pid) pool.push(n);
      });
    } else if (includeSubfolders) {
      var stack = [folderId];
      var visited = new Set();
      while (stack.length) {
        var cid = stack.pop();
        if (visited.has(cid)) continue;
        visited.add(cid);
        var kids = index.childrenByParent.get(cid) || [];
        for (var i = 0; i < kids.length; i++) {
          if (kids[i].isBin) {
            stack.push(kids[i].id);
          } else {
            pool.push(kids[i]);
          }
        }
      }
    } else {
      pool = (index.childrenByParent.get(folderId) || []).slice();
    }

    var filtered = [];
    for (var j = 0; j < pool.length; j++) {
      var item = pool[j];
      if (typeFilter !== 'all' && item.kind !== typeFilter) continue;
      if (query) {
        var hitName = item.name.toLowerCase().indexOf(query) !== -1;
        var hitPath = item.path && item.path.toLowerCase().indexOf(query) !== -1;
        if (!hitName && !hitPath) continue;
      }
      filtered.push(item);
    }

    var collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
    filtered.sort(function (a, b) {
      if (sortBy !== 'label' && sortBy !== 'status') {
        if (a.isBin !== b.isBin) return a.isBin ? -1 : 1;
      }
      var cmp = 0;
      if (sortBy === 'name') {
        cmp = collator.compare(a.name, b.name) * sortDir;
      } else if (sortBy === 'kind') {
        cmp = ((KIND_ORDER[a.kind] || 9) - (KIND_ORDER[b.kind] || 9)) * sortDir;
      } else if (sortBy === 'ext') {
        cmp = collator.compare(a.ext || '', b.ext || '') * sortDir;
      } else if (sortBy === 'label') {
        cmp = (a.label - b.label) * sortDir;
      } else if (sortBy === 'status') {
        cmp = ((a.offline ? 1 : 0) - (b.offline ? 1 : 0)) * sortDir;
      } else if (sortBy === 'fps') {
        cmp = compareNumericMissingLast(
          parseFpsValue(getColumnCellText(a, 'fps')),
          parseFpsValue(getColumnCellText(b, 'fps')),
          sortDir
        );
      } else if (
        sortBy === 'mediaStart' || sortBy === 'mediaEnd' || sortBy === 'mediaDuration' ||
        sortBy === 'videoIn' || sortBy === 'videoOut' || sortBy === 'videoDuration'
      ) {
        cmp = compareNumericMissingLast(
          parseTimecodeValue(getColumnCellText(a, sortBy)),
          parseTimecodeValue(getColumnCellText(b, sortBy)),
          sortDir
        );
      } else if (sortBy === 'videoInfo') {
        cmp = compareNumericMissingLast(
          parseResolutionArea(getColumnCellText(a, 'videoInfo')),
          parseResolutionArea(getColumnCellText(b, 'videoInfo')),
          sortDir
        );
      } else if (sortBy === 'audioInfo') {
        cmp = compareNumericMissingLast(
          parseAudioRate(getColumnCellText(a, 'audioInfo')),
          parseAudioRate(getColumnCellText(b, 'audioInfo')),
          sortDir
        );
        if (cmp === 0) {
          cmp = collator.compare(getColumnCellText(a, 'audioInfo'), getColumnCellText(b, 'audioInfo')) * sortDir;
        }
      } else {
        var sa = getColumnCellText(a, sortBy);
        var sb = getColumnCellText(b, sortBy);
        if (!sa && !sb) cmp = 0;
        else if (!sa || !sb) cmp = !sa ? 1 : -1;
        else cmp = collator.compare(sa, sb) * sortDir;
      }
      if (cmp !== 0) return cmp;
      return collator.compare(a.name, b.name);
    });

    return filtered;
  }

  function topLevelSelection(nodes, ids) {
    var set = new Set(ids);
    var out = [];
    set.forEach(function (id) {
      var n = nodes.get(id);
      if (!n || !n.pid) return;
      var ancestors = getAncestors(nodes, n.pid);
      var covered = false;
      for (var i = 0; i < ancestors.length; i++) {
        if (set.has(ancestors[i].id)) { covered = true; break; }
      }
      if (!covered) out.push(id);
    });
    return out;
  }

  function validateMove(nodes, ids, targetBinId) {
    var target = nodes.get(targetBinId);
    if (!target || !target.isBin) throw new Error(tr('msg.validateTargetBin'));
    var targetAncestors = getAncestors(nodes, targetBinId);
    var ancestorSet = new Set(targetAncestors.map(function (a) { return a.id; }));
    for (var k = 0; k < ids.length; k++) {
      var raw = nodes.get(ids[k]);
      if (!raw || !raw.pid) throw new Error(tr('msg.validateMoveRoot'));
      if (ancestorSet.has(raw.id)) throw new Error(tr('msg.validateMoveCycle'));
    }
    var top = topLevelSelection(nodes, ids);
    var valid = [];
    for (var i = 0; i < top.length; i++) {
      var n = nodes.get(top[i]);
      if (n && n.pid !== targetBinId) valid.push(n.id);
    }
    return valid;
  }

  function formatTime(seconds) {
    var n = Number(seconds);
    if (!Number.isFinite(n) || n < 0) return '--:--';
    var total = Math.floor(n);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    var mm = m < 10 ? '0' + m : String(m);
    var ss = s < 10 ? '0' + s : String(s);
    return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss;
  }

  function formatBytes(bytes) {
    var b = Number(bytes);
    if (!Number.isFinite(b) || b <= 0) return '—';
    if (b >= 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
    if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
    if (b >= 1024) return Math.round(b / 1024) + ' KB';
    return b + ' B';
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var ICONS = {
    sidebar: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><line x1="5.5" y1="2.5" x2="5.5" y2="13.5"/></svg>',
    folder: '<svg viewBox="0 0 20 20" fill="none"><path d="M2.5 5.2A1.7 1.7 0 0 1 4.2 3.5h3.9l1.7 2h6a1.7 1.7 0 0 1 1.7 1.7v7.6a1.7 1.7 0 0 1-1.7 1.7H4.2a1.7 1.7 0 0 1-1.7-1.7V5.2Z" fill="currentColor" fill-opacity="0.24" stroke="currentColor" stroke-width="1.35"/></svg>',
    folderOpen: '<svg viewBox="0 0 20 20" fill="none"><path d="M2.5 5.5A1.5 1.5 0 0 1 4 4h4l1.6 1.8H16a1.5 1.5 0 0 1 1.5 1.5v1.2H3.8l-1.3 5.8V5.5Z" fill="currentColor" fill-opacity="0.26" stroke="currentColor" stroke-width="1.3"/><path d="M2.6 15.5l1.5-7h13.8l-1.5 7H2.6Z" fill="currentColor" fill-opacity="0.36" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
    video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="14" rx="2"/><polygon points="10,9 16,12 10,15" fill="currentColor" stroke="none"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5" fill="currentColor" stroke="none"/><path d="M21 16l-5-5-4.5 4.5-2.5-2.5L3 19"/></svg>',
    audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="4" y1="10" x2="4" y2="14"/><line x1="8" y1="7" x2="8" y2="17"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="16" y1="8" x2="16" y2="16"/><line x1="20" y1="10.5" x2="20" y2="13.5"/></svg>',
    sequence: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="9" height="4" rx="1" fill="#46b685" fill-opacity="0.25" stroke="#46b685"/><rect x="8" y="10.5" width="13" height="3.5" rx="1" fill="#4ea4dc" fill-opacity="0.25" stroke="#4ea4dc"/><rect x="5" y="15.5" width="11" height="3.5" rx="1" fill="#4ea4dc" fill-opacity="0.25" stroke="#4ea4dc"/></svg>',
    other: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 3h8l5 5v13H6V3z"/><path d="M14 3v5h5"/></svg>',
    offline: '<svg viewBox="0 0 24 24" fill="none" stroke="#e3645b" stroke-width="1.6"><path d="M12 4L2.5 20h19L12 4z"/><line x1="12" y1="10" x2="12" y2="14.5"/><circle cx="12" cy="17.2" r="0.8" fill="#e3645b"/></svg>',
    search: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4.5"/><line x1="10.4" y1="10.4" x2="14" y2="14" stroke-linecap="round"/></svg>',
    grid: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>',
    list: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="2.5" y1="4" x2="13.5" y2="4"/><line x1="2.5" y1="8" x2="13.5" y2="8"/><line x1="2.5" y1="12" x2="13.5" y2="12"/></svg>',
    plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>',
    importFile: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v7.5m0 0L5.2 7.2M8 10l2.8-2.8"/><path d="M2.5 11.5v1.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1.5"/></svg>',
    importFolder: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.2A1.2 1.2 0 0 1 3.2 3h2.9l1.3 1.5h5.4A1.2 1.2 0 0 1 14 5.7v6.1a1.2 1.2 0 0 1-1.2 1.2H3.2A1.2 1.2 0 0 1 2 11.8V4.2z"/><path d="M8 6.8v4m0 0-1.6-1.6M8 10.8l1.6-1.6"/></svg>',
    refresh: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.4-3.7"/><polyline points="13.5 2.5 13.5 5.5 10.5 5.5"/></svg>',
    chevronRight: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="4.5 2.5 8 6 4.5 9.5"/></svg>',
    eye: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>',
    timeline: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="2" y1="4" x2="14" y2="4"/><rect x="4" y="6.5" width="6" height="3" rx="0.8"/><rect x="7" y="11" width="6" height="3" rx="0.8"/></svg>',
    play: '<svg viewBox="0 0 16 16" fill="currentColor"><polygon points="4.5,2.5 13,8 4.5,13.5"/></svg>',
    back: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="10 3.5 5.5 8 10 12.5"/></svg>',
    forward: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 3.5 10.5 8 6 12.5"/></svg>',
    up: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="3.5 10 8 5.5 12.5 10"/></svg>',
    close: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>',
    columns: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><line x1="6" y1="2.5" x2="6" y2="13.5"/><line x1="10.5" y1="2.5" x2="10.5" y2="13.5"/></svg>'
  };

  function sigHashUpdate(h, str) {
    var s = String(str || '');
    for (var i = 0; i < s.length; i++) {
      h = (h ^ s.charCodeAt(i)) >>> 0;
      h = (h + ((h << 1) >>> 0) + ((h << 4) >>> 0) + ((h << 7) >>> 0) + ((h << 8) >>> 0) + ((h << 24) >>> 0)) >>> 0;
    }
    return h >>> 0;
  }

  /* Mirrors host.jsx computeFolderSig / computeSelSig byte-for-byte for instant native-change detection */
  function computeFolderSig(index, folderId) {
    var h = 2166136261 >>> 0;
    if (!index || !folderId) return h.toString(16);
    var kids = index.childrenByParent.get(folderId);
    if (!kids) return h.toString(16);
    var count = kids.length;
    var limit = count > 400 ? 400 : count;
    h = sigHashUpdate(h, String(count));
    for (var i = 0; i < limit; i++) {
      var c = kids[i];
      if (!c) continue;
      h = sigHashUpdate(h,
        String(c.id || '') + '|' +
        String(c.name || '') + '|' +
        (c.isBin ? 'B' : (c.isSeq ? 'S' : String(c.path || ''))) + '|' +
        (c.isBin ? (c.childCount || 0) : (c.isSeq ? '0' : (c.offline ? '1' : '0'))) + '|' +
        String(c.label) + ';'
      );
    }
    return h.toString(16);
  }

  function computeSelSig(index, selIds) {
    if (!index || !selIds || !selIds.length) return '';
    var h = 2166136261 >>> 0;
    var limit = selIds.length > 20 ? 20 : selIds.length;
    for (var i = 0; i < limit; i++) {
      var id = String(selIds[i] || '');
      var c = index.nodes.get(id);
      if (!c) continue;
      h = sigHashUpdate(h,
        id + '|' +
        String(c.name || '') + '|' +
        (c.isBin ? 'B' : (c.isSeq ? 'S' : String(c.path || ''))) + '|' +
        (c.isBin ? (c.childCount || 0) : (c.isSeq ? '0' : (c.offline ? '1' : '0'))) + '|' +
        String(c.label) + ';'
      );
    }
    return h.toString(16);
  }

  function kindIconSvg(kind, offline) {
    if (offline) return ICONS.offline;
    if (kind === 'bin') return ICONS.folder;
    return ICONS[kind] || ICONS.other;
  }

  var api = {
    DEFAULT_LABEL_COLORS: DEFAULT_LABEL_COLORS,
    LABEL_COLORS: LABEL_COLORS,
    KIND_LABEL: KIND_LABEL,
    MEDIA_COLUMNS: MEDIA_COLUMNS,
    ICONS: ICONS,
    nodeRequire: nodeRequire,
    nodeProcess: nodeProcess,
    cleanPath: cleanPath,
    uriToPath: uriToPath,
    normKey: normKey,
    pathToFileUrl: pathToFileUrl,
    extOf: extOf,
    detectKind: detectKind,
    isWebImageExt: isWebImageExt,
    isProImageExt: isProImageExt,
    isVectorExt: isVectorExt,
    isNativeVideoExt: isNativeVideoExt,
    isUnsupportedPreviewExt: isUnsupportedPreviewExt,
    labelColor: labelColor,
    labelName: labelName,
    isDefaultLabelName: isDefaultLabelName,
    parseLabelColorValue: parseLabelColorValue,
    resolveLabelColorList: resolveLabelColorList,
    parsePremierePrefsLabels: parsePremierePrefsLabels,
    parseLabelPresetText: parseLabelPresetText,
    applyCustomLabels: applyCustomLabels,
    resetCustomLabels: resetCustomLabels,
    getLabelPaletteSig: getLabelPaletteSig,
    kindLabel: kindLabel,
    columnLabel: columnLabel,
    parseTimecodeValue: parseTimecodeValue,
    parseFpsValue: parseFpsValue,
    parseResolutionArea: parseResolutionArea,
    parseAudioRate: parseAudioRate,
    getColumnCellText: getColumnCellText,
    sortFolderList: sortFolderList,
    buildTreeIndex: buildTreeIndex,
    getAncestors: getAncestors,
    collectItems: collectItems,
    topLevelSelection: topLevelSelection,
    validateMove: validateMove,
    formatTime: formatTime,
    formatBytes: formatBytes,
    escapeHtml: escapeHtml,
    computeFolderSig: computeFolderSig,
    computeSelSig: computeSelSig,
    kindIconSvg: kindIconSvg
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PrUtils = api;
})(typeof window !== 'undefined' ? window : globalThis);
