'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');

var JSX_PATH = path.resolve(__dirname, '..', 'PrBinView', 'jsx', 'host.jsx');
var jsxSource = fs.readFileSync(JSX_PATH, 'utf8');

function createMockPremiereSandbox() {
  var nextId = 100;
  var ProjectItemType = { CLIP: 1, BIN: 2, ROOT: 3, FILE: 4 };

  function makeChildren(arr) {
    var obj = {
      get numItems() { return arr.length; },
      _arr: arr
    };
    return new Proxy(obj, {
      get: function (target, prop) {
        if (prop === 'numItems' || prop === '_arr') return target[prop];
        var idx = Number(prop);
        if (Number.isInteger(idx)) return arr[idx];
        return target[prop];
      }
    });
  }

  function makeItem(opts) {
    var kids = [];
    var item = {
      nodeId: opts.nodeId || String(++nextId),
      name: opts.name,
      type: opts.type,
      treePath: opts.treePath || ('/' + opts.name),
      _mediaPath: opts.mediaPath || '',
      _isSeq: !!opts.isSeq,
      _offline: !!opts.offline,
      _label: opts.label || 0,
      _parent: null,
      _inCleared: false,
      _outCleared: false,
      _refreshed: false,
      children: makeChildren(kids),
      isSequence: function () { return item._isSeq; },
      getMediaPath: function () { return item._mediaPath; },
      isOffline: function () { return item._offline; },
      getColorLabel: function () { return item._label; },
      setColorLabel: function (idx) { item._label = idx; return 0; },
      clearInPoint: function () { item._inCleared = true; },
      clearOutPoint: function () { item._outCleared = true; },
      refreshMedia: function () { item._refreshed = true; return 0; },
      canChangeMediaPath: function () { return !item._isSeq; },
      changeMediaPath: function (p) { item._mediaPath = p; item._offline = false; return true; },
      hasProxy: function () { return false; },
      getProxyPath: function () { return ''; },
      getInPoint: function () { return { seconds: 1.5 }; },
      getOutPoint: function () { return { seconds: 10.5 }; },
      getProjectMetadata: function () {
        return '<rdf:Description premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase="25.00 fps">' +
          '<premierePrivateProjectMetaData:Column.Intrinsic.MediaStart>00:00:00:00</premierePrivateProjectMetaData:Column.Intrinsic.MediaStart>' +
          '<premierePrivateProjectMetaData:Column.Intrinsic.MediaEnd>00:00:03:12</premierePrivateProjectMetaData:Column.Intrinsic.MediaEnd>' +
          '<premierePrivateProjectMetaData:Column.Intrinsic.MediaDuration>00:00:03:13</premierePrivateProjectMetaData:Column.Intrinsic.MediaDuration>' +
          '<premierePrivateProjectMetaData:Column.Intrinsic.VideoInPoint>00:00:00:00</premierePrivateProjectMetaData:Column.Intrinsic.VideoInPoint>' +
          '<premierePrivateProjectMetaData:Column.Intrinsic.VideoOutPoint>00:00:03:12</premierePrivateProjectMetaData:Column.Intrinsic.VideoOutPoint>' +
          '<premierePrivateProjectMetaData:Column.Intrinsic.VideoDuration>00:00:03:13</premierePrivateProjectMetaData:Column.Intrinsic.VideoDuration>' +
          '<premierePrivateProjectMetaData:Column.Intrinsic.VideoInfo>1920 x 1080</premierePrivateProjectMetaData:Column.Intrinsic.VideoInfo>' +
          '<premierePrivateProjectMetaData:Column.Intrinsic.AudioInfo>48000 Hz - Compressed - Stereo</premierePrivateProjectMetaData:Column.Intrinsic.AudioInfo>' +
          '</rdf:Description>';
      },
      createBin: function (name) {
        var b = makeItem({ name: name, type: ProjectItemType.BIN });
        b._parent = item;
        kids.push(b);
        return b;
      },
      moveBin: function (dest) {
        if (item._parent) {
          var arr = item._parent.children._arr;
          var pos = arr.indexOf(item);
          if (pos !== -1) arr.splice(pos, 1);
        }
        item._parent = dest;
        dest.children._arr.push(item);
        return 0;
      },
      deleteBin: function () {
        if (item._parent) {
          var arr = item._parent.children._arr;
          var pos = arr.indexOf(item);
          if (pos !== -1) arr.splice(pos, 1);
        }
        kids.length = 0;
        return 0;
      },
      _addChild: function (child) {
        child._parent = item;
        kids.push(child);
        return child;
      }
    };
    return item;
  }

  var rootItem = makeItem({ nodeId: '1', name: 'TestProject.prproj', type: ProjectItemType.ROOT });
  var binFootage = rootItem._addChild(makeItem({ nodeId: '2', name: '01_实拍', type: ProjectItemType.BIN, label: 4 }));
  var clipVideo = binFootage._addChild(makeItem({ nodeId: '3', name: '镜头 "A"\\01.mp4', type: ProjectItemType.CLIP, mediaPath: 'D:\\素材\\A.mp4', label: 4 }));
  var clipAudio = binFootage._addChild(makeItem({ nodeId: '4', name: 'BGM.wav', type: ProjectItemType.CLIP, mediaPath: 'D:\\素材\\BGM.wav', label: 5 }));
  var seqItem = rootItem._addChild(makeItem({ nodeId: '5', name: '主序列', type: ProjectItemType.CLIP, isSeq: true, label: 13 }));

  var insertedVideo = [];
  var insertedAudio = [];
  var openedSource = [];
  var openedSeqs = [];
  var selection = [binFootage];
  var boundCallbacks = {};

  var sequencesArr = [{ sequenceID: 'seq-guid-5', name: '主序列', projectItem: seqItem }];
  var sequencesProxy = new Proxy({ get numSequences() { return sequencesArr.length; } }, {
    get: function (t, p) {
      if (p === 'numSequences') return sequencesArr.length;
      var idx = Number(p);
      return Number.isInteger(idx) ? sequencesArr[idx] : t[p];
    }
  });

  function makeTracks(logArr) {
    var tracks = [{
      isTargeted: function () { return true; },
      isLocked: function () { return false; },
      insertClip: function (it, pos) { logArr.push({ op: 'insert', id: it.nodeId, pos: pos.seconds }); },
      overwriteClip: function (it, pos) { logArr.push({ op: 'overwrite', id: it.nodeId, pos: pos.seconds }); }
    }];
    return new Proxy({ numTracks: 1 }, {
      get: function (t, p) { return p === 'numTracks' ? 1 : (Number.isInteger(Number(p)) ? tracks[Number(p)] : t[p]); }
    });
  }

  var app = {
    bind: function (ev, fn) { boundCallbacks[ev] = fn; },
    getProjectViewIDs: function () { return ['view-1']; },
    getProjectFromViewID: function () { return app.project; },
    getProjectViewSelection: function () { return selection.slice(); },
    setProjectViewSelection: function (items) { selection = items.slice(); },
    sourceMonitor: {
      openProjectItem: function (it) { openedSource.push({ id: it.nodeId, play: false }); return true; },
      play: function (speed) { openedSource.push({ playSpeed: speed }); return true; }
    },
    project: {
      documentID: 'doc-uuid-1',
      name: 'TestProject.prproj',
      path: 'D:\\Projects\\TestProject.prproj',
      rootItem: rootItem,
      sequences: sequencesProxy,
      activeSequence: {
        name: '主序列',
        getPlayerPosition: function () { return { seconds: 12.5 }; },
        videoTracks: makeTracks(insertedVideo),
        audioTracks: makeTracks(insertedAudio)
      },
      openSequence: function (seqId) { openedSeqs.push(seqId); return true; },
      importFiles: function (paths, suppress, targetBin) {
        paths.forEach(function (p) {
          targetBin._addChild(makeItem({ name: path.basename(p), type: ProjectItemType.CLIP, mediaPath: p }));
        });
        return true;
      },
      createNewSequenceFromClips: function (name, clips, targetBin) {
        var si = targetBin._addChild(makeItem({ name: name, type: ProjectItemType.CLIP, isSeq: true }));
        var sq = { sequenceID: 'seq-' + si.nodeId, name: name, projectItem: si };
        sequencesArr.push(sq);
        return sq;
      }
    }
  };

  function MockTime() { this.ticks = '0'; this.seconds = 0; }
  var sandbox = { app: app, ProjectItemType: ProjectItemType, Time: MockTime };
  vm.createContext(sandbox);
  vm.runInContext(jsxSource, sandbox);

  return {
    host: sandbox.PrBinViewHost,
    state: { insertedVideo: insertedVideo, insertedAudio: insertedAudio, openedSource: openedSource, openedSeqs: openedSeqs, boundCallbacks: boundCallbacks, app: app, clipVideo: clipVideo }
  };
}

test('jsx/host.jsx strictly uses ES3-safe constructs (no let/const/arrow/template/JSON)', function () {
  var stripped = jsxSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');

  assert.equal(/\b(let|const)\b/.test(stripped), false, 'Found ES6 let/const in ExtendScript');
  assert.equal(/=>/.test(stripped), false, 'Found ES6 arrow function in ExtendScript');
  assert.equal(/`/.test(stripped), false, 'Found ES6 template literal in ExtendScript');
  assert.equal(/\bJSON\s*\./.test(stripped), false, 'Found native JSON reference in ES3 ExtendScript');
  assert.equal(/,\s*[\}\]]/.test(stripped), false, 'Found trailing comma in ES3 ExtendScript');
});

test('jsx/host.jsx tree scan, selection sync, open, timeline insert, and mutations work end-to-end', function () {
  var env = createMockPremiereSandbox();
  var H = env.host;

  /* pollTick */
  var tick = JSON.parse(H.pollTick({ folderId: '2' }));
  assert.equal(tick.ok, true);
  assert.equal(tick.data.hasProject, true);
  assert.equal(tick.data.folderCount, 2);
  assert.deepEqual(tick.data.sel, ['2']);

  /* getProjectTree with quotes & backslashes escaped cleanly in custom ES3 JSON */
  var tree = JSON.parse(H.getProjectTree());
  assert.equal(tree.ok, true);
  assert.equal(tree.data.nodes.length, 5);
  var vNode = tree.data.nodes.find(function (n) { return n.id === '3'; });
  assert.equal(vNode.name, '镜头 "A"\\01.mp4');
  assert.equal(vNode.path, 'D:\\素材\\A.mp4');
  var sNode = tree.data.nodes.find(function (n) { return n.id === '5'; });
  assert.equal(sNode.seqId, 'seq-guid-5');

  /* selectItems updates Premiere view selection */
  var selRes = JSON.parse(H.selectItems({ ids: ['3', '4'] }));
  assert.equal(selRes.ok, true);
  assert.equal(selRes.data.count, 2);
  assert.deepEqual(JSON.parse(H.pollTick()).data.sel, ['3', '4']);

  /* openItem routes clips to Source Monitor and sequences to openSequence */
  assert.equal(JSON.parse(H.openItem({ id: '3', play: true })).data.opened, 'sourceMonitor');
  assert.equal(env.state.openedSource[0].id, '3');
  assert.equal(env.state.openedSource[1].playSpeed, 1);

  assert.equal(JSON.parse(H.openItem({ id: '5' })).data.opened, 'sequence');
  assert.deepEqual(env.state.openedSeqs, ['seq-guid-5']);

  /* insertToTimeline routes video to videoTracks and audio-only to audioTracks */
  var ins = JSON.parse(H.insertToTimeline({ ids: ['3', '4'], mode: 'insert' }));
  assert.equal(ins.ok, true);
  assert.equal(ins.data.placed, 2);
  assert.equal(env.state.insertedVideo[0].id, '3');
  assert.equal(env.state.insertedAudio[0].id, '4');

  /* createBin, renameItem, setColorLabel, moveItems, removeItems */
  var created = JSON.parse(H.createBin({ parentId: '2', name: '子素材箱' }));
  assert.equal(created.ok, true);
  var subId = created.data.id;

  var ren = JSON.parse(H.renameItem({ id: subId, name: 'B机位' }));
  assert.equal(ren.ok, true);
  assert.equal(ren.data.name, 'B机位');

  /* Cyclic move rejected */
  var badMove = JSON.parse(H.moveItems({ ids: ['2'], targetBinId: subId }));
  assert.equal(badMove.ok, false);

  /* Valid move */
  var mv = JSON.parse(H.moveItems({ ids: ['3'], targetBinId: subId }));
  assert.equal(mv.ok, true);
  assert.equal(mv.data.moved, 1);

  /* Label & details & batch folder metadata */
  assert.equal(JSON.parse(H.setColorLabel({ ids: ['3'], labelIndex: 7 })).ok, true);
  var det = JSON.parse(H.getItemDetails({ id: '3' }));
  assert.equal(det.data.label, 7);
  assert.equal(det.data.videoInfo, '1920 x 1080');

  var batchMeta = JSON.parse(H.getFolderMetadata({ ids: ['3', '4', '2'] }));
  assert.equal(batchMeta.ok, true);
  assert.equal(batchMeta.data['3'].fps, '25.00 fps');
  assert.equal(batchMeta.data['3'].mediaStart, '00:00:00:00');
  assert.equal(batchMeta.data['3'].mediaEnd, '00:00:03:12');
  assert.equal(batchMeta.data['3'].mediaDuration, '00:00:03:13');
  assert.equal(batchMeta.data['3'].videoIn, '00:00:00:00');
  assert.equal(batchMeta.data['3'].videoOut, '00:00:03:12');
  assert.equal(batchMeta.data['3'].audioInfo, '48000 Hz - Compressed - Stereo');
  assert.equal(batchMeta.data['2'], undefined);

  /* Remove non-bin clip via temp bin */
  var rm = JSON.parse(H.removeItems({ ids: ['4'] }));
  assert.equal(rm.ok, true);
  assert.equal(rm.data.removed, 1);
  var afterTree = JSON.parse(H.getProjectTree());
  assert.equal(afterTree.data.nodes.some(function (n) { return n.id === '4'; }), false);

  /* onProjectChanged bumps dirtySeq */
  var beforeDirty = JSON.parse(H.pollTick()).data.dirtySeq;
  env.state.boundCallbacks.onProjectChanged();
  assert.equal(JSON.parse(H.pollTick()).data.dirtySeq, beforeDirty + 1);
});

test('jsx/host.jsx reconcileDroppedClips swaps duplicate timeline drop to original colored ProjectItem and removes duplicate', function () {
  var env = createMockPremiereSandbox();
  var H = env.host;
  var app = env.state.app;

  /* Change original clip '3' label to Mango Orange (7) */
  assert.equal(JSON.parse(H.setColorLabel({ ids: ['3'], labelIndex: 7 })).ok, true);

  var beforeTree = JSON.parse(H.getProjectTree());
  var beforeIds = beforeTree.data.nodes.map(function (n) { return n.id; });

  /* Simulate Premiere CEP DnD re-importing a duplicate ProjectItem '999' with default label 0 onto V2/A2 at t=20s */
  var dupClip = {
    nodeId: '999',
    name: 'A.mp4',
    type: 1,
    _mediaPath: 'D:\\素材\\A.mp4',
    _label: 0,
    _parent: app.project.rootItem,
    children: { numItems: 0 },
    isSequence: function () { return false; },
    getMediaPath: function () { return dupClip._mediaPath; },
    isOffline: function () { return false; },
    getColorLabel: function () { return dupClip._label; },
    setColorLabel: function (idx) { dupClip._label = idx; return 0; },
    moveBin: function (dest) {
      var arr = dupClip._parent.children._arr;
      var p = arr.indexOf(dupClip);
      if (p !== -1) arr.splice(p, 1);
      dupClip._parent = dest;
      dest.children._arr.push(dupClip);
      return 0;
    }
  };
  app.project.rootItem.children._arr.push(dupClip);

  var removedCount = 0;
  var seqOverwrites = [];
  var vTrackClips = [
    { projectItem: dupClip, start: { ticks: '5080320000000', seconds: 20 }, remove: function () { removedCount++; } }
  ];
  var aTrackClips = [
    { projectItem: dupClip, start: { ticks: '5080320000000', seconds: 20 }, remove: function () { removedCount++; } }
  ];
  function wrapTrackList(clipArrays) {
    var list = clipArrays.map(function (arr) {
      var clipsProxy = new Proxy({ get numItems() { return arr.length; } }, {
        get: function (t, p) { return p === 'numItems' ? arr.length : (Number.isInteger(Number(p)) ? arr[Number(p)] : t[p]); }
      });
      return { clips: clipsProxy, overwriteClip: function (it, st) { seqOverwrites.push({ it: it, st: st, trackFallback: true }); } };
    });
    return new Proxy({ numTracks: list.length }, {
      get: function (t, p) { return p === 'numTracks' ? list.length : (Number.isInteger(Number(p)) ? list[Number(p)] : t[p]); }
    });
  }

  app.project.activeSequence.videoTracks = wrapTrackList([[], vTrackClips]);
  app.project.activeSequence.audioTracks = wrapTrackList([[], aTrackClips]);
  app.project.activeSequence.overwriteClip = function (origItem, startTime, vIdx, aIdx) {
    seqOverwrites.push({ origId: origItem.nodeId, origLabel: origItem.getColorLabel(), startTicks: String(startTime.ticks || startTime), vIdx: vIdx, aIdx: aIdx });
    return true;
  };

  var res = JSON.parse(H.reconcileDroppedClips({
    beforeIds: beforeIds,
    dragged: [{ id: '3', path: 'D:\\素材\\A.mp4', label: 7 }]
  }));

  assert.equal(res.ok, true);
  assert.equal(res.data.found, 1);
  assert.equal(res.data.swapped, 1);
  assert.equal(res.data.cleaned, 1);
  assert.equal(removedCount, 2);
  assert.equal(seqOverwrites.length, 1);
  assert.equal(seqOverwrites[0].origId, '3');
  assert.equal(seqOverwrites[0].origLabel, 7);
  assert.equal(seqOverwrites[0].startTicks, '5080320000000');
  assert.equal(seqOverwrites[0].vIdx, 1);
  assert.equal(seqOverwrites[0].aIdx, 1);

  /* Duplicate ProjectItem '999' must be gone from the project tree */
  var afterTree = JSON.parse(H.getProjectTree());
  assert.equal(afterTree.data.nodes.some(function (n) { return n.id === '999'; }), false);
  assert.equal(afterTree.data.nodes.some(function (n) { return n.id === '3'; }), true);
});

test('jsx/host.jsx timeline-diff detects and swaps drop even when Premiere creates NO duplicate ProjectItem', function () {
  var env = createMockPremiereSandbox();
  var H = env.host;
  var app = env.state.app;
  var origClip = env.state.clipVideo;

  assert.equal(JSON.parse(H.setColorLabel({ ids: ['3'], labelIndex: 6 })).ok, true);

  var vClips = [];
  var aClips = [];
  var removed = 0;
  var swappedLog = [];

  function wrapTrack(arr) {
    var clipsProxy = new Proxy({ get numItems() { return arr.length; } }, {
      get: function (t, p) { return p === 'numItems' ? arr.length : (Number.isInteger(Number(p)) ? arr[Number(p)] : t[p]); }
    });
    return { clips: clipsProxy, overwriteClip: function (it, tm) { swappedLog.push({ id: it.nodeId, tm: tm }); return true; } };
  }
  function wrapList(tracks) {
    return new Proxy({ numTracks: tracks.length }, {
      get: function (t, p) { return p === 'numTracks' ? tracks.length : (Number.isInteger(Number(p)) ? tracks[Number(p)] : t[p]); }
    });
  }

  app.project.activeSequence.sequenceID = 'seq-1';
  app.project.activeSequence.videoTracks = wrapList([wrapTrack(vClips)]);
  app.project.activeSequence.audioTracks = wrapList([wrapTrack(aClips)]);
  app.project.activeSequence.overwriteClip = function (it, tm, vi, ai) {
    swappedLog.push({ id: it.nodeId, label: it.getColorLabel(), ticks: String(tm.ticks || tm), vi: vi, ai: ai });
    return true;
  };

  /* 1. Capture baseline on mousedown BEFORE drop (timeline empty) */
  var base = JSON.parse(H.captureTimelineBaseline());
  assert.equal(base.ok, true);
  assert.equal(base.data.clips, 0);

  /* 2. Premiere drops clip onto V1/A1 WITHOUT adding a duplicate ProjectItem (reuses nodeId '3') */
  vClips.push({ name: 'A.mp4', projectItem: origClip, start: { ticks: '2540160000000', seconds: 10 }, end: { ticks: '5080320000000', seconds: 20 }, remove: function () { removed++; } });
  aClips.push({ name: 'A.mp4', projectItem: origClip, start: { ticks: '2540160000000', seconds: 10 }, end: { ticks: '5080320000000', seconds: 20 }, remove: function () { removed++; } });

  var beforeIds = JSON.parse(H.getProjectTree()).data.nodes.map(function (n) { return n.id; });
  var res = JSON.parse(H.reconcileDroppedClips({
    beforeIds: beforeIds,
    dragged: [{ id: '3', name: origClip.name, path: 'D:\\素材\\A.mp4', label: 6 }]
  }));

  assert.equal(res.ok, true);
  assert.equal(res.data.foundClips, 2);
  assert.equal(res.data.swapped, 1);
  assert.equal(res.data.cleaned, 0);
  assert.equal(removed, 2);
  assert.equal(swappedLog.length, 1);
  assert.equal(swappedLog[0].id, '3');
  assert.equal(swappedLog[0].label, 6);
  assert.equal(swappedLog[0].ticks, '2540160000000');
  assert.equal(swappedLog[0].vi, 0);
  assert.equal(swappedLog[0].ai, 0);
});

test('jsx/host.jsx importStructure recursively creates bins and imports nested folder media', function () {
  var env = createMockPremiereSandbox();
  var H = env.host;

  var res = JSON.parse(H.importStructure({
    targetBinId: '2',
    files: ['D:\\drop\\single.png'],
    folders: [{
      name: '002-Assets',
      files: ['D:\\drop\\002-Assets\\Background.mp4', 'D:\\drop\\002-Assets\\DM.jpg'],
      dirs: [{
        name: 'SubClips',
        files: ['D:\\drop\\002-Assets\\SubClips\\extra.mov'],
        dirs: []
      }]
    }]
  }));

  assert.equal(res.ok, true);
  assert.equal(res.data.imported, true);
  assert.equal(res.data.importedFiles, 4);
  assert.equal(res.data.createdBins, 2);

  var tree = JSON.parse(H.getProjectTree());
  var assetsBin = tree.data.nodes.find(function (n) { return n.name === '002-Assets' && n.isBin; });
  assert.ok(assetsBin);
  assert.equal(assetsBin.pid, '2');
  var subBin = tree.data.nodes.find(function (n) { return n.name === 'SubClips' && n.isBin; });
  assert.ok(subBin);
  assert.equal(subBin.pid, assetsBin.id);
  var extra = tree.data.nodes.find(function (n) { return n.name === 'extra.mov'; });
  assert.ok(extra);
  assert.equal(extra.pid, subBin.id);
});

test('jsx/host.jsx pollTick detects when startup offline clips finish mounting online', function () {
  var env = createMockPremiereSandbox();
  var H = env.host;
  var clip3 = env.state.app.project.rootItem.children[0].children[0];

  /* Simulate Premiere Pro startup where clip is temporarily marked offline while mounting */
  var offlineFlag = true;
  clip3.isOffline = function () { return offlineFlag; };

  var initialTree = JSON.parse(H.getProjectTree());
  var node3 = initialTree.data.nodes.find(function (n) { return n.id === '3'; });
  assert.equal(node3.offline, true);

  /* Still offline -> cameOnline must be false */
  var t1 = JSON.parse(H.pollTick({ folderId: '2', offlineIds: ['3'] }));
  assert.equal(t1.ok, true);
  assert.equal(t1.data.cameOnline, false);

  /* Premiere finishes mounting media without changing dirtySeq or item counts */
  offlineFlag = false;
  var t2 = JSON.parse(H.pollTick({ folderId: '2', offlineIds: ['3'] }));
  assert.equal(t2.ok, true);
  assert.equal(t2.data.cameOnline, true);
});

test('jsx/host.jsx native context menu actions (duplicate, newBinFromSelection, makeOffline, subclip, sequence)', function () {
  var env = createMockPremiereSandbox();
  var H = env.host;
  var app = env.state.app;
  var clip3 = app.project.rootItem.children[0].children[0];
  var seqObj = app.project.sequences[0];

  /* Wire mock APIs on clip3, seqObj, and app */
  var stateFlags = {
    offlineCalls: 0,
    seqSettings: { videoFrameWidth: 1920, videoFrameHeight: 1080, videoFrameRate: { ticks: '10160640000', seconds: 0.04 }, audioSampleRate: { ticks: '5292000' } },
    reframed: null,
    ameJob: null
  };
  clip3.setOffline = function (m) { stateFlags.offlineCalls += m || 1; return 0; };
  clip3.createSubClip = function (name, s, e) {
    return { nodeId: 'sub-99', name: name, start: s, end: e };
  };
  app.encoder = {
    launchEncoder: function () {},
    encodeSequence: function (s, out, preset) { stateFlags.ameJob = { out: out, preset: preset }; return 'job-1'; },
    encodeProjectItem: function (it, out, preset) { stateFlags.ameJob = { out: out, preset: preset }; return 'job-2'; }
  };
  seqObj.getSettings = function () { return stateFlags.seqSettings; };
  seqObj.setSettings = function (s) { stateFlags.seqSettings = s; };
  seqObj.autoReframeSequence = function (num, den, preset, nm) {
    stateFlags.reframed = { num: num, den: den, preset: preset, name: nm };
    return { name: nm };
  };

  /* 1. newBinFromSelection */
  var nb = JSON.parse(H.newBinFromSelection({ ids: ['4'], parentId: '2', name: '音频分组' }));
  assert.equal(nb.ok, true);
  assert.equal(nb.data.moved, 1);

  /* 2. duplicateItems */
  var dup = JSON.parse(H.duplicateItems({ ids: ['3'], targetBinId: '2' }));
  assert.equal(dup.ok, true);
  assert.equal(dup.data.duplicated, 1);

  /* 3. makeOffline */
  var off = JSON.parse(H.makeOffline({ ids: ['3'] }));
  assert.equal(off.ok, true);
  assert.equal(off.data.updated, 1);
  assert.equal(stateFlags.offlineCalls, 4);

  /* 4. Subclip */
  var sub = JSON.parse(H.createSubClip({ id: '3', name: 'A_Sub', startTicks: '0', endTicks: '254016000000', hasHardBoundaries: true, takeAudio: true, takeVideo: true }));
  assert.equal(sub.ok, true);
  assert.equal(sub.data.name, 'A_Sub');

  /* 5. Sequence Settings + Auto Reframe + Export AME */
  var ss = JSON.parse(H.getSequenceSettings({ id: '5' }));
  assert.equal(ss.ok, true);
  assert.equal(ss.data.videoFrameWidth, 1920);
  assert.equal(JSON.parse(H.setSequenceSettings({ id: '5', videoFrameWidth: 1080, videoFrameHeight: 1920, frameRateFps: 30 })).ok, true);
  assert.equal(stateFlags.seqSettings.videoFrameWidth, 1080);

  var ar = JSON.parse(H.autoReframeSequence({ id: '5', numerator: 9, denominator: 16, motionPreset: 'Default', newName: 'Seq_9x16', useNested: false }));
  assert.equal(ar.ok, true);
  assert.equal(stateFlags.reframed.num, 9);
  assert.equal(stateFlags.reframed.den, 16);

  var ex = JSON.parse(H.exportToAME({ id: '5', outputPath: 'D:\\out.mp4', presetPath: 'C:\\preset.epr' }));
  assert.equal(ex.ok, true);
  assert.equal(stateFlags.ameJob.out, 'D:\\out.mp4');
});

test('jsx/host.jsx checkItemsInUse detects direct clip and folder-contained clip references in sequences', function () {
  var env = createMockPremiereSandbox();
  var H = env.host;
  var app = env.state.app;
  var clip3 = app.project.rootItem.children[0].children[0];

  /* Initially no clips on sequence tracks -> inUse false */
  var u0 = JSON.parse(H.checkItemsInUse({ ids: ['3'] }));
  assert.equal(u0.ok, true);
  assert.equal(u0.data.inUse, false);
  assert.equal(u0.data.refCount, 0);

  var uBin0 = JSON.parse(H.checkItemsInUse({ ids: ['2'] }));
  assert.equal(uBin0.ok, true);
  assert.equal(uBin0.data.inUse, false);

  /* Place clip '3' on sequence videoTrack 0 */
  var seq = app.project.sequences[0];
  var vClips = [{ name: 'A.mp4', projectItem: clip3 }];
  vClips.numItems = 1;
  var vTracks = [{ clips: vClips }];
  vTracks.numTracks = 1;
  seq.videoTracks = vTracks;
  seq.audioTracks = { numTracks: 0 };

  /* Direct clip check -> inUse true */
  var u1 = JSON.parse(H.checkItemsInUse({ ids: ['3'] }));
  assert.equal(u1.ok, true);
  assert.equal(u1.data.inUse, true);
  assert.equal(u1.data.refCount, 1);
  assert.deepEqual(u1.data.sequences, ['主序列']);

  /* Unreferenced sibling clip '4' -> still inUse false */
  var u4 = JSON.parse(H.checkItemsInUse({ ids: ['4'] }));
  assert.equal(u4.ok, true);
  assert.equal(u4.data.inUse, false);

  /* Parent bin '2' containing clip '3' -> inUse true */
  var uBin1 = JSON.parse(H.checkItemsInUse({ ids: ['2'] }));
  assert.equal(uBin1.ok, true);
  assert.equal(uBin1.data.inUse, true);
  assert.equal(uBin1.data.refCount, 1);

  /* relinkBatch updates multiple offline clips in one shot */
  var relRes = JSON.parse(H.relinkBatch({
    pairs: [
      { id: '3', newPath: 'E:\\NewMedia\\A.mp4' },
      { id: '4', newPath: 'E:\\NewMedia\\B.wav' }
    ]
  }));
  assert.equal(relRes.ok, true);
  assert.equal(relRes.data.linked, 2);
  assert.equal(relRes.data.failed, 0);
});

test('jsx/host.jsx pollTick folderSig & selSig match utils.js and detect native Replace Footage / Rename / Label', function () {
  var U = require('../PrBinView/js/utils');
  var env = createMockPremiereSandbox();
  var H = env.host;
  var clip3 = env.state.clipVideo;

  var tree = JSON.parse(H.getProjectTree());
  var idx = U.buildTreeIndex(tree.data.nodes, tree.data.rootId);

  /* Select clip3 inside Premiere native Project panel */
  H.selectItems({ ids: ['3'] });

  var t1 = JSON.parse(H.pollTick({ folderId: '2', wantSig: true }));
  assert.equal(t1.ok, true);
  assert.ok(t1.data.folderSig.length > 0);
  assert.ok(t1.data.selSig.length > 0);
  /* Exact byte-for-byte hash parity between ExtendScript host.jsx and JS utils.js */
  assert.equal(t1.data.folderSig, U.computeFolderSig(idx, '2'));
  assert.equal(t1.data.selSig, U.computeSelSig(idx, ['3']));

  /* Unchanged state produces identical signatures */
  var t2 = JSON.parse(H.pollTick({ folderId: '2', wantSig: true }));
  assert.equal(t2.data.folderSig, t1.data.folderSig);
  assert.equal(t2.data.selSig, t1.data.selSig);

  /* Simulate native Premiere "Replace Footage..." updating mediaPath & name without changing item count or dirtySeq */
  clip3._mediaPath = 'D:\\素材\\Replaced_Shot_B.mp4';
  clip3.name = 'Replaced_Shot_B.mp4';
  var t3 = JSON.parse(H.pollTick({ folderId: '2', wantSig: true }));
  assert.notEqual(t3.data.folderSig, t1.data.folderSig);
  assert.notEqual(t3.data.selSig, t1.data.selSig);

  /* Simulate native Premiere color label change */
  clip3._label = 9;
  var t4 = JSON.parse(H.pollTick({ folderId: '2', wantSig: true }));
  assert.notEqual(t4.data.folderSig, t3.data.folderSig);
  assert.notEqual(t4.data.selSig, t3.data.selSig);

  /* Re-syncing tree restores exact hash parity */
  var tree2 = JSON.parse(H.getProjectTree());
  var idx2 = U.buildTreeIndex(tree2.data.nodes, tree2.data.rootId);
  assert.equal(t4.data.folderSig, U.computeFolderSig(idx2, '2'));
  assert.equal(t4.data.selSig, U.computeSelSig(idx2, ['3']));
});

test('jsx/host.jsx getLabelPrefs reads live app.properties custom label names, colors, and preset info', function () {
  var env = createMockPremiereSandbox();
  var H = env.host;
  var app = env.state.app;

  var props = {
    'BE.Prefs.LabelNames.0': 'Violet',
    'BE.Prefs.LabelNames.7': '重要镜头',
    'BE.Prefs.LabelColors.7': '#ff2244',
    'BE.Prefs.LabelColorPreset': 'MyCustomPalette'
  };
  app.version = '27.0.0';
  app.properties = {
    doesPropertyExist: function (k) { return Object.prototype.hasOwnProperty.call(props, k); },
    getProperty: function (k) { return props[k]; }
  };

  var res = JSON.parse(H.getLabelPrefs());
  assert.equal(res.ok, true);
  assert.equal(res.data.names.length, 16);
  assert.equal(res.data.colors.length, 16);
  assert.equal(res.data.names[0], 'Violet');
  assert.equal(res.data.names[7], '重要镜头');
  assert.equal(res.data.colors[7], '#ff2244');
  assert.equal(res.data.presetName, 'MyCustomPalette');
  assert.equal(res.data.appVersion, '27.0.0');
});

test('jsx/host.jsx tracks sequence usage counts, formats timecodes, jumps to sequence time, and bumps usageSig', function () {
  var env = createMockPremiereSandbox();
  var H = env.host;
  var app = env.state.app;
  var clip3 = env.state.clipVideo;
  var seq1 = app.project.sequences[0];

  function wrapList(items, propName) {
    var obj = {};
    obj[propName] = items.length;
    return new Proxy(obj, {
      get: function (t, p) {
        if (p === propName) return items.length;
        var idx = Number(p);
        return Number.isInteger(idx) ? items[idx] : t[p];
      }
    });
  }

  var jumpedTicks = '';
  var selectedLog = [];
  var vClips1 = [
    {
      name: 'background02.mp4',
      projectItem: clip3,
      start: { ticks: '1270080000000', seconds: 5 }, /* 00:00:05:00 at 25fps */
      setSelected: function (v) { selectedLog.push({ seq: 1, track: 'V1', val: v }); }
    }
  ];
  var aClips1 = [
    {
      name: 'background02.mp4',
      projectItem: clip3,
      start: { ticks: '1270080000000', seconds: 5 },
      setSelected: function (v) { selectedLog.push({ seq: 1, track: 'A1', val: v }); }
    }
  ];
  seq1.timebase = '10160640000'; /* 25fps */
  seq1.zeroPoint = '0';
  seq1.getSettings = function () { return { videoDisplayFormat: 101 }; }; /* 25fps NDF */
  seq1.videoTracks = wrapList([{ clips: wrapList(vClips1, 'numItems') }], 'numTracks');
  seq1.audioTracks = wrapList([{ clips: wrapList(aClips1, 'numItems') }], 'numTracks');
  seq1.setPlayerPosition = function (ticksStr) { jumpedTicks = ticksStr; };

  /* Add a second 29.97fps drop-frame sequence with two placements (at 0s and 3s + 1 frame) */
  var seq2Item = app.project.rootItem.createBin('TempSeqHost');
  var seq2 = app.project.createNewSequenceFromClips('序列2', [clip3], seq2Item);
  var tb2997 = 8475667200; /* 254016000000 / (30000/1001) */
  var ticks3s1f = String(Math.round(91 * tb2997));
  var vClips2 = [
    { name: 'background02.mp4', projectItem: clip3, start: { ticks: ticks3s1f, seconds: 3.036 }, setSelected: function () {} },
    { name: 'background02.mp4', projectItem: clip3, start: { ticks: '0', seconds: 0 }, setSelected: function () {} }
  ];
  seq2.timebase = String(tb2997);
  seq2.zeroPoint = '0';
  seq2.getSettings = function () { return { videoDisplayFormat: 102 }; }; /* 29.97 DF */
  seq2.videoTracks = wrapList([{ clips: wrapList(vClips2, 'numItems') }], 'numTracks');
  seq2.audioTracks = wrapList([], 'numTracks');
  var seq2Jumped = '';
  seq2.setPlayerPosition = function (ticksStr) { seq2Jumped = ticksStr; };

  /* 1. getProjectTree exposes uv=3, ua=1, up=3 for clip '3' */
  var tree = JSON.parse(H.getProjectTree());
  assert.equal(tree.ok, true);
  var node3 = tree.data.nodes.find(function (n) { return n.id === '3'; });
  assert.equal(node3.uv, 3);
  assert.equal(node3.ua, 1);
  assert.equal(node3.up, 3);

  /* 2. getItemUsage merges V1+A1 at identical startTicks and sorts per-sequence entries ascending */
  var usage = JSON.parse(H.getItemUsage({ id: '3' }));
  assert.equal(usage.ok, true);
  assert.equal(usage.data.videoCount, 3);
  assert.equal(usage.data.audioCount, 1);
  assert.equal(usage.data.entries.length, 3);
  assert.equal(usage.data.entries[0].seqName, '主序列');
  assert.equal(usage.data.entries[0].timecode, '00:00:05:00');
  assert.equal(usage.data.entries[0].tracks, 'V1+A1');
  assert.equal(usage.data.entries[1].seqName, '序列2');
  assert.equal(usage.data.entries[1].timecode, '00;00;00;00');
  assert.equal(usage.data.entries[2].timecode, '00;00;03;01');

  /* 3. jumpToSequenceTime opens target sequence, moves playhead via setPlayerPosition, and selects clip */
  var jumpRes = JSON.parse(H.jumpToSequenceTime(usage.data.entries[0]));
  assert.equal(jumpRes.ok, true);
  assert.equal(jumpRes.data.jumped, true);
  assert.equal(jumpedTicks, '1270080000000');
  assert.equal(selectedLog.some(function (x) { return x.track === 'V1' && x.val === true; }), true);

  var jumpRes2 = JSON.parse(H.jumpToSequenceTime(usage.data.entries[2]));
  assert.equal(jumpRes2.ok, true);
  assert.equal(seq2Jumped, ticks3s1f);
  assert.equal(env.state.openedSeqs.indexOf(seq2.sequenceID) !== -1, true);

  /* 4. pollTick({ wantSig: true }) detects timeline clip count mutations via usageSig */
  var sig1 = JSON.parse(H.pollTick({ folderId: '2', wantSig: true })).data.usageSig;
  assert.ok(sig1 && sig1.length > 0);
  vClips2.push({ name: 'background02.mp4', projectItem: clip3, start: { ticks: '2540160000000', seconds: 10 } });
  var sig2 = JSON.parse(H.pollTick({ folderId: '2', wantSig: true })).data.usageSig;
  assert.notEqual(sig2, sig1);
});

test('jsx/host.jsx getTimelineSelection resolves selected Timeline clips and falls back to playhead clip', function () {
  var env = createMockPremiereSandbox();
  var H = env.host;
  var app = env.state.app;
  var clip3 = env.state.clipVideo;
  var clip4 = app.project.rootItem.children[0].children[1]; /* BGM.wav */
  var activeSeq = app.project.activeSequence;

  function wrapList(items, propName) {
    var obj = {};
    obj[propName] = items.length;
    return new Proxy(obj, {
      get: function (t, p) {
        if (p === propName) return items.length;
        var idx = Number(p);
        return Number.isInteger(idx) ? items[idx] : t[p];
      }
    });
  }

  /* 1. Active getSelection() deduplicates linked Video+Audio and puts Video clip first */
  activeSeq.getSelection = function () {
    return [
      { mediaType: 'Audio', name: 'BGM.wav', projectItem: clip4 },
      { mediaType: 'Video', name: 'A.mp4', projectItem: clip3 },
      { mediaType: 'Audio', name: 'A.mp4', projectItem: clip3 }
    ];
  };
  var r1 = JSON.parse(H.getTimelineSelection());
  assert.equal(r1.ok, true);
  assert.equal(r1.data.found, true);
  assert.equal(r1.data.fromPlayhead, false);
  assert.equal(r1.data.primaryId, '3');
  assert.deepEqual(r1.data.ids, ['3', '4']);

  /* 2. Fallback to clip.isSelected() when getSelection() returns empty */
  activeSeq.getSelection = function () { return []; };
  var vClips = [
    { name: 'A.mp4', projectItem: clip3, start: { seconds: 0 }, end: { seconds: 8 }, isSelected: function () { return false; } }
  ];
  var aClips = [
    { name: 'BGM.wav', projectItem: clip4, start: { seconds: 2 }, end: { seconds: 15 }, isSelected: function () { return true; } }
  ];
  activeSeq.videoTracks = wrapList([{ isMuted: function () { return false; }, clips: wrapList(vClips, 'numItems') }], 'numTracks');
  activeSeq.audioTracks = wrapList([{ isMuted: function () { return false; }, clips: wrapList(aClips, 'numItems') }], 'numTracks');

  var r2 = JSON.parse(H.getTimelineSelection());
  assert.equal(r2.ok, true);
  assert.equal(r2.data.found, true);
  assert.equal(r2.data.fromPlayhead, false);
  assert.equal(r2.data.primaryId, '4');

  /* 3. Smart playhead fallback when nothing is selected (player at 5s -> hits clip3 on V1) */
  aClips[0].isSelected = function () { return false; };
  activeSeq.getPlayerPosition = function () { return { seconds: 5 }; };
  var r3 = JSON.parse(H.getTimelineSelection());
  assert.equal(r3.ok, true);
  assert.equal(r3.data.found, true);
  assert.equal(r3.data.fromPlayhead, true);
  assert.equal(r3.data.primaryId, '3');

  /* 4. Empty area under playhead -> found: false, reason: 'noSelection' */
  activeSeq.getPlayerPosition = function () { return { seconds: 99 }; };
  var r4 = JSON.parse(H.getTimelineSelection());
  assert.equal(r4.ok, true);
  assert.equal(r4.data.found, false);
  assert.equal(r4.data.reason, 'noSelection');

  /* 5. No active sequence -> found: false, reason: 'noSequence' */
  app.project.activeSequence = null;
  var r5 = JSON.parse(H.getTimelineSelection());
  assert.equal(r5.ok, true);
  assert.equal(r5.data.found, false);
  assert.equal(r5.data.reason, 'noSequence');
});
