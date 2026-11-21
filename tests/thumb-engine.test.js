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
