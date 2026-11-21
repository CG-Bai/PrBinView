'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var crypto = require('node:crypto');
var T = require('../PrBinView/js/thumb-engine.js');

test('makeHashKey is deterministic and reacts to path/size/mtime changes', function () {
  var a = T.makeHashKey(crypto, 'D:\\Footage\\Clip.mp4', 1024, 1700000000);
  var b = T.makeHashKey(crypto, 'd:/footage/clip.mp4', 1024, 1700000000);
  var c = T.makeHashKey(crypto, 'D:\\Footage\\Clip.mp4', 2048, 1700000000);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.length, 16);
});

test('buildThumbArgs puts fast -ss before -i and includes FFmpeg 9 full-range JPEG flags', function () {
  var args = T.buildThumbArgs('D:/a.mp4', 'C:/tmp/out.jpg', 1.0);
  var ssIdx = args.indexOf('-ss');
  var iIdx = args.indexOf('-i');
  assert.ok(ssIdx !== -1 && iIdx !== -1 && ssIdx < iIdx, '-ss must precede -i for fast keyframe seek');
  var vf = args[args.indexOf('-vf') + 1];
  assert.ok(vf.includes('out_range=full'));
  assert.ok(vf.includes('yuvj420p'));
  assert.ok(args.includes('-strict') && args.includes('unofficial'));
});

test('buildSpriteArgs builds N fast-seek inputs with hstack filter_complex', function () {
  var built = T.buildSpriteArgs('D:/movie.mxf', 'C:/tmp/s.jpg', 120, 8);
  assert.equal(built.count, 8);
  var ssCount = built.args.filter(function (a) { return a === '-ss'; }).length;
  assert.equal(ssCount, 8);
  var fc = built.args[built.args.indexOf('-filter_complex') + 1];
  assert.ok(fc.includes('hstack=inputs=8'));
});

test('ThumbEngine cancels queued old-folder jobs immediately on folder switch and fast-paths small web images', async function () {
  var mockFs = {
    mkdirSync: function () {},
    statSync: function (p) {
      if (p.endsWith('.png')) return { isFile: function () { return true; }, size: 250000, mtimeMs: 1000 };
      if (p.endsWith('.mp4')) return { isFile: function () { return true; }, size: 5000000, mtimeMs: 1000 };
      throw new Error('ENOENT');
    },
    existsSync: function () { return false; }
  };

  var engine = new T.ThumbEngine({
    fs: mockFs,
    path: require('node:path'),
    os: require('node:os'),
    crypto: crypto,
    cp: null,
    maxConcurrency: 1
  });
  engine.ffmpegChecked = true;
  engine.ffmpegReady = false;

  /* Direct small web image resolves immediately to file:// URL */
  var imgRes = await engine.requestThumb({ id: 'i1', kind: 'image', ext: 'png', path: 'D:/img/test.png' }, true);
  assert.equal(imgRes.direct, true);
  assert.equal(imgRes.url, 'file:///D:/img/test.png');

  /* Simulate busy worker + queued jobs -> cancelPending drops queued jobs immediately */
  engine.activeCount = 1;
  var p1 = engine.requestThumb({ id: 'v1', kind: 'video', ext: 'mp4', path: 'D:/old/1.mp4' }, false);
  var p2 = engine.requestThumb({ id: 'v2', kind: 'video', ext: 'mp4', path: 'D:/old/2.mp4' }, false);
  assert.equal(engine.queue.length, 2);

  engine.cancelPending();
  assert.equal(engine.queue.length, 0);
  assert.equal(await p1, null);
  assert.equal(await p2, null);
});

test('extractXmpJpegFromText decodes Illustrator XMP JPEG with &#xA; breaks and rejects non-JPEG data', function () {
  var fakeJpeg = Buffer.alloc(240, 0x22);
  fakeJpeg[0] = 0xff; fakeJpeg[1] = 0xd8; fakeJpeg[2] = 0xff;
  var b64 = fakeJpeg.toString('base64');
  var withBreaks = b64.slice(0, 40) + '&#xA;' + b64.slice(40, 90) + '\n' + b64.slice(90);
  var xmp = '<rdf:li><xmpGImg:format>JPEG</xmpGImg:format><xmpGImg:image>' + withBreaks + '</xmpGImg:image></rdf:li>';

  var out = T.extractXmpJpegFromText(xmp);
  assert.ok(out);
  assert.equal(out.length, 240);
  assert.equal(out[0], 0xff);
  assert.equal(out[1], 0xd8);
  assert.equal(out[2], 0xff);

  var bad = T.extractXmpJpegFromText('<xmpGImg:image>not-a-jpeg-header</xmpGImg:image>');
  assert.equal(bad, null);
});

test('parseFfmpegInfo and probeMedia work with single ffmpeg.exe (no ffprobe.exe required)', async function () {
  var sampleMp4 = [
    "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.mp4':",
    '  Duration: 00:01:23.45, start: 0.000000, bitrate: 15234 kb/s',
    '  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 3840x2160 [SAR 1:1 DAR 16:9], 15000 kb/s, 25 fps, 25 tbr, 12800 tbn (default)',
    '  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 192 kb/s (default)'
  ].join('\n');

  var parsed = T.parseFfmpegInfo(sampleMp4);
  assert.equal(parsed.duration, 83.45);
  assert.equal(parsed.width, 3840);
  assert.equal(parsed.height, 2160);
  assert.equal(parsed.fps, 25);
  assert.equal(parsed.vCodec, 'h264');
  assert.equal(parsed.pixFmt, 'yuv420p');
  assert.equal(parsed.aCodec, 'aac');
  assert.equal(parsed.aChannels, 2);
  assert.equal(parsed.aRate, 48000);

  var sampleMxf = [
    "Input #0, mxf, from 'shot.mxf':",
    '  Duration: 00:00:42.80, start: 0.000000, bitrate: 112000 kb/s',
    '  Stream #0:0: Video: prores (HQ) (apch / 0x68637061), yuv422p10le(tv, bt709), 1920x1080, 29.97 fps, 29.97 tbr, 29.97 tbn',
    '  Stream #0:1: Audio: pcm_s24le, 48000 Hz, 4 channels, s32 (24 bit), 4608 kb/s'
  ].join('\n');

  var p2 = T.parseFfmpegInfo(sampleMxf);
  assert.equal(p2.duration, 42.8);
  assert.equal(p2.vCodec, 'prores');
  assert.equal(p2.pixFmt, 'yuv422p10le');
  assert.equal(p2.fps, 29.97);
  assert.equal(p2.aCodec, 'pcm_s24le');
  assert.equal(p2.aChannels, 4);

  /* Verify ThumbEngine.probeMedia uses ffmpeg -i cleanly when ffprobe is absent */
  var mockCp = {
    execFile: function (bin, args, opts, cb) {
      assert.equal(bin, 'C:\\PrBinView\\bin\\ffmpeg.exe');
      assert.ok(args.includes('-i'));
      cb(new Error('exit 1'), '', sampleMp4);
    }
  };
  var mockFs = {
    mkdirSync: function () {},
    statSync: function () { return { isFile: function () { return true; }, size: 12345678, mtimeMs: 1000 }; },
    existsSync: function () { return false; }
  };
  var engine = new T.ThumbEngine({
    fs: mockFs,
    path: require('node:path'),
    os: require('node:os'),
    crypto: crypto,
    cp: mockCp
  });
  engine.ffmpegChecked = true;
  engine.ffmpegReady = true;
  engine.ffmpegBin = 'C:\\PrBinView\\bin\\ffmpeg.exe';
  engine.ffprobeBin = '';
  engine.ffprobeReady = false;

  var probed = await engine.probeMedia('D:\\Footage\\clip.mp4');
  assert.equal(probed.size, 12345678);
  assert.equal(probed.width, 3840);
  assert.equal(probed.height, 2160);
  assert.equal(probed.duration, 83.45);
  assert.equal(probed.vCodec, 'h264');
  assert.equal(probed.aCodec, 'aac');
});
