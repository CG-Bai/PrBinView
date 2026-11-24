(function (root) {
  'use strict';

  var U = root.PrUtils || (typeof require === 'function' ? require('./utils') : null);
  var I18n = root.PrI18n || (typeof require === 'function' ? require('./i18n') : null);
  function tr(key, vars) { return I18n ? I18n.t(key, vars) : key; }

  function serializeArg(payload) {
    if (typeof payload === 'undefined') return '';
    return JSON.stringify(payload)
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }

  var IGNORED_FILES = /^(thumbs\.db|desktop\.ini|\.ds_store|ehthumbs\.db)$/i;
  var IGNORED_DIRS = /^(\.git|\.svn|\.hg|__macosx|\$recycle\.bin|system volume information)$/i;

  function scanExternalPaths(fsMod, pathMod, rawPaths) {
    var topFiles = [];
    var folders = [];
    var seen = new Set();
    if (!fsMod || !pathMod || !Array.isArray(rawPaths)) {
      return { files: topFiles, folders: folders, totalFiles: 0 };
    }

    var totalFiles = 0;

    function scanDir(dirPath, depth) {
      if (depth > 16) return null;
      var entries;
      try {
        entries = fsMod.readdirSync(dirPath);
      } catch (_) {
        return null;
      }
      entries.sort(function (a, b) {
        return a.localeCompare(b, 'zh-CN', { numeric: true, sensitivity: 'base' });
      });
      var files = [];
      var dirs = [];
      for (var i = 0; i < entries.length; i++) {
        var name = entries[i];
        if (!name) continue;
        var full = pathMod.join(dirPath, name);
        var st;
        try { st = fsMod.statSync(full); } catch (_) { continue; }
        if (st.isDirectory()) {
          if (IGNORED_DIRS.test(name) || name.charAt(0) === '.') continue;
          var sub = scanDir(full, depth + 1);
          if (sub && (sub.files.length > 0 || sub.dirs.length > 0)) {
            dirs.push(sub);
          }
        } else if (st.isFile()) {
          if (IGNORED_FILES.test(name) || name.indexOf('._') === 0) continue;
          files.push(full);
          totalFiles += 1;
        }
      }
      return { name: pathMod.basename(dirPath), files: files, dirs: dirs };
    }

    for (var i = 0; i < rawPaths.length; i++) {
      var p = U.cleanPath(rawPaths[i]).replace(/\//g, pathMod.sep);
      if (!p) continue;
      var norm = p.toLowerCase();
      if (seen.has(norm)) continue;
      seen.add(norm);
      var stat;
      try { stat = fsMod.statSync(p); } catch (_) { continue; }
      if (stat.isDirectory()) {
        var tree = scanDir(p, 0);
        if (tree) folders.push(tree);
      } else if (stat.isFile()) {
        var bn = pathMod.basename(p);
        if (!IGNORED_FILES.test(bn)) {
          topFiles.push(p);
          totalFiles += 1;
        }
      }
    }

    return { files: topFiles, folders: folders, totalFiles: totalFiles };
  }

  /* Match offline clips against discovered local file paths by exact filename (preferring same parent dir name) */
  function matchOfflineClipsInPaths(offlineItems, foundPaths) {
    var byBase = new Map();
    function baseOf(p) {
      var s = String(p || '').replace(/\\/g, '/');
      var idx = s.lastIndexOf('/');
      return (idx >= 0 ? s.slice(idx + 1) : s).toLowerCase();
    }
    function parentNameOf(p) {
      var s = String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
      var idx = s.lastIndexOf('/');
      if (idx <= 0) return '';
      var dir = s.slice(0, idx);
      var idx2 = dir.lastIndexOf('/');
      return (idx2 >= 0 ? dir.slice(idx2 + 1) : dir).toLowerCase();
    }

    (foundPaths || []).forEach(function (fp) {
      var b = baseOf(fp);
      if (!b) return;
      if (!byBase.has(b)) byBase.set(b, []);
      byBase.get(b).push(fp);
    });

    var pairs = [];
    (offlineItems || []).forEach(function (item) {
      if (!item || !item.id) return;
      var keys = [];
      if (item.path) keys.push(baseOf(item.path));
      if (item.name) {
        var nb = baseOf(item.name);
        if (keys.indexOf(nb) === -1) keys.push(nb);
      }
      var wantParent = item.path ? parentNameOf(item.path) : '';
      var chosen = '';
      for (var k = 0; k < keys.length; k++) {
        var list = byBase.get(keys[k]);
        if (!list || !list.length) continue;
        if (list.length === 1 || !wantParent) {
          chosen = list[0];
        } else {
          chosen = list[0];
          for (var m = 0; m < list.length; m++) {
            if (parentNameOf(list[m]) === wantParent) { chosen = list[m]; break; }
          }
        }
        break;
      }
      if (chosen) pairs.push({ id: item.id, newPath: chosen });
    });
    return pairs;
  }

  /* ==================== REAL CEP 12 BRIDGE ==================== */

  function createCepBridge() {
    var cepApi = window.__adobe_cep__;
    var cp = U.nodeRequire('child_process');
    var fsMod = U.nodeRequire('fs');
    var pathMod = U.nodeRequire('path');
    var hostLoaded = false;
    var currentRevealShortcut = Object.assign({}, U.DEFAULT_REVEAL_SHORTCUT);
    var lastHostEnv = { appVersion: '', docsPath: '' };

    /* Tell Premiere Pro CEP to route arrow keys & panel shortcuts to PrBinView while our panel has focus */
    function registerPanelKeyInterest() {
      try {
        if (!cepApi || typeof cepApi.registerKeyEventsInterest !== 'function') return;
        var proc = U.nodeProcess();
        var isMac = !!(proc && proc.platform === 'darwin');
        var keys = [];
        function addKey(kc, mods) {
          var m = mods || {};
          keys.push({
            keyCode: kc,
            ctrlKey: !!m.ctrl,
            altKey: !!m.alt,
            shiftKey: !!m.shift,
            metaKey: !!m.meta
          });
        }
        if (isMac) {
          /* macOS virtual key codes: Left 123, Right 124, Down 125, Up 126, Home 115, End 119 */
          [123, 124, 125, 126].forEach(function (kc) {
            addKey(kc);
            addKey(kc, { shift: true });
          });
          addKey(123, { alt: true });
          addKey(124, { alt: true });
          addKey(3, { alt: true }); /* Option+F: Reveal timeline clip */
          [115, 119, 49, 36, 51, 117, 53, 120, 96].forEach(function (kc) { addKey(kc); });
          [0, 8, 2, 3, 15, 9, 7].forEach(function (kc) { addKey(kc, { meta: true }); });
        } else {
          /* Windows VK codes: Left 37, Up 38, Right 39, Down 40, Home 36, End 35, Space 32, Enter 13, Backspace 8, Delete 46, Esc 27, F2 113, F5 116 */
          [37, 38, 39, 40].forEach(function (kc) {
            addKey(kc);
            addKey(kc, { shift: true });
          });
          addKey(37, { alt: true });
          addKey(39, { alt: true });
          if (currentRevealShortcut && currentRevealShortcut.vk) {
            addKey(currentRevealShortcut.vk, {
              ctrl: !!currentRevealShortcut.ctrl,
              alt: !!currentRevealShortcut.alt,
              shift: !!currentRevealShortcut.shift
            });
          } else {
            addKey(70, { alt: true });
          }
          [36, 35, 32, 13, 8, 46, 27, 113, 116].forEach(function (kc) { addKey(kc); });
          /* Ctrl+A(65), Ctrl+C(67), Ctrl+D(68), Ctrl+F(70), Ctrl+R(82), Ctrl+V(86), Ctrl+X(88) */
          [65, 67, 68, 70, 82, 86, 88].forEach(function (kc) { addKey(kc, { ctrl: true }); });
        }
        cepApi.registerKeyEventsInterest(JSON.stringify(keys));
      } catch (_) {}
    }
    registerPanelKeyInterest();
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('focus', registerPanelKeyInterest);
    }

    function rawEval(script) {
      return new Promise(function (resolve) {
        try {
          cepApi.evalScript(script, function (res) {
            resolve(res);
          });
        } catch (e) {
          resolve('EvalScript error.');
        }
      });
    }

    function resolveExtensionRoot() {
      var candidates = [];
      try {
        var raw = cepApi.getSystemPath('extension') || '';
        if (raw) {
          var normalized = U.uriToPath(raw);
          if (normalized) candidates.push(normalized);
          candidates.push(raw);
        }
      } catch (_) {}
      try {
        if (typeof window !== 'undefined' && window.location && window.location.href && pathMod) {
          var pagePath = U.uriToPath(window.location.href);
          if (pagePath) candidates.push(pathMod.dirname(pagePath));
        }
      } catch (_) {}
      for (var i = 0; i < candidates.length; i++) {
        var dir = candidates[i];
        if (!dir) continue;
        var nativeDir = pathMod ? pathMod.normalize(dir) : dir;
        if (!fsMod) return nativeDir;
        try {
          if (fsMod.existsSync(nativeDir)) return nativeDir;
        } catch (_) {}
      }
      return candidates[0] || '';
    }

    async function ensureHostLoaded() {
      if (hostLoaded) return;
      var check = await rawEval('typeof PrBinViewHost');
      if (check === 'object') {
        hostLoaded = true;
        return;
      }
      try {
        var extRoot = resolveExtensionRoot();
        if (extRoot) {
          var jsxPath = extRoot.replace(/\\/g, '/').replace(/\/+$/, '') + '/jsx/host.jsx';
          await rawEval('$.evalFile(' + serializeArg(jsxPath) + ')');
          var verify = await rawEval('typeof PrBinViewHost');
          if (verify === 'object') hostLoaded = true;
        }
      } catch (_) {}
    }

    async function call(method, payload) {
      await ensureHostLoaded();
      var argStr = typeof payload === 'undefined' ? '' : serializeArg(payload);
      var raw = await rawEval('PrBinViewHost.' + method + '(' + argStr + ')');
      if (!raw || raw === 'EvalScript error.' || raw === 'undefined') {
        throw new Error(tr('err.evalFailed', { method: method }));
      }
      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        throw new Error(tr('err.parseFailed', { raw: String(raw).slice(0, 120) }));
      }
      if (!parsed.ok) {
        throw new Error(parsed.error || tr('err.hostFailed', { method: method }));
      }
      return parsed.data;
    }

    function getLastImportDir() {
      try { return localStorage.getItem('prbinview.lastImportDir') || ''; } catch (_) { return ''; }
    }

    function saveLastImportDir(pickedPath) {
      if (!pickedPath || !pathMod) return;
      try {
        var dir = pickedPath;
        if (fsMod) {
          try {
            if (fsMod.statSync(pickedPath).isFile()) dir = pathMod.dirname(pickedPath);
          } catch (_) {
            dir = pathMod.dirname(pickedPath);
          }
        }
        if (dir) localStorage.setItem('prbinview.lastImportDir', dir);
      } catch (_) {}
    }

    function pickModernWindowsDialog(mode, title, initialDir) {
      return new Promise(function (resolve) {
        var proc = U.nodeProcess();
        if (!cp || !pathMod || !fsMod || !proc || proc.platform !== 'win32') {
          resolve(null);
          return;
        }
        var extRoot = resolveExtensionRoot();
        var helperScript = extRoot ? pathMod.join(extRoot, 'helpers', 'win-dialog.ps1') : '';
        if (!helperScript || !fsMod.existsSync(helperScript)) {
          resolve(null);
          return;
        }
        var rawStartDir = initialDir || getLastImportDir() || '';
        var startDir = rawStartDir ? pathMod.normalize(U.uriToPath(rawStartDir)) : '';
        var psBin = 'powershell.exe';
        try {
          var sysRoot = proc.env && (proc.env.SystemRoot || proc.env.windir);
          if (sysRoot) {
            var fullPs = pathMod.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
            if (fsMod.existsSync(fullPs)) psBin = fullPs;
          }
        } catch (_) {}
        var args = [
          '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
          '-STA', '-WindowStyle', 'Hidden',
          '-File', helperScript,
          '-Mode', mode || 'files',
          '-Title', title || tr('picker.importFiles')
        ];
        if (startDir) args.push('-InitialDir', startDir);

        cp.execFile(psBin, args, {
          windowsHide: true,
          encoding: 'utf8',
          maxBuffer: 4 * 1024 * 1024
        }, function (err, stdout, stderr) {
          if (err) {
            try { console.warn('[PrBinView] win-dialog failed:', err.message, stderr); } catch (_) {}
            resolve(null);
            return;
          }
          var lines = String(stdout || '').trim().split(/\r?\n/);
          for (var i = lines.length - 1; i >= 0; i--) {
            var line = lines[i].trim();
            if (line.charAt(0) === '[') {
              try {
                var arr = JSON.parse(line);
                if (Array.isArray(arr)) {
                  if (arr.length) saveLastImportDir(arr[0]);
                  resolve(arr);
                  return;
                }
              } catch (_) {}
            }
          }
          resolve([]);
        });
      });
    }

    async function pickFiles(allowMulti, title, initialDir) {
      var modern = await pickModernWindowsDialog(allowMulti ? 'files' : 'single', title, initialDir);
      if (modern !== null) return modern;
      return new Promise(function (resolve) {
        try {
          if (window.cep && window.cep.fs && typeof window.cep.fs.showOpenDialogEx === 'function') {
            var res = window.cep.fs.showOpenDialogEx(!!allowMulti, false, title || tr('picker.defaultFile'), initialDir || getLastImportDir() || '', []);
            if (res && res.err === 0 && Array.isArray(res.data)) {
              if (res.data.length) saveLastImportDir(res.data[0]);
              resolve(res.data);
              return;
            }
          }
        } catch (_) {}
        resolve([]);
      });
    }

    async function pickFolders(title, initialDir) {
      var modern = await pickModernWindowsDialog('folders', title, initialDir);
      if (modern !== null) return modern;
      return new Promise(function (resolve) {
        try {
          if (window.cep && window.cep.fs && typeof window.cep.fs.showOpenDialogEx === 'function') {
            var res = window.cep.fs.showOpenDialogEx(true, true, title || tr('picker.defaultFolder'), initialDir || getLastImportDir() || '', []);
            if (res && res.err === 0 && Array.isArray(res.data)) {
              if (res.data.length) saveLastImportDir(res.data[0]);
              resolve(res.data);
              return;
            }
          }
        } catch (_) {}
        resolve([]);
      });
    }

    function revealInExplorer(nativePath) {
      if (!nativePath) return false;
      if (!cp) return false;
      var proc = U.nodeProcess();
      var clean = U.uriToPath(nativePath);
      var winPath = clean.replace(/\//g, '\\').replace(/"/g, '');
      try {
        if (proc && proc.platform === 'win32') {
          var exists = true;
          try { if (fsMod) exists = fsMod.existsSync(winPath); } catch (_) {}
          var arg = exists
            ? ('/select,"' + winPath + '"')
            : ('"' + (pathMod ? pathMod.dirname(winPath) : winPath) + '"');
          var child = cp.spawn('explorer.exe', [arg], {
            detached: true,
            stdio: 'ignore',
            windowsHide: false,
            windowsVerbatimArguments: true
          });
          child.unref();
          return true;
        }
        if (proc && proc.platform === 'darwin') {
          var mac = cp.spawn('open', ['-R', clean], { detached: true, stdio: 'ignore' });
          mac.unref();
          return true;
        }
      } catch (_) {}
      return false;
    }

    function editOriginal(nativePath) {
      if (!nativePath || !cp) return false;
      var proc = U.nodeProcess();
      var clean = U.uriToPath(nativePath);
      var winPath = clean.replace(/\//g, '\\').replace(/"/g, '');
      try {
        if (proc && proc.platform === 'win32') {
          if (fsMod && !fsMod.existsSync(winPath)) return false;
          var child = cp.spawn('explorer.exe', ['"' + winPath + '"'], {
            detached: true,
            stdio: 'ignore',
            windowsHide: false,
            windowsVerbatimArguments: true
          });
          child.unref();
          return true;
        }
        if (proc && proc.platform === 'darwin') {
          var mac = cp.spawn('open', [clean], { detached: true, stdio: 'ignore' });
          mac.unref();
          return true;
        }
      } catch (_) {}
      return false;
    }

    function findAdobeExe(appKind) {
      if (!fsMod || !pathMod) return '';
      var proc = U.nodeProcess();
      if (!proc || proc.platform !== 'win32') return '';
      var roots = [];
      if (proc.env && proc.env.ProgramFiles) roots.push(pathMod.join(proc.env.ProgramFiles, 'Adobe'));
      roots.push('C:\\Program Files\\Adobe');
      var folderRe = appKind === 'photoshop' ? /^Adobe Photoshop/i : /^Adobe Audition/i;
      var exeName = appKind === 'photoshop' ? 'Photoshop.exe' : 'Adobe Audition.exe';
      var seen = {};
      var hits = [];
      for (var r = 0; r < roots.length; r++) {
        var base = roots[r];
        var key = base.toLowerCase();
        if (seen[key]) continue;
        seen[key] = true;
        try {
          if (!fsMod.existsSync(base)) continue;
          var entries = fsMod.readdirSync(base);
          entries.sort().reverse();
          for (var i = 0; i < entries.length; i++) {
            if (!folderRe.test(entries[i])) continue;
            var candidate = pathMod.join(base, entries[i], exeName);
            if (fsMod.existsSync(candidate)) hits.push(candidate);
          }
        } catch (_) {}
      }
      return hits[0] || '';
    }

    function editInAdobeApp(appKind, nativePath) {
      if (!nativePath || !cp) return { ok: false, error: tr('msg.appNotSupported') };
      var exe = findAdobeExe(appKind);
      var appLabel = appKind === 'photoshop' ? 'Adobe Photoshop' : 'Adobe Audition';
      if (!exe) return { ok: false, error: tr('msg.appNotFound', { app: appLabel }) };
      var clean = U.uriToPath(nativePath);
      var winPath = clean.replace(/\//g, '\\');
      try {
        var child = cp.spawn(exe, [winPath], { detached: true, stdio: 'ignore', windowsHide: false });
        child.unref();
        return { ok: true, appName: appLabel };
      } catch (e) {
        return { ok: false, error: tr('msg.appLaunchFailed', { app: appLabel, err: e.message || e }) };
      }
    }

    function discoverExportPresets() {
      var presets = [];
      if (!fsMod || !pathMod) return presets;
      var proc = U.nodeProcess();
      if (!proc || proc.platform !== 'win32') return presets;
      var adobeDir = (proc.env && proc.env.ProgramFiles) ? pathMod.join(proc.env.ProgramFiles, 'Adobe') : 'C:\\Program Files\\Adobe';
      var roots = [];
      try {
        if (fsMod.existsSync(adobeDir)) {
          var dirs = fsMod.readdirSync(adobeDir).sort().reverse();
          for (var i = 0; i < dirs.length; i++) {
            if (/^Adobe (Premiere Pro|Media Encoder)/i.test(dirs[i])) {
              var sp = pathMod.join(adobeDir, dirs[i], 'MediaIO', 'systempresets');
              if (fsMod.existsSync(sp)) roots.push(sp);
            }
          }
        }
      } catch (_) {}
      var seenNames = {};
      function walk(dir, depth) {
        if (depth > 3 || presets.length >= 24) return;
        var items;
        try { items = fsMod.readdirSync(dir); } catch (_) { return; }
        for (var j = 0; j < items.length; j++) {
          var full = pathMod.join(dir, items[j]);
          var st;
          try { st = fsMod.statSync(full); } catch (_) { continue; }
          if (st.isDirectory()) {
            walk(full, depth + 1);
          } else if (/\.epr$/i.test(items[j])) {
            var base = items[j].replace(/\.epr$/i, '');
            if (/(Match Source|H\.264|YouTube|ProRes|WAV|MP3|1080p|4K)/i.test(base) && !seenNames[base]) {
              seenNames[base] = true;
              presets.push({ label: base, path: full });
            }
          }
        }
      }
      for (var k = 0; k < roots.length; k++) walk(roots[k], 0);
      return presets;
    }

    var hotkeyChild = null;
    var hotkeyCallback = null;
    var hotkeyWanted = false;
    var hotkeyRestartTimer = 0;
    var hotkeyFailCount = 0;
    var hotkeyMods = U.DEFAULT_REVEAL_SHORTCUT.winMods;
    var hotkeyVk = U.DEFAULT_REVEAL_SHORTCUT.vk;

    function resolvePowerShellExe() {
      var proc = U.nodeProcess();
      var psBin = 'powershell.exe';
      try {
        var sysRoot = proc && proc.env && (proc.env.SystemRoot || proc.env.windir);
        if (sysRoot && pathMod && fsMod) {
          var fullPs = pathMod.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
          if (fsMod.existsSync(fullPs)) psBin = fullPs;
        }
      } catch (_) {}
      return psBin;
    }

    function supportsGlobalHotkey() {
      var proc = U.nodeProcess();
      if (!cp || !pathMod || !fsMod || !proc || proc.platform !== 'win32') return false;
      var extRoot = resolveExtensionRoot();
      var helperScript = extRoot ? pathMod.join(extRoot, 'helpers', 'hotkey-watch.ps1') : '';
      try {
        return !!(helperScript && fsMod.existsSync(helperScript));
      } catch (_) {
        return false;
      }
    }

    function stopGlobalHotkey() {
      hotkeyWanted = false;
      hotkeyCallback = null;
      clearTimeout(hotkeyRestartTimer);
      hotkeyRestartTimer = 0;
      if (hotkeyChild) {
        var child = hotkeyChild;
        hotkeyChild = null;
        try {
          if (child.stdin && !child.stdin.destroyed) {
            child.stdin.write('EXIT\n');
            child.stdin.end();
          }
        } catch (_) {}
        setTimeout(function () {
          try { if (!child.killed) child.kill(); } catch (_) {}
        }, 250);
      }
    }

    function updateGlobalHotkey(shortcut) {
      if (shortcut && shortcut.vk) {
        currentRevealShortcut = Object.assign({}, shortcut);
        hotkeyMods = Number(shortcut.winMods) || 0;
        hotkeyVk = Number(shortcut.vk) || U.DEFAULT_REVEAL_SHORTCUT.vk;
        registerPanelKeyInterest();
      }
      if (hotkeyChild && hotkeyChild.stdin && !hotkeyChild.stdin.destroyed) {
        try {
          hotkeyChild.stdin.write('SET:' + hotkeyMods + ':' + hotkeyVk + '\n');
        } catch (_) {}
      }
    }

    function startGlobalHotkey(onTrigger, shortcut) {
      hotkeyCallback = typeof onTrigger === 'function' ? onTrigger : null;
      hotkeyWanted = true;
      hotkeyFailCount = 0;
      clearTimeout(hotkeyRestartTimer);
      hotkeyRestartTimer = 0;
      if (shortcut && shortcut.vk) {
        currentRevealShortcut = Object.assign({}, shortcut);
        hotkeyMods = Number(shortcut.winMods) || 0;
        hotkeyVk = Number(shortcut.vk) || U.DEFAULT_REVEAL_SHORTCUT.vk;
        registerPanelKeyInterest();
      }
      if (!supportsGlobalHotkey()) return false;
      if (hotkeyChild) {
        updateGlobalHotkey(shortcut);
        return true;
      }

      var proc = U.nodeProcess();
      var extRoot = resolveExtensionRoot();
      var helperScript = extRoot ? pathMod.join(extRoot, 'helpers', 'hotkey-watch.ps1') : '';
      if (!helperScript) return false;

      var psBin = resolvePowerShellExe();
      var parentPid = (proc && typeof proc.pid === 'number') ? proc.pid : 0;

      function launch() {
        if (!hotkeyWanted || hotkeyChild) return;
        try {
          var child = cp.spawn(psBin, [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-WindowStyle', 'Hidden',
            '-File', helperScript,
            '-ParentPid', String(parentPid),
            '-Modifiers', String(hotkeyMods),
            '-Vk', String(hotkeyVk)
          ], {
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe']
          });
          hotkeyChild = child;
          var stdoutBuf = '';
          if (child.stdout) {
            child.stdout.setEncoding('utf8');
            child.stdout.on('data', function (chunk) {
              stdoutBuf += String(chunk || '');
              var lines = stdoutBuf.split(/\r?\n/);
              stdoutBuf = lines.pop() || '';
              for (var i = 0; i < lines.length; i++) {
                var line = lines[i].trim();
                if (/^READY\b/i.test(line)) {
                  hotkeyFailCount = 0;
                } else if (/^TRIGGER:/i.test(line)) {
                  if (hotkeyCallback) hotkeyCallback(line.slice(8).toLowerCase());
                }
              }
            });
          }
          child.on('error', function () {
            if (hotkeyChild === child) hotkeyChild = null;
          });
          child.on('exit', function () {
            if (hotkeyChild === child) hotkeyChild = null;
            if (hotkeyWanted && hotkeyFailCount < 3) {
              hotkeyFailCount += 1;
              clearTimeout(hotkeyRestartTimer);
              hotkeyRestartTimer = setTimeout(launch, 2500);
            }
          });
        } catch (_) {
          hotkeyChild = null;
        }
      }

      launch();
      return true;
    }

    function focusPanel() {
      try {
        if (cepApi && typeof cepApi.requestOpenExtension === 'function') {
          cepApi.requestOpenExtension('com.cgbai.prbinview.panel', '');
        }
      } catch (_) {}
    }

    function triggerNativeMenuAction(action) {
      return new Promise(function (resolve) {
        var proc = U.nodeProcess();
        if (!cp || !pathMod || !fsMod || !proc || proc.platform !== 'win32') {
          resolve({ ok: false, detail: 'UNSUPPORTED_PLATFORM' });
          return;
        }
        var extRoot = resolveExtensionRoot();
        var helperScript = extRoot ? pathMod.join(extRoot, 'helpers', 'pr-menu.ps1') : '';
        if (!helperScript || !fsMod.existsSync(helperScript)) {
          resolve({ ok: false, detail: 'HELPER_MISSING' });
          return;
        }
        var psBin = 'powershell.exe';
        try {
          var sysRoot = proc.env && (proc.env.SystemRoot || proc.env.windir);
          if (sysRoot) {
            var fullPs = pathMod.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
            if (fsMod.existsSync(fullPs)) psBin = fullPs;
          }
        } catch (_) {}

        cp.execFile(psBin, [
          '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-WindowStyle', 'Hidden',
          '-File', helperScript,
          '-Action', action
        ], {
          windowsHide: true,
          encoding: 'utf8',
          timeout: 12000
        }, function (err, stdout) {
          var out = String(stdout || '').trim().split(/\r?\n/).pop() || '';
          if (!err && /^OK:/i.test(out)) {
            resolve({ ok: true, detail: out });
          } else {
            resolve({ ok: false, detail: out || (err && err.message) || 'FAILED' });
          }
        });
      });
    }

    function findActivePremiereProfile(hostInfo) {
      var out = { docsCandidates: [], bestPrefsPath: '', bestProfileDir: '' };
      if (!fsMod || !pathMod) return out;

      var proc = U.nodeProcess();
      var osMod = U.nodeRequire('os');
      var docsCandidates = out.docsCandidates;
      function pushDir(d) {
        var clean = U.uriToPath(d || '').replace(/\//g, pathMod.sep).replace(/[\\/]+$/, '');
        if (!clean) return;
        var low = clean.toLowerCase();
        for (var i = 0; i < docsCandidates.length; i++) {
          if (docsCandidates[i].toLowerCase() === low) return;
        }
        docsCandidates.push(clean);
      }

      var envInfo = hostInfo || lastHostEnv;
      if (envInfo && envInfo.docsPath) pushDir(envInfo.docsPath);
      try {
        var home = (osMod && typeof osMod.homedir === 'function') ? osMod.homedir()
          : (proc && proc.env && (proc.env.USERPROFILE || proc.env.HOME)) || '';
        if (home) {
          pushDir(pathMod.join(home, 'Documents'));
          pushDir(pathMod.join(home, 'OneDrive', 'Documents'));
        }
        if (proc && proc.env && proc.env.OneDrive) {
          pushDir(pathMod.join(proc.env.OneDrive, 'Documents'));
        }
      } catch (_) {}

      /* Major version prefix from running Premiere Pro (works across 22.0 .. 27.0+ without version caps) */
      var verMajor = '';
      if (envInfo && envInfo.appVersion) {
        var vm = String(envInfo.appVersion).match(/^(\d+)/);
        if (vm) verMajor = vm[1] + '.';
      }

      var bestPrefsScore = -1;
      for (var d = 0; d < docsCandidates.length; d++) {
        var prBase = pathMod.join(docsCandidates[d], 'Adobe', 'Premiere Pro');
        try {
          if (!fsMod.existsSync(prBase)) continue;
          var verDirs = fsMod.readdirSync(prBase);
          for (var v = 0; v < verDirs.length; v++) {
            var verName = verDirs[v];
            var verPath = pathMod.join(prBase, verName);
            var profiles;
            try { profiles = fsMod.readdirSync(verPath); } catch (_) { continue; }
            for (var p = 0; p < profiles.length; p++) {
              if (!/^Profile-/i.test(profiles[p])) continue;
              var profDir = pathMod.join(verPath, profiles[p]);
              var prefsFile = pathMod.join(profDir, 'Adobe Premiere Pro Prefs');
              try {
                var st = fsMod.statSync(prefsFile);
                if (!st.isFile()) continue;
                var verBonus = (verMajor && verName.indexOf(verMajor) === 0) ? 1e15 : 0;
                var score = verBonus + (st.mtimeMs || 0);
                if (score > bestPrefsScore) {
                  bestPrefsScore = score;
                  out.bestPrefsPath = prefsFile;
                  out.bestProfileDir = profDir;
                }
              } catch (_) {}
            }
          }
        } catch (_) {}
      }
      return out;
    }

    function readPremiereRevealShortcutFromDisk(hostInfo) {
      var fallback = Object.assign({}, U.DEFAULT_REVEAL_SHORTCUT);
      if (!fsMod || !pathMod) return fallback;

      var prof = findActivePremiereProfile(hostInfo);
      if (!prof.bestProfileDir) return fallback;

      var proc = U.nodeProcess();
      var subDir = (proc && proc.platform === 'darwin') ? 'Mac' : 'Win';
      var kysDir = pathMod.join(prof.bestProfileDir, subDir);
      var kysEntries = [];
      try {
        if (!fsMod.existsSync(kysDir)) return fallback;
        var names = fsMod.readdirSync(kysDir);
        for (var i = 0; i < names.length; i++) {
          if (!/\.kys$/i.test(names[i])) continue;
          var fullPath = pathMod.join(kysDir, names[i]);
          try {
            var st = fsMod.statSync(fullPath);
            if (st.isFile()) {
              kysEntries.push({ name: names[i], path: fullPath, mtimeMs: st.mtimeMs || 0 });
            }
          } catch (_) {}
        }
      } catch (_) {
        return fallback;
      }
      if (!kysEntries.length) return fallback;

      var prefsXml = '';
      if (prof.bestPrefsPath) {
        try { prefsXml = fsMod.readFileSync(prof.bestPrefsPath, 'utf8'); } catch (_) {}
      }

      var activeFile = U.findActiveKysFromPrefs(prefsXml, kysEntries.map(function (e) { return e.name; }));
      if (activeFile) {
        var matched = kysEntries.find(function (e) { return e.name === activeFile; });
        if (matched) {
          try {
            var stem = matched.name.replace(/\.kys$/i, '');
            var parsedActive = U.parsePremiereKysRevealShortcut(fsMod.readFileSync(matched.path, 'utf8'), stem);
            if (parsedActive) {
              parsedActive.kysPath = matched.path;
              return parsedActive;
            }
            return Object.assign({}, fallback, { presetName: stem, kysPath: matched.path });
          } catch (_) {}
        }
      }

      /* Fallback when Prefs didn't name a specific .kys file: inspect most recently modified .kys */
      kysEntries.sort(function (a, b) { return b.mtimeMs - a.mtimeMs; });
      for (var k = 0; k < kysEntries.length; k++) {
        try {
          var stemName = kysEntries[k].name.replace(/\.kys$/i, '');
          var parsed = U.parsePremiereKysRevealShortcut(fsMod.readFileSync(kysEntries[k].path, 'utf8'), stemName);
          if (parsed) {
            parsed.kysPath = kysEntries[k].path;
            return parsed;
          }
        } catch (_) {}
      }
      return fallback;
    }

    async function getRevealShortcut() {
      if (!lastHostEnv.appVersion && !lastHostEnv.docsPath) {
        try {
          var hostInfo = await call('getLabelPrefs');
          if (hostInfo) {
            if (hostInfo.appVersion) lastHostEnv.appVersion = String(hostInfo.appVersion);
            if (hostInfo.docsPath) lastHostEnv.docsPath = String(hostInfo.docsPath);
          }
        } catch (_) {}
      }
      return readPremiereRevealShortcutFromDisk(lastHostEnv);
    }

    function readPremiereLabelPrefsFromDisk(hostInfo) {
      var empty = { colors: new Array(16).fill(''), names: new Array(16).fill(''), presetName: '', prefsPath: '' };
      if (!fsMod || !pathMod) return empty;

      var prof = findActivePremiereProfile(hostInfo);
      var docsCandidates = prof.docsCandidates;
      var bestPrefsPath = prof.bestPrefsPath;
      var bestProfileDir = prof.bestProfileDir;

      var prefsParsed = { colors: new Array(16).fill(''), names: new Array(16).fill(''), presetName: '' };
      if (bestPrefsPath) {
        try {
          var xml = fsMod.readFileSync(bestPrefsPath, 'utf8');
          prefsParsed = U.parsePremierePrefsLabels(xml);
        } catch (_) {}
      }

      /* Optional .prlabelpreset lookup when an active custom preset name is configured */
      var activePreset = (hostInfo && hostInfo.presetName) || prefsParsed.presetName || '';
      var presetParsed = { colors: new Array(16).fill(''), names: new Array(16).fill('') };
      if (activePreset) {
        var presetDirs = [];
        for (var k = 0; k < docsCandidates.length; k++) {
          presetDirs.push(pathMod.join(docsCandidates[k], 'Adobe', 'Common', 'Assets', 'Label Color Presets'));
        }
        if (bestProfileDir) {
          presetDirs.push(pathMod.join(bestProfileDir, 'Label Color Presets'));
        }
        var wantFile = /\.prlabelpreset$/i.test(activePreset) ? activePreset : (activePreset + '.prlabelpreset');
        for (var pd = 0; pd < presetDirs.length; pd++) {
          try {
            var candidate = pathMod.join(presetDirs[pd], wantFile);
            if (fsMod.existsSync(candidate)) {
              presetParsed = U.parseLabelPresetText(fsMod.readFileSync(candidate, 'utf8'));
              break;
            }
          } catch (_) {}
        }
      }

      var mergedColors = new Array(16);
      var mergedNames = new Array(16);
      for (var i = 0; i < 16; i++) {
        mergedColors[i] = prefsParsed.colors[i] || presetParsed.colors[i] || '';
        mergedNames[i] = prefsParsed.names[i] || presetParsed.names[i] || '';
      }

      return {
        colors: mergedColors,
        names: mergedNames,
        presetName: activePreset,
        prefsPath: bestPrefsPath
      };
    }

    async function getLabelPrefs() {
      var hostInfo = null;
      try {
        hostInfo = await call('getLabelPrefs');
      } catch (_) {
        hostInfo = null;
      }
      if (hostInfo) {
        if (hostInfo.appVersion) lastHostEnv.appVersion = String(hostInfo.appVersion);
        if (hostInfo.docsPath) lastHostEnv.docsPath = String(hostInfo.docsPath);
      }
      var disk = readPremiereLabelPrefsFromDisk(hostInfo);
      var liveColors = (hostInfo && Array.isArray(hostInfo.colors))
        ? U.resolveLabelColorList(hostInfo.colors)
        : new Array(16).fill('');
      var liveNames = (hostInfo && Array.isArray(hostInfo.names))
        ? hostInfo.names
        : new Array(16).fill('');

      var finalColors = new Array(16);
      var finalNames = new Array(16);
      for (var i = 0; i < 16; i++) {
        finalColors[i] = liveColors[i] || disk.colors[i] || '';
        finalNames[i] = (liveNames[i] && String(liveNames[i]).trim()) || disk.names[i] || '';
      }
      return {
        colors: finalColors,
        names: finalNames,
        presetName: disk.presetName || '',
        prefsPath: disk.prefsPath || ''
      };
    }

    return {
      isDemo: false,
      isCep: true,
      getExtensionPath: function () {
        return resolveExtensionRoot();
      },
      triggerNativeMenuAction: triggerNativeMenuAction,
      getLabelPrefs: getLabelPrefs,
      pollTick: function (folderId, offlineIds, wantSig) {
        var payload = {};
        if (folderId) payload.folderId = folderId;
        if (offlineIds && offlineIds.length) payload.offlineIds = offlineIds;
        if (wantSig) payload.wantSig = true;
        return call('pollTick', payload);
      },
      getProjectTree: function () { return call('getProjectTree'); },
      selectItems: function (ids) { return call('selectItems', { ids: ids }); },
      openItem: function (id, play) { return call('openItem', { id: id, play: !!play }); },
      stopSourceMonitor: function () { return call('stopSourceMonitor'); },
      insertToTimeline: function (ids, mode) { return call('insertToTimeline', { ids: ids, mode: mode || 'insert' }); },
      createBin: function (parentId, name) { return call('createBin', { parentId: parentId, name: name }); },
      newBinFromSelection: function (ids, parentId, name) {
        return call('newBinFromSelection', { ids: ids, parentId: parentId, name: name });
      },
      renameItem: function (id, name) { return call('renameItem', { id: id, name: name }); },
      moveItems: function (ids, targetBinId) { return call('moveItems', { ids: ids, targetBinId: targetBinId }); },
      checkItemsInUse: function (ids) { return call('checkItemsInUse', { ids: ids }); },
      duplicateItems: function (ids, targetBinId) {
        return call('duplicateItems', { ids: ids, targetBinId: targetBinId || '' });
      },
      removeItems: function (ids) { return call('removeItems', { ids: ids }); },
      makeOffline: function (ids) { return call('makeOffline', { ids: ids }); },
      importFiles: async function (targetBinId) {
        var paths = await pickFiles(true, tr('picker.importFiles'), '');
        if (!paths.length) return { imported: false, count: 0 };
        return call('importFiles', { targetBinId: targetBinId, paths: paths });
      },
      importFolders: async function (targetBinId) {
        var dirs = await pickFolders(tr('picker.importFolders'), '');
        if (!dirs.length) return { imported: false, importedFiles: 0, createdBins: 0 };
        var plan = scanExternalPaths(fsMod, pathMod, dirs);
        if (!plan.files.length && !plan.folders.length) return { imported: false, importedFiles: 0, createdBins: 0 };
        return call('importStructure', { targetBinId: targetBinId, files: plan.files, folders: plan.folders });
      },
      importExternalPaths: async function (targetBinId, rawPaths) {
        var plan = scanExternalPaths(fsMod, pathMod, rawPaths);
        if (!plan.files.length && !plan.folders.length) {
          return { imported: false, importedFiles: 0, createdBins: 0 };
        }
        return call('importStructure', { targetBinId: targetBinId, files: plan.files, folders: plan.folders });
      },
      setColorLabel: function (ids, labelIndex) { return call('setColorLabel', { ids: ids, labelIndex: labelIndex }); },
      clearInOut: function (ids) { return call('clearInOut', { ids: ids }); },
      refreshMedia: function (ids) { return call('refreshMedia', { ids: ids }); },
      relinkMedia: async function (id, currentPath, customTitle) {
        var dir = currentPath && pathMod ? pathMod.dirname(currentPath) : '';
        var paths = await pickFiles(false, customTitle || tr('picker.relinkDefault'), dir);
        if (!paths.length) return null;
        return call('relinkMedia', { id: id, newPath: paths[0] });
      },
      relinkToPath: function (id, newPath) {
        return call('relinkMedia', { id: id, newPath: newPath });
      },
      relinkFolderBatch: async function (offlineItems, initialDir) {
        var dirs = await pickFolders(tr('picker.linkFolder'), initialDir || '');
        if (!dirs.length) return { cancelled: true, linked: 0, matched: 0 };
        var plan = scanExternalPaths(fsMod, pathMod, dirs);
        var flatFiles = plan.files.slice();
        function flatten(folderObj) {
          if (!folderObj) return;
          if (Array.isArray(folderObj.files)) flatFiles = flatFiles.concat(folderObj.files);
          if (Array.isArray(folderObj.dirs)) folderObj.dirs.forEach(flatten);
        }
        plan.folders.forEach(flatten);
        var pairs = matchOfflineClipsInPaths(offlineItems, flatFiles);
        if (!pairs.length) {
          return { cancelled: false, linked: 0, matched: 0, scanned: flatFiles.length };
        }
        var res = await call('relinkBatch', { pairs: pairs });
        return {
          cancelled: false,
          linked: (res && res.linked) || 0,
          failed: (res && res.failed) || 0,
          matched: pairs.length,
          scanned: flatFiles.length
        };
      },
      createSubClip: function (payload) { return call('createSubClip', payload); },
      getSequenceSettings: function (id) { return call('getSequenceSettings', { id: id }); },
      setSequenceSettings: function (payload) { return call('setSequenceSettings', payload); },
      autoReframeSequence: function (payload) { return call('autoReframeSequence', payload); },
      exportToAME: function (payload) { return call('exportToAME', payload); },
      pickExportFolder: async function (initialDir) {
        var dirs = await pickFolders(tr('picker.exportDir'), initialDir || '');
        return dirs.length ? dirs[0] : '';
      },
      pickPresetFile: async function () {
        var paths = await pickFiles(false, tr('picker.exportPreset'), '');
        return paths.length ? paths[0] : '';
      },
      discoverExportPresets: discoverExportPresets,
      createSequenceFromClips: function (ids, name, targetBinId) {
        return call('createSequenceFromClips', { ids: ids, name: name, targetBinId: targetBinId });
      },
      getItemDetails: function (id) { return call('getItemDetails', { id: id }); },
      getItemUsage: function (id) { return call('getItemUsage', { id: id }); },
      jumpToSequenceTime: function (entry) { return call('jumpToSequenceTime', entry); },
      getTimelineSelection: function () { return call('getTimelineSelection'); },
      getRevealShortcut: getRevealShortcut,
      supportsGlobalHotkey: supportsGlobalHotkey,
      startGlobalHotkey: startGlobalHotkey,
      updateGlobalHotkey: updateGlobalHotkey,
      stopGlobalHotkey: stopGlobalHotkey,
      focusPanel: focusPanel,
      getFolderMetadata: function (ids) { return call('getFolderMetadata', { ids: ids || [] }); },
      captureTimelineBaseline: function () { return call('captureTimelineBaseline'); },
      reconcileDroppedClips: function (beforeIds, dragged) {
        return call('reconcileDroppedClips', { beforeIds: beforeIds, dragged: dragged });
      },
      revealInExplorer: revealInExplorer,
      editOriginal: editOriginal,
      editInAdobeApp: editInAdobeApp
    };
  }

  /* ==================== STANDALONE BROWSER DEMO ADAPTER ==================== */

  function makeSvgThumb(title, subtitle, c1, c2, badge) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="' + c1 + '"/><stop offset="100%" stop-color="' + c2 + '"/></linearGradient></defs>' +
      '<rect width="480" height="270" fill="url(#g)"/>' +
      '<circle cx="385" cy="70" r="90" fill="rgba(255,255,255,0.08)"/>' +
      '<circle cx="95" cy="220" r="110" fill="rgba(0,0,0,0.16)"/>' +
      '<rect x="24" y="22" width="76" height="24" rx="4" fill="rgba(0,0,0,0.45)"/>' +
      '<text x="62" y="38" fill="#fff" font-family="Segoe UI,sans-serif" font-size="12" font-weight="600" text-anchor="middle">' + badge + '</text>' +
      '<text x="28" y="210" fill="#fff" font-family="Segoe UI,Microsoft YaHei UI,sans-serif" font-size="22" font-weight="600">' + title + '</text>' +
      '<text x="28" y="238" fill="rgba(255,255,255,0.75)" font-family="Segoe UI,Microsoft YaHei UI,sans-serif" font-size="13">' + subtitle + '</text>' +
      '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function createDemoBridge() {
    var dirtySeq = 1;
    var seqCounter = 100;
    var selection = ['bin-cam-a'];

    var nodes = [
      { id: 'root', pid: '', name: '商业广告_2026_演示工程.prproj', isBin: true, isSeq: false, path: '', offline: false, label: 0 },
      { id: 'bin-footage', pid: 'root', name: '01_实拍素材', isBin: true, isSeq: false, path: '', offline: false, label: 4 },
      { id: 'bin-cam-a', pid: 'bin-footage', name: 'A机位_4K_主镜头', isBin: true, isSeq: false, path: '', offline: false, label: 4 },
      { id: 'bin-cam-b', pid: 'bin-footage', name: 'B机位_升格慢动作', isBin: true, isSeq: false, path: '', offline: false, label: 2 },
      { id: 'bin-drone', pid: 'bin-footage', name: '航拍空镜', isBin: true, isSeq: false, path: '', offline: false, label: 5 },
      { id: 'bin-gfx', pid: 'root', name: '02_平面与包装', isBin: true, isSeq: false, path: '', offline: false, label: 3 },
      { id: 'bin-audio', pid: 'root', name: '03_配乐与音效', isBin: true, isSeq: false, path: '', offline: false, label: 5 },
      { id: 'bin-seq', pid: 'root', name: '04_剪辑序列', isBin: true, isSeq: false, path: '', offline: false, label: 13 },

      { id: 'c-1', pid: 'bin-cam-a', name: 'A001_开场城市夜景.mp4', isBin: false, isSeq: false, path: 'D:/Media/A机位/A001_开场城市夜景.mp4', offline: false, label: 4, uv: 3, ua: 3, up: 3, demoDuration: 28.4, demoRes: '3840×2160 · 25fps', demoThumb: makeSvgThumb('A001 城市夜景', '3840×2160 · H.264 · 25fps', '#1b2b4a', '#0f1626', '4K MP4') },
      { id: 'c-2', pid: 'bin-cam-a', name: 'A002_人物特写采访.mov', isBin: false, isSeq: false, path: 'D:/Media/A机位/A002_人物特写采访.mov', offline: false, label: 4, demoDuration: 64.0, demoRes: '3840×2160 · 25fps', demoThumb: makeSvgThumb('A002 人物采访', 'ProRes 422 HQ · 25fps', '#3c2544', '#1a1220', 'PRORES') },
      { id: 'c-3', pid: 'bin-cam-a', name: 'A003_产品桌面推轨.mp4', isBin: false, isSeq: false, path: 'D:/Media/A机位/A003_产品桌面推轨.mp4', offline: false, label: 7, demoDuration: 15.2, demoRes: '3840×2160 · 50fps', demoThumb: makeSvgThumb('A003 产品推轨', '3840×2160 · 50fps', '#4a331d', '#1c150f', '50FPS') },
      { id: 'c-4', pid: 'bin-cam-a', name: 'A004_霓虹街头跟拍.mxf', isBin: false, isSeq: false, path: 'D:/Media/A机位/A004_霓虹街头跟拍.mxf', offline: false, label: 6, demoDuration: 42.8, demoRes: '4096×2160 · 24fps', demoThumb: makeSvgThumb('A004 霓虹街头', 'XAVC-I MXF · 24fps', '#541e3b', '#1b1126', 'MXF') },
      { id: 'c-5', pid: 'bin-cam-a', name: 'A005_丢失代理镜头.mp4', isBin: false, isSeq: false, path: 'E:/OfflineDisk/A005_丢失代理镜头.mp4', offline: true, label: 6, demoDuration: 19.0, demoRes: '离线' },
      { id: 'c-6', pid: 'bin-cam-a', name: 'A006_咖啡馆逆光.mp4', isBin: false, isSeq: false, path: 'D:/Media/A机位/A006_咖啡馆逆光.mp4', offline: false, label: 15, demoDuration: 22.5, demoRes: '3840×2160 · 25fps', demoThumb: makeSvgThumb('A006 咖啡馆逆光', '3840×2160 · 10-bit', '#5c4220', '#21190f', '10-BIT') },

      { id: 'c-7', pid: 'bin-cam-b', name: 'B001_水花飞溅_120fps.mov', isBin: false, isSeq: false, path: 'D:/Media/B机位/B001_水花飞溅_120fps.mov', offline: false, label: 2, demoDuration: 12.6, demoRes: '1920×1080 · 120fps', demoThumb: makeSvgThumb('B001 水花飞溅', '120fps 升格慢动作', '#154652', '#0b1e26', '120FPS') },
      { id: 'c-8', pid: 'bin-cam-b', name: 'B002_奔跑背影_100fps.mp4', isBin: false, isSeq: false, path: 'D:/Media/B机位/B002_奔跑背影_100fps.mp4', offline: false, label: 2, demoDuration: 18.0, demoRes: '3840×2160 · 100fps', demoThumb: makeSvgThumb('B002 奔跑背影', '100fps 升格', '#1e4d45', '#0e1e1c', '100FPS') },
      { id: 'c-9', pid: 'bin-cam-b', name: 'B003_光影慢门延时.mp4', isBin: false, isSeq: false, path: 'D:/Media/B机位/B003_光影慢门延时.mp4', offline: false, label: 9, demoDuration: 9.5, demoRes: '3840×2160 · 25fps', demoThumb: makeSvgThumb('B003 延时摄影', '3840×2160 · Timelapse', '#24305e', '#11162b', 'RAW TL') },

      { id: 'c-10', pid: 'bin-drone', name: 'DJI_0104_海边日落航拍.mp4', isBin: false, isSeq: false, path: 'D:/Media/航拍/DJI_0104_海边日落航拍.mp4', offline: false, label: 7, demoDuration: 51.3, demoRes: '5120×2700 · 50fps', demoThumb: makeSvgThumb('DJI_0104 海边日落', '5.1K D-Log M · 50fps', '#693420', '#241418', '5.1K') },
      { id: 'c-11', pid: 'bin-drone', name: 'DJI_0109_跨海大桥俯冲.mp4', isBin: false, isSeq: false, path: 'D:/Media/航拍/DJI_0109_跨海大桥俯冲.mp4', offline: false, label: 5, demoDuration: 34.7, demoRes: '3840×2160 · 50fps', demoThumb: makeSvgThumb('DJI_0109 跨海大桥', '4K · 50fps', '#1d4534', '#0e1f19', 'DRONE') },

      { id: 'c-12', pid: 'bin-gfx', name: '片头主标题_分层.psd', isBin: false, isSeq: false, path: 'D:/Media/平面/片头主标题_分层.psd', offline: false, label: 3, demoRes: '3840×2160 · PSD', demoThumb: makeSvgThumb('片头主标题', 'Photoshop 分层文件', '#272959', '#141530', 'PSD') },
      { id: 'c-13', pid: 'bin-gfx', name: '品牌视觉KV海报.png', isBin: false, isSeq: false, path: 'D:/Media/平面/品牌视觉KV海报.png', offline: false, label: 3, demoRes: '2560×1440 · PNG', demoThumb: makeSvgThumb('品牌 KV 海报', 'PNG 透明通道', '#3f285c', '#1c1229', 'PNG') },
      { id: 'c-14', pid: 'bin-gfx', name: '角标水印_矢量.ai', isBin: false, isSeq: false, path: 'D:/Media/平面/角标水印_矢量.ai', offline: false, label: 11, demoRes: 'AI 矢量' },

      { id: 'c-15', pid: 'bin-audio', name: 'BGM_星际脉冲_主旋律.wav', isBin: false, isSeq: false, path: 'D:/Media/音频/BGM_星际脉冲_主旋律.wav', offline: false, label: 5, demoDuration: 142.0, demoRes: '48kHz · 24bit' },
      { id: 'c-16', pid: 'bin-audio', name: 'SFX_转场低频冲击.wav', isBin: false, isSeq: false, path: 'D:/Media/音频/SFX_转场低频冲击.wav', offline: false, label: 13, demoDuration: 2.8, demoRes: '48kHz · 24bit' },
      { id: 'c-17', pid: 'bin-audio', name: 'VO_男声旁白_终版.mp3', isBin: false, isSeq: false, path: 'D:/Media/音频/VO_男声旁白_终版.mp3', offline: false, label: 10, demoDuration: 58.4, demoRes: '48kHz · Stereo' },

      { id: 'c-18', pid: 'bin-seq', name: '01_主片粗剪_60s', isBin: false, isSeq: true, seqId: 'seq-1', path: '', offline: false, label: 13, demoDuration: 60.0 },
      { id: 'c-19', pid: 'bin-seq', name: '02_精剪定版_30s_竖屏', isBin: false, isSeq: true, seqId: 'seq-2', path: '', offline: false, label: 13, demoDuration: 30.0 }
    ];

    function find(id) {
      for (var i = 0; i < nodes.length; i++) if (nodes[i].id === id) return nodes[i];
      return null;
    }

    function snapshot() {
      var counts = {};
      for (var i = 0; i < nodes.length; i++) {
        var p = nodes[i].pid;
        if (p) counts[p] = (counts[p] || 0) + 1;
      }
      return {
        docId: 'demo-doc-1',
        name: '商业广告_2026_演示工程.prproj',
        path: 'D:/Demo/商业广告_2026_演示工程.prproj',
        rootId: 'root',
        dirtySeq: dirtySeq,
        nodes: nodes.map(function (n) {
          return Object.assign({}, n, { childCount: counts[n.id] || 0 });
        })
      };
    }

    return {
      isDemo: true,
      isCep: false,
      getExtensionPath: function () { return ''; },
      getLabelPrefs: async function () {
        return { colors: new Array(16).fill(''), names: new Array(16).fill(''), presetName: '', prefsPath: '' };
      },
      pollTick: async function () {
        var rootCount = nodes.filter(function (n) { return n.pid === 'root'; }).length;
        return {
          hasProject: true,
          docId: 'demo-doc-1',
          name: '商业广告_2026_演示工程.prproj',
          path: 'D:/Demo/商业广告_2026_演示工程.prproj',
          dirtySeq: dirtySeq,
          rootCount: rootCount,
          sel: selection.slice()
        };
      },
      getProjectTree: async function () { return snapshot(); },
      selectItems: async function (ids) { selection = ids.slice(); return { count: selection.length }; },
      openItem: async function () { return { opened: 'demo' }; },
      stopSourceMonitor: async function () { return true; },
      insertToTimeline: async function (ids, mode) { return { placed: ids.length, sequenceName: '01_主片粗剪_60s (' + mode + ')' }; },
      createBin: async function (parentId, name) {
        var id = 'bin-' + (++seqCounter);
        nodes.push({ id: id, pid: parentId || 'root', name: name, isBin: true, isSeq: false, path: '', offline: false, label: 4 });
        dirtySeq++;
        return { id: id, name: name };
      },
      renameItem: async function (id, name) {
        var n = find(id);
        if (!n) throw new Error('未找到项目');
        n.name = name;
        dirtySeq++;
        return { id: id, name: name };
      },
      moveItems: async function (ids, targetBinId) {
        var moved = 0;
        ids.forEach(function (id) {
          var n = find(id);
          if (n && n.pid) { n.pid = targetBinId; moved++; }
        });
        dirtySeq++;
        return { moved: moved };
      },
      removeItems: async function (ids) {
        var drop = new Set(ids);
        var changed = true;
        while (changed) {
          changed = false;
          nodes.forEach(function (n) {
            if (drop.has(n.pid) && !drop.has(n.id)) { drop.add(n.id); changed = true; }
          });
        }
        var before = nodes.length;
        nodes = nodes.filter(function (n) { return !drop.has(n.id); });
        dirtySeq++;
        return { removed: before - nodes.length };
      },
      importFiles: async function () {
        throw new Error('演示模式无法导入本地磁盘素材，请在 Premiere Pro 中使用');
      },
      importFolders: async function () {
        throw new Error('演示模式无法导入本地文件夹，请在 Premiere Pro 中使用');
      },
      importExternalPaths: async function () {
        throw new Error('演示模式无法拖入本地文件，请在 Premiere Pro 中使用');
      },
      setColorLabel: async function (ids, idx) {
        ids.forEach(function (id) { var n = find(id); if (n) n.label = idx; });
        dirtySeq++;
        return { updated: ids.length };
      },
      clearInOut: async function (ids) { return { updated: ids.length }; },
      refreshMedia: async function (ids) { return { updated: ids.length }; },
      relinkMedia: async function () { throw new Error('演示模式不支持重新链接'); },
      relinkToPath: async function () { return { ok: true }; },
      relinkFolderBatch: async function () { return { cancelled: true, linked: 0, matched: 0 }; },
      createSequenceFromClips: async function (ids, name, targetBinId) {
        var id = 'seq-' + (++seqCounter);
        nodes.push({ id: id, pid: targetBinId || 'bin-seq', name: name, isBin: false, isSeq: true, seqId: id, path: '', offline: false, label: 13 });
        dirtySeq++;
        return { name: name, seqId: id };
      },
      getItemDetails: async function (id) {
        var n = find(id) || {};
        return {
          id: id,
          name: n.name || '',
          treePath: '/' + (n.name || ''),
          path: n.path || '',
          offline: !!n.offline,
          label: n.label || 0,
          hasProxy: false,
          proxyPath: '',
          inPoint: 0,
          outPoint: n.demoDuration || -1,
          videoInfo: n.demoRes || '',
          audioInfo: n.kind === 'audio' ? '48000 Hz - Stereo' : '48000 Hz - 2ch',
          mediaDuration: n.demoDuration ? U.formatTime(n.demoDuration) : '',
          frameRate: n.demoRes && /fps/i.test(n.demoRes) ? n.demoRes.split('·').pop().trim() : ''
        };
      },
      getFolderMetadata: async function (ids) {
        var out = {};
        function secToTc(sec, fps) {
          var rate = fps || 25;
          var totalFrames = Math.max(0, Math.round((sec || 0) * rate));
          var f = totalFrames % rate;
          var s = Math.floor(totalFrames / rate) % 60;
          var m = Math.floor(totalFrames / (rate * 60)) % 60;
          var h = Math.floor(totalFrames / (rate * 3600));
          var pad = function (v) { return v < 10 ? '0' + v : String(v); };
          return pad(h) + ':' + pad(m) + ':' + pad(s) + ':' + pad(f);
        }
        (ids || []).forEach(function (id) {
          var n = find(id);
          if (!n || n.isBin) return;
          var fpsMatch = String(n.demoRes || '').match(/(\d+(?:\.\d+)?)\s*fps/i);
          var fpsNum = fpsMatch ? Number(fpsMatch[1]) : (n.isSeq ? 25 : 0);
          var dur = Number(n.demoDuration) || 0;
          var endSec = Math.max(0, dur - (fpsNum ? (1 / fpsNum) : 0));
          var resMatch = String(n.demoRes || '').match(/(\d+)\s*[×x]\s*(\d+)/);
          var audioOnly = /\.(wav|mp3|aac|m4a)$/i.test(n.name);
          out[id] = {
            fps: fpsNum ? fpsNum.toFixed(2) + ' fps' : '',
            mediaStart: dur > 0 ? '00:00:00:00' : '',
            mediaEnd: dur > 0 ? secToTc(endSec, Math.round(fpsNum) || 25) : '',
            mediaDuration: dur > 0 ? secToTc(dur, Math.round(fpsNum) || 25) : '',
            videoIn: (!audioOnly && dur > 0) ? '00:00:00:00' : '',
            videoOut: (!audioOnly && dur > 0) ? secToTc(endSec, Math.round(fpsNum) || 25) : '',
            videoDuration: (!audioOnly && dur > 0) ? secToTc(dur, Math.round(fpsNum) || 25) : '',
            videoInfo: resMatch ? (resMatch[1] + ' x ' + resMatch[2] + ' (1.0)') : '',
            audioInfo: audioOnly ? '48000 Hz - 24 bit - Stereo' : (dur > 0 ? '48000 Hz - Compressed - Stereo' : ''),
            description: '',
            logNote: '',
            status: n.offline ? 'Offline' : 'Online'
          };
        });
        return out;
      },
      captureTimelineBaseline: async function () { return { clips: 0 }; },
      reconcileDroppedClips: async function () { return { found: 0, foundClips: 0, swapped: 0, cleaned: 0, errors: [] }; },
      checkItemsInUse: async function () { return { inUse: false, refCount: 0, sequences: [], clipNames: [] }; },
      getItemUsage: async function (id) {
        var n = find(id);
        var nm = n ? n.name : '';
        if (!n || n.isBin || !(n.up > 0)) return { id: id, name: nm, videoCount: 0, audioCount: 0, entries: [] };
        return {
          id: id,
          name: nm,
          videoCount: n.uv || 0,
          audioCount: n.ua || 0,
          entries: [
            { seqId: 'seq-1', seqName: '01_主片粗剪_60s', clipName: nm, startTicks: '1270080000000', startSec: 5, timecode: '00:00:05:00', tracks: 'V1+A1', hasVideo: true, hasAudio: true, trackType: 'video', trackIndex: 0, clipIndex: 0 },
            { seqId: 'seq-2', seqName: '02_精剪定版_30s_竖屏', clipName: nm, startTicks: '0', startSec: 0, timecode: '00;00;00;00', tracks: 'V1+A1', hasVideo: true, hasAudio: true, trackType: 'video', trackIndex: 0, clipIndex: 0 },
            { seqId: 'seq-2', seqName: '02_精剪定版_30s_竖屏', clipName: nm, startTicks: '771208560000', startSec: 3.036, timecode: '00;00;03;01', tracks: 'V1+A1', hasVideo: true, hasAudio: true, trackType: 'video', trackIndex: 0, clipIndex: 1 }
          ]
        };
      },
      jumpToSequenceTime: async function (entry) {
        return { jumped: true, seqId: entry.seqId, seqName: entry.seqName || 'Demo', startTicks: entry.startTicks || '0' };
      },
      getTimelineSelection: async function () {
        return {
          found: true,
          reason: '',
          seqName: '01_主片粗剪_60s',
          ids: ['c-1'],
          primaryId: 'c-1',
          primaryName: 'A001_开场航拍_4K.mp4',
          fromPlayhead: false
        };
      },
      getRevealShortcut: async function () { return Object.assign({}, U.DEFAULT_REVEAL_SHORTCUT); },
      supportsGlobalHotkey: function () { return false; },
      startGlobalHotkey: function () { return false; },
      updateGlobalHotkey: function () {},
      stopGlobalHotkey: function () {},
      focusPanel: function () {},
      duplicateItems: async function (ids, targetBinId) {
        var count = 0;
        (ids || []).forEach(function (id) {
          var n = find(id);
          if (!n || !n.pid) return;
          var dest = targetBinId || n.pid;
          var copy = Object.assign({}, n, { id: 'dup-' + (++seqCounter), pid: dest, name: dest === n.pid ? (n.name + ' 副本') : n.name });
          nodes.push(copy);
          count++;
        });
        dirtySeq++;
        return { duplicated: count, newIds: [] };
      },
      newBinFromSelection: async function (ids, parentId, name) {
        var nid = 'bin-' + (++seqCounter);
        nodes.push({ id: nid, pid: parentId || 'root', name: name || '新建素材箱', isBin: true, isSeq: false, path: '', offline: false, label: 0 });
        var moved = 0;
        (ids || []).forEach(function (id) {
          var n = find(id);
          if (n && n.pid && n.id !== nid) { n.pid = nid; moved++; }
        });
        dirtySeq++;
        return { id: nid, name: name || '新建素材箱', moved: moved };
      },
      makeOffline: async function (ids) {
        var updated = 0;
        (ids || []).forEach(function (id) {
          var n = find(id);
          if (n && !n.isBin && !n.isSeq) { n.offline = true; updated++; }
        });
        dirtySeq++;
        return { updated: updated };
      },
      createSubClip: async function (p) { return { id: 'sub-' + (++seqCounter), name: p.name || '子剪辑' }; },
      getSequenceSettings: async function () { return { name: '演示序列', videoFrameWidth: 1920, videoFrameHeight: 1080, frameRateFps: 25, audioSampleRate: 48000 }; },
      setSequenceSettings: async function () { return { updated: true }; },
      autoReframeSequence: async function (p) { return { name: p.newName || '自动重构序列' }; },
      exportToAME: async function () { return { queued: true }; },
      pickExportFolder: async function () { return ''; },
      pickPresetFile: async function () { return ''; },
      discoverExportPresets: function () { return []; },
      revealInExplorer: function () { return false; },
      editOriginal: function () { return false; },
      editInAdobeApp: function () { return { ok: false, error: '演示模式不支持启动本地应用' }; },
      triggerNativeMenuAction: async function () { return { ok: false, detail: 'DEMO_MODE' }; }
    };
  }

  function createBridge() {
    if (typeof window !== 'undefined' && typeof window.__adobe_cep__ !== 'undefined') {
      return createCepBridge();
    }
    return createDemoBridge();
  }

  var api = {
    createBridge: createBridge,
    scanExternalPaths: scanExternalPaths,
    matchOfflineClipsInPaths: matchOfflineClipsInPaths
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PrCepBridge = api;
})(typeof window !== 'undefined' ? window : globalThis);
