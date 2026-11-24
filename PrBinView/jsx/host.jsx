/* PrBinView ExtendScript Host (Pure ES3 for Premiere Pro CEP 12) */
if (typeof PrBinViewHost === 'undefined') {
    var PrBinViewHost = (function () {
        var _dirtySeq = 0;
        var _boundEvents = false;
        var _nodeMap = {};
        var _cachedDocKey = '';
        var _dropBaseline = null;

        function bindProjectEvents() {
            if (_boundEvents) return;
            _boundEvents = true;
            try {
                if (typeof app !== 'undefined' && app && typeof app.bind === 'function') {
                    app.bind('onProjectChanged', function () {
                        _dirtySeq += 1;
                    });
                }
            } catch (e) {
                /* Some host builds do not support app.bind; fallback polling handles changes */
            }
        }

        function escapeString(str) {
            var s = String(str);
            var out = '"';
            var i, ch, code, hex;
            for (i = 0; i < s.length; i++) {
                ch = s.charAt(i);
                code = s.charCodeAt(i);
                if (ch === '"') {
                    out += '\\"';
                } else if (ch === '\\') {
                    out += '\\\\';
                } else if (ch === '\b') {
                    out += '\\b';
                } else if (ch === '\f') {
                    out += '\\f';
                } else if (ch === '\n') {
                    out += '\\n';
                } else if (ch === '\r') {
                    out += '\\r';
                } else if (ch === '\t') {
                    out += '\\t';
                } else if (code < 0x20 || code === 0x2028 || code === 0x2029) {
                    hex = code.toString(16);
                    while (hex.length < 4) hex = '0' + hex;
                    out += '\\u' + hex;
                } else {
                    out += ch;
                }
            }
            return out + '"';
        }

        function isArray(v) {
            return !!(v && Object.prototype.toString.call(v) === '[object Array]');
        }

        function toJSON(val) {
            if (val === null || typeof val === 'undefined') return 'null';
            var t = typeof val;
            if (t === 'boolean') return val ? 'true' : 'false';
            if (t === 'number') return isFinite(val) ? String(val) : 'null';
            if (t === 'string') return escapeString(val);
            if (isArray(val)) {
                var arr = [];
                var i;
                for (i = 0; i < val.length; i++) {
                    arr.push(toJSON(val[i]));
                }
                return '[' + arr.join(',') + ']';
            }
            var parts = [];
            var k;
            for (k in val) {
                if (val.hasOwnProperty(k) && typeof val[k] !== 'undefined' && typeof val[k] !== 'function') {
                    parts.push(escapeString(k) + ':' + toJSON(val[k]));
                }
            }
            return '{' + parts.join(',') + '}';
        }

        function ok(data) {
            return toJSON({ ok: true, data: data });
        }

        function fail(msg) {
            return toJSON({ ok: false, error: String(msg || 'Unknown ExtendScript error') });
        }

        function normPath(p) {
            var s = String(p || '').replace(/\\/g, '/').replace(/^\s+|\s+$/g, '');
            if (/^\/\/\?\/unc\//i.test(s)) s = '//' + s.slice(8);
            else if (s.indexOf('//?/') === 0) s = s.slice(4);
            return s.toLowerCase();
        }

        function getDocKey(proj) {
            if (!proj) return '';
            var id = '';
            try { id = String(proj.documentID || ''); } catch (e) {}
            if (id) return id;
            try { return normPath(proj.path || proj.name || ''); } catch (e2) {}
            return '';
        }

        function isBinItem(item) {
            if (!item) return false;
            try {
                if (typeof ProjectItemType !== 'undefined') {
                    if (item.type === ProjectItemType.BIN || item.type === ProjectItemType.ROOT) {
                        return true;
                    }
                }
                if (item.type === 2 || item.type === 3) return true;
            } catch (e) {}
            return false;
        }

        function isRootItem(item) {
            if (!item) return false;
            try {
                if (typeof ProjectItemType !== 'undefined' && item.type === ProjectItemType.ROOT) {
                    return true;
                }
                if (app.project && app.project.rootItem && String(item.nodeId) === String(app.project.rootItem.nodeId)) {
                    return true;
                }
            } catch (e) {}
            return false;
        }

        function safeIsSequence(item) {
            try {
                return !!(item && typeof item.isSequence === 'function' && item.isSequence());
            } catch (e) {
                return false;
            }
        }

        function safeMediaPath(item) {
            try {
                return (item && typeof item.getMediaPath === 'function') ? String(item.getMediaPath() || '') : '';
            } catch (e) {
                return '';
            }
        }

        function safeIsOffline(item) {
            try {
                return !!(item && typeof item.isOffline === 'function' && item.isOffline());
            } catch (e) {
                return false;
            }
        }

        function safeColorLabel(item) {
            try {
                if (item && item.getColorLabel) {
                    var idx = Number(item.getColorLabel());
                    return (isFinite(idx) && idx >= 0 && idx <= 15) ? idx : 0;
                }
            } catch (e) {}
            return 0;
        }

        function getActiveProjectViewID() {
            if (!app || !app.project || typeof app.getProjectViewIDs !== 'function') return null;
            var views = app.getProjectViewIDs();
            if (!views || !views.length) return null;
            var activeKey = getDocKey(app.project);
            var activePath = normPath(app.project.path || '');
            var i, p;
            for (i = 0; i < views.length; i++) {
                try {
                    p = app.getProjectFromViewID(views[i]);
                    if (p) {
                        if (activeKey && getDocKey(p) === activeKey) return views[i];
                        if (activePath && normPath(p.path || '') === activePath) return views[i];
                    }
                } catch (e) {}
            }
            return views[0];
        }

        function getSelectionIds() {
            var result = [];
            var seen = {};
            var items = null;
            if (typeof app.getCurrentProjectViewSelection === 'function') {
                try {
                    items = app.getCurrentProjectViewSelection();
                } catch (e0) {
                    items = null;
                }
            }
            if (!items || !items.length) {
                var viewId = getActiveProjectViewID();
                if (viewId !== null) {
                    try {
                        items = app.getProjectViewSelection(viewId);
                    } catch (e) {
                        items = null;
                    }
                }
            }
            if (items && items.length) {
                var i, id;
                for (i = 0; i < items.length; i++) {
                    if (!items[i]) continue;
                    try {
                        id = String(items[i].nodeId || '');
                        if (id && !seen[id]) {
                            seen[id] = true;
                            result.push(id);
                        }
                    } catch (e3) {}
                }
            }
            return result;
        }

        function rebuildNodeCache() {
            _nodeMap = {};
            if (!app || !app.project || !app.project.rootItem) {
                _cachedDocKey = '';
                return;
            }
            _cachedDocKey = getDocKey(app.project);
            var stack = [app.project.rootItem];
            var cur, i, count;
            while (stack.length > 0) {
                cur = stack.pop();
                if (!cur) continue;
                try {
                    _nodeMap[String(cur.nodeId)] = cur;
                    if (isBinItem(cur) && cur.children && cur.children.numItems > 0) {
                        count = cur.children.numItems;
                        for (i = count - 1; i >= 0; i--) {
                            stack.push(cur.children[i]);
                        }
                    }
                } catch (e) {}
            }
        }

        function findNode(nodeId) {
            if (!nodeId || !app || !app.project || !app.project.rootItem) return null;
            var key = String(nodeId);
            var curDocKey = getDocKey(app.project);
            if (_cachedDocKey === curDocKey && _nodeMap[key]) {
                try {
                    if (String(_nodeMap[key].nodeId) === key) {
                        return _nodeMap[key];
                    }
                } catch (e) {}
            }
            rebuildNodeCache();
            return _nodeMap[key] || null;
        }

        function buildSequenceIdMap() {
            var map = {};
            try {
                var seqs = app.project.sequences;
                if (seqs && seqs.numSequences) {
                    var i, seq;
                    for (i = 0; i < seqs.numSequences; i++) {
                        seq = seqs[i];
                        if (seq && seq.projectItem && seq.projectItem.nodeId) {
                            map[String(seq.projectItem.nodeId)] = String(seq.sequenceID || '');
                        }
                    }
                }
            } catch (e) {}
            return map;
        }

        function isAncestorOf(possibleAncestorId, nodeId) {
            if (String(possibleAncestorId) === String(nodeId)) return true;
            var root = app.project.rootItem;
            var target = findNode(possibleAncestorId);
            if (!target || !isBinItem(target)) return false;
            var stack = [target];
            var cur, i;
            while (stack.length > 0) {
                cur = stack.pop();
                if (!cur || !cur.children) continue;
                for (i = 0; i < cur.children.numItems; i++) {
                    var child = cur.children[i];
                    if (!child) continue;
                    if (String(child.nodeId) === String(nodeId)) return true;
                    if (isBinItem(child)) stack.push(child);
                }
            }
            return false;
        }

        function isAudioPath(p) {
            return /\.(wav|mp3|aac|m4a|aif|aiff|flac|ogg|wma)$/i.test(String(p || ''));
        }

        function pickTrackIndex(tracks) {
            if (!tracks || !tracks.numTracks) return -1;
            var i;
            for (i = 0; i < tracks.numTracks; i++) {
                try {
                    if (typeof tracks[i].isTargeted === 'function' && tracks[i].isTargeted()) {
                        if (typeof tracks[i].isLocked !== 'function' || !tracks[i].isLocked()) {
                            return i;
                        }
                    }
                } catch (e) {}
            }
            for (i = 0; i < tracks.numTracks; i++) {
                try {
                    if (typeof tracks[i].isLocked !== 'function' || !tracks[i].isLocked()) {
                        return i;
                    }
                } catch (e2) {}
            }
            return 0;
        }

        function decodeXml(s) {
            return String(s || '')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&apos;/g, "'")
                .replace(/&amp;/g, '&');
        }

        function parseTagValue(xml, tagName) {
            if (!xml) return '';
            var reElem = new RegExp('<[^>]*' + tagName + '[^>]*>([^<]*)<', 'i');
            var m = xml.match(reElem);
            if (m && m[1]) return decodeXml(m[1]);
            var reAttr = new RegExp(tagName + '\\s*=\\s*"([^"]*)"', 'i');
            var m2 = xml.match(reAttr);
            if (m2 && m2[1]) return decodeXml(m2[1]);
            return '';
        }

        function extractMetadataObject(item) {
            var meta = {
                fps: '',
                mediaStart: '',
                mediaEnd: '',
                mediaDuration: '',
                videoIn: '',
                videoOut: '',
                videoDuration: '',
                videoInfo: '',
                audioInfo: '',
                description: '',
                logNote: '',
                status: ''
            };
            try {
                if (item && item.getProjectMetadata) {
                    var xml = String(item.getProjectMetadata() || '');
                    if (xml) {
                        meta.fps = parseTagValue(xml, 'Column\\.Intrinsic\\.MediaTimebase');
                        meta.mediaStart = parseTagValue(xml, 'Column\\.Intrinsic\\.MediaStart');
                        meta.mediaEnd = parseTagValue(xml, 'Column\\.Intrinsic\\.MediaEnd');
                        meta.mediaDuration = parseTagValue(xml, 'Column\\.Intrinsic\\.MediaDuration');
                        meta.videoIn = parseTagValue(xml, 'Column\\.Intrinsic\\.VideoInPoint');
                        meta.videoOut = parseTagValue(xml, 'Column\\.Intrinsic\\.VideoOutPoint');
                        meta.videoDuration = parseTagValue(xml, 'Column\\.Intrinsic\\.VideoDuration');
                        meta.videoInfo = parseTagValue(xml, 'Column\\.Intrinsic\\.VideoInfo');
                        meta.audioInfo = parseTagValue(xml, 'Column\\.Intrinsic\\.AudioInfo');
                        meta.description = parseTagValue(xml, 'Column\\.PropertyText\\.Description');
                        meta.logNote = parseTagValue(xml, 'Column\\.PropertyText\\.LogNote');
                        meta.status = parseTagValue(xml, 'Column\\.PropertyText\\.Status');
                    }
                }
            } catch (e) {}
            if (!meta.status) {
                meta.status = safeIsOffline(item) ? 'Offline' : 'Online';
            }
            return meta;
        }

        function getFolderMetadata(payload) {
            try {
                if (!app || !app.project) return fail('No active project');
                var ids = (payload && isArray(payload.ids)) ? payload.ids : [];
                var out = {};
                var i, id, item;
                for (i = 0; i < ids.length; i++) {
                    id = String(ids[i] || '');
                    if (!id) continue;
                    item = findNode(id);
                    if (!item || isBinItem(item)) continue;
                    out[id] = extractMetadataObject(item);
                }
                return ok(out);
            } catch (err) {
                return fail(err);
            }
        }

        function timeToSeconds(t) {
            if (t === null || typeof t === 'undefined') return -1;
            if (typeof t === 'number') return isFinite(t) ? t : -1;
            try {
                if (typeof t.seconds === 'number' && isFinite(t.seconds)) return t.seconds;
                if (typeof t.ticks !== 'undefined') {
                    var ticks = Number(t.ticks);
                    if (isFinite(ticks)) return ticks / 254016000000;
                }
            } catch (e) {}
            return -1;
        }

        /* ================= PUBLIC API ================= */

        function hashUpdate(h, str) {
            var s = String(str || '');
            var i;
            for (i = 0; i < s.length; i++) {
                h = (h ^ s.charCodeAt(i)) >>> 0;
                h = (h + ((h << 1) >>> 0) + ((h << 4) >>> 0) + ((h << 7) >>> 0) + ((h << 8) >>> 0) + ((h << 24) >>> 0)) >>> 0;
            }
            return h >>> 0;
        }

        function computeFolderSig(folderNode) {
            var h = 2166136261 >>> 0;
            var i, child, bin, seq;
            if (folderNode && isBinItem(folderNode) && folderNode.children) {
                var count = folderNode.children.numItems;
                var limit = count > 400 ? 400 : count;
                h = hashUpdate(h, String(count));
                for (i = 0; i < limit; i++) {
                    child = folderNode.children[i];
                    if (!child) continue;
                    try {
                        bin = isBinItem(child);
                        seq = bin ? false : safeIsSequence(child);
                        h = hashUpdate(h,
                            String(child.nodeId || '') + '|' +
                            String(child.name || '') + '|' +
                            (bin ? 'B' : (seq ? 'S' : safeMediaPath(child))) + '|' +
                            (bin ? (child.children ? child.children.numItems : 0) : (seq ? '0' : (safeIsOffline(child) ? '1' : '0'))) + '|' +
                            String(safeColorLabel(child)) + ';'
                        );
                    } catch (eSig) {}
                }
            }
            return h.toString(16);
        }

        function computeSelSig(selIds) {
            if (!selIds || !selIds.length) return '';
            var h = 2166136261 >>> 0;
            var sLimit = selIds.length > 20 ? 20 : selIds.length;
            var i, id, child, bin, seq;
            for (i = 0; i < sLimit; i++) {
                id = String(selIds[i] || '');
                child = findNode(id);
                if (!child) continue;
                try {
                    bin = isBinItem(child);
                    seq = bin ? false : safeIsSequence(child);
                    h = hashUpdate(h,
                        id + '|' +
                        String(child.name || '') + '|' +
                        (bin ? 'B' : (seq ? 'S' : safeMediaPath(child))) + '|' +
                        (bin ? (child.children ? child.children.numItems : 0) : (seq ? '0' : (safeIsOffline(child) ? '1' : '0'))) + '|' +
                        String(safeColorLabel(child)) + ';'
                    );
                } catch (eSel) {}
            }
            return h.toString(16);
        }

        function computeSeqUsageSig() {
            var h = 2166136261 >>> 0;
            try {
                var seqs = app.project ? app.project.sequences : null;
                if (!seqs || !seqs.numSequences) return '0';
                var sCount = seqs.numSequences;
                h = hashUpdate(h, String(sCount) + ';');
                var s, seq, t, vTracks, aTracks, vCnt, aCnt;
                for (s = 0; s < sCount; s++) {
                    seq = seqs[s];
                    if (!seq) continue;
                    vTracks = seq.videoTracks;
                    vCnt = (vTracks && vTracks.numTracks) ? vTracks.numTracks : 0;
                    for (t = 0; t < vCnt; t++) {
                        try {
                            if (vTracks[t] && vTracks[t].clips) {
                                h = hashUpdate(h, 'v' + s + ':' + t + '=' + vTracks[t].clips.numItems + ';');
                            }
                        } catch (eV) {}
                    }
                    aTracks = seq.audioTracks;
                    aCnt = (aTracks && aTracks.numTracks) ? aTracks.numTracks : 0;
                    for (t = 0; t < aCnt; t++) {
                        try {
                            if (aTracks[t] && aTracks[t].clips) {
                                h = hashUpdate(h, 'a' + s + ':' + t + '=' + aTracks[t].clips.numItems + ';');
                            }
                        } catch (eA) {}
                    }
                }
            } catch (eAll) {}
            return h.toString(16);
        }

        function buildUsageCountMap() {
            var map = {};
            try {
                var seqs = app.project ? app.project.sequences : null;
                if (!seqs || !seqs.numSequences) return map;
                var s, seq, seqKey, t, c, clip, pi, nid, startTicks, pKey, rec;
                function scanTrackList(tracks, isVideo) {
                    if (!tracks || !tracks.numTracks) return;
                    for (t = 0; t < tracks.numTracks; t++) {
                        var tr = tracks[t];
                        if (!tr || !tr.clips || !tr.clips.numItems) continue;
                        for (c = 0; c < tr.clips.numItems; c++) {
                            clip = tr.clips[c];
                            if (!clip) continue;
                            try {
                                pi = clip.projectItem;
                                nid = (pi && pi.nodeId) ? String(pi.nodeId) : '';
                                if (!nid) continue;
                                rec = map[nid];
                                if (!rec) {
                                    rec = { v: 0, a: 0, p: 0, _seen: {} };
                                    map[nid] = rec;
                                }
                                if (isVideo) rec.v += 1;
                                else rec.a += 1;
                                startTicks = (clip.start && typeof clip.start.ticks !== 'undefined')
                                    ? String(clip.start.ticks)
                                    : String(Math.round(timeToSeconds(clip.start) * 1000));
                                pKey = seqKey + '@' + startTicks;
                                if (!rec._seen[pKey]) {
                                    rec._seen[pKey] = true;
                                    rec.p += 1;
                                }
                            } catch (eClip) {}
                        }
                    }
                }
                for (s = 0; s < seqs.numSequences; s++) {
                    seq = seqs[s];
                    if (!seq) continue;
                    seqKey = String(seq.sequenceID || ('seq_' + s));
                    try { scanTrackList(seq.videoTracks, true); } catch (eVT) {}
                    try { scanTrackList(seq.audioTracks, false); } catch (eAT) {}
                }
            } catch (eMap) {}
            return map;
        }

        function pad2(n) {
            return n < 10 ? ('0' + n) : String(n);
        }

        function formatSequenceTimecode(displayTicks, timebaseTicks, isDropFrame) {
            var TICKS_PER_SEC = 254016000000;
            var tb = (timebaseTicks > 0) ? timebaseTicks : 10160640000;
            var fps = TICKS_PER_SEC / tb;
            var roundedFps = Math.round(fps);
            if (!isFinite(roundedFps) || roundedFps < 1) roundedFps = 25;
            var frames = Math.round((Number(displayTicks) || 0) / tb);
            if (!isFinite(frames) || frames < 0) frames = 0;
            var drop = 0;
            if (isDropFrame && (roundedFps === 30 || roundedFps === 60)) {
                drop = (roundedFps === 60) ? 4 : 2;
                var framesPerMin = roundedFps * 60 - drop;
                var framesPer10Min = roundedFps * 600 - drop * 9;
                if (framesPerMin > 0 && framesPer10Min > 0) {
                    var d = Math.floor(frames / framesPer10Min);
                    var m = frames % framesPer10Min;
                    frames = frames + drop * 9 * d + (m >= drop ? drop * Math.floor((m - drop) / framesPerMin) : 0);
                }
            }
            var ff = frames % roundedFps;
            var totalSec = Math.floor(frames / roundedFps);
            var ss = totalSec % 60;
            var mm = Math.floor(totalSec / 60) % 60;
            var hh = Math.floor(totalSec / 3600);
            var sep = (drop > 0) ? ';' : ':';
            return pad2(hh) + sep + pad2(mm) + sep + pad2(ss) + sep + pad2(ff);
        }

        function pollTick(payload) {
            bindProjectEvents();
            try {
                if (!app || !app.project || !app.project.rootItem) {
                    return ok({
                        hasProject: false,
                        docId: '',
                        name: '',
                        path: '',
                        dirtySeq: _dirtySeq,
                        rootCount: 0,
                        folderCount: -1,
                        folderSig: '',
                        selSig: '',
                        usageSig: '',
                        cameOnline: false,
                        sel: []
                    });
                }
                var proj = app.project;
                var rootCount = 0;
                try {
                    rootCount = proj.rootItem.children ? proj.rootItem.children.numItems : 0;
                } catch (e1) {}
                var folderCount = -1;
                var folderNode = null;
                var folderId = payload && payload.folderId ? String(payload.folderId) : '';
                if (folderId) {
                    folderNode = findNode(folderId);
                    if (folderNode && isBinItem(folderNode) && folderNode.children) {
                        folderCount = folderNode.children.numItems;
                    }
                } else {
                    folderNode = proj.rootItem;
                }
                var selIds = getSelectionIds();
                var folderSig = (payload && payload.wantSig) ? computeFolderSig(folderNode) : '';
                var selSig = (payload && payload.wantSig) ? computeSelSig(selIds) : '';
                var usageSig = (payload && payload.wantSig) ? computeSeqUsageSig() : '';
                var cameOnline = false;
                var offlineIds = (payload && isArray(payload.offlineIds)) ? payload.offlineIds : null;
                if (offlineIds && offlineIds.length > 0) {
                    var oi, oNode;
                    for (oi = 0; oi < offlineIds.length; oi++) {
                        oNode = findNode(offlineIds[oi]);
                        if (oNode && !isBinItem(oNode) && !safeIsSequence(oNode)) {
                            if (!safeIsOffline(oNode) && safeMediaPath(oNode)) {
                                cameOnline = true;
                                break;
                            }
                        }
                    }
                }
                return ok({
                    hasProject: true,
                    docId: getDocKey(proj),
                    name: String(proj.name || ''),
                    path: String(proj.path || ''),
                    dirtySeq: _dirtySeq,
                    rootCount: rootCount,
                    folderCount: folderCount,
                    folderSig: folderSig,
                    selSig: selSig,
                    usageSig: usageSig,
                    cameOnline: cameOnline,
                    sel: selIds
                });
            } catch (err) {
                return fail(err);
            }
        }

        function getProjectTree() {
            bindProjectEvents();
            try {
                if (!app || !app.project || !app.project.rootItem) {
                    return ok(null);
                }
                var proj = app.project;
                var root = proj.rootItem;
                var seqMap = buildSequenceIdMap();
                var usageMap = buildUsageCountMap();
                var nodes = [];
                _nodeMap = {};
                _cachedDocKey = getDocKey(proj);

                function walk(item, parentId) {
                    if (!item) return;
                    var id = String(item.nodeId || '');
                    if (!id) return;
                    _nodeMap[id] = item;
                    var bin = isBinItem(item);
                    var seq = bin ? false : safeIsSequence(item);
                    var mediaPath = (bin || seq) ? '' : safeMediaPath(item);
                    var offline = (bin || seq) ? false : safeIsOffline(item);
                    var label = safeColorLabel(item);
                    var count = 0;
                    if (bin && item.children) {
                        count = item.children.numItems;
                    }
                    var uRec = bin ? null : usageMap[id];
                    nodes.push({
                        id: id,
                        pid: parentId,
                        name: String(item.name || ''),
                        isBin: bin,
                        isSeq: seq,
                        seqId: seq ? (seqMap[id] || '') : '',
                        path: mediaPath,
                        offline: offline,
                        label: label,
                        childCount: count,
                        uv: uRec ? uRec.v : 0,
                        ua: uRec ? uRec.a : 0,
                        up: uRec ? uRec.p : 0
                    });
                    if (bin && item.children && count > 0) {
                        var i;
                        for (i = 0; i < count; i++) {
                            walk(item.children[i], id);
                        }
                    }
                }

                walk(root, '');
                return ok({
                    docId: _cachedDocKey,
                    name: String(proj.name || ''),
                    path: String(proj.path || ''),
                    rootId: String(root.nodeId || ''),
                    dirtySeq: _dirtySeq,
                    nodes: nodes
                });
            } catch (err) {
                return fail(err);
            }
        }

        function selectItems(payload) {
            try {
                if (!app || !app.project) return fail('No active project');
                var ids = (payload && isArray(payload.ids)) ? payload.ids : [];
                var viewId = getActiveProjectViewID();
                if (viewId === null) return fail('No Project panel view found');
                var targets = [];
                var i, node;
                for (i = 0; i < ids.length; i++) {
                    node = findNode(ids[i]);
                    if (node && !isRootItem(node)) {
                        targets.push(node);
                    }
                }
                if (typeof app.setProjectViewSelection === 'function') {
                    app.setProjectViewSelection(targets, viewId);
                }
                return ok({ count: targets.length });
            } catch (err) {
                return fail(err);
            }
        }

        function openItem(payload) {
            try {
                if (!app || !app.project) return fail('No active project');
                var id = payload && payload.id ? String(payload.id) : '';
                var play = !!(payload && payload.play);
                var item = findNode(id);
                if (!item) return fail('Project item not found');
                if (isBinItem(item)) return ok({ opened: 'bin' });

                if (safeIsSequence(item)) {
                    var seqMap = buildSequenceIdMap();
                    var seqId = seqMap[id];
                    if (!seqId) return fail('Matching sequence not found');
                    app.project.openSequence(seqId);
                    return ok({ opened: 'sequence' });
                }

                if (app.sourceMonitor && typeof app.sourceMonitor.openProjectItem === 'function') {
                    app.sourceMonitor.openProjectItem(item);
                    if (play && typeof app.sourceMonitor.play === 'function') {
                        app.sourceMonitor.play(1.0);
                    }
                    return ok({ opened: 'sourceMonitor' });
                }
                return fail('SourceMonitor API unavailable');
            } catch (err) {
                return fail(err);
            }
        }

        function stopSourceMonitor() {
            try {
                if (app && app.sourceMonitor && typeof app.sourceMonitor.play === 'function') {
                    app.sourceMonitor.play(0);
                }
                return ok(true);
            } catch (err) {
                return fail(err);
            }
        }

        function insertToTimeline(payload) {
            try {
                if (!app || !app.project) return fail('No active project');
                var seq = app.project.activeSequence;
                if (!seq) return fail('请先在时间线中打开一个序列');
                var ids = (payload && isArray(payload.ids)) ? payload.ids : [];
                var mode = (payload && payload.mode === 'overwrite') ? 'overwrite' : 'insert';
                var items = [];
                var i, node;
                for (i = 0; i < ids.length; i++) {
                    node = findNode(ids[i]);
                    if (node && !isBinItem(node)) {
                        items.push(node);
                    }
                }
                if (!items.length) return fail('请选择至少一个可插入的素材或序列');

                var vIdx = pickTrackIndex(seq.videoTracks);
                var aIdx = pickTrackIndex(seq.audioTracks);
                var pos = seq.getPlayerPosition();
                var placed = 0;

                if (mode === 'insert') {
                    /* Insert in reverse at playhead so clips ripple in exact selection order */
                    for (i = items.length - 1; i >= 0; i--) {
                        var it = items[i];
                        var audioOnly = !safeIsSequence(it) && isAudioPath(safeMediaPath(it));
                        if (audioOnly && aIdx >= 0) {
                            seq.audioTracks[aIdx].insertClip(it, pos);
                            placed++;
                        } else if (vIdx >= 0) {
                            seq.videoTracks[vIdx].insertClip(it, pos);
                            placed++;
                        } else if (aIdx >= 0) {
                            seq.audioTracks[aIdx].insertClip(it, pos);
                            placed++;
                        }
                    }
                } else {
                    for (i = 0; i < items.length; i++) {
                        var it2 = items[i];
                        var audioOnly2 = !safeIsSequence(it2) && isAudioPath(safeMediaPath(it2));
                        if (audioOnly2 && aIdx >= 0) {
                            seq.audioTracks[aIdx].overwriteClip(it2, pos);
                            placed++;
                        } else if (vIdx >= 0) {
                            seq.videoTracks[vIdx].overwriteClip(it2, pos);
                            placed++;
                        } else if (aIdx >= 0) {
                            seq.audioTracks[aIdx].overwriteClip(it2, pos);
                            placed++;
                        }
                    }
                }
                return ok({ placed: placed, sequenceName: String(seq.name || '') });
            } catch (err) {
                return fail(err);
            }
        }

        function createBin(payload) {
            try {
                if (!app || !app.project) return fail('No active project');
                var name = payload && payload.name ? String(payload.name).replace(/^\s+|\s+$/g, '') : '';
                if (!name) return fail('素材箱名称不能为空');
                var parent = (payload && payload.parentId) ? findNode(payload.parentId) : app.project.rootItem;
                if (!parent || !isBinItem(parent)) parent = app.project.rootItem;
                var created = parent.createBin(name);
                if (!created) return fail('Premiere 未能创建素材箱');
                var explicitBinLabel = (payload && typeof payload.defaultBinLabel === 'number') ? payload.defaultBinLabel : -1;
                applyDefaultBinLabel(created, explicitBinLabel);
                _dirtySeq += 1;
                return ok({ id: String(created.nodeId || ''), name: String(created.name || name) });
            } catch (err) {
                return fail(err);
            }
        }

        function renameItem(payload) {
            try {
                if (!app || !app.project) return fail('No active project');
                var id = payload && payload.id ? String(payload.id) : '';
                var name = payload && payload.name ? String(payload.name).replace(/^\s+|\s+$/g, '') : '';
                if (!name) return fail('名称不能为空');
                var item = findNode(id);
                if (!item) return fail('未找到目标项目');
                if (isRootItem(item)) return fail('不能重命名工程根目录');
                item.name = name;
                _dirtySeq += 1;
                return ok({ id: id, name: String(item.name || name) });
            } catch (err) {
                return fail(err);
            }
        }

        function moveItems(payload) {
            try {
                if (!app || !app.project) return fail('No active project');
                var ids = (payload && isArray(payload.ids)) ? payload.ids : [];
                var targetId = payload && payload.targetBinId ? String(payload.targetBinId) : '';
                var target = targetId ? findNode(targetId) : app.project.rootItem;
                if (!target || !isBinItem(target)) return fail('目标必须是素材箱');
                var moved = 0;
                var i, item;
                for (i = 0; i < ids.length; i++) {
                    item = findNode(ids[i]);
                    if (!item || isRootItem(item)) continue;
                    if (isBinItem(item) && isAncestorOf(String(item.nodeId), String(target.nodeId))) {
                        return fail('不能将素材箱移动到自身或其子素材箱内');
                    }
                    item.moveBin(target);
                    moved++;
                }
                _dirtySeq += 1;
                return ok({ moved: moved });
            } catch (err) {
                return fail(err);
            }
        }

        function checkItemsInUse(payload) {
            try {
                if (!app || !app.project) return fail('No active project');
                var ids = (payload && isArray(payload.ids)) ? payload.ids : [];
                var targetMap = {};
                var targetNames = {};

                function collect(node) {
                    if (!node) return;
                    var nid = String(node.nodeId || '');
                    if (!nid || targetMap[nid]) return;
                    targetMap[nid] = true;
                    targetNames[nid] = String(node.name || '');
                    if (isBinItem(node) && node.children) {
                        var ci;
                        for (ci = 0; ci < node.children.numItems; ci++) {
                            collect(node.children[ci]);
                        }
                    }
                }

                var i;
                for (i = 0; i < ids.length; i++) {
                    collect(findNode(ids[i]));
                }

                var refCount = 0;
                var seqSet = {};
                var seqNames = [];
                var clipSet = {};
                var clipNames = [];

                function scanTracks(tracks, seqName) {
                    if (!tracks || !tracks.numTracks) return;
                    var t, tr, c, cl, pid, cn;
                    for (t = 0; t < tracks.numTracks; t++) {
                        tr = tracks[t];
                        if (!tr || !tr.clips || !tr.clips.numItems) continue;
                        for (c = 0; c < tr.clips.numItems; c++) {
                            cl = tr.clips[c];
                            if (!cl) continue;
                            pid = '';
                            try {
                                if (cl.projectItem && cl.projectItem.nodeId) pid = String(cl.projectItem.nodeId);
                            } catch (e1) {}
                            if (pid && targetMap[pid]) {
                                refCount++;
                                if (!seqSet[seqName]) {
                                    seqSet[seqName] = true;
                                    seqNames.push(seqName);
                                }
                                cn = targetNames[pid] || String(cl.name || '');
                                if (cn && !clipSet[cn]) {
                                    clipSet[cn] = true;
                                    clipNames.push(cn);
                                }
                            }
                        }
                    }
                }

                var seqs = app.project.sequences;
                if (seqs && seqs.numSequences > 0) {
                    var s, seq, seqName;
                    for (s = 0; s < seqs.numSequences; s++) {
                        seq = seqs[s];
                        if (!seq) continue;
                        seqName = String(seq.name || '未命名序列');
                        scanTracks(seq.videoTracks, seqName);
                        scanTracks(seq.audioTracks, seqName);
                    }
                }

                return ok({
                    inUse: refCount > 0,
                    refCount: refCount,
                    sequences: seqNames,
                    clipNames: clipNames
                });
            } catch (err) {
                return fail(err);
            }
        }

        function removeItems(payload) {
            try {
                if (!app || !app.project) return fail('No active project');
                var ids = (payload && isArray(payload.ids)) ? payload.ids : [];
                var bins = [];
                var clips = [];
                var i, item;
                for (i = 0; i < ids.length; i++) {
                    item = findNode(ids[i]);
                    if (!item || isRootItem(item)) continue;
                    if (isBinItem(item)) {
                        bins.push(item);
                    } else {
                        clips.push(item);
                    }
                }
                var removed = 0;
                if (clips.length > 0) {
                    var trashBin = app.project.rootItem.createBin('__PrBinView_Remove_' + new Date().getTime());
                    if (trashBin) {
                        for (i = 0; i < clips.length; i++) {
                            try {
                                clips[i].moveBin(trashBin);
                                removed++;
                            } catch (e1) {}
                        }
                        trashBin.deleteBin();
                    }
                }
                for (i = 0; i < bins.length; i++) {
                    try {
                        bins[i].deleteBin();
                        removed++;
                    } catch (e2) {}
                }
                _dirtySeq += 1;
                return ok({ removed: removed });
            } catch (err) {
                return fail(err);
            }
        }

        function importFiles(payload) {
            try {
                if (!app || !app.project) return fail('No active project');
                var paths = (payload && isArray(payload.paths)) ? payload.paths : [];
                if (!paths.length) return ok({ imported: false, count: 0 });
                var target = (payload && payload.targetBinId) ? findNode(payload.targetBinId) : app.project.rootItem;
                if (!target || !isBinItem(target)) target = app.project.rootItem;
                var res = app.project.importFiles(paths, true, target, false);
                _dirtySeq += 1;
                return ok({ imported: !!res, count: paths.length });
            } catch (err) {
                return fail(err);
            }
        }

        function importStructure(payload) {
            try {
                if (!app || !app.project) return fail('No active project');
                var target = (payload && payload.targetBinId) ? findNode(payload.targetBinId) : app.project.rootItem;
                if (!target || !isBinItem(target)) target = app.project.rootItem;
                var topFiles = (payload && isArray(payload.files)) ? payload.files : [];
                var folders = (payload && isArray(payload.folders)) ? payload.folders : [];
                var explicitBinLabel = (payload && typeof payload.defaultBinLabel === 'number') ? payload.defaultBinLabel : -1;

                var importedFiles = 0;
                var createdBins = 0;
                var firstBinId = '';

                if (topFiles.length > 0) {
                    app.project.importFiles(topFiles, true, target, false);
                    importedFiles += topFiles.length;
                }

                function walkFolder(parentBin, folderSpec) {
                    if (!folderSpec || !folderSpec.name) return;
                    var bin = parentBin.createBin(String(folderSpec.name));
                    if (!bin) bin = parentBin;
                    else {
                        applyDefaultBinLabel(bin, explicitBinLabel);
                        createdBins += 1;
                        if (!firstBinId) {
                            try { firstBinId = String(bin.nodeId || ''); } catch (eId) {}
                        }
                    }
                    var fList = isArray(folderSpec.files) ? folderSpec.files : [];
                    if (fList.length > 0) {
                        app.project.importFiles(fList, true, bin, false);
                        importedFiles += fList.length;
                    }
                    var subDirs = isArray(folderSpec.dirs) ? folderSpec.dirs : [];
                    var j;
                    for (j = 0; j < subDirs.length; j++) {
                        walkFolder(bin, subDirs[j]);
                    }
                }

                var i;
                for (i = 0; i < folders.length; i++) {
                    walkFolder(target, folders[i]);
                }

                _dirtySeq += 1;
                return ok({
                    imported: (importedFiles > 0 || createdBins > 0),
                    importedFiles: importedFiles,
                    createdBins: createdBins,
                    firstBinId: firstBinId
                });
            } catch (err) {
                return fail(err);
            }
        }

        function setColorLabel(payload) {
            try {
                if (!app || !app.project) return fail('No active project');
                var ids = (payload && isArray(payload.ids)) ? payload.ids : [];
                var idx = Number(payload && payload.labelIndex);
                if (!isFinite(idx) || idx < 0 || idx > 15) return fail('标签索引必须在 0 到 15 之间');
                var updated = 0;
                var i, item;
                for (i = 0; i < ids.length; i++) {
                    item = findNode(ids[i]);
                    if (item && item.setColorLabel) {
                        item.setColorLabel(idx);
                        updated++;
                    }
                }
                _dirtySeq += 1;
                return ok({ updated: updated, requested: ids.length });
            } catch (err) {
                return fail(err);
            }
        }

        function clearInOut(payload) {
            try {
                if (!app || !app.project) return fail('No active project');
                var ids = (payload && isArray(payload.ids)) ? payload.ids : [];
                var updated = 0;
                var i, item;
                for (i = 0; i < ids.length; i++) {
                    item = findNode(ids[i]);
                    if (!item || isBinItem(item)) continue;
                    try { if (typeof item.clearInPoint === 'function') item.clearInPoint(); } catch (e1) {}
                    try { if (typeof item.clearOutPoint === 'function') item.clearOutPoint(); } catch (e2) {}
                    updated++;
                }
                return ok({ updated: updated });
            } catch (err) {
                return fail(err);
            }
        }

        function collectMediaItemsFromIds(ids) {
            var out = [];
            var seen = {};
            function addClip(node) {
                if (!node) return;
                var nid = String(node.nodeId || '');
                if (!nid || seen[nid]) return;
                if (isBinItem(node)) {
                    seen[nid] = true;
                    if (node.children) {
                        var j;
                        for (j = 0; j < node.children.numItems; j++) {
                            addClip(node.children[j]);
                        }
                    }
                    return;
                }
                if (!safeIsSequence(node)) {
                    seen[nid] = true;
                    out.push(node);
                }
            }
            var i;
            for (i = 0; i < ids.length; i++) {
                addClip(findNode(ids[i]));
            }
            return out;
        }

        function findParentBin(nodeId) {
            if (!nodeId || !app || !app.project || !app.project.rootItem) return null;
            var targetId = String(nodeId);
            var stack = [app.project.rootItem];
            var cur, i, child;
            while (stack.length > 0) {
                cur = stack.pop();
                if (!cur || !cur.children) continue;
                for (i = 0; i < cur.children.numItems; i++) {
                    child = cur.children[i];
                    if (!child) continue;
                    if (String(child.nodeId) === targetId) return cur;
                    if (isBinItem(child)) stack.push(child);
                }
            }
            return null;
        }

        function findSequenceByNodeId(nodeId) {
            if (!nodeId || !app || !app.project || !app.project.sequences) return null;
            var targetId = String(nodeId);
            var seqs = app.project.sequences;
            var i, seq;
            for (i = 0; i < seqs.numSequences; i++) {
                seq = seqs[i];
                try {
                    if (seq && seq.projectItem && String(seq.projectItem.nodeId) === targetId) {
                        return seq;
                    }
                } catch (e) {}
            }
            return null;
        }

        function refreshMedia(payload) {
            try {
                if (!app || !app.project) return fail('No active project');
                var ids = (payload && isArray(payload.ids)) ? payload.ids : [];
                var clips = collectMediaItemsFromIds(ids);
                var updated = 0;
                var i;
                for (i = 0; i < clips.length; i++) {
                    if (clips[i] && typeof clips[i].refreshMedia === 'function') {
                        try {
                            clips[i].refreshMedia();
                            updated++;
                        } catch (eRef) {}
                    }
                }
                _dirtySeq += 1;
                return ok({ updated: updated });
            } catch (err) {
                return fail(err);
            }
        }

        function relinkMedia(payload) {
            try {
                if (!app || !app.project) return fail('No active project');
                var id = payload && payload.id ? String(payload.id) : '';
                var newPath = payload && payload.newPath ? String(payload.newPath) : '';
                if (!newPath) return fail('新路径为空');
                var item = findNode(id);
                if (!item || isBinItem(item)) return fail('只能重新链接媒体素材');
                if (typeof item.canChangeMediaPath === 'function' && !item.canChangeMediaPath()) {
                    return fail('该素材不支持更改媒体路径');
                }
                var changed = item.changeMediaPath(newPath, true);
                if (!changed) return fail('Premiere 未能完成重新链接');
                _dirtySeq += 1;
                return ok({ id: id, path: safeMediaPath(item) });
            } catch (err) {
                return fail(err);
            }
        }

        function relinkBatch(payload) {
            try {
                if (!app || !app.project) return fail('No active project');
                var pairs = (payload && isArray(payload.pairs)) ? payload.pairs : [];
                var linked = 0;
                var failed = 0;
                var i, entry, item;
                for (i = 0; i < pairs.length; i++) {
                    entry = pairs[i];
                    if (!entry || !entry.id || !entry.newPath) continue;
                    item = findNode(entry.id);
                    if (!item || isBinItem(item) || safeIsSequence(item)) continue;
                    try {
                        if (typeof item.canChangeMediaPath === 'function' && !item.canChangeMediaPath()) {
                            failed++;
                            continue;
                        }
                        if (item.changeMediaPath(String(entry.newPath), true)) {
                            linked++;
                        } else {
                            failed++;
                        }
                    } catch (eRel) {
                        failed++;
                    }
                }
                if (linked > 0) _dirtySeq += 1;
                return ok({ linked: linked, failed: failed, requested: pairs.length });
            } catch (err) {
                return fail(err);
            }
        }

        function createSequenceFromClips(payload) {
            try {
                if (!app || !app.project) return fail('No active project');
                var ids = (payload && isArray(payload.ids)) ? payload.ids : [];
                var name = payload && payload.name ? String(payload.name).replace(/^\s+|\s+$/g, '') : '新建序列';
                var target = (payload && payload.targetBinId) ? findNode(payload.targetBinId) : app.project.rootItem;
                if (!target || !isBinItem(target)) target = app.project.rootItem;
                var clips = [];
                var i, item;
                for (i = 0; i < ids.length; i++) {
                    item = findNode(ids[i]);
                    if (item && !isBinItem(item)) clips.push(item);
                }
                if (!clips.length) return fail('请先选择至少一个媒体素材');
                var seq = app.project.createNewSequenceFromClips(name, clips, target);
                if (!seq) return fail('未能根据所选素材创建序列');
                _dirtySeq += 1;
                return ok({ name: String(seq.name || name), seqId: String(seq.sequenceID || '') });
            } catch (err) {
                return fail(err);
            }
        }

        function getItemDetails(payload) {
            try {
                if (!app || !app.project) return fail('No active project');
                var id = payload && payload.id ? String(payload.id) : '';
                var item = findNode(id);
                if (!item) return fail('未找到该项目');
                var details = {
                    id: id,
                    name: String(item.name || ''),
                    treePath: String(item.treePath || ''),
                    path: safeMediaPath(item),
                    offline: safeIsOffline(item),
                    label: safeColorLabel(item),
                    hasProxy: false,
                    canProxy: false,
                    proxyPath: '',
                    proxiesEnabled: false,
                    inPoint: -1,
                    outPoint: -1,
                    videoInfo: '',
                    audioInfo: '',
                    mediaStart: '',
                    mediaEnd: '',
                    mediaDuration: '',
                    frameRate: '',
                    interpretation: null
                };
                try {
                    if (typeof app.getEnableProxies === 'function') {
                        details.proxiesEnabled = !!app.getEnableProxies();
                    }
                } catch (e0) {}
                try {
                    if (typeof item.canProxy === 'function') details.canProxy = !!item.canProxy();
                    if (typeof item.hasProxy === 'function' && item.hasProxy()) {
                        details.hasProxy = true;
                        details.proxyPath = typeof item.getProxyPath === 'function' ? String(item.getProxyPath() || '') : '';
                    }
                } catch (e1) {}
                try {
                    if (typeof item.getInPoint === 'function') details.inPoint = timeToSeconds(item.getInPoint());
                    if (typeof item.getOutPoint === 'function') details.outPoint = timeToSeconds(item.getOutPoint());
                } catch (e2) {}
                try {
                    if (typeof item.getProjectMetadata === 'function') {
                        var xml = String(item.getProjectMetadata() || '');
                        details.videoInfo = parseTagValue(xml, 'Column\\.Intrinsic\\.VideoInfo');
                        details.audioInfo = parseTagValue(xml, 'Column\\.Intrinsic\\.AudioInfo');
                        details.mediaStart = parseTagValue(xml, 'Column\\.Intrinsic\\.MediaStart');
                        details.mediaEnd = parseTagValue(xml, 'Column\\.Intrinsic\\.MediaEnd');
                        details.mediaDuration = parseTagValue(xml, 'Column\\.Intrinsic\\.MediaDuration');
                        details.frameRate = parseTagValue(xml, 'Column\\.Intrinsic\\.MediaTimebase');
                    }
                } catch (e3) {}
                try {
                    if (!isBinItem(item) && !safeIsSequence(item) && typeof item.getFootageInterpretation === 'function') {
                        var fi = item.getFootageInterpretation();
                        if (fi && typeof fi === 'object') {
                            details.interpretation = {
                                frameRate: Number(fi.frameRate) || 0,
                                pixelAspectRatio: Number(fi.pixelAspectRatio) || 1,
                                alphaUsage: Number(fi.alphaUsage),
                                fieldType: Number(fi.fieldType),
                                ignoreAlpha: !!fi.ignoreAlpha,
                                invertAlpha: !!fi.invertAlpha
                            };
                        }
                    }
                } catch (e4) {}
                return ok(details);
            } catch (err) {
                return fail(err);
            }
        }

        function baseNameOf(p) {
            var s = String(p || '').replace(/\\/g, '/');
            var idx = s.lastIndexOf('/');
            return (idx >= 0 ? s.slice(idx + 1) : s).toLowerCase();
        }

        function clipStartTicks(clip) {
            try {
                if (clip && clip.start && typeof clip.start.ticks !== 'undefined') return String(clip.start.ticks);
            } catch (e) {}
            return '';
        }

        function clipEndTicks(clip) {
            try {
                if (clip && clip.end && typeof clip.end.ticks !== 'undefined') return String(clip.end.ticks);
            } catch (e) {}
            return '';
        }

        function clipSig(prefix, trackIdx, clip) {
            var st = clipStartTicks(clip) || String(timeToSeconds(clip ? clip.start : null));
            var en = clipEndTicks(clip) || String(timeToSeconds(clip ? clip.end : null));
            return prefix + '|' + trackIdx + '|' + st + '|' + en + '|' + String((clip && clip.name) || '').toLowerCase();
        }

        function snapshotActiveSeqClips() {
            var map = {};
            var total = 0;
            try {
                var seq = app && app.project ? app.project.activeSequence : null;
                if (!seq) return { seqId: '', map: map, total: 0 };
                var tIdx, cIdx, track, clips, sig;
                if (seq.videoTracks && seq.videoTracks.numTracks) {
                    for (tIdx = 0; tIdx < seq.videoTracks.numTracks; tIdx++) {
                        track = seq.videoTracks[tIdx];
                        clips = track ? track.clips : null;
                        if (!clips || !clips.numItems) continue;
                        for (cIdx = 0; cIdx < clips.numItems; cIdx++) {
                            sig = clipSig('V', tIdx, clips[cIdx]);
                            map[sig] = (map[sig] || 0) + 1;
                            total++;
                        }
                    }
                }
                if (seq.audioTracks && seq.audioTracks.numTracks) {
                    for (tIdx = 0; tIdx < seq.audioTracks.numTracks; tIdx++) {
                        track = seq.audioTracks[tIdx];
                        clips = track ? track.clips : null;
                        if (!clips || !clips.numItems) continue;
                        for (cIdx = 0; cIdx < clips.numItems; cIdx++) {
                            sig = clipSig('A', tIdx, clips[cIdx]);
                            map[sig] = (map[sig] || 0) + 1;
                            total++;
                        }
                    }
                }
                return { seqId: String(seq.sequenceID || seq.name || ''), map: map, total: total };
            } catch (e) {
                return { seqId: '', map: map, total: 0 };
            }
        }

        function captureTimelineBaseline() {
            try {
                if (!app || !app.project || !app.project.rootItem) {
                    _dropBaseline = null;
                    return ok({ clips: 0 });
                }
                rebuildNodeCache();
                var ids = {};
                var k;
                for (k in _nodeMap) {
                    if (_nodeMap.hasOwnProperty(k)) ids[k] = true;
                }
                var seqSnap = snapshotActiveSeqClips();
                _dropBaseline = {
                    docKey: getDocKey(app.project),
                    seqId: seqSnap.seqId,
                    ids: ids,
                    clips: seqSnap.map,
                    totalClips: seqSnap.total
                };
                return ok({ clips: seqSnap.total });
            } catch (err) {
                return fail(err);
            }
        }

        function makeTimeArg(ticksStr, secondsNum) {
            try {
                if (typeof Time !== 'undefined') {
                    var t = new Time();
                    if (ticksStr) t.ticks = String(ticksStr);
                    else if (isFinite(secondsNum) && secondsNum >= 0) t.seconds = secondsNum;
                    return t;
                }
            } catch (e) {}
            return ticksStr ? String(ticksStr) : (isFinite(secondsNum) ? secondsNum : 0);
        }

        function tryOverwriteOnSeq(seq, origItem, pl, errors) {
            var timeCandidates = [
                pl.startTicks ? String(pl.startTicks) : null,
                makeTimeArg(pl.startTicks, pl.startSec),
                isFinite(pl.startSec) ? pl.startSec : null
            ];
            var c, tArg, r;
            if (pl.vIdx >= 0 && pl.aIdx >= 0 && seq.overwriteClip) {
                for (c = 0; c < timeCandidates.length; c++) {
                    tArg = timeCandidates[c];
                    if (tArg === null) continue;
                    try {
                        r = seq.overwriteClip(origItem, tArg, pl.vIdx, pl.aIdx);
                        if (r !== false) return true;
                    } catch (e1) {
                        if (c === timeCandidates.length - 1) errors.push('seq.overwriteClip: ' + e1);
                    }
                }
            }
            if (pl.vIdx >= 0 && seq.videoTracks && seq.videoTracks[pl.vIdx] && seq.videoTracks[pl.vIdx].overwriteClip) {
                for (c = 0; c < timeCandidates.length; c++) {
                    tArg = timeCandidates[c];
                    if (tArg === null) continue;
                    try {
                        r = seq.videoTracks[pl.vIdx].overwriteClip(origItem, tArg);
                        if (r !== false) return true;
                    } catch (e2) {
                        if (c === timeCandidates.length - 1) errors.push('vTrack.overwriteClip: ' + e2);
                    }
                }
            }
            if (pl.aIdx >= 0 && seq.audioTracks && seq.audioTracks[pl.aIdx] && seq.audioTracks[pl.aIdx].overwriteClip) {
                for (c = 0; c < timeCandidates.length; c++) {
                    tArg = timeCandidates[c];
                    if (tArg === null) continue;
                    try {
                        r = seq.audioTracks[pl.aIdx].overwriteClip(origItem, tArg);
                        if (r !== false) return true;
                    } catch (e3) {
                        if (c === timeCandidates.length - 1) errors.push('aTrack.overwriteClip: ' + e3);
                    }
                }
            }
            return false;
        }

        function reconcileDroppedClips(payload) {
            try {
                if (!app || !app.project || !app.project.rootItem) {
                    return ok({ found: 0, foundClips: 0, swapped: 0, cleaned: 0, errors: [] });
                }
                var beforeIds = (payload && isArray(payload.beforeIds)) ? payload.beforeIds : [];
                var dragged = (payload && isArray(payload.dragged)) ? payload.dragged : [];
                if (!dragged.length) {
                    return ok({ found: 0, foundClips: 0, swapped: 0, cleaned: 0, errors: [] });
                }

                var errors = [];
                var beforeSet = {};
                var i;
                for (i = 0; i < beforeIds.length; i++) {
                    beforeSet[String(beforeIds[i])] = true;
                }
                if (_dropBaseline && _dropBaseline.docKey === getDocKey(app.project) && _dropBaseline.ids) {
                    var bk;
                    for (bk in _dropBaseline.ids) {
                        if (_dropBaseline.ids.hasOwnProperty(bk)) beforeSet[bk] = true;
                    }
                }

                var dragByPath = {};
                var dragByName = {};
                for (i = 0; i < dragged.length; i++) {
                    var d = dragged[i];
                    if (!d || !d.id) continue;
                    var entry = {
                        id: String(d.id),
                        name: String(d.name || ''),
                        path: String(d.path || ''),
                        label: Number(d.label) || 0
                    };
                    if (entry.path) {
                        dragByPath[normPath(entry.path)] = entry;
                        var bn = baseNameOf(entry.path);
                        if (bn && !dragByName[bn]) dragByName[bn] = entry;
                    }
                    if (entry.name) {
                        dragByName[entry.name.toLowerCase()] = entry;
                    }
                }

                function matchDraggedSpec(projectItem, clipName) {
                    var mp = projectItem ? normPath(safeMediaPath(projectItem)) : '';
                    if (mp && dragByPath[mp]) return dragByPath[mp];
                    var pn = projectItem && projectItem.name ? String(projectItem.name).toLowerCase() : '';
                    if (pn && dragByName[pn]) return dragByName[pn];
                    var cn = clipName ? String(clipName).toLowerCase() : '';
                    if (cn && dragByName[cn]) return dragByName[cn];
                    return null;
                }

                rebuildNodeCache();

                /* 1. Find any newly created duplicate ProjectItems */
                var dupIds = {};
                var dupItems = [];
                var id, item, spec, origItem, labelIdx;
                for (id in _nodeMap) {
                    if (!_nodeMap.hasOwnProperty(id)) continue;
                    if (beforeSet[id]) continue;
                    item = _nodeMap[id];
                    if (!item || isBinItem(item) || safeIsSequence(item)) continue;
                    spec = matchDraggedSpec(item, '');
                    if (!spec) continue;
                    origItem = _nodeMap[spec.id] || null;
                    if (origItem && String(origItem.nodeId) === id) continue;
                    labelIdx = origItem ? safeColorLabel(origItem) : spec.label;
                    try {
                        if (item.setColorLabel) item.setColorLabel(labelIdx);
                    } catch (eLbl) {
                        errors.push('setColorLabel: ' + eLbl);
                    }
                    dupIds[id] = { dupItem: item, spec: spec, origItem: origItem, swapped: false };
                    dupItems.push(dupIds[id]);
                }

                /* 2. Detect brand-new TrackItems on activeSequence via timeline baseline diff OR dupIds */
                var swapped = 0;
                var foundClips = 0;
                var seq = app.project.activeSequence;
                var placements = {};
                var placementOrder = [];

                if (seq) {
                    var seqKey = String(seq.sequenceID || seq.name || '');
                    var hasBaseClips = !!(_dropBaseline && _dropBaseline.docKey === getDocKey(app.project) && _dropBaseline.seqId === seqKey && _dropBaseline.clips);
                    var baseRemaining = {};
                    if (hasBaseClips) {
                        var sk;
                        for (sk in _dropBaseline.clips) {
                            if (_dropBaseline.clips.hasOwnProperty(sk)) baseRemaining[sk] = _dropBaseline.clips[sk];
                        }
                    }

                    function inspectTracks(tracks, prefix) {
                        if (!tracks || !tracks.numTracks) return;
                        var tIdx, cIdx, track, clips, clip, pi, pid, sig, isNewByDup, isNewByDiff, mSpec, mOrig, stTicks, stSec, plKey, pl;
                        for (tIdx = 0; tIdx < tracks.numTracks; tIdx++) {
                            track = tracks[tIdx];
                            clips = track ? track.clips : null;
                            if (!clips || !clips.numItems) continue;
                            for (cIdx = 0; cIdx < clips.numItems; cIdx++) {
                                clip = clips[cIdx];
                                if (!clip) continue;
                                sig = clipSig(prefix, tIdx, clip);
                                if (hasBaseClips && baseRemaining[sig] > 0) {
                                    baseRemaining[sig] -= 1;
                                    continue;
                                }
                                pi = clip.projectItem || null;
                                pid = pi ? String(pi.nodeId || '') : '';
                                isNewByDup = !!(pid && (dupIds[pid] || !beforeSet[pid]));
                                isNewByDiff = hasBaseClips;
                                if (!isNewByDup && !isNewByDiff) continue;

                                mSpec = (pid && dupIds[pid]) ? dupIds[pid].spec : matchDraggedSpec(pi, clip.name);
                                if (!mSpec) continue;
                                mOrig = _nodeMap[mSpec.id] || null;
                                if (!mOrig) continue;

                                if (pid && !beforeSet[pid] && !dupIds[pid] && pi && String(mOrig.nodeId) !== pid) {
                                    dupIds[pid] = { dupItem: pi, spec: mSpec, origItem: mOrig, swapped: false };
                                    dupItems.push(dupIds[pid]);
                                }

                                stTicks = clipStartTicks(clip);
                                stSec = timeToSeconds(clip.start);
                                plKey = mSpec.id + '|' + (stTicks || String(stSec));
                                if (!placements[plKey]) {
                                    pl = {
                                        origItem: mOrig,
                                        dupPid: (pid && dupIds[pid]) ? pid : '',
                                        startTicks: stTicks,
                                        startSec: stSec,
                                        vIdx: prefix === 'V' ? tIdx : -1,
                                        aIdx: prefix === 'A' ? tIdx : -1,
                                        clips: []
                                    };
                                    placements[plKey] = pl;
                                    placementOrder.push(pl);
                                } else {
                                    pl = placements[plKey];
                                    if (prefix === 'V' && (pl.vIdx === -1 || tIdx < pl.vIdx)) pl.vIdx = tIdx;
                                    if (prefix === 'A' && (pl.aIdx === -1 || tIdx < pl.aIdx)) pl.aIdx = tIdx;
                                    if (!pl.dupPid && pid && dupIds[pid]) pl.dupPid = pid;
                                }
                                pl.clips.push(clip);
                                foundClips++;
                            }
                        }
                    }

                    inspectTracks(seq.videoTracks, 'V');
                    inspectTracks(seq.audioTracks, 'A');

                    for (i = 0; i < placementOrder.length; i++) {
                        var pItem = placementOrder[i];
                        var k;
                        for (k = pItem.clips.length - 1; k >= 0; k--) {
                            try {
                                if (pItem.clips[k] && pItem.clips[k].remove) {
                                    pItem.clips[k].remove(false, false);
                                }
                            } catch (eRem) {
                                errors.push('clip.remove: ' + eRem);
                            }
                        }
                        if (tryOverwriteOnSeq(seq, pItem.origItem, pItem, errors)) {
                            swapped++;
                            if (pItem.dupPid && dupIds[pItem.dupPid]) {
                                dupIds[pItem.dupPid].swapped = true;
                            }
                        }
                    }
                }

                /* 3. Clean up any newly imported duplicate ProjectItems that were replaced on timeline */
                var toDelete = [];
                for (i = 0; i < dupItems.length; i++) {
                    if (dupItems[i].swapped) toDelete.push(dupItems[i].dupItem);
                }

                var cleaned = 0;
                if (toDelete.length > 0) {
                    var trashBin = app.project.rootItem.createBin('__PrBinView_Dedup_' + new Date().getTime());
                    if (trashBin) {
                        for (i = 0; i < toDelete.length; i++) {
                            try {
                                toDelete[i].moveBin(trashBin);
                                cleaned++;
                            } catch (eMv) {
                                errors.push('moveBin: ' + eMv);
                            }
                        }
                        try { trashBin.deleteBin(); } catch (eDel) { errors.push('deleteBin: ' + eDel); }
                    }
                }

                if (swapped > 0 || dupItems.length > 0) {
                    _dirtySeq += 1;
                    _dropBaseline = null;
                }
                return ok({
                    found: dupItems.length,
                    foundClips: foundClips,
                    swapped: swapped,
                    cleaned: cleaned,
                    errors: errors
                });
            } catch (err) {
                return fail(err);
            }
        }

        function duplicateItems(payload) {
            try {
                if (!app || !app.project || !app.project.rootItem) return fail('No active project');
                var ids = (payload && isArray(payload.ids)) ? payload.ids : [];
                var explicitTargetId = payload && payload.targetBinId ? String(payload.targetBinId) : '';
                var explicitTarget = explicitTargetId ? findNode(explicitTargetId) : null;
                if (explicitTarget && !isBinItem(explicitTarget)) explicitTarget = null;

                var duplicated = 0;
                var newIds = [];

                function snapshotChildIds(bin) {
                    var map = {};
                    if (bin && bin.children) {
                        var ci;
                        for (ci = 0; ci < bin.children.numItems; ci++) {
                            try { map[String(bin.children[ci].nodeId)] = true; } catch (e) {}
                        }
                    }
                    return map;
                }

                function snapshotSeqIds() {
                    var map = {};
                    try {
                        var seqs = app.project.sequences;
                        if (seqs && seqs.numSequences) {
                            var si;
                            for (si = 0; si < seqs.numSequences; si++) {
                                map[String(seqs[si].sequenceID)] = true;
                            }
                        }
                    } catch (e) {}
                    return map;
                }

                function cloneOne(srcItem, destBin, appendCopySuffix) {
                    if (!srcItem || isRootItem(srcItem) || !destBin) return;
                    var origName = String(srcItem.name || '');
                    var origLabel = safeColorLabel(srcItem);

                    if (isBinItem(srcItem)) {
                        var nextBinName = appendCopySuffix ? (origName + ' 副本') : origName;
                        var newBin = destBin.createBin(nextBinName);
                        if (!newBin) return;
                        try { if (newBin.setColorLabel) newBin.setColorLabel(origLabel); } catch (eLbl) {}
                        try { newIds.push(String(newBin.nodeId || '')); } catch (eId) {}
                        duplicated++;
                        if (srcItem.children && srcItem.children.numItems > 0) {
                            var kids = [];
                            var k;
                            for (k = 0; k < srcItem.children.numItems; k++) {
                                kids.push(srcItem.children[k]);
                            }
                            for (k = 0; k < kids.length; k++) {
                                cloneOne(kids[k], newBin, false);
                            }
                        }
                        return;
                    }

                    if (safeIsSequence(srcItem)) {
                        var seq = findSequenceByNodeId(String(srcItem.nodeId || ''));
                        if (seq && typeof seq.clone === 'function') {
                            var beforeSeq = snapshotSeqIds();
                            seq.clone();
                            var seqsAfter = app.project.sequences;
                            var si, clonedSeq = null;
                            for (si = 0; si < seqsAfter.numSequences; si++) {
                                if (!beforeSeq[String(seqsAfter[si].sequenceID)]) {
                                    clonedSeq = seqsAfter[si];
                                    break;
                                }
                            }
                            if (clonedSeq && clonedSeq.projectItem) {
                                try {
                                    if (!appendCopySuffix) clonedSeq.projectItem.name = origName;
                                } catch (eNm) {}
                                try {
                                    if (clonedSeq.projectItem.setColorLabel) clonedSeq.projectItem.setColorLabel(origLabel);
                                } catch (eSl) {}
                                try {
                                    if (clonedSeq.projectItem.moveBin) clonedSeq.projectItem.moveBin(destBin);
                                } catch (eMv) {}
                                try { newIds.push(String(clonedSeq.projectItem.nodeId || '')); } catch (eSid) {}
                                duplicated++;
                            }
                        }
                        return;
                    }

                    var mediaPath = safeMediaPath(srcItem);
                    if (!mediaPath) return;
                    var beforeKids = snapshotChildIds(destBin);
                    app.project.importFiles([mediaPath], true, destBin, false);
                    if (destBin.children) {
                        var ci, added;
                        for (ci = destBin.children.numItems - 1; ci >= 0; ci--) {
                            added = destBin.children[ci];
                            if (added && !beforeKids[String(added.nodeId)]) {
                                try {
                                    if (appendCopySuffix) added.name = origName + ' 副本';
                                    else if (origName && String(added.name) !== origName) added.name = origName;
                                } catch (eRn) {}
                                try {
                                    if (added.setColorLabel) added.setColorLabel(origLabel);
                                } catch (eCl) {}
                                try { newIds.push(String(added.nodeId || '')); } catch (eCid) {}
                                duplicated++;
                                break;
                            }
                        }
                    }
                }

                var i, src, parentBin, targetBin, sameParent;
                for (i = 0; i < ids.length; i++) {
                    src = findNode(ids[i]);
                    if (!src || isRootItem(src)) continue;
                    parentBin = findParentBin(String(src.nodeId)) || app.project.rootItem;
                    targetBin = explicitTarget || parentBin;
                    if (isBinItem(src) && isAncestorOf(String(src.nodeId), String(targetBin.nodeId))) {
                        return fail('不能将素材箱复制到自身或其子素材箱内');
                    }
                    sameParent = String(parentBin.nodeId) === String(targetBin.nodeId);
                    cloneOne(src, targetBin, sameParent);
                }
                if (duplicated > 0) _dirtySeq += 1;
                return ok({ duplicated: duplicated, newIds: newIds });
            } catch (err) {
                return fail(err);
            }
        }

        function newBinFromSelection(payload) {
            try {
                if (!app || !app.project || !app.project.rootItem) return fail('No active project');
                var ids = (payload && isArray(payload.ids)) ? payload.ids : [];
                var name = payload && payload.name ? String(payload.name).replace(/^\s+|\s+$/g, '') : '新建素材箱';
                if (!name) name = '新建素材箱';
                var parent = (payload && payload.parentId) ? findNode(payload.parentId) : app.project.rootItem;
                if (!parent || !isBinItem(parent)) parent = app.project.rootItem;
                var created = parent.createBin(name);
                if (!created) return fail('Premiere 未能创建素材箱');
                var explicitBinLabel = (payload && typeof payload.defaultBinLabel === 'number') ? payload.defaultBinLabel : -1;
                applyDefaultBinLabel(created, explicitBinLabel);
                var createdId = String(created.nodeId || '');
                var moved = 0;
                var i, item;
                for (i = 0; i < ids.length; i++) {
                    item = findNode(ids[i]);
                    if (!item || isRootItem(item) || String(item.nodeId) === createdId) continue;
                    if (isBinItem(item) && isAncestorOf(String(item.nodeId), createdId)) continue;
                    try {
                        item.moveBin(created);
                        moved++;
                    } catch (eMv) {}
                }
                _dirtySeq += 1;
                return ok({ id: createdId, name: String(created.name || name), moved: moved });
            } catch (err) {
                return fail(err);
            }
        }

        function makeOffline(payload) {
            try {
                if (!app || !app.project) return fail('No active project');
                var ids = (payload && isArray(payload.ids)) ? payload.ids : [];
                var clips = collectMediaItemsFromIds(ids);
                var updated = 0;
                var i, item;
                for (i = 0; i < clips.length; i++) {
                    item = clips[i];
                    if (item && typeof item.setOffline === 'function') {
                        try {
                            item.setOffline(4);
                            updated++;
                        } catch (e1) {
                            try {
                                item.setOffline();
                                updated++;
                            } catch (e2) {}
                        }
                    }
                }
                if (updated > 0) _dirtySeq += 1;
                return ok({ updated: updated });
            } catch (err) {
                return fail(err);
            }
        }

        function createSubClip(payload) {
            try {
                if (!app || !app.project) return fail('No active project');
                var id = payload && payload.id ? String(payload.id) : '';
                var name = payload && payload.name ? String(payload.name).replace(/^\s+|\s+$/g, '') : '';
                var startTicks = payload && typeof payload.startTicks !== 'undefined' ? String(payload.startTicks) : '0';
                var endTicks = payload && typeof payload.endTicks !== 'undefined' ? String(payload.endTicks) : '';
                var hardBounds = (payload && payload.hasHardBoundaries === false) ? 0 : 1;
                var takeAudio = (payload && payload.takeAudio === false) ? 0 : 1;
                var takeVideo = (payload && payload.takeVideo === false) ? 0 : 1;
                var item = findNode(id);
                if (!item || isBinItem(item) || safeIsSequence(item)) return fail('只能从媒体剪辑制作子剪辑');
                if (!name) name = String(item.name || '子剪辑') + '_Subclip';
                if (!endTicks || Number(endTicks) <= Number(startTicks)) return fail('结束时间必须大于开始时间');
                if (typeof item.createSubClip !== 'function') return fail('当前 Premiere 版本不支持制作子剪辑');
                var sub = item.createSubClip(name, startTicks, endTicks, hardBounds, takeAudio, takeVideo);
                if (!sub) return fail('Premiere 未能创建子剪辑');
                _dirtySeq += 1;
                return ok({ id: String(sub.nodeId || ''), name: String(sub.name || name) });
            } catch (err) {
                return fail(err);
            }
        }

        function getSequenceSettings(payload) {
            try {
                if (!app || !app.project) return fail('No active project');
                var id = payload && payload.id ? String(payload.id) : '';
                var seq = findSequenceByNodeId(id);
                if (!seq || typeof seq.getSettings !== 'function') return fail('未找到目标序列');
                var s = seq.getSettings();
                var fps = 0;
                try {
                    if (s && s.videoFrameRate && Number(s.videoFrameRate.ticks) > 0) {
                        fps = Math.round((254016000000 / Number(s.videoFrameRate.ticks)) * 1000) / 1000;
                    } else if (s && s.videoFrameRate && Number(s.videoFrameRate.seconds) > 0) {
                        fps = Math.round((1 / Number(s.videoFrameRate.seconds)) * 1000) / 1000;
                    }
                } catch (eF) {}
                var sr = 48000;
                try {
                    if (s && s.audioSampleRate && Number(s.audioSampleRate.ticks) > 0) {
                        sr = Math.round(254016000000 / Number(s.audioSampleRate.ticks));
                    }
                } catch (eA) {}
                return ok({
                    name: String(seq.name || ''),
                    videoFrameWidth: Number(s.videoFrameWidth) || 1920,
                    videoFrameHeight: Number(s.videoFrameHeight) || 1080,
                    frameRateFps: fps,
                    audioSampleRate: sr
                });
            } catch (err) {
                return fail(err);
            }
        }

        function setSequenceSettings(payload) {
            try {
                if (!app || !app.project) return fail('No active project');
                var id = payload && payload.id ? String(payload.id) : '';
                var seq = findSequenceByNodeId(id);
                if (!seq || typeof seq.getSettings !== 'function' || typeof seq.setSettings !== 'function') {
                    return fail('未找到目标序列');
                }
                var s = seq.getSettings();
                var w = Math.round(Number(payload.videoFrameWidth));
                var h = Math.round(Number(payload.videoFrameHeight));
                if (isFinite(w) && w >= 64) s.videoFrameWidth = w;
                if (isFinite(h) && h >= 64) s.videoFrameHeight = h;
                var fps = Number(payload.frameRateFps);
                if (isFinite(fps) && fps > 0 && s.videoFrameRate) {
                    var frameTicks = Math.round(254016000000 / fps);
                    try { s.videoFrameRate.ticks = String(frameTicks); } catch (eT) {
                        try { s.videoFrameRate.seconds = 1 / fps; } catch (eS) {}
                    }
                }
                seq.setSettings(s);
                _dirtySeq += 1;
                return ok({ updated: true });
            } catch (err) {
                return fail(err);
            }
        }

        function autoReframeSequence(payload) {
            try {
                if (!app || !app.project) return fail('No active project');
                var id = payload && payload.id ? String(payload.id) : '';
                var seq = findSequenceByNodeId(id);
                if (!seq || typeof seq.autoReframeSequence !== 'function') return fail('该项不是序列或不支持自动重构');
                var num = Math.max(1, Math.round(Number(payload.numerator) || 9));
                var den = Math.max(1, Math.round(Number(payload.denominator) || 16));
                var preset = payload && payload.motionPreset ? String(payload.motionPreset) : 'Default';
                var newName = payload && payload.newName ? String(payload.newName).replace(/^\s+|\s+$/g, '') : (String(seq.name || '序列') + '_' + num + 'x' + den);
                var useNested = !!(payload && payload.useNested);
                var created = seq.autoReframeSequence(num, den, preset, newName, useNested);
                _dirtySeq += 1;
                return ok({ name: created && created.name ? String(created.name) : newName });
            } catch (err) {
                return fail(err);
            }
        }

        function exportToAME(payload) {
            try {
                if (!app || !app.project || !app.encoder) return fail('Adobe Media Encoder 接口不可用');
                var id = payload && payload.id ? String(payload.id) : '';
                var outputPath = payload && payload.outputPath ? String(payload.outputPath) : '';
                var presetPath = payload && payload.presetPath ? String(payload.presetPath) : '';
                if (!outputPath || !presetPath) return fail('请提供导出路径和预设文件 (.epr)');
                var item = findNode(id);
                if (!item || isBinItem(item)) return fail('只能导出素材或序列');
                try { app.encoder.launchEncoder(); } catch (eLaunch) {}
                var jobId = '';
                if (safeIsSequence(item)) {
                    var seq = findSequenceByNodeId(id);
                    if (!seq) return fail('未找到目标序列');
                    jobId = String(app.encoder.encodeSequence(seq, outputPath, presetPath, 0, 1) || '');
                } else if (typeof app.encoder.encodeProjectItem === 'function') {
                    jobId = String(app.encoder.encodeProjectItem(item, outputPath, presetPath, 0, 1) || '');
                } else {
                    return fail('当前 Premiere 版本不支持直接导出此素材，请先创建序列后导出');
                }
                return ok({ queued: true, jobId: jobId, outputPath: outputPath });
            } catch (err) {
                return fail(err);
            }
        }

        function readAppProp(key) {
            try {
                if (!app || !app.properties) return '';
                if (typeof app.properties.doesPropertyExist === 'function' && !app.properties.doesPropertyExist(key)) {
                    return '';
                }
                var v = app.properties.getProperty(key);
                if (v === null || typeof v === 'undefined') return '';
                return String(v);
            } catch (e) {
                return '';
            }
        }

        function readDefaultBinLabelIndex() {
            var keys = [
                'BE.Prefs.LabelDefaults.Bin',
                'BE.Prefs.DefaultLabels.Bin',
                'BE.Prefs.LabelDefault.Bin',
                'BE.Prefs.DefaultBinLabel',
                'BE.Prefs.BinDefaultLabel',
                'BE.Prefs.Labels.Default.Bin',
                'FE.Prefs.LabelDefaults.Bin'
            ];
            var i, raw, n;
            for (i = 0; i < keys.length; i++) {
                raw = readAppProp(keys[i]);
                if (!raw) continue;
                n = Number(raw);
                if (isFinite(n) && Math.floor(n) === n && n >= 0 && n <= 15) {
                    return n;
                }
            }
            return -1;
        }

        function applyDefaultBinLabel(bin, explicitIdx) {
            if (!bin || typeof bin.setColorLabel !== 'function') return;
            try {
                /* Premiere Pro ExtendScript createBin() initializes bins to label 0 (1st color) when the native
                   Project panel is closed, only applying Label Defaults -> Bin once the Project panel opens. */
                var cur = safeColorLabel(bin);
                if (cur !== 0) return;
                var target = -1;
                if (typeof explicitIdx === 'number' && isFinite(explicitIdx) && explicitIdx >= 0 && explicitIdx <= 15) {
                    target = Math.floor(explicitIdx);
                } else {
                    target = readDefaultBinLabelIndex();
                }
                if (target < 0) target = 7; /* Premiere Pro factory default for Bins: Mango (index 7) */
                if (target !== 0) {
                    bin.setColorLabel(target);
                }
            } catch (eBinLbl) {}
        }

        function getLabelPrefs() {
            try {
                var names = [];
                var colors = [];
                var i, nm, cl;
                for (i = 0; i < 16; i++) {
                    nm = readAppProp('BE.Prefs.LabelNames.' + i);
                    if (!nm) nm = readAppProp('BE.Prefs.LabelName.' + i);
                    cl = readAppProp('BE.Prefs.LabelColors.' + i);
                    if (!cl) cl = readAppProp('BE.Prefs.LabelColor.' + i);
                    if (!cl) cl = readAppProp('BE.Prefs.LabelColors.Hex.' + i);
                    names.push(nm);
                    colors.push(cl);
                }
                var presetKeys = [
                    'BE.Prefs.LabelColorPreset',
                    'BE.Prefs.CurrentLabelColorPreset',
                    'BE.Prefs.LabelPreset',
                    'FE.Prefs.LabelColorPreset',
                    'BE.Prefs.Labels.CurrentPreset'
                ];
                var presetName = '';
                for (i = 0; i < presetKeys.length; i++) {
                    presetName = readAppProp(presetKeys[i]);
                    if (presetName) break;
                }
                var appVer = '';
                try { if (app && app.version) appVer = String(app.version); } catch (eVer) {}
                var docsPath = '';
                try {
                    if (typeof Folder !== 'undefined' && Folder.myDocuments && Folder.myDocuments.fsName) {
                        docsPath = String(Folder.myDocuments.fsName);
                    }
                } catch (eDoc) {}
                return ok({
                    names: names,
                    colors: colors,
                    presetName: presetName,
                    defaultBinLabel: readDefaultBinLabelIndex(),
                    appVersion: appVer,
                    docsPath: docsPath
                });
            } catch (err) {
                return fail(err);
            }
        }

        function getItemUsage(payload) {
            try {
                if (!app || !app.project) return fail('No active project');
                var id = payload && payload.id ? String(payload.id) : '';
                if (!id) return fail('Missing item id');
                var item = findNode(id);
                if (!item) return fail('Item not found');

                var seqs = app.project.sequences;
                var videoCount = 0;
                var audioCount = 0;
                var entries = [];

                if (seqs && seqs.numSequences) {
                    var s, seq, seqId, seqName, tbTicks, zeroTicks, isDrop, st;
                    for (s = 0; s < seqs.numSequences; s++) {
                        seq = seqs[s];
                        if (!seq) continue;
                        seqId = String(seq.sequenceID || '');
                        seqName = String(seq.name || '');
                        tbTicks = 0;
                        zeroTicks = 0;
                        isDrop = false;
                        try { if (seq.timebase) tbTicks = Number(seq.timebase); } catch (eTb) {}
                        try { if (seq.zeroPoint) zeroTicks = Number(seq.zeroPoint); } catch (eZp) {}
                        try {
                            if (typeof seq.getSettings === 'function') {
                                st = seq.getSettings();
                                if (st) {
                                    if (!tbTicks && st.videoFrameRate && st.videoFrameRate.ticks) {
                                        tbTicks = Number(st.videoFrameRate.ticks);
                                    }
                                    /* Premiere videoDisplayFormat: 102 = 29.97 DF, 109 = 59.94 DF */
                                    if (st.videoDisplayFormat === 102 || st.videoDisplayFormat === 109) {
                                        isDrop = true;
                                    }
                                }
                            }
                        } catch (eSet) {}
                        if (!(tbTicks > 0)) tbTicks = 10160640000;

                        var seqEntries = [];
                        var byStart = {};

                        function scanSeqTracks(tracks, isVideo) {
                            if (!tracks || !tracks.numTracks) return;
                            var ti, ci, tr, clip, pi, nid, ticksStr, secVal, trackTag, existing, dispTicks;
                            for (ti = 0; ti < tracks.numTracks; ti++) {
                                tr = tracks[ti];
                                if (!tr || !tr.clips || !tr.clips.numItems) continue;
                                for (ci = 0; ci < tr.clips.numItems; ci++) {
                                    clip = tr.clips[ci];
                                    if (!clip) continue;
                                    try {
                                        pi = clip.projectItem;
                                        nid = (pi && pi.nodeId) ? String(pi.nodeId) : '';
                                        if (nid !== id) continue;
                                        if (isVideo) videoCount += 1;
                                        else audioCount += 1;

                                        secVal = timeToSeconds(clip.start);
                                        if (secVal < 0) secVal = 0;
                                        ticksStr = (clip.start && typeof clip.start.ticks !== 'undefined' && String(clip.start.ticks) !== '')
                                            ? String(clip.start.ticks)
                                            : String(Math.round(secVal * 254016000000));
                                        trackTag = (isVideo ? 'V' : 'A') + String(ti + 1);
                                        existing = byStart[ticksStr];
                                        if (existing) {
                                            if (('+' + existing.tracks + '+').indexOf('+' + trackTag + '+') === -1) {
                                                existing.tracks = existing.tracks + '+' + trackTag;
                                            }
                                            if (isVideo) existing.hasVideo = true;
                                            else existing.hasAudio = true;
                                        } else {
                                            dispTicks = (Number(ticksStr) || 0) + (zeroTicks || 0);
                                            existing = {
                                                seqId: seqId,
                                                seqName: seqName,
                                                clipName: String(clip.name || item.name || ''),
                                                startTicks: ticksStr,
                                                startSec: secVal,
                                                timecode: formatSequenceTimecode(dispTicks, tbTicks, isDrop),
                                                tracks: trackTag,
                                                hasVideo: !!isVideo,
                                                hasAudio: !isVideo,
                                                trackType: isVideo ? 'video' : 'audio',
                                                trackIndex: ti,
                                                clipIndex: ci
                                            };
                                            byStart[ticksStr] = existing;
                                            seqEntries.push(existing);
                                        }
                                    } catch (eSc) {}
                                }
                            }
                        }

                        try { scanSeqTracks(seq.videoTracks, true); } catch (eV2) {}
                        try { scanSeqTracks(seq.audioTracks, false); } catch (eA2) {}

                        seqEntries.sort(function (a, b) {
                            return (a.startSec || 0) - (b.startSec || 0);
                        });
                        var k;
                        for (k = 0; k < seqEntries.length; k++) {
                            entries.push(seqEntries[k]);
                        }
                    }
                }

                return ok({
                    id: id,
                    name: String(item.name || ''),
                    videoCount: videoCount,
                    audioCount: audioCount,
                    entries: entries
                });
            } catch (err) {
                return fail(err);
            }
        }

        function jumpToSequenceTime(payload) {
            try {
                if (!app || !app.project) return fail('No active project');
                var seqId = payload && payload.seqId ? String(payload.seqId) : '';
                var ticksStr = payload && typeof payload.startTicks !== 'undefined' ? String(payload.startTicks) : '';
                var secVal = payload && typeof payload.startSec === 'number' ? payload.startSec : -1;
                if (!ticksStr && secVal >= 0) {
                    ticksStr = String(Math.round(secVal * 254016000000));
                }
                if (!seqId) return fail('Missing sequence id');

                var targetSeq = null;
                var seqs = app.project.sequences;
                var s;
                if (seqs && seqs.numSequences) {
                    for (s = 0; s < seqs.numSequences; s++) {
                        if (seqs[s] && String(seqs[s].sequenceID || '') === seqId) {
                            targetSeq = seqs[s];
                            break;
                        }
                    }
                }
                if (!targetSeq) return fail('Sequence not found');

                var alreadyActive = !!(app.project.activeSequence && String(app.project.activeSequence.sequenceID || '') === seqId);
                if (!alreadyActive && typeof app.project.openSequence === 'function') {
                    app.project.openSequence(seqId);
                }
                var liveSeq = (app.project.activeSequence && String(app.project.activeSequence.sequenceID || '') === seqId)
                    ? app.project.activeSequence
                    : targetSeq;

                if (ticksStr && typeof liveSeq.setPlayerPosition === 'function') {
                    liveSeq.setPlayerPosition(ticksStr);
                }

                /* Highlight the target clip on the sequence timeline if supported */
                var wantType = payload && payload.trackType ? String(payload.trackType) : '';
                var wantTrack = payload && typeof payload.trackIndex === 'number' ? payload.trackIndex : -1;
                var wantClip = payload && typeof payload.clipIndex === 'number' ? payload.clipIndex : -1;
                try {
                    function clearSelectionOnTracks(tracks) {
                        if (!tracks || !tracks.numTracks) return;
                        var ti, ci, tr, cl;
                        for (ti = 0; ti < tracks.numTracks; ti++) {
                            tr = tracks[ti];
                            if (!tr || !tr.clips) continue;
                            for (ci = 0; ci < tr.clips.numItems; ci++) {
                                cl = tr.clips[ci];
                                if (cl && typeof cl.setSelected === 'function') {
                                    cl.setSelected(false, false);
                                }
                            }
                        }
                    }
                    if (wantTrack >= 0 && wantClip >= 0) {
                        clearSelectionOnTracks(liveSeq.videoTracks);
                        clearSelectionOnTracks(liveSeq.audioTracks);
                        var pickTracks = wantType === 'audio' ? liveSeq.audioTracks : liveSeq.videoTracks;
                        if (pickTracks && wantTrack < pickTracks.numTracks) {
                            var pTr = pickTracks[wantTrack];
                            if (pTr && pTr.clips && wantClip < pTr.clips.numItems) {
                                var pCl = pTr.clips[wantClip];
                                if (pCl && typeof pCl.setSelected === 'function') {
                                    pCl.setSelected(true, true);
                                }
                            }
                        }
                    }
                } catch (eSel) {}

                return ok({
                    jumped: true,
                    seqId: seqId,
                    seqName: String(liveSeq.name || targetSeq.name || ''),
                    startTicks: ticksStr
                });
            } catch (err) {
                return fail(err);
            }
        }

        function getTimelineSelection() {
            try {
                if (!app || !app.project) return fail('No active project');
                var seq = app.project.activeSequence;
                if (!seq) {
                    return ok({
                        found: false,
                        reason: 'noSequence',
                        seqName: '',
                        ids: [],
                        primaryId: '',
                        primaryName: '',
                        fromPlayhead: false
                    });
                }

                var ids = [];
                var seen = {};
                var firstHolder = { name: '' };
                var fromPlayhead = false;

                function pushTrackClip(clip) {
                    if (!clip) return;
                    try {
                        var pi = clip.projectItem;
                        var nid = (pi && pi.nodeId) ? String(pi.nodeId) : '';
                        if (!nid || seen[nid]) return;
                        seen[nid] = true;
                        ids.push(nid);
                        if (!firstHolder.name) {
                            firstHolder.name = String((pi && pi.name) || clip.name || '');
                        }
                    } catch (ePush) {}
                }

                /* 1. Primary: Premiere Pro activeSequence.getSelection() (prefer video clips first) */
                try {
                    if (typeof seq.getSelection === 'function') {
                        var selList = seq.getSelection();
                        if (selList && selList.length) {
                            var si, sc, mType;
                            for (si = 0; si < selList.length; si++) {
                                sc = selList[si];
                                mType = '';
                                try { mType = String(sc.mediaType || ''); } catch (eMt) {}
                                if (mType === 'Video') pushTrackClip(sc);
                            }
                            for (si = 0; si < selList.length; si++) {
                                pushTrackClip(selList[si]);
                            }
                        }
                    }
                } catch (eSelApi) {}

                /* 2. Fallback: inspect clip.isSelected() on video & audio tracks */
                if (!ids.length) {
                    function scanSelectedTracks(tracks) {
                        if (!tracks || !tracks.numTracks) return;
                        var ti, ci, tr, cl;
                        for (ti = 0; ti < tracks.numTracks; ti++) {
                            tr = tracks[ti];
                            if (!tr || !tr.clips || !tr.clips.numItems) continue;
                            for (ci = 0; ci < tr.clips.numItems; ci++) {
                                cl = tr.clips[ci];
                                try {
                                    if (cl && typeof cl.isSelected === 'function' && cl.isSelected()) {
                                        pushTrackClip(cl);
                                    }
                                } catch (eIsSel) {}
                            }
                        }
                    }
                    try { scanSelectedTracks(seq.videoTracks); } catch (eVT) {}
                    try { scanSelectedTracks(seq.audioTracks); } catch (eAT) {}
                }

                /* 3. Smart fallback when nothing is selected: clip under current playhead */
                if (!ids.length) {
                    try {
                        var pos = (typeof seq.getPlayerPosition === 'function') ? seq.getPlayerPosition() : null;
                        var posSec = timeToSeconds(pos);
                        if (posSec >= 0) {
                            function findClipAtPlayhead(tracks, topDown) {
                                if (!tracks || !tracks.numTracks) return;
                                var ti, ci, tr, cl, stSec, enSec, muted;
                                var startIdx = topDown ? (tracks.numTracks - 1) : 0;
                                var endIdx = topDown ? -1 : tracks.numTracks;
                                var step = topDown ? -1 : 1;
                                for (ti = startIdx; ti !== endIdx; ti += step) {
                                    tr = tracks[ti];
                                    if (!tr || !tr.clips || !tr.clips.numItems) continue;
                                    muted = false;
                                    try { if (typeof tr.isMuted === 'function' && tr.isMuted()) muted = true; } catch (eM) {}
                                    if (muted) continue;
                                    for (ci = 0; ci < tr.clips.numItems; ci++) {
                                        cl = tr.clips[ci];
                                        if (!cl) continue;
                                        stSec = timeToSeconds(cl.start);
                                        enSec = timeToSeconds(cl.end);
                                        if (stSec >= 0 && enSec > stSec && posSec >= (stSec - 0.0005) && posSec < (enSec - 0.0005)) {
                                            pushTrackClip(cl);
                                            if (ids.length) return;
                                        }
                                    }
                                }
                            }
                            findClipAtPlayhead(seq.videoTracks, true);
                            if (!ids.length) findClipAtPlayhead(seq.audioTracks, false);
                            if (ids.length) fromPlayhead = true;
                        }
                    } catch (ePh) {}
                }

                return ok({
                    found: ids.length > 0,
                    reason: ids.length > 0 ? '' : 'noSelection',
                    seqName: String(seq.name || ''),
                    ids: ids,
                    primaryId: ids.length ? ids[0] : '',
                    primaryName: firstHolder.name,
                    fromPlayhead: fromPlayhead
                });
            } catch (err) {
                return fail(err);
            }
        }

        bindProjectEvents();

        return {
            pollTick: pollTick,
            getProjectTree: getProjectTree,
            getLabelPrefs: getLabelPrefs,
            getItemUsage: getItemUsage,
            jumpToSequenceTime: jumpToSequenceTime,
            getTimelineSelection: getTimelineSelection,
            selectItems: selectItems,
            openItem: openItem,
            stopSourceMonitor: stopSourceMonitor,
            insertToTimeline: insertToTimeline,
            createBin: createBin,
            renameItem: renameItem,
            moveItems: moveItems,
            checkItemsInUse: checkItemsInUse,
            removeItems: removeItems,
            duplicateItems: duplicateItems,
            newBinFromSelection: newBinFromSelection,
            makeOffline: makeOffline,
            importFiles: importFiles,
            importStructure: importStructure,
            setColorLabel: setColorLabel,
            clearInOut: clearInOut,
            refreshMedia: refreshMedia,
            relinkMedia: relinkMedia,
            relinkBatch: relinkBatch,
            createSequenceFromClips: createSequenceFromClips,
            getItemDetails: getItemDetails,
            getFolderMetadata: getFolderMetadata,
            createSubClip: createSubClip,
            getSequenceSettings: getSequenceSettings,
            setSequenceSettings: setSequenceSettings,
            autoReframeSequence: autoReframeSequence,
            exportToAME: exportToAME,
            captureTimelineBaseline: captureTimelineBaseline,
            reconcileDroppedClips: reconcileDroppedClips
        };
    }());
}
