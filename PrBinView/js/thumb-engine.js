(function (root) {
  'use strict';

  var U = root.PrUtils || (typeof require === 'function' ? require('./utils') : null);
  var LARGE_WEB_IMAGE_BYTES = 4 * 1024 * 1024;
  var THUMB_MAX_DIM = 360;
  var SPRITE_FRAMES = 10;
  var SPRITE_TILE_W = 240;
  var SPRITE_TILE_H = 135;
  var CACHE_MAX_BYTES = 250 * 1024 * 1024;
  var CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

  function makeHashKey(cryptoMod, filePath, size, mtimeMs) {
    var raw = U.normKey(filePath) + '|' + String(size || 0) + '|' + String(Math.floor(mtimeMs || 0));
    if (cryptoMod && typeof cryptoMod.createHash === 'function') {
      return cryptoMod.createHash('sha1').update(raw).digest('hex').slice(0, 16);
    }
    var h = 2166136261;
    for (var i = 0; i < raw.length; i++) {
      h ^= raw.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }

  function buildThumbArgs(filePath, outPath, seekSeconds) {
    var vf = 'scale=' + THUMB_MAX_DIM + ':' + THUMB_MAX_DIM +
      ':force_original_aspect_ratio=decrease:flags=fast_bilinear:out_range=full,format=yuvj420p';
    var args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
    if (typeof seekSeconds === 'number' && seekSeconds > 0) {
      args.push('-ss', seekSeconds.toFixed(2));
    }
    args.push(
      '-i', filePath,
      '-map', '0:v:0',
      '-an', '-sn', '-dn',
      '-frames:v', '1',
      '-vf', vf,
      '-strict', 'unofficial',
      '-q:v', '5',
      '-f', 'image2',
      '-y', outPath
    );
    return args;
  }

  function buildSpriteArgs(filePath, outPath, duration, frameCount) {
    var count = Math.max(2, Math.min(SPRITE_FRAMES, frameCount || SPRITE_FRAMES));
    var dur = Math.max(0.5, Number(duration) || 1);
    var args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
    var filters = [];
    var stackInputs = '';
    for (var i = 0; i < count; i++) {
      var frac = count === 1 ? 0.1 : (0.04 + (i / (count - 1)) * 0.92);
      var ts = Math.max(0, Math.min(dur - 0.05, dur * frac));
      args.push('-ss', ts.toFixed(3), '-i', filePath);
      filters.push(
        '[' + i + ':v:0]scale=' + SPRITE_TILE_W + ':' + SPRITE_TILE_H +
        ':force_original_aspect_ratio=decrease:flags=fast_bilinear,' +
        'pad=' + SPRITE_TILE_W + ':' + SPRITE_TILE_H + ':(ow-iw)/2:(oh-ih)/2:color=#111214[v' + i + ']'
      );
      stackInputs += '[v' + i + ']';
    }
    var filterComplex = filters.join(';') + ';' + stackInputs +
      'hstack=inputs=' + count + ',scale=iw:ih:out_range=full,format=yuvj420p[out]';
    args.push(
      '-filter_complex', filterComplex,
      '-map', '[out]',
      '-frames:v', '1',
      '-strict', 'unofficial',
      '-q:v', '6',
      '-f', 'image2',
      '-y', outPath
    );
    return { args: args, count: count, tileW: SPRITE_TILE_W, tileH: SPRITE_TILE_H };
  }

  function parseFps(str) {
    var s = String(str || '');
    if (s.indexOf('/') !== -1) {
      var parts = s.split('/');
      var a = Number(parts[0]), b = Number(parts[1]);
      return b > 0 ? Math.round((a / b) * 1000) / 1000 : 0;
    }
    var n = Number(s);
    return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
  }

  /* Pure Node.js fast extractor for Adobe Illustrator / EPS embedded XMP JPEG thumbnails (<3ms) */
  function extractXmpJpegFromText(text) {
    if (!text) return null;
    var m = text.match(/<(?:xmpGImg|xapGImg):image[^>]*>([\s\S]*?)<\/(?:xmpGImg|xapGImg):image>/i);
    if (!m || !m[1]) return null;
    var b64 = m[1].replace(/&#xA;|&#10;|&#13;|\s+/gi, '');
    if (b64.length < 160) return null;
    try {
      var buf = Buffer.from(b64, 'base64');
      /* Verify JPEG SOI magic bytes (FF D8 FF) */
      if (buf.length > 200 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
        return buf;
      }
    } catch (_) {}
    return null;
  }

  function extractXmpThumbnail(fsMod, filePath) {
    if (!fsMod || !filePath) return null;
    var fd = -1;
    try {
      var st = fsMod.statSync(filePath);
      if (!st.isFile() || st.size < 200) return null;
      var chunk = Math.min(st.size, 512 * 1024);
      fd = fsMod.openSync(filePath, 'r');
      var headBuf = Buffer.alloc(chunk);
      fsMod.readSync(fd, headBuf, 0, chunk, 0);
      var hit = extractXmpJpegFromText(headBuf.toString('latin1'));
      if (hit) return hit;
      if (st.size > chunk) {
        var tailStart = Math.max(0, st.size - chunk);
        var tailBuf = Buffer.alloc(st.size - tailStart);
        fsMod.readSync(fd, tailBuf, 0, tailBuf.length, tailStart);
        return extractXmpJpegFromText(tailBuf.toString('latin1'));
      }
    } catch (_) {
      return null;
    } finally {
      if (fd >= 0) {
        try { fsMod.closeSync(fd); } catch (_2) {}
      }
    }
    return null;
  }

  class ThumbEngine {
    constructor(options) {
      var opts = options || {};
      this.fs = opts.fs || U.nodeRequire('fs');
      this.path = opts.path || U.nodeRequire('path');
      this.os = opts.os || U.nodeRequire('os');
      this.crypto = opts.crypto || U.nodeRequire('crypto');
      this.cp = opts.cp || U.nodeRequire('child_process');
      this.extensionRoot = opts.extensionRoot ? U.uriToPath(opts.extensionRoot) : '';
      if (this.extensionRoot && this.path) {
        this.extensionRoot = this.path.normalize(this.extensionRoot);
      }
      this.maxConcurrency = opts.maxConcurrency || 4;

      this.cacheDir = '';
      this.ffmpegBin = '';
      this.ffprobeBin = '';
      this.ffmpegChecked = false;
      this.ffmpegReady = false;

      this.epoch = 0;
      this.activeCount = 0;
      this.queue = [];
      this.inFlight = new Map();
      this.memThumb = new Map();
      this.memSprite = new Map();
      this.spriteInFlight = new Map();
      this.probeCache = new Map();
      this.objectUrls = [];

      this._initCacheDir();
    }

    _initCacheDir() {
      if (!this.fs || !this.path || !this.os) return;
      try {
        var dir = this.path.join(this.os.tmpdir(), 'PrBinViewCache');
        this.fs.mkdirSync(dir, { recursive: true });
        this.cacheDir = dir;
      } catch (_) {
        this.cacheDir = '';
      }
    }

    async init() {
      if (this.ffmpegChecked) return this.ffmpegReady;
      this.ffmpegChecked = true;
      if (!this.cp || !this.path || !this.fs) {
        this.ffmpegReady = false;
        return false;
      }
      var proc = U.nodeProcess ? U.nodeProcess() : (typeof process !== 'undefined' ? process : null);
      var exe = (proc && proc.platform === 'win32') ? '.exe' : '';
      var candidates = [];
      if (this.extensionRoot) {
        candidates.push(this.path.join(this.extensionRoot, 'bin', 'ffmpeg' + exe));
      }
      if (proc && proc.env && proc.env.PRBINVIEW_FFMPEG) {
        candidates.push(proc.env.PRBINVIEW_FFMPEG);
      }
      candidates.push('ffmpeg' + exe);
      if (exe) {
        candidates.push('C:\\ffmpeg\\bin\\ffmpeg.exe');
      }

      for (var i = 0; i < candidates.length; i++) {
        var bin = candidates[i];
        try {
          await this._exec(bin, ['-version'], 3500);
          this.ffmpegBin = bin;
          var dir = this.path.dirname(bin);
          if (typeof process !== 'undefined' && process.env && process.env.PRBINVIEW_FFPROBE) {
            this.ffprobeBin = process.env.PRBINVIEW_FFPROBE;
          } else if (dir && dir !== '.') {
            this.ffprobeBin = this.path.join(dir, 'ffprobe' + exe);
          } else {
            this.ffprobeBin = 'ffprobe' + exe;
          }
          this.ffmpegReady = true;
          return true;
        } catch (_) {}
      }
      this.ffmpegReady = false;
      return false;
    }

    _exec(bin, args, timeoutMs) {
      var self = this;
      return new Promise(function (resolve, reject) {
        self.cp.execFile(
          bin,
          args,
          { windowsHide: true, timeout: timeoutMs || 15000, maxBuffer: 2 * 1024 * 1024 },
          function (err, stdout, stderr) {
            if (err) reject(new Error(String(stderr || err.message || err).slice(0, 300)));
            else resolve(stdout);
          }
        );
      });
    }

    cancelPending() {
      this.epoch += 1;
      for (var i = 0; i < this.queue.length; i++) {
        var job = this.queue[i];
        this.inFlight.delete(job.cacheKey);
        job.resolve(null);
      }
      this.queue.length = 0;
    }

    peekThumb(node) {
      if (!node) return null;
      if (node.demoThumb) return { url: node.demoThumb, instant: true };
      if (!node.path || node.offline || node.isBin || node.isSeq || node.kind === 'audio') return null;
      var ext = node.ext || U.extOf(node.path);
      if (U.isUnsupportedPreviewExt(ext)) return null;
      var k = U.normKey(node.path);
      if (this.memThumb.has(k)) return this.memThumb.get(k);
      return null;
    }

    requestThumb(node, priority) {
      var self = this;
      if (!node) return Promise.resolve(null);
      var instant = this.peekThumb(node);
      if (instant) return Promise.resolve(instant);
      if (!node.path || node.offline || node.isBin || node.isSeq || node.kind === 'audio') {
        return Promise.resolve(null);
      }
      var ext = node.ext || U.extOf(node.path);
      if (U.isUnsupportedPreviewExt(ext)) return Promise.resolve(null);

      var k = U.normKey(node.path);
      if (this.inFlight.has(k)) return this.inFlight.get(k);

      var jobEpoch = this.epoch;
      var promise = new Promise(function (resolve) {
        var job = {
          node: node,
          ext: ext,
          cacheKey: k,
          epoch: jobEpoch,
          resolve: resolve
        };
        if (priority) self.queue.unshift(job);
        else self.queue.push(job);
        self._pump();
      });
      this.inFlight.set(k, promise);
      return promise;
    }

    _pump() {
      var self = this;
      var limit = this.ffmpegReady ? this.maxConcurrency : Math.min(this.maxConcurrency, 2);
      while (this.activeCount < limit && this.queue.length > 0) {
        var job = this.queue.shift();
        if (job.epoch !== this.epoch) {
          this.inFlight.delete(job.cacheKey);
          job.resolve(null);
          continue;
        }
        this.activeCount += 1;
        this._runJob(job).then(function (result) {
          self.activeCount -= 1;
          self.inFlight.delete(job.cacheKey);
          if (result && result.url) {
            self.memThumb.set(job.cacheKey, result);
          }
          job.resolve(result);
          self._pump();
        }).catch(function () {
          self.activeCount -= 1;
          self.inFlight.delete(job.cacheKey);
          job.resolve(null);
          self._pump();
        });
      }
    }

    async _runJob(job) {
      var filePath = job.node.path;
      var ext = job.ext;
      var stat = null;
      if (this.fs) {
        try {
          stat = this.fs.statSync(filePath);
          if (!stat.isFile()) return null;
        } catch (_) {
          return null;
        }
      }

      /* Tier 1: Small standard web images load directly via native Chromium file:// (0ms) */
      if (U.isWebImageExt(ext)) {
        if (!stat || stat.size < LARGE_WEB_IMAGE_BYTES || ext === 'svg' || ext === 'gif') {
          return { url: U.pathToFileUrl(filePath), direct: true };
        }
      }

      /* Tier 2: Check persistent tiny JPEG / PNG disk cache */
      var hash = makeHashKey(this.crypto, filePath, stat ? stat.size : 0, stat ? stat.mtimeMs : 0);
      var thumbPath = this.cacheDir ? this.path.join(this.cacheDir, 't_' + hash + '.jpg') : '';
      var pngThumbPath = this.cacheDir ? this.path.join(this.cacheDir, 't_' + hash + '.png') : '';
      if (this.fs) {
        var cachedCandidates = [thumbPath, pngThumbPath];
        for (var ci = 0; ci < cachedCandidates.length; ci++) {
          if (!cachedCandidates[ci]) continue;
          try {
            var tStat = this.fs.statSync(cachedCandidates[ci]);
            if (tStat.isFile() && tStat.size > 120) {
              return { url: U.pathToFileUrl(cachedCandidates[ci]), cached: true };
            }
          } catch (_) {}
        }
      }

      /* Tier 2.5: Vector formats (.ai / .pdf / .eps): WinRT PDF (true alpha + smart contrast) <-> XMP JPEG -> Shell thumbnail */
      if (U.isVectorExt(ext)) {
        var vecUrl = await this._extractVectorThumb(filePath, ext, thumbPath, pngThumbPath);
        if (vecUrl) return { url: vecUrl, vector: true };
        return null;
      }

      /* Ensure FFmpeg detection completed */
      if (!this.ffmpegChecked) await this.init();

      /* Tier 3: Fast-seek single-frame FFmpeg extraction (~25-60ms) */
      if (this.ffmpegReady && thumbPath) {
        var ok = await this._extractWithFfmpeg(filePath, thumbPath, job.node.kind === 'video');
        if (ok) {
          return { url: U.pathToFileUrl(thumbPath), cached: false };
        }
      }

      /* Tier 4: Zero-dependency browser <video>/<canvas> fallback for native web formats */
      if (job.node.kind === 'image' && U.isWebImageExt(ext)) {
        return { url: U.pathToFileUrl(filePath), direct: true };
      }
      if (job.node.kind === 'video' && U.isNativeVideoExt(ext) && typeof document !== 'undefined') {
        var fallbackUrl = await this._extractWithCanvas(filePath, thumbPath);
        if (fallbackUrl) return { url: fallbackUrl, fallback: true };
      }

      return null;
    }

    async _extractVectorThumb(filePath, ext, jpgOutPath, pngOutPath) {
      var self = this;

      function tryXmp() {
        if (!jpgOutPath || !self.fs) return '';
        var xmpBuf = extractXmpThumbnail(self.fs, filePath);
        if (!xmpBuf) return '';
        try {
          var tmpJpg = jpgOutPath + '.' + Math.random().toString(36).slice(2, 7) + '.tmp.jpg';
          self.fs.writeFileSync(tmpJpg, xmpBuf);
          self.fs.renameSync(tmpJpg, jpgOutPath);
          return U.pathToFileUrl(jpgOutPath);
        } catch (_) {
          return '';
        }
      }

      async function tryWinHelper() {
        var proc = U.nodeProcess ? U.nodeProcess() : (typeof process !== 'undefined' ? process : null);
        if (!pngOutPath || !self.cp || !self.fs || !self.path || !self.extensionRoot) return '';
        if (!proc || proc.platform !== 'win32') return '';
        var helper = self.path.join(self.extensionRoot, 'helpers', 'render-vector.ps1');
        if (!self.fs.existsSync(helper)) return '';
        var psBin = 'powershell.exe';
        try {
          var sysRoot = proc.env && (proc.env.SystemRoot || proc.env.windir);
          if (sysRoot) {
            var fullPs = self.path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
            if (self.fs.existsSync(fullPs)) psBin = fullPs;
          }
        } catch (_) {}
        var tmpPng = pngOutPath + '.' + Math.random().toString(36).slice(2, 7) + '.tmp.png';
        try {
          await self._exec(psBin, [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
            '-File', helper,
            '-InputPath', filePath,
            '-OutputPath', tmpPng,
            '-MaxSize', String(THUMB_MAX_DIM)
          ], 15000);
          if (self.fs.existsSync(tmpPng) && self.fs.statSync(tmpPng).size > 120) {
            self.fs.renameSync(tmpPng, pngOutPath);
            return U.pathToFileUrl(pngOutPath);
          }
        } catch (_) {
          try { if (self.fs.existsSync(tmpPng)) self.fs.unlinkSync(tmpPng); } catch (_2) {}
        }
        return '';
      }

      /* .eps is PostScript (not PDF): try embedded XMP JPEG first (<3ms), then Windows shell thumbnail */
      if (String(ext || '').toLowerCase() === 'eps') {
        var epsXmp = tryXmp();
        if (epsXmp) return epsXmp;
        return await tryWinHelper();
      }

      /* .ai / .pdf: WinRT PDF first so transparent white/dark logos render crisp with true alpha & smart contrast;
         fallback to embedded XMP JPEG for legacy non-PDF .ai files or non-Windows platforms */
      var rendered = await tryWinHelper();
      if (rendered) return rendered;
      return tryXmp();
    }

    async _extractWithFfmpeg(filePath, outPath, isVideo) {
      var tmpPath = outPath + '.' + Math.random().toString(36).slice(2, 7) + '.tmp.jpg';
      var self = this;
      function cleanupTmp() {
        try { if (self.fs.existsSync(tmpPath)) self.fs.unlinkSync(tmpPath); } catch (_) {}
      }
      function commitIfValid() {
        try {
          if (self.fs.existsSync(tmpPath) && self.fs.statSync(tmpPath).size > 120) {
            self.fs.renameSync(tmpPath, outPath);
            return true;
          }
        } catch (_) {}
        cleanupTmp();
        return false;
      }

      if (isVideo) {
        try {
          await this._exec(this.ffmpegBin, buildThumbArgs(filePath, tmpPath, 1.0), 12000);
          if (commitIfValid()) return true;
        } catch (_) {
          cleanupTmp();
        }
      }

      try {
        await this._exec(this.ffmpegBin, buildThumbArgs(filePath, tmpPath, 0), 15000);
        if (commitIfValid()) return true;
      } catch (_) {
        cleanupTmp();
      }
      return false;
    }

    _extractWithCanvas(filePath, outPath) {
      var self = this;
      return new Promise(function (resolve) {
        var v = document.createElement('video');
        v.muted = true;
        v.preload = 'metadata';
        var done = false;
        var timer = null;

        function finish(val) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          try { v.pause(); v.removeAttribute('src'); v.load(); } catch (_) {}
          resolve(val || '');
        }

        timer = setTimeout(function () { finish(''); }, 6000);

        v.addEventListener('error', function () { finish(''); }, { once: true });
        v.addEventListener('loadedmetadata', function () {
          var dur = Number(v.duration) || 0;
          var seekTo = dur > 0 ? Math.min(1.0, Math.max(0.05, dur * 0.12)) : 0;
          try { v.currentTime = seekTo; } catch (_) { finish(''); }
        }, { once: true });

        v.addEventListener('seeked', function () {
          try {
            var vw = v.videoWidth || 0;
            var vh = v.videoHeight || 0;
            if (!vw || !vh) { finish(''); return; }
            var scale = Math.min(1, THUMB_MAX_DIM / Math.max(vw, vh));
            var cw = Math.max(2, Math.round(vw * scale));
            var ch = Math.max(2, Math.round(vh * scale));
            var canvas = document.createElement('canvas');
            canvas.width = cw;
            canvas.height = ch;
            canvas.getContext('2d').drawImage(v, 0, 0, cw, ch);
            canvas.toBlob(function (blob) {
              if (!blob) { finish(''); return; }
              if (outPath && self.fs && typeof blob.arrayBuffer === 'function') {
                blob.arrayBuffer().then(function (buf) {
                  try {
                    self.fs.writeFileSync(outPath, Buffer.from(buf));
                    finish(U.pathToFileUrl(outPath));
                  } catch (_) {
                    var u = URL.createObjectURL(blob);
                    self.objectUrls.push(u);
                    finish(u);
                  }
                }).catch(function () { finish(''); });
              } else {
                var objUrl = URL.createObjectURL(blob);
                self.objectUrls.push(objUrl);
                finish(objUrl);
              }
            }, 'image/jpeg', 0.78);
          } catch (_) {
            finish('');
          }
        }, { once: true });

        v.src = U.pathToFileUrl(filePath);
        try { v.load(); } catch (_) { finish(''); }
      });
    }

    async requestSprite(node) {
      if (!node || !node.path || node.offline || node.kind !== 'video') return null;
      var k = U.normKey(node.path);
      if (this.memSprite.has(k)) return this.memSprite.get(k);
      if (this.spriteInFlight.has(k)) return this.spriteInFlight.get(k);
      if (!this.ffmpegChecked) await this.init();
      if (!this.ffmpegReady || !this.cacheDir || !this.fs) return null;

      var self = this;
      var p = (async function () {
        var stat;
        try {
          stat = self.fs.statSync(node.path);
          if (!stat.isFile()) return null;
        } catch (_) { return null; }

        var hash = makeHashKey(self.crypto, node.path, stat.size, stat.mtimeMs);
        var spritePath = self.path.join(self.cacheDir, 's_' + hash + '.jpg');
        var metaPath = self.path.join(self.cacheDir, 's_' + hash + '.json');

        try {
          if (self.fs.existsSync(spritePath) && self.fs.existsSync(metaPath) && self.fs.statSync(spritePath).size > 200) {
            var meta = JSON.parse(self.fs.readFileSync(metaPath, 'utf8'));
            var cached = {
              url: U.pathToFileUrl(spritePath),
              frames: meta.frames || SPRITE_FRAMES,
              tileW: meta.tileW || SPRITE_TILE_W,
              tileH: meta.tileH || SPRITE_TILE_H,
              duration: meta.duration || 0
            };
            self.memSprite.set(k, cached);
            return cached;
          }
        } catch (_) {}

        var info = await self.probeMedia(node.path);
        var duration = (info && info.duration > 0) ? info.duration : 0;
        if (duration <= 0.4) return null;

        var wanted = duration < 3 ? Math.max(3, Math.ceil(duration * 2)) : SPRITE_FRAMES;
        var tmpPath = spritePath + '.tmp.jpg';
        var built = buildSpriteArgs(node.path, tmpPath, duration, wanted);
        try {
          await self._exec(self.ffmpegBin, built.args, 20000);
          if (self.fs.existsSync(tmpPath) && self.fs.statSync(tmpPath).size > 200) {
            self.fs.renameSync(tmpPath, spritePath);
            var outMeta = { frames: built.count, tileW: built.tileW, tileH: built.tileH, duration: duration };
            try { self.fs.writeFileSync(metaPath, JSON.stringify(outMeta)); } catch (_) {}
            var res = Object.assign({ url: U.pathToFileUrl(spritePath) }, outMeta);
            self.memSprite.set(k, res);
            return res;
          }
        } catch (_) {
          try { if (self.fs.existsSync(tmpPath)) self.fs.unlinkSync(tmpPath); } catch (_2) {}
        }
        return null;
      })();

      this.spriteInFlight.set(k, p);
      try {
        return await p;
      } finally {
        this.spriteInFlight.delete(k);
      }
    }

    async probeMedia(filePath) {
      if (!filePath) return null;
      var k = U.normKey(filePath);
      if (this.probeCache.has(k)) return this.probeCache.get(k);
      var base = { bytes: 0, duration: 0, width: 0, height: 0, fps: 0, codec: '', pixFmt: '', colorSpace: '', audioCodec: '', channels: 0, sampleRate: 0, container: '' };
      if (this.fs) {
        try {
          var st = this.fs.statSync(filePath);
          if (st.isFile()) base.bytes = st.size;
        } catch (_) {}
      }
      if (!this.ffmpegChecked) await this.init();
      if (this.ffmpegReady && this.ffprobeBin) {
        try {
          var raw = await this._exec(this.ffprobeBin, [
            '-v', 'error',
            '-show_entries', 'stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,pix_fmt,color_space,channels,sample_rate,duration:format=duration,size,bit_rate,format_name',
            '-of', 'json',
            filePath
          ], 10000);
          var parsed = JSON.parse(raw);
          var streams = parsed.streams || [];
          var fmt = parsed.format || {};
          var v = streams.find(function (s) { return s.codec_type === 'video'; }) || {};
          var a = streams.find(function (s) { return s.codec_type === 'audio'; }) || {};
          base.duration = Number(v.duration) || Number(fmt.duration) || 0;
          base.bytes = Number(fmt.size) || base.bytes;
          base.container = fmt.format_name || '';
          base.width = Number(v.width) || 0;
          base.height = Number(v.height) || 0;
          base.fps = parseFps(v.avg_frame_rate) || parseFps(v.r_frame_rate);
          base.codec = v.codec_name || '';
          base.pixFmt = v.pix_fmt || '';
          base.colorSpace = v.color_space || '';
          base.audioCodec = a.codec_name || '';
          base.channels = Number(a.channels) || 0;
          base.sampleRate = Number(a.sample_rate) || 0;
        } catch (_) {}
      }
      this.probeCache.set(k, base);
      return base;
    }

    pruneOldCache() {
      if (!this.cacheDir || !this.fs || !this.path) return;
      try {
        var names = this.fs.readdirSync(this.cacheDir);
        var entries = [];
        var now = Date.now();
        var totalBytes = 0;
        for (var i = 0; i < names.length; i++) {
          var full = this.path.join(this.cacheDir, names[i]);
          try {
            var st = this.fs.statSync(full);
            if (!st.isFile()) continue;
            if (now - st.mtimeMs > CACHE_MAX_AGE_MS) {
              this.fs.unlinkSync(full);
              continue;
            }
            totalBytes += st.size;
            entries.push({ full: full, size: st.size, mtime: st.mtimeMs });
          } catch (_) {}
        }
        if (totalBytes > CACHE_MAX_BYTES) {
          entries.sort(function (a, b) { return a.mtime - b.mtime; });
          for (var j = 0; j < entries.length && totalBytes > CACHE_MAX_BYTES * 0.75; j++) {
            try {
              this.fs.unlinkSync(entries[j].full);
              totalBytes -= entries[j].size;
            } catch (_) {}
          }
        }
      } catch (_) {}
    }

    invalidatePath(filePath) {
      if (!filePath) return;
      var k = U.normKey(filePath);
      this.memThumb.delete(k);
      this.memSprite.delete(k);
      this.probeCache.delete(k);
    }

    invalidateMemory() {
      this.memThumb.clear();
      this.memSprite.clear();
      this.probeCache.clear();
    }

    clearCache() {
      this.memThumb.clear();
      this.memSprite.clear();
      this.probeCache.clear();
      var removed = 0;
      if (this.cacheDir && this.fs && this.path) {
        try {
          var names = this.fs.readdirSync(this.cacheDir);
          for (var i = 0; i < names.length; i++) {
            try {
              this.fs.unlinkSync(this.path.join(this.cacheDir, names[i]));
              removed++;
            } catch (_) {}
          }
        } catch (_) {}
      }
      return removed;
    }

    getCacheStats() {
      var files = 0;
      var bytes = 0;
      if (this.cacheDir && this.fs && this.path) {
        try {
          var names = this.fs.readdirSync(this.cacheDir);
          for (var i = 0; i < names.length; i++) {
            try {
              var st = this.fs.statSync(this.path.join(this.cacheDir, names[i]));
              if (st.isFile()) { files++; bytes += st.size; }
            } catch (_) {}
          }
        } catch (_) {}
      }
      return { files: files, bytes: bytes, dir: this.cacheDir, ffmpeg: this.ffmpegReady };
    }

    dispose() {
      this.cancelPending();
      for (var i = 0; i < this.objectUrls.length; i++) {
        try { URL.revokeObjectURL(this.objectUrls[i]); } catch (_) {}
      }
      this.objectUrls.length = 0;
    }
  }

  var api = {
    ThumbEngine: ThumbEngine,
    makeHashKey: makeHashKey,
    buildThumbArgs: buildThumbArgs,
    buildSpriteArgs: buildSpriteArgs,
    extractXmpJpegFromText: extractXmpJpegFromText,
    extractXmpThumbnail: extractXmpThumbnail
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PrThumbEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
