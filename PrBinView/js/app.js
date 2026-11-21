(function () {
  'use strict';

  var PLUGIN_VERSION = '1.3.8';
  var U = window.PrUtils;
  var I18n = window.PrI18n;
  var t = function (key, vars) { return I18n ? I18n.t(key, vars) : key; };
  var bridge = window.PrCepBridge.createBridge();
  var thumbEngine = new window.PrThumbEngine.ThumbEngine({
    extensionRoot: bridge.getExtensionPath(),
    maxConcurrency: 4
  });

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    hasProject: false,
    docId: '',
    projectName: '',
    projectPath: '',
    dirtySeq: -1,
    rootCount: -1,
    folderSig: '',
    selSig: '',
    lastSigSelKey: '',
    index: null,
    offlineIds: [],
    projectLoadedAt: 0,

    folderId: '',
    selected: new Set(),
    history: [],
    historyPos: -1,

    query: '',
    globalSearch: false,
    includeSubfolders: false,
    typeFilter: 'all',
    sortBy: 'name',
    sortDir: 'asc',
    treeSortBy: 'name',
    treeSortDir: 'asc',
    viewMode: 'grid',
    cardWidth: 184,
    treeSize: 27,
    sidebarOpen: true,
    sidebarManual: false,
    followSync: true,
    viewHidden: false,
    lastFocusPane: 'grid',

    busy: false,
    polling: false,
    menuOpen: false,
    colPopoverOpen: false,
    modalOpen: false,
    lastHostSelKey: '',
    suppressSyncUntil: 0
  };

  var relinkUndoMap = new Map();
  var metaCache = new Map();
  var metaTicket = 0;
  var clipboard = { mode: '', ids: [] };
  var hiddenIds = new Set();
  var submenuCloseTimer = 0;
  var activeSubmenuBtn = null;
  var columnsConfig = U.MEDIA_COLUMNS.map(function (c) { return Object.assign({}, c); });
  var pollTimer = 0;
  var searchTimer = 0;
  var modalResolve = null;
  var activeDropWatch = null;
  var reconcileWatchTimer = 0;
  var reconcilingDrop = false;
  var lastOfflineCheckAt = 0;
  var offlineCheckCursor = 0;
  var lastSigCheckAt = 0;
  var lastLabelSyncAt = 0;
  var labelSyncing = false;
  var arrowHostSyncTimer = 0;

  var treeView = null;
  var gridView = null;
  var externalDragDepth = 0;

  function focusPane(pane) {
    state.lastFocusPane = pane === 'tree' ? 'tree' : 'grid';
    if (state.modalOpen || (gridView && gridView.renamingId) || (treeView && treeView.renamingId)) return;
    var el = pane === 'tree' ? $('folder-tree') : $('grid-scroll');
    if (el && typeof el.focus === 'function') {
      try { el.focus({ preventScroll: true }); } catch (_) { try { el.focus(); } catch (__) {} }
    }
  }

  /* ==================== STATUS & TOAST ==================== */

  function setStatus(text, isError) {
    var el = $('status-text');
    if (!el) return;
    el.textContent = text;
    el.title = text;
    el.classList.toggle('is-error', !!isError);
  }

  function updateCounters(visibleCount) {
    var countEl = $('status-count');
    if (!countEl) return;
    var sel = selectedIds().length;
    countEl.textContent = sel > 0
      ? t('status.countSel', { n: visibleCount, sel: sel })
      : t('status.count', { n: visibleCount });
  }

  function updateEngineBadge() {
    var engineBadge = $('engine-badge');
    if (!engineBadge) return;
    engineBadge.title = t('status.engineTitle');
    if (bridge.isDemo) {
      engineBadge.textContent = t('status.engineDemo');
      engineBadge.classList.remove('is-fast');
    } else if (thumbEngine.ffmpegReady) {
      engineBadge.textContent = t('status.engineFfmpeg');
      engineBadge.classList.add('is-fast');
    } else {
      engineBadge.textContent = t('status.engineBuiltin');
      engineBadge.classList.remove('is-fast');
    }
  }

  function updateProjectPill() {
    var pill = $('project-pill');
    if (!pill) return;
    pill.title = t('top.projectPillTitle');
    if (state.hasProject && state.projectName) {
      pill.textContent = state.projectName + (bridge.isDemo ? t('top.demoSuffix') : '');
      pill.classList.add('is-live');
    } else {
      pill.textContent = t('top.noProject');
      pill.classList.remove('is-live');
    }
  }

  function applyLanguage(lang, opts) {
    var options = opts || {};
    var next = I18n.setLang(lang);
    persistPref('lang', next);

    var langBtn = $('btn-lang');
    if (langBtn) {
      langBtn.title = t('lang.switchTitle');
      var zhEl = langBtn.querySelector('.lang-zh');
      var enEl = langBtn.querySelector('.lang-en');
      if (zhEl) zhEl.classList.toggle('is-on', next === 'zh');
      if (enEl) enEl.classList.toggle('is-on', next === 'en');
    }

    /* Topbar */
    $('btn-toggle-sidebar').title = t('top.toggleSidebar');
    $('btn-back').title = t('top.back');
    $('btn-forward').title = t('top.forward');
    $('btn-up').title = t('top.up');
    $('search-input').placeholder = t('top.searchPlaceholder');
    $('btn-search-clear').title = t('top.searchClear');
    $('toggle-global-search').textContent = t('top.globalSearch');
    $('toggle-global-search').title = t('top.globalSearchTitle');
    $('btn-new-bin').innerHTML = U.ICONS.plus + '<span>' + U.escapeHtml(t('top.newBin')) + '</span>';
    $('btn-new-bin').title = t('top.newBinTitle');
    $('btn-import').innerHTML = U.ICONS.importFile + '<span>' + U.escapeHtml(t('top.import')) + '</span>';
    $('btn-import').title = t('top.importTitle');
    $('btn-import-folder').innerHTML = U.ICONS.importFolder + '<span>' + U.escapeHtml(t('top.importFolder')) + '</span>';
    $('btn-import-folder').title = t('top.importFolderTitle');
    $('btn-refresh').title = t('top.refreshTitle');
    var demoText = $('demo-strip-text');
    if (demoText) demoText.textContent = t('top.demoNotice');

    /* Left Sidebar */
    var sbTitle = $('sidebar-title');
    if (sbTitle) sbTitle.textContent = t('sidebar.title');
    var sortSel = $('tree-sort-select');
    if (sortSel) {
      sortSel.title = t('sidebar.sortTitle');
      var optsList = sortSel.options;
      for (var i = 0; i < optsList.length; i++) {
        optsList[i].textContent = t('sidebar.sort.' + optsList[i].value);
      }
    }
    var sortDirBtn = $('btn-tree-sort-dir');
    if (sortDirBtn) {
      sortDirBtn.title = state.treeSortDir === 'asc' ? t('sidebar.sortDirAsc') : t('sidebar.sortDirDesc');
    }
    var sbSizeLbl = $('sidebar-size-label');
    if (sbSizeLbl) sbSizeLbl.textContent = t('sidebar.size');
    var sbSizeWrap = $('sidebar-size-wrap');
    if (sbSizeWrap) sbSizeWrap.title = t('sidebar.sizeTitle');
    var splitter = $('sidebar-splitter');
    if (splitter) splitter.title = t('sidebar.splitterTitle');

    /* Stage Bar & Filter Chips */
    $('toggle-subfolders').textContent = t('stage.subfolders');
    $('toggle-subfolders').title = t('stage.subfoldersTitle');
    var chips = $('type-filters').querySelectorAll('.chip');
    for (var c = 0; c < chips.length; c++) {
      var kindKey = chips[c].dataset.type || 'all';
      chips[c].textContent = t('filter.' + kindKey);
    }
    $('btn-col-settings').title = t('view.columnsTitle');
    $('btn-view-grid').title = t('view.gridTitle');
    $('btn-view-list').title = t('view.listTitle');

    /* Status Bar & Modal Defaults */
    var verEl = $('version-badge');
    if (verEl) {
      verEl.textContent = 'v' + PLUGIN_VERSION;
      verEl.title = t('app.versionTitle', { ver: PLUGIN_VERSION });
    }
    $('btn-sync-toggle').title = t('status.syncTitle');
    $('sync-label').textContent = state.followSync ? t('status.syncOn') : t('status.syncPaused');
    $('btn-clear-cache').textContent = t('status.clearCache');
    $('btn-clear-cache').title = t('status.clearCacheTitle');
    var stSizeLbl = $('status-size-label');
    if (stSizeLbl) stSizeLbl.textContent = t('status.size');
    var stSizeWrap = $('status-size-wrap');
    if (stSizeWrap) stSizeWrap.title = t('status.sizeTitle');
    $('modal-cancel').textContent = t('modal.cancel');

    /* Refresh dynamic UI components */
    if (options.skipRerender) {
      var pill = $('project-pill');
      if (pill && !state.hasProject) {
        pill.textContent = t('top.connecting');
        pill.title = t('top.projectPillTitle');
      }
      var engEl = $('engine-badge');
      if (engEl) {
        engEl.textContent = t('status.checking');
        engEl.title = t('status.engineTitle');
      }
      updateCounters(0);
      setStatus(t('status.ready'));
    } else {
      closeContextMenu();
      closeColPopover();
      updateProjectPill();
      updateEngineBadge();
      if (treeView && state.index) treeView.render();
      renderBreadcrumbs();
      renderColumnHeader();
      renderCurrentFolder({ preserveScroll: true, skipMetaFetch: true });
      if (!options.silent) setStatus(t('lang.switched'));
    }
  }

  function selectedIds() {
    if (!state.index) return [];
    var out = [];
    state.selected.forEach(function (id) {
      if (state.index.nodes.has(id)) out.push(id);
    });
    return out;
  }

  function isAnyInternalDrag() {
    return !!((gridView && gridView.isDraggingInternal) || (treeView && treeView.isDraggingInternal));
  }

  function hiddenStorageKey(docId) {
    return 'prbinview.hidden.' + String(docId || 'default').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
  }

  function loadHiddenIds(docId) {
    hiddenIds = new Set();
    try {
      var raw = localStorage.getItem(hiddenStorageKey(docId));
      if (raw) {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr)) arr.forEach(function (id) { hiddenIds.add(String(id)); });
      }
    } catch (_) {}
  }

  function saveHiddenIds() {
    if (!state.docId) return;
    try {
      localStorage.setItem(hiddenStorageKey(state.docId), JSON.stringify(Array.from(hiddenIds)));
    } catch (_) {}
  }

  function persistPref(key, val) {
    try { localStorage.setItem('prbinview.' + key, String(val)); } catch (_) {}
  }

  function readPref(key, fallback) {
    try {
      var v = localStorage.getItem('prbinview.' + key);
      return v === null ? fallback : v;
    } catch (_) {
      return fallback;
    }
  }

  /* ==================== FOLDER NAVIGATION ==================== */

  function pushHistory(folderId) {
    if (!folderId) return;
    if (state.historyPos >= 0 && state.history[state.historyPos] === folderId) return;
    state.history = state.history.slice(0, state.historyPos + 1);
    state.history.push(folderId);
    if (state.history.length > 60) state.history.shift();
    state.historyPos = state.history.length - 1;
    updateNavButtons();
  }

  function updateNavButtons() {
    var canBack = state.historyPos > 0;
    var canFwd = state.historyPos >= 0 && state.historyPos < state.history.length - 1;
    var cur = state.index && state.index.nodes.get(state.folderId);
    var canUp = !!(cur && cur.pid);
    $('btn-back').disabled = !canBack;
    $('btn-forward').disabled = !canFwd;
    $('btn-up').disabled = !canUp;
  }

  function navigateToFolder(folderId, opts) {
    var options = opts || {};
    if (!state.index || !state.index.nodes.has(folderId)) return;
    var target = state.index.nodes.get(folderId);
    if (!target.isBin) folderId = target.pid || state.index.rootId;

    var changed = folderId !== state.folderId;
    if (changed) {
      thumbEngine.cancelPending();
      state.folderId = folderId;
      state.folderSig = '';
      lastSigCheckAt = 0;
      if (!options.skipHistory) pushHistory(folderId);
      if (!options.keepSelection) {
        state.selected.clear();
      }
    }

    treeView.setActive(state.folderId);
    renderBreadcrumbs();
    updateNavButtons();
    renderCurrentFolder({ preserveScroll: !!options.preserveScroll });

    if (options.pushToHost !== false && state.followSync && state.hasProject) {
      pushHostSelection(target.pid ? [folderId] : []);
    }
  }

  function pushHostSelection(ids) {
    if (!state.hasProject || !state.followSync) return;
    var key = (ids || []).slice().sort().join('|');
    state.lastHostSelKey = key;
    state.suppressSyncUntil = Date.now() + 650;
    bridge.selectItems(ids || []).catch(function () {});
  }

  /* ==================== RENDERING ==================== */

  function renderBreadcrumbs() {
    var box = $('breadcrumbs');
    box.innerHTML = '';
    if (!state.index || !state.folderId) return;

    var chain = U.getAncestors(state.index.nodes, state.folderId);
    var frag = document.createDocumentFragment();
    for (var i = 0; i < chain.length; i++) {
      (function (node, isLast) {
        if (i > 0) {
          var sep = document.createElement('span');
          sep.className = 'crumb-sep';
          sep.textContent = '/';
          frag.appendChild(sep);
        }
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'crumb-btn' + (isLast ? ' is-current' : '');
        btn.dataset.id = node.id;
        btn.textContent = node.pid ? node.name : t('tree.rootName');
        btn.title = node.pid ? node.name : t('tree.rootTitle', { name: node.name });
        btn.addEventListener('click', function () {
          navigateToFolder(node.id);
        });
        /* Allow dropping internal items OR external OS folders/files onto any parent breadcrumb */
        btn.addEventListener('dragover', function (e) {
          var isInt = isAnyInternalDrag();
          var isExt = !isInt && isExternalFileDrag(e);
          if (!isInt && !isExt) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = isExt ? 'copy' : 'move';
          btn.classList.add('is-drop-target');
          if (isExt) showExternalDropBanner(node.id);
        });
        btn.addEventListener('dragleave', function () {
          btn.classList.remove('is-drop-target');
        });
        btn.addEventListener('drop', function (e) {
          btn.classList.remove('is-drop-target');
          if (isAnyInternalDrag()) {
            e.preventDefault();
            e.stopPropagation();
            handleDropToBin(node.id, e);
          } else if (isExternalFileDrag(e)) {
            e.preventDefault();
            e.stopPropagation();
            handleExternalDrop(node.id, e);
          }
        });
        frag.appendChild(btn);
      })(chain[i], i === chain.length - 1);
    }
    box.appendChild(frag);
  }

  function visibleColumns() {
    return columnsConfig.filter(function (c) { return c.visible; });
  }

  function loadColumnPrefs() {
    try {
      var raw = readPref('columnsConfig', '');
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return;
      columnsConfig.forEach(function (col) {
        if (saved[col.id]) {
          if (!col.locked && typeof saved[col.id].visible === 'boolean') {
            col.visible = saved[col.id].visible;
          }
          var w = Number(saved[col.id].width);
          if (Number.isFinite(w) && w >= (col.minWidth || 28) && w <= 600) {
            col.width = Math.round(w);
          }
        }
      });
    } catch (_) {}
  }

  function saveColumnPrefs() {
    var out = {};
    columnsConfig.forEach(function (col) {
      out[col.id] = { visible: !!col.visible, width: col.width };
    });
    persistPref('columnsConfig', JSON.stringify(out));
  }

  function isMetaSortColumn(colId) {
    for (var i = 0; i < columnsConfig.length; i++) {
      if (columnsConfig[i].id === colId) return !!columnsConfig[i].needsMeta;
    }
    return false;
  }

  function renderColumnHeader() {
    var bar = $('col-header');
    if (!bar) return;
    bar.innerHTML = '';
    var cols = visibleColumns();
    gridView.setColumns(cols);

    cols.forEach(function (col) {
      var colTitle = U.columnLabel(col.id);
      var th = document.createElement('div');
      var isSorted = state.sortBy === col.id;
      th.className = 'col-th' + (isSorted ? ' is-sorted' : '') + (col.isLabel ? ' is-label-th' : '');
      th.dataset.col = col.id;
      th.title = t('col.sortTitle', { label: colTitle });

      var labelSpan = document.createElement('span');
      labelSpan.className = 'col-th-text';
      labelSpan.textContent = colTitle;
      th.appendChild(labelSpan);

      if (isSorted) {
        var arrow = document.createElement('span');
        arrow.className = 'col-sort-arrow';
        arrow.textContent = state.sortDir === 'asc' ? '↑' : '↓';
        th.appendChild(arrow);
      }

      th.addEventListener('click', function (e) {
        if (e.target.closest('.col-resizer')) return;
        if (state.sortBy === col.id) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortBy = col.id;
          state.sortDir = 'asc';
        }
        persistPref('sortBy', state.sortBy);
        persistPref('sortDir', state.sortDir);
        renderColumnHeader();
        renderCurrentFolder();
      });

      /* Draggable right-edge column resizer for List Mode */
      var resizer = document.createElement('div');
      resizer.className = 'col-resizer';
      resizer.title = t('col.resizeTitle');
      resizer.addEventListener('mousedown', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var startX = e.clientX;
        var startW = col.width;
        resizer.classList.add('is-dragging');
        document.body.classList.add('is-resizing');
        function onMove(ev) {
          col.width = Math.max(col.minWidth || 32, Math.min(600, Math.round(startW + (ev.clientX - startX))));
          gridView.setColumns(visibleColumns());
        }
        function onUp() {
          resizer.classList.remove('is-dragging');
          document.body.classList.remove('is-resizing');
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          saveColumnPrefs();
        }
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
      th.appendChild(resizer);

      bar.appendChild(th);
    });
  }

  function closeColPopover() {
    state.colPopoverOpen = false;
    $('col-popover').classList.add('hidden');
  }

  function toggleColPopover() {
    if (state.colPopoverOpen) { closeColPopover(); return; }
    closeContextMenu();
    var pop = $('col-popover');
    pop.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'col-pop-head';
    head.innerHTML = '<span>' + U.escapeHtml(t('col.popTitle')) + '</span>';
    var resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'link-btn';
    resetBtn.textContent = t('col.popReset');
    resetBtn.addEventListener('click', function () {
      columnsConfig = U.MEDIA_COLUMNS.map(function (c) { return Object.assign({}, c); });
      saveColumnPrefs();
      renderColumnHeader();
      renderCurrentFolder({ preserveScroll: true });
      closeColPopover();
    });
    head.appendChild(resetBtn);
    pop.appendChild(head);

    columnsConfig.forEach(function (col) {
      var row = document.createElement('label');
      row.className = 'col-pop-item' + (col.locked ? ' is-locked' : '');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!col.visible;
      if (col.locked) cb.disabled = true;
      cb.addEventListener('change', function () {
        col.visible = cb.checked;
        if (!col.visible && state.sortBy === col.id) {
          state.sortBy = 'name';
          state.sortDir = 'asc';
        }
        saveColumnPrefs();
        renderColumnHeader();
        renderCurrentFolder({ preserveScroll: true });
      });
      var txt = document.createElement('span');
      txt.textContent = U.columnLabel(col.id);
      row.appendChild(cb);
      row.appendChild(txt);
      pop.appendChild(row);
    });

    pop.classList.remove('hidden');
    state.colPopoverOpen = true;
    var anchor = $('btn-col-settings').getBoundingClientRect();
    var rect = pop.getBoundingClientRect();
    var left = Math.max(8, Math.min(anchor.right - rect.width, window.innerWidth - rect.width - 8));
    var top = Math.min(anchor.bottom + 4, window.innerHeight - rect.height - 8);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  function ensureFolderMetadata(items) {
    if (!state.hasProject || !state.index || !items || !items.length) return;
    var missing = [];
    for (var i = 0; i < items.length; i++) {
      var n = items[i];
      if (!n || n.isBin) continue;
      if (!n.meta && !metaCache.has(n.id)) missing.push(n.id);
    }
    if (!missing.length) return;

    /* Fetch in background without blocking folder switch */
    var ticket = ++metaTicket;
    var docIdAtStart = state.docId;
    var needMetaSort = isMetaSortColumn(state.sortBy);
    var CHUNK = 120;

    (async function fetchChunks() {
      var anyUpdated = false;
      for (var offset = 0; offset < missing.length; offset += CHUNK) {
        if (ticket !== metaTicket || state.docId !== docIdAtStart) return;
        var batchIds = missing.slice(offset, offset + CHUNK);
        var map = null;
        try {
          map = await bridge.getFolderMetadata(batchIds);
        } catch (_) {
          return;
        }
        if (ticket !== metaTicket || state.docId !== docIdAtStart || !map) return;
        Object.keys(map).forEach(function (id) {
          metaCache.set(id, map[id]);
          var node = state.index && state.index.nodes.get(id);
          if (node) node.meta = map[id];
        });
        gridView.patchMetadata(map);
        anyUpdated = true;
      }
      if (anyUpdated && needMetaSort && ticket === metaTicket && state.docId === docIdAtStart) {
        renderCurrentFolder({ preserveScroll: true, skipMetaFetch: true });
      }
    })();
  }

  function renderCurrentFolder(opts) {
    if (!state.index) {
      gridView.setItems([], state.selected, {
        emptyHtml: '<strong>' + U.escapeHtml(t('empty.noProjectTitle')) + '</strong><div>' + U.escapeHtml(t('empty.noProjectDesc')) + '</div>'
      });
      updateCounters(0);
      return;
    }

    var items = U.collectItems(state.index, state.folderId, {
      query: state.query,
      globalSearch: state.globalSearch,
      includeSubfolders: state.includeSubfolders,
      type: state.typeFilter,
      sortBy: state.sortBy,
      sortDir: state.sortDir
    });
    if (hiddenIds.size > 0) {
      if (state.viewHidden) {
        items.forEach(function (it) { it.isHidden = hiddenIds.has(it.id); });
      } else {
        items = items.filter(function (it) { return !hiddenIds.has(it.id); });
        items.forEach(function (it) { it.isHidden = false; });
      }
    } else {
      items.forEach(function (it) { it.isHidden = false; });
    }

    var emptyHtml = state.query
      ? ('<strong>' + U.escapeHtml(t('empty.noSearchTitle')) + '</strong><div>' + U.escapeHtml(t('empty.noSearchDesc')) + '</div>')
      : ('<strong>' + U.escapeHtml(t('empty.folderTitle')) + '</strong><div>' + U.escapeHtml(t('empty.folderDesc')) + '</div>');

    gridView.setItems(items, state.selected, {
      preserveScroll: !!(opts && opts.preserveScroll),
      emptyHtml: emptyHtml
    });
    updateCounters(items.length);

    if (!(opts && opts.skipMetaFetch)) {
      if (state.viewMode === 'list' || isMetaSortColumn(state.sortBy) || items.length <= 120) {
        ensureFolderMetadata(items);
      }
    }
  }

  async function syncLabelPrefs(silent) {
    if (labelSyncing || !bridge || typeof bridge.getLabelPrefs !== 'function') return false;
    labelSyncing = true;
    lastLabelSyncAt = Date.now();
    try {
      var prefs = await bridge.getLabelPrefs();
      if (!prefs) return false;
      var applied = U.applyCustomLabels(prefs);
      if (applied.changed) {
        if (treeView && state.index) treeView.render();
        if (state.index) renderCurrentFolder({ preserveScroll: true, skipMetaFetch: true });
        if (!silent) setStatus(t('msg.labelsSynced'));
        return true;
      }
      return false;
    } catch (_) {
      return false;
    } finally {
      labelSyncing = false;
    }
  }

  /* ==================== PROJECT LOADING & FAST POLLING ==================== */

  async function refreshProject(opts) {
    var options = opts || {};
    if (state.busy && !options.force) return;
    var silent = !!options.silent;
    if (!silent) {
      setStatus(t('msg.syncing'));
      syncLabelPrefs(true);
    }

    try {
      var tree = await bridge.getProjectTree();
      if (!tree || !tree.rootId) {
        state.hasProject = false;
        state.docId = '';
        state.projectName = '';
        state.projectPath = '';
        state.folderSig = '';
        state.selSig = '';
        state.lastSigSelKey = '';
        state.index = null;
        state.offlineIds = [];
        state.folderId = '';
        state.selected.clear();
        updateProjectPill();
        treeView.setData(null, '');
        renderBreadcrumbs();
        renderCurrentFolder();
        setStatus(t('msg.waitProject'));
        return;
      }

      var prevIndex = state.index;
      var projectSwitched = tree.docId !== state.docId;
      if (projectSwitched || !silent) {
        metaCache.clear();
        ++metaTicket;
        if (!silent) thumbEngine.invalidateMemory();
      }
      state.hasProject = true;
      state.docId = tree.docId;
      state.projectName = tree.name;
      state.projectPath = tree.path;
      state.dirtySeq = tree.dirtySeq;
      state.folderSig = '';
      state.selSig = '';
      lastSigCheckAt = 0;
      state.index = U.buildTreeIndex(tree.nodes, tree.rootId);

      var offlineIds = [];
      var recoveredCount = 0;
      var replacedCount = 0;
      state.index.nodes.forEach(function (n) {
        if (!n.isBin && !n.isSeq) {
          var prevNode = (!projectSwitched && prevIndex && prevIndex.nodes.has(n.id))
            ? prevIndex.nodes.get(n.id)
            : null;
          if (n.offline || !n.path) {
            offlineIds.push(n.id);
          } else if (prevNode && (prevNode.offline || !prevNode.path)) {
            recoveredCount += 1;
          }
          if (prevNode && (prevNode.path !== n.path || prevNode.name !== n.name || prevNode.offline !== n.offline)) {
            metaCache.delete(n.id);
            if (prevNode.path) thumbEngine.invalidatePath(prevNode.path);
            if (n.path) thumbEngine.invalidatePath(n.path);
            if (prevNode.path && n.path && prevNode.path !== n.path) {
              replacedCount += 1;
            }
          }
        }
        if (metaCache.has(n.id)) n.meta = metaCache.get(n.id);
      });
      state.offlineIds = offlineIds;
      if (projectSwitched) {
        state.projectLoadedAt = Date.now();
        offlineCheckCursor = 0;
        lastOfflineCheckAt = 0;
        state.lastSigSelKey = '';
        loadHiddenIds(tree.docId);
      }
      state.rootCount = (state.index.childrenByParent.get(tree.rootId) || []).length;

      updateProjectPill();

      if (projectSwitched || !state.folderId || !state.index.nodes.has(state.folderId)) {
        state.folderId = tree.rootId;
        state.selected.clear();
        state.history = [tree.rootId];
        state.historyPos = 0;
        /* In demo mode start directly inside a populated bin so user sees thumbnails immediately */
        if (bridge.isDemo && state.index.nodes.has('bin-cam-a')) {
          state.folderId = 'bin-cam-a';
          state.history = [tree.rootId, 'bin-cam-a'];
          state.historyPos = 1;
        }
      } else {
        /* Prune deleted ids from selection */
        state.selected = new Set(selectedIds());
      }

      treeView.hiddenIds = hiddenIds;
      treeView.viewHidden = state.viewHidden;
      treeView.setData(state.index, state.folderId, projectSwitched);
      renderBreadcrumbs();
      updateNavButtons();
      renderCurrentFolder({ preserveScroll: !projectSwitched });

      if (!silent) {
        var total = Math.max(0, state.index.nodes.size - 1);
        var pendingHint = offlineIds.length > 0 ? t('msg.pendingOnline', { n: offlineIds.length }) : '';
        var engDesc = thumbEngine.ffmpegReady ? t('msg.engineFfmpegDesc') : t('msg.engineBuiltinDesc');
        setStatus(t('msg.synced', { total: total, engine: engDesc, pending: pendingHint }));
      } else if (replacedCount > 0) {
        setStatus(t('msg.autoReplaced', { n: replacedCount }));
      } else if (recoveredCount > 0) {
        setStatus(t('msg.autoRecovered', { n: recoveredCount }));
      }
    } catch (err) {
      setStatus(t('msg.syncFailed', { err: err.message || err }), true);
    }
  }

  async function pollOnce() {
    if (document.hidden || state.polling || state.busy || reconcilingDrop || state.modalOpen || state.menuOpen || isAnyInternalDrag() || gridView.renamingId || treeView.renamingId) {
      return;
    }
    state.polling = true;
    try {
      var now = Date.now();
      var offlineBatch = null;
      if (state.offlineIds.length > 0) {
        var checkInterval = (now - state.projectLoadedAt) < 30000 ? 400 : 2000;
        if ((now - lastOfflineCheckAt) >= checkInterval) {
          lastOfflineCheckAt = now;
          var batchSize = 60;
          if (state.offlineIds.length <= batchSize) {
            offlineBatch = state.offlineIds;
          } else {
            if (offlineCheckCursor >= state.offlineIds.length) offlineCheckCursor = 0;
            offlineBatch = state.offlineIds.slice(offlineCheckCursor, offlineCheckCursor + batchSize);
            offlineCheckCursor += batchSize;
          }
        }
      }

      var wantSig = state.hasProject && ((now - lastSigCheckAt) >= 450);
      if (wantSig) lastSigCheckAt = now;

      if (state.hasProject && ((now - lastLabelSyncAt) >= 6000)) {
        syncLabelPrefs(false);
      }

      var tick = await bridge.pollTick(state.folderId, offlineBatch, wantSig);
      if (!tick) return;

      if (!tick.hasProject) {
        if (state.hasProject) await refreshProject({ silent: true, force: true });
        return;
      }

      /* Project switched, mutated, Replace Footage / Rename / Label in Pr, or startup offline clips mounted */
      var curFolderKids = state.index && state.folderId
        ? (state.index.childrenByParent.get(state.folderId) || []).length
        : -1;
      var folderCountChanged = tick.folderCount >= 0 && curFolderKids >= 0 && tick.folderCount !== curFolderKids;

      var folderSigChanged = false;
      if (tick.folderSig && state.index && state.folderId) {
        var expectedFolderSig = U.computeFolderSig(state.index, state.folderId);
        if (tick.folderSig !== expectedFolderSig && tick.folderSig !== state.folderSig) {
          folderSigChanged = true;
        }
        state.folderSig = tick.folderSig;
      }

      var sel = Array.isArray(tick.sel) ? tick.sel : [];
      var selKey = sel.slice().sort().join('|');
      var selSigChanged = false;
      if (tick.selSig && state.index && sel.length) {
        var expectedSelSig = U.computeSelSig(state.index, sel);
        if (tick.selSig !== expectedSelSig && !(selKey === state.lastSigSelKey && tick.selSig === state.selSig)) {
          selSigChanged = true;
        }
        state.lastSigSelKey = selKey;
        state.selSig = tick.selSig;
      }

      if (tick.docId !== state.docId || tick.dirtySeq !== state.dirtySeq || tick.rootCount !== state.rootCount || folderCountChanged || tick.cameOnline || folderSigChanged || selSigChanged) {
        var keepFolderSig = tick.folderSig || '';
        var keepSelSig = tick.selSig || '';
        var keepSelKey = selKey;
        await refreshProject({ silent: true, force: true });
        if (keepFolderSig) state.folderSig = keepFolderSig;
        if (keepSelSig) { state.selSig = keepSelSig; state.lastSigSelKey = keepSelKey; }
      }

      if (!state.followSync || !state.index || Date.now() < state.suppressSyncUntil) return;

      if (selKey === state.lastHostSelKey) return;
      state.lastHostSelKey = selKey;

      if (!sel.length) return;

      /* If user selected a brand-new item in Pr that isn't in our index yet, rescan first */
      var missing = sel.some(function (id) { return !state.index.nodes.has(id); });
      if (missing) {
        await refreshProject({ silent: true, force: true });
        if (!state.index) return;
      }

      var primary = state.index.nodes.get(sel[0]);
      if (!primary) return;

      if (primary.isBin) {
        /* Single-clicked a folder in Premiere's Project panel -> INSTANTLY switch to it! */
        if (state.folderId !== primary.id) {
          state.selected.clear();
          navigateToFolder(primary.id, { pushToHost: false });
          setStatus(t('msg.followBin', { name: primary.name }));
        }
      } else {
        /* Clicked a clip/sequence in Premiere's Project panel -> switch to its folder & highlight it */
        var parentBin = primary.pid || state.index.rootId;
        state.selected = new Set(sel);
        if (state.folderId !== parentBin) {
          navigateToFolder(parentBin, { pushToHost: false, keepSelection: true });
        }
        gridView.setSelection(sel, true);
        updateCounters(gridView.items.length);
      }
    } catch (_) {
      /* Ignore transient poll errors while Pr is busy (e.g. modal dialog open in Pr) */
    } finally {
      state.polling = false;
    }
  }

  /* ==================== ACTIONS ==================== */

  async function runAction(fn, successMsg) {
    if (state.busy) return;
    state.busy = true;
    try {
      var res = await fn();
      if (successMsg) setStatus(typeof successMsg === 'function' ? successMsg(res) : successMsg);
      return res;
    } catch (err) {
      setStatus(err.message || String(err), true);
    } finally {
      state.busy = false;
    }
  }

  function clearReconcileTimers() {
    clearInterval(reconcileWatchTimer);
    reconcileWatchTimer = 0;
    activeDropWatch = null;
  }

  function startDropWatch(dropCtx) {
    clearReconcileTimers();
    if (!dropCtx || !dropCtx.dragged || !dropCtx.dragged.length) return;
    activeDropWatch = dropCtx;
    /* CEF fires dragend prematurely when leaving the panel for Premiere's Timeline, so we watch
       continuously for up to 20 seconds until the dropped clip actually lands in Premiere! */
    reconcileWatchTimer = setInterval(function () {
      var watch = activeDropWatch;
      if (!watch || watch.handledInternally || !state.hasProject || state.docId !== watch.docId) {
        clearReconcileTimers();
        return;
      }
      var now = Date.now();
      if (now > watch.expiresAt) {
        clearReconcileTimers();
        setStatus(t('status.ready'));
        return;
      }
      if (watch.foundAt && now - watch.foundAt > 2000) {
        clearReconcileTimers();
        setStatus(t('status.ready'));
        return;
      }
      if (reconcilingDrop || state.busy) return;

      reconcilingDrop = true;
      bridge.reconcileDroppedClips(watch.beforeIds, watch.dragged).then(async function (res) {
        reconcilingDrop = false;
        if (!activeDropWatch || activeDropWatch !== watch) return;
        if (res && res.errors && res.errors.length) {
          setStatus(t('msg.dragReconcileErr', { err: res.errors[0] }), true);
        }
        if (res && res.swapped > 0) {
          clearReconcileTimers();
          await refreshProject({ silent: true, force: true });
          setStatus(t('msg.dragSwapped', {
            cleaned: res.cleaned > 0 ? t('msg.dragSwappedCleaned', { n: res.cleaned }) : ''
          }));
        } else if (res && (res.found > 0 || res.foundClips > 0)) {
          /* Duplicate ProjectItem or TrackItem appeared; keep watching briefly in case placement settles */
          if (!watch.foundAt) {
            watch.foundAt = Date.now();
            await refreshProject({ silent: true, force: true });
          }
        }
      }).catch(function (err) {
        reconcilingDrop = false;
        setStatus(t('msg.dragSyncFailed', { err: (err && err.message) || err }), true);
      });
    }, 220);
  }

  async function handleDropToBin(targetBinId, event) {
    if (activeDropWatch) activeDropWatch.handledInternally = true;
    clearReconcileTimers();
    if (!state.index) return;
    var raw = '';
    try { raw = event.dataTransfer.getData('application/x-prbinview-ids'); } catch (_) {}
    var fallbackIds = (treeView && treeView.draggedBinId) ? [treeView.draggedBinId] : selectedIds();
    var ids = [];
    try { ids = raw ? JSON.parse(raw) : fallbackIds; } catch (_) { ids = fallbackIds; }
    if (!ids.length) return;

    var valid;
    try {
      valid = U.validateMove(state.index.nodes, ids, targetBinId);
    } catch (err) {
      setStatus(err.message, true);
      return;
    }
    if (!valid.length) return;

    var targetNode = state.index.nodes.get(targetBinId);
    var targetLabel = targetNode ? (targetNode.pid ? targetNode.name : t('tree.rootName')) : t('msg.targetBinFallback');
    var movedSingle = valid.length === 1 ? state.index.nodes.get(valid[0]) : null;
    var msg = movedSingle
      ? t('msg.movedOne', { name: movedSingle.name, target: targetLabel })
      : t('msg.movedMany', { n: valid.length, target: targetLabel });

    await runAction(async function () {
      await bridge.moveItems(valid, targetBinId);
      if (treeView) treeView.expanded.add(targetBinId);
      await refreshProject({ silent: true, force: true });
    }, msg);
  }

  async function actionCreateBin(parentId) {
    if (!state.hasProject) { setStatus(t('msg.openProjectFirst'), true); return; }
    var targetId = parentId || state.folderId || state.index.rootId;
    var name = await promptInput(t('modal.newBinTitle'), t('modal.newBinPrompt'), t('modal.newBinDefault'));
    if (!name) return;
    await runAction(async function () {
      var created = await bridge.createBin(targetId, name);
      await refreshProject({ silent: true, force: true });
      if (created && created.id && state.index && state.index.nodes.has(created.id)) {
        navigateToFolder(created.id);
      }
    }, t('msg.binCreated', { name: name }));
  }

  function isExternalFileDrag(event) {
    if (!event || !event.dataTransfer) return false;
    var types = event.dataTransfer.types;
    if (!types) return false;
    for (var i = 0; i < types.length; i++) {
      if (types[i] === 'Files' || types[i] === 'text/uri-list') return true;
    }
    return false;
  }

  function fileUrlToNativePath(url) {
    var s = String(url || '').trim();
    if (!/^file:\/\//i.test(s)) return '';
    s = s.replace(/^file:\/\//i, '');
    try { s = decodeURIComponent(s); } catch (_) {}
    if (/^\/[A-Za-z]:\//.test(s)) s = s.slice(1);
    else if (!/^[A-Za-z]:\//.test(s) && s.charAt(0) !== '/') s = '//' + s;
    return s;
  }

  function extractExternalDropPaths(dataTransfer) {
    var paths = [];
    var seen = new Set();
    function pushPath(p) {
      var clean = String(p || '').trim();
      if (!clean) return;
      var k = clean.toLowerCase();
      if (!seen.has(k)) { seen.add(k); paths.push(clean); }
    }
    if (!dataTransfer) return paths;

    /* 1. Primary in CEP 12 (Chromium/NW.js): File.path gives full Windows path for both files & folders */
    if (dataTransfer.files && dataTransfer.files.length) {
      for (var i = 0; i < dataTransfer.files.length; i++) {
        var f = dataTransfer.files[i];
        if (f && f.path) pushPath(f.path);
      }
    }
    /* 2. Fallback: text/uri-list (file:///...) */
    if (!paths.length) {
      try {
        var uriList = dataTransfer.getData('text/uri-list') || '';
        uriList.split(/\r?\n/).forEach(function (line) {
          var l = line.trim();
          if (l && l.charAt(0) !== '#') {
            var p = fileUrlToNativePath(l);
            if (p) pushPath(p);
          }
        });
      } catch (_) {}
    }
    /* 3. Fallback: text/plain absolute file path or file:// URL */
    if (!paths.length) {
      try {
        var plain = dataTransfer.getData('text/plain') || '';
        plain.split(/\r?\n/).forEach(function (line) {
          var l = line.trim().replace(/^"|"$/g, '');
          if (/^file:\/\//i.test(l)) pushPath(fileUrlToNativePath(l));
          else if (/^(?:[A-Za-z]:[\\/]|\\\\)/.test(l)) pushPath(l);
        });
      } catch (_) {}
    }
    return paths;
  }

  function showExternalDropBanner(targetBinId) {
    var banner = $('external-drop-banner');
    if (!banner) return;
    var targetId = targetBinId || state.folderId || (state.index ? state.index.rootId : '');
    var targetNode = state.index && targetId ? state.index.nodes.get(targetId) : null;
    var name = targetNode ? (targetNode.pid ? targetNode.name : t('tree.rootName')) : t('msg.currentBinFallback');
    banner.textContent = t('msg.extDropBanner', { name: name });
    banner.classList.remove('hidden');
  }

  function hideExternalDropBanner() {
    externalDragDepth = 0;
    var banner = $('external-drop-banner');
    if (banner) banner.classList.add('hidden');
  }

  async function handleExternalDrop(targetBinId, event) {
    hideExternalDropBanner();
    if (!state.hasProject || !state.index) {
      setStatus(t('msg.openProjectBeforeDrop'), true);
      return;
    }
    var paths = extractExternalDropPaths(event && event.dataTransfer);
    if (!paths.length) {
      setStatus(t('msg.extDropNoPaths'), true);
      return;
    }
    var targetId = targetBinId || state.folderId || state.index.rootId;
    var targetNode = state.index.nodes.get(targetId);
    var targetLabel = targetNode ? (targetNode.pid ? targetNode.name : t('tree.rootName')) : t('msg.currentBinFallback');

    setStatus(t('msg.extDropImporting', { target: targetLabel }));
    await runAction(async function () {
      var res = await bridge.importExternalPaths(targetId, paths);
      if (!res || !res.imported) {
        throw new Error(t('msg.extDropEmpty'));
      }
      await refreshProject({ silent: true, force: true });
      var binsPart = res.createdBins > 0 ? t('msg.extDropBins', { n: res.createdBins }) : '';
      setStatus(t('msg.extDropDone', { files: res.importedFiles || 0, bins: binsPart, target: targetLabel }));
    });
  }

  async function actionImport(targetBinId) {
    if (!state.hasProject) { setStatus(t('msg.openProjectFirst'), true); return; }
    var targetId = targetBinId || state.folderId || state.index.rootId;
    await runAction(async function () {
      var res = await bridge.importFiles(targetId);
      if (res && res.imported) {
        await refreshProject({ silent: true, force: true });
        setStatus(t('msg.importedFiles', { n: res.count }));
      }
    });
  }

  async function actionImportFolders(targetBinId) {
    if (!state.hasProject) { setStatus(t('msg.openProjectFirst'), true); return; }
    var targetId = targetBinId || state.folderId || state.index.rootId;
    await runAction(async function () {
      var res = await bridge.importFolders(targetId);
      if (res && res.imported) {
        await refreshProject({ silent: true, force: true });
        setStatus(t('msg.importedFolder', { files: res.importedFiles || 0, bins: res.createdBins || 0 }));
      }
    });
  }

  async function actionRename(id, isTreeTarget) {
    if (!state.index || !state.index.nodes.has(id)) return;
    var node = state.index.nodes.get(id);
    if (!node.pid) { setStatus(t('msg.cannotRenameRoot'), true); return; }

    function commitRename(newName) {
      runAction(async function () {
        await bridge.renameItem(id, newName);
        await refreshProject({ silent: true, force: true });
      }, t('msg.renamed', { name: newName }));
    }

    if (isTreeTarget && treeView.startInlineRename(id, commitRename)) {
      return;
    }

    if (!isTreeTarget && gridView.cardEls.has(id)) {
      gridView.startInlineRename(id, commitRename);
      return;
    }

    if (node.isBin && treeView.startInlineRename(id, commitRename)) {
      return;
    }

    var nextName = await promptInput(t('modal.renameTitle'), t('modal.renamePrompt'), node.name);
    if (!nextName || nextName === node.name) return;
    commitRename(nextName);
  }

  async function actionMoveDialog(ids) {
    if (!state.index || !ids.length) return;
    var bins = [];
    state.index.nodes.forEach(function (n) {
      if (!n.isBin) return;
      try {
        U.validateMove(state.index.nodes, ids, n.id);
        var label = U.getAncestors(state.index.nodes, n.id).map(function (a) {
          return a.pid ? a.name : t('tree.rootName');
        }).join(' / ');
        bins.push({ id: n.id, label: label });
      } catch (_) {}
    });
    if (!bins.length) { setStatus(t('msg.noMoveTargets'), true); return; }

    var body = document.createElement('div');
    body.innerHTML = '<p class="modal-copy">' + U.escapeHtml(t('modal.movePrompt', { n: ids.length })) + '</p>';
    var select = document.createElement('select');
    select.className = 'modal-select';
    for (var i = 0; i < bins.length; i++) {
      var opt = document.createElement('option');
      opt.value = bins[i].id;
      opt.textContent = bins[i].label;
      select.appendChild(opt);
    }
    body.appendChild(select);
    var targetId = await showModal(t('modal.moveTitle'), body, t('modal.move'), function () { return select.value; });
    if (!targetId) return;

    var valid = U.validateMove(state.index.nodes, ids, targetId);
    if (!valid.length) return;
    await runAction(async function () {
      await bridge.moveItems(valid, targetId);
      await refreshProject({ silent: true, force: true });
      navigateToFolder(targetId);
    }, t('msg.movedCount', { n: valid.length }));
  }

  async function actionRemove(ids) {
    if (!state.index || !ids.length) return;
    var top = U.topLevelSelection(state.index.nodes, ids);
    if (!top.length) { setStatus(t('msg.cannotRemoveRoot'), true); return; }

    /* Only prompt when a clip (or any clip inside a folder) is referenced in one or more sequences */
    var usage = null;
    try {
      usage = await bridge.checkItemsInUse(top);
    } catch (_) {
      usage = null;
    }

    if (usage && usage.inUse) {
      var sepChar = I18n.getLang() === 'en' ? ', ' : '、';
      var seqList = (usage.sequences && usage.sequences.length)
        ? t('modal.deleteInUseSeqs', {
            list: usage.sequences.slice(0, 4).join(sepChar) + (usage.sequences.length > 4 ? t('modal.deleteInUseMore') : '')
          })
        : '';
      var ok = await confirmDialog(
        t('modal.deleteInUseTitle'),
        t('modal.deleteInUseBody', { seqs: seqList }),
        t('modal.yes'),
        true
      );
      if (!ok) return;
    }

    /* If deleting the currently open folder (or one of its ancestors), land cleanly in its parent folder */
    var fallbackParent = '';
    if (state.folderId && state.index.nodes.has(state.folderId)) {
      var curAncestors = U.getAncestors(state.index.nodes, state.folderId);
      var delSet = new Set(top);
      for (var i = 0; i < curAncestors.length; i++) {
        if (delSet.has(curAncestors[i].id)) {
          fallbackParent = curAncestors[i].pid || state.index.rootId;
          break;
        }
      }
    }

    await runAction(async function () {
      await bridge.removeItems(top);
      state.selected.clear();
      if (fallbackParent) state.folderId = fallbackParent;
      await refreshProject({ silent: true, force: true });
    }, t('msg.removedCount', { n: top.length }));
  }

  async function actionSetLabel(ids, labelIdx) {
    if (!Array.isArray(ids) || !ids.length) return;
    await runAction(async function () {
      var res = await bridge.setColorLabel(ids, labelIdx);
      await refreshProject({ silent: true, force: true });
      if (res && res.updated === 0) {
        throw new Error(t('msg.labelFailed'));
      }
      return res;
    }, function (res) {
      var count = (res && typeof res.updated === 'number') ? res.updated : ids.length;
      return t('msg.labelUpdated', { n: count, label: U.labelName(labelIdx) });
    });
  }

  async function actionCreateSequence(ids) {
    if (!state.index || !ids.length) return;
    var first = state.index.nodes.get(ids[0]);
    var defaultName = (first ? first.name.replace(/\.[^.]+$/, '') : t('modal.newSeqDefault')) + '_' + t('modal.newSeqDefault');
    var name = await promptInput(t('modal.newSeqTitle'), t('modal.newSeqPrompt'), defaultName);
    if (!name) return;
    await runAction(async function () {
      await bridge.createSequenceFromClips(ids, name, state.folderId);
      await refreshProject({ silent: true, force: true });
    }, t('msg.seqCreated', { name: name }));
  }

  async function actionRelink(id, customTitle) {
    if (!state.index || !state.index.nodes.has(id)) return;
    var node = state.index.nodes.get(id);
    var oldPath = node.path;
    await runAction(async function () {
      var res = await bridge.relinkMedia(id, oldPath, customTitle);
      if (res) {
        if (oldPath) relinkUndoMap.set(id, oldPath);
        metaCache.delete(id);
        await refreshProject({ silent: true, force: true });
        setStatus(t(customTitle ? 'msg.replacedFootage' : 'msg.relinkedMedia', { name: node.name }));
      }
    });
  }

  async function actionUndoRelink(id) {
    var prevPath = relinkUndoMap.get(id);
    if (!prevPath) return;
    await runAction(async function () {
      await bridge.relinkToPath(id, prevPath);
      relinkUndoMap.delete(id);
      metaCache.delete(id);
      await refreshProject({ silent: true, force: true });
    }, t('msg.undoRelinkDone'));
  }

  function actionCut(ids) {
    if (!state.index || !ids.length) return;
    var valid = U.topLevelSelection(state.index.nodes, ids);
    if (!valid.length) { setStatus(t('msg.cannotCutRoot'), true); return; }
    clipboard = { mode: 'cut', ids: valid };
    setStatus(t('msg.cutDone', { n: valid.length }));
  }

  function actionCopy(ids) {
    if (!state.index || !ids.length) return;
    var valid = U.topLevelSelection(state.index.nodes, ids);
    if (!valid.length) { setStatus(t('msg.cannotCopyRoot'), true); return; }
    clipboard = { mode: 'copy', ids: valid };
    setStatus(t('msg.copyDone', { n: valid.length }));
  }

  async function actionPaste(targetBinId) {
    if (!state.index || !clipboard.ids.length) return;
    var destId = targetBinId || state.folderId || state.index.rootId;
    var targetNode = state.index.nodes.get(destId);
    var targetName = targetNode ? (targetNode.pid ? targetNode.name : t('tree.rootName')) : t('msg.currentBinFallback');
    var mode = clipboard.mode;
    var srcIds = clipboard.ids.filter(function (id) { return state.index.nodes.has(id); });
    if (!srcIds.length) {
      clipboard = { mode: '', ids: [] };
      setStatus(t('msg.clipEmpty'), true);
      return;
    }

    if (mode === 'cut') {
      var valid;
      try {
        valid = U.validateMove(state.index.nodes, srcIds, destId);
      } catch (err) {
        setStatus(err.message, true);
        return;
      }
      if (!valid.length) { setStatus(t('msg.alreadyInTarget')); return; }
      await runAction(async function () {
        await bridge.moveItems(valid, destId);
        clipboard = { mode: '', ids: [] };
        if (treeView) treeView.expanded.add(destId);
        await refreshProject({ silent: true, force: true });
      }, t('msg.pastedCut', { n: valid.length, target: targetName }));
    } else {
      await runAction(async function () {
        var res = await bridge.duplicateItems(srcIds, destId);
        if (treeView) treeView.expanded.add(destId);
        await refreshProject({ silent: true, force: true });
        return res;
      }, function (res) {
        return t('msg.pastedCopy', { n: (res && res.duplicated) || srcIds.length, target: targetName });
      });
    }
  }

  async function actionDuplicate(ids) {
    if (!state.index || !ids.length) return;
    var valid = U.topLevelSelection(state.index.nodes, ids);
    if (!valid.length) { setStatus(t('msg.cannotDupRoot'), true); return; }
    await runAction(async function () {
      var res = await bridge.duplicateItems(valid, '');
      await refreshProject({ silent: true, force: true });
      return res;
    }, function (res) {
      return t('msg.dupDone', { n: (res && res.duplicated) || valid.length });
    });
  }

  function actionToggleHide(ids, shouldHide) {
    if (!state.index || !ids.length) return;
    var changed = 0;
    ids.forEach(function (id) {
      var n = state.index.nodes.get(id);
      if (!n || !n.pid) return;
      if (shouldHide) {
        if (!hiddenIds.has(id)) { hiddenIds.add(id); changed++; }
      } else {
        if (hiddenIds.delete(id)) changed++;
      }
    });
    if (!changed) return;
    saveHiddenIds();
    if (shouldHide && !state.viewHidden && hiddenIds.has(state.folderId)) {
      var cur = state.index.nodes.get(state.folderId);
      state.folderId = (cur && cur.pid) ? cur.pid : state.index.rootId;
      renderBreadcrumbs();
      updateNavButtons();
    }
    treeView.setHiddenFilter(hiddenIds, state.viewHidden);
    renderCurrentFolder({ preserveScroll: true });
    setStatus(t(shouldHide ? 'msg.hiddenDone' : 'msg.unhiddenDone', { n: changed }));
  }

  function actionToggleViewHidden() {
    state.viewHidden = !state.viewHidden;
    treeView.setHiddenFilter(hiddenIds, state.viewHidden);
    renderCurrentFolder({ preserveScroll: true });
    setStatus(t(state.viewHidden ? 'msg.viewHiddenOn' : 'msg.viewHiddenOff'));
  }

  async function actionNewBinFromSelection(ids, parentId) {
    if (!state.index || !ids.length) return;
    var valid = U.topLevelSelection(state.index.nodes, ids);
    if (!valid.length) { setStatus(t('msg.cannotActOnRoot'), true); return; }
    var first = state.index.nodes.get(valid[0]);
    var targetParent = parentId || (first && first.pid) || state.folderId || state.index.rootId;
    var name = await promptInput(t('modal.newBinFromSelTitle'), t('modal.newBinFromSelPrompt'), t('modal.newBinDefault'));
    if (!name) return;
    await runAction(async function () {
      var res = await bridge.newBinFromSelection(valid, targetParent, name);
      if (treeView) treeView.expanded.add(targetParent);
      await refreshProject({ silent: true, force: true });
      if (res && res.id && state.index && state.index.nodes.has(res.id)) {
        navigateToFolder(res.id);
      }
      return res;
    }, function (res) {
      return t('msg.newBinFromSelDone', { name: name, n: (res && res.moved) || valid.length });
    });
  }

  async function actionMakeOffline(ids) {
    if (!state.index || !ids.length) return;
    var ok = await confirmDialog(
      t('modal.makeOfflineTitle'),
      t('modal.makeOfflineBody'),
      t('modal.makeOfflineOk'),
      true
    );
    if (!ok) return;
    await runAction(async function () {
      var res = await bridge.makeOffline(ids);
      ids.forEach(function (id) { metaCache.delete(id); });
      await refreshProject({ silent: true, force: true });
      return res;
    }, function (res) {
      return t('msg.makeOfflineDone', { n: (res && res.updated) || 0 });
    });
  }

  function parseTcToSeconds(str, fps) {
    var s = String(str || '').trim();
    var rate = (Number(fps) > 0) ? Number(fps) : 25;
    var m = s.match(/^(\d+)[:;](\d+)[:;](\d+)[:;](\d+)$/);
    if (m) {
      return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + (Number(m[4]) / rate);
    }
    var m2 = s.match(/^(\d+):(\d+(?:\.\d+)?)$/);
    if (m2) return Number(m2[1]) * 60 + Number(m2[2]);
    var n = Number(s);
    return Number.isFinite(n) && n >= 0 ? n : -1;
  }

  function formatSecondsToTc(sec, fps) {
    var rate = (Number(fps) > 0) ? Math.round(Number(fps)) : 25;
    var total = Math.max(0, Math.round((Number(sec) || 0) * rate));
    var f = total % rate;
    var s = Math.floor(total / rate) % 60;
    var m = Math.floor(total / (rate * 60)) % 60;
    var h = Math.floor(total / (rate * 3600));
    var pad = function (v) { return v < 10 ? '0' + v : String(v); };
    return pad(h) + ':' + pad(m) + ':' + pad(s) + ':' + pad(f);
  }

  async function actionMediaProperties(id) {
    if (!state.index || !state.index.nodes.has(id)) return;
    var node = state.index.nodes.get(id);
    setStatus(t('msg.readingProps'));
    var results = await Promise.all([
      bridge.getItemDetails(id).catch(function () { return null; }),
      (node.path && !node.offline) ? thumbEngine.probeMedia(node.path).catch(function () { return null; }) : Promise.resolve(null)
    ]);
    var det = results[0] || {};
    var probe = results[1] || null;
    setStatus(t('status.ready'));

    var rows = [
      [t('props.name'), node.name],
      [t('props.type'), U.kindLabel(node.kind) + (node.ext ? ' (' + node.ext.toUpperCase() + ')' : '')],
      [t('props.treePath'), det.treePath || '—'],
      [t('props.filePath'), det.path || node.path || '—'],
      [t('props.status'), node.offline ? t('props.statusOffline') : t('props.statusOnline')],
      [t('props.label'), U.labelName(node.label)],
      [t('props.fileSize'), probe && probe.size ? U.formatBytes(probe.size) : '—'],
      [t('props.frameSize'), (probe && probe.width) ? (probe.width + ' × ' + probe.height) : (det.videoInfo || '—')],
      [t('props.frameRate'), det.frameRate || (probe && probe.fps ? probe.fps + ' fps' : '—')],
      [t('props.mediaRange'), (det.mediaStart || det.mediaEnd) ? ((det.mediaStart || '—') + '  →  ' + (det.mediaEnd || '—')) : '—'],
      [t('props.mediaDuration'), det.mediaDuration || (probe && probe.duration ? U.formatTime(probe.duration) : '—')],
      [t('props.videoCodec'), probe && probe.vCodec ? (probe.vCodec.toUpperCase() + (probe.pixFmt ? ' · ' + probe.pixFmt : '')) : '—'],
      [t('props.audioInfo'), det.audioInfo || (probe && probe.aCodec ? (probe.aCodec.toUpperCase() + (probe.aChannels ? ' · ' + probe.aChannels + 'ch' : '') + (probe.aRate ? ' · ' + Math.round(probe.aRate / 1000) + ' kHz' : '')) : '—')],
      [t('props.proxyStatus'), det.hasProxy ? t('props.proxyAttached', { path: det.proxyPath || t('props.proxyValid') }) : (det.canProxy ? t('props.proxyNone') : t('props.proxyUnsupported'))]
    ];
    if (det.interpretation) {
      var alphaNames = [t('props.alphaNone'), t('props.alphaStraight'), t('props.alphaPremult'), t('props.alphaIgnore')];
      rows.push([t('props.interpret'), 'PAR ' + (det.interpretation.pixelAspectRatio || 1) + ' · Alpha: ' + (alphaNames[det.interpretation.alphaUsage] || det.interpretation.alphaUsage)]);
    }

    var box = document.createElement('div');
    var table = document.createElement('div');
    table.className = 'props-table';
    rows.forEach(function (pair) {
      var k = document.createElement('div');
      k.className = 'props-k';
      k.textContent = pair[0];
      var v = document.createElement('div');
      v.className = 'props-v';
      v.textContent = pair[1];
      table.appendChild(k);
      table.appendChild(v);
    });
    box.appendChild(table);
    await showModal(t('modal.propsTitle'), box, t('modal.close'), function () { return true; }, false, { wide: true, hideCancel: true });
  }

  async function actionMakeSubclip(id) {
    if (!state.index || !state.index.nodes.has(id)) return;
    var node = state.index.nodes.get(id);
    var det = await bridge.getItemDetails(id).catch(function () { return {}; });
    var fps = U.parseFpsValue(det.frameRate || (node.meta && node.meta.fps) || '') || 25;
    var durSec = parseTcToSeconds(det.mediaDuration || (node.meta && node.meta.mediaDuration) || '', fps);
    if (!(durSec > 0)) durSec = 10;
    var startSec = (typeof det.inPoint === 'number' && det.inPoint >= 0) ? det.inPoint : 0;
    var endSec = (typeof det.outPoint === 'number' && det.outPoint > startSec) ? det.outPoint : durSec;

    var form = document.createElement('div');
    form.className = 'modal-form';
    function field(lbl, el) {
      var d = document.createElement('div');
      d.className = 'modal-field';
      var s = document.createElement('label');
      s.className = 'modal-field-label';
      s.textContent = lbl;
      d.appendChild(s);
      d.appendChild(el);
      return d;
    }

    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'modal-input';
    nameInput.value = node.name.replace(/\.[^.]+$/, '') + '_Subclip';
    form.appendChild(field(t('modal.subclipName'), nameInput));

    var row = document.createElement('div');
    row.className = 'modal-row';
    var startIn = document.createElement('input');
    startIn.type = 'text';
    startIn.className = 'modal-input';
    startIn.value = formatSecondsToTc(startSec, fps);
    var endIn = document.createElement('input');
    endIn.type = 'text';
    endIn.className = 'modal-input';
    endIn.value = formatSecondsToTc(endSec, fps);
    row.appendChild(field(t('modal.subclipIn'), startIn));
    row.appendChild(field(t('modal.subclipOut'), endIn));
    form.appendChild(row);

    var hardCb = document.createElement('input');
    hardCb.type = 'checkbox';
    hardCb.checked = true;
    var hardLbl = document.createElement('label');
    hardLbl.className = 'modal-check';
    hardLbl.appendChild(hardCb);
    hardLbl.appendChild(document.createTextNode(t('modal.subclipHard')));
    form.appendChild(hardLbl);

    var payload = await showModal(t('modal.subclipTitle', { name: node.name }), form, t('modal.create'), function () {
      var nm = nameInput.value.trim();
      var s1 = parseTcToSeconds(startIn.value, fps);
      var s2 = parseTcToSeconds(endIn.value, fps);
      if (!nm || s1 < 0 || s2 <= s1) {
        setStatus(t('msg.subclipInvalid'), true);
        return undefined;
      }
      return {
        id: id,
        name: nm,
        startTicks: String(Math.round(s1 * 254016000000)),
        endTicks: String(Math.round(s2 * 254016000000)),
        hasHardBoundaries: hardCb.checked,
        takeAudio: true,
        takeVideo: true
      };
    });
    if (!payload) return;
    await runAction(async function () {
      await bridge.createSubClip(payload);
      await refreshProject({ silent: true, force: true });
    }, t('msg.subclipDone', { name: payload.name }));
  }

  async function actionSequenceSettings(id) {
    if (!state.index || !state.index.nodes.has(id)) return;
    var node = state.index.nodes.get(id);
    var cur;
    try {
      cur = await bridge.getSequenceSettings(id);
    } catch (err) {
      setStatus(err.message || String(err), true);
      return;
    }

    var form = document.createElement('div');
    form.className = 'modal-form';
    function field(lbl, el) {
      var d = document.createElement('div');
      d.className = 'modal-field';
      var s = document.createElement('label');
      s.className = 'modal-field-label';
      s.textContent = lbl;
      d.appendChild(s);
      d.appendChild(el);
      return d;
    }

    var row = document.createElement('div');
    row.className = 'modal-row';
    var wIn = document.createElement('input');
    wIn.type = 'number';
    wIn.className = 'modal-input';
    wIn.value = String(cur.videoFrameWidth || 1920);
    var hIn = document.createElement('input');
    hIn.type = 'number';
    hIn.className = 'modal-input';
    hIn.value = String(cur.videoFrameHeight || 1080);
    row.appendChild(field(t('modal.seqWidth'), wIn));
    row.appendChild(field(t('modal.seqHeight'), hIn));
    form.appendChild(row);

    var fpsIn = document.createElement('input');
    fpsIn.type = 'number';
    fpsIn.step = '0.001';
    fpsIn.className = 'modal-input';
    fpsIn.value = cur.frameRateFps ? String(cur.frameRateFps) : '25';
    form.appendChild(field(t('modal.seqFps'), fpsIn));

    var payload = await showModal(t('modal.seqSettingsTitle', { name: node.name }), form, t('modal.apply'), function () {
      var w = Number(wIn.value), h = Number(hIn.value), f = Number(fpsIn.value);
      if (!(w >= 64 && h >= 64)) return undefined;
      return { id: id, videoFrameWidth: w, videoFrameHeight: h, frameRateFps: f > 0 ? f : 0 };
    });
    if (!payload) return;
    await runAction(async function () {
      await bridge.setSequenceSettings(payload);
      metaCache.delete(id);
      await refreshProject({ silent: true, force: true });
    }, t('msg.seqSettingsDone', { name: node.name, w: payload.videoFrameWidth, h: payload.videoFrameHeight }));
  }

  async function actionAutoReframe(id) {
    if (!state.index || !state.index.nodes.has(id)) return;
    var node = state.index.nodes.get(id);
    var form = document.createElement('div');
    form.className = 'modal-form';
    function field(lbl, el) {
      var d = document.createElement('div');
      d.className = 'modal-field';
      var s = document.createElement('label');
      s.className = 'modal-field-label';
      s.textContent = lbl;
      d.appendChild(s);
      d.appendChild(el);
      return d;
    }

    var nameIn = document.createElement('input');
    nameIn.type = 'text';
    nameIn.className = 'modal-input';
    nameIn.value = node.name + '_9x16';
    form.appendChild(field(t('modal.autoReframeName'), nameIn));

    var row = document.createElement('div');
    row.className = 'modal-row';
    var ratioSel = document.createElement('select');
    ratioSel.className = 'modal-select';
    [
      ['9:16', t('modal.ratio916')],
      ['1:1', t('modal.ratio11')],
      ['4:5', t('modal.ratio45')],
      ['16:9', t('modal.ratio169')],
      ['4:3', t('modal.ratio43')]
    ].forEach(function (r) {
      var o = document.createElement('option');
      o.value = r[0];
      o.textContent = r[1];
      ratioSel.appendChild(o);
    });
    ratioSel.addEventListener('change', function () {
      nameIn.value = node.name + '_' + ratioSel.value.replace(':', 'x');
    });

    var motionSel = document.createElement('select');
    motionSel.className = 'modal-select';
    [
      ['Default', t('modal.motionDefault')],
      ['Slower Motion', t('modal.motionSlow')],
      ['Faster Motion', t('modal.motionFast')]
    ].forEach(function (m) {
      var o = document.createElement('option');
      o.value = m[0];
      o.textContent = m[1];
      motionSel.appendChild(o);
    });
    row.appendChild(field(t('modal.autoReframeRatio'), ratioSel));
    row.appendChild(field(t('modal.autoReframeMotion'), motionSel));
    form.appendChild(row);

    var nestCb = document.createElement('input');
    nestCb.type = 'checkbox';
    var nestLbl = document.createElement('label');
    nestLbl.className = 'modal-check';
    nestLbl.appendChild(nestCb);
    nestLbl.appendChild(document.createTextNode(t('modal.autoReframeNest')));
    form.appendChild(nestLbl);

    var payload = await showModal(t('modal.autoReframeTitle', { name: node.name }), form, t('modal.create'), function () {
      var parts = ratioSel.value.split(':');
      return {
        id: id,
        numerator: Number(parts[0]) || 9,
        denominator: Number(parts[1]) || 16,
        motionPreset: motionSel.value,
        newName: nameIn.value.trim() || (node.name + '_Reframe'),
        useNested: nestCb.checked
      };
    });
    if (!payload) return;
    await runAction(async function () {
      var res = await bridge.autoReframeSequence(payload);
      await refreshProject({ silent: true, force: true });
      return res;
    }, function (res) {
      return t('msg.autoReframeDone', { name: (res && res.name) || payload.newName });
    });
  }

  function collectOfflineIdsInBin(binId) {
    var out = [];
    if (!state.index || !binId) return out;
    var stack = [binId];
    var seen = new Set();
    while (stack.length > 0) {
      var cur = stack.pop();
      if (!cur || seen.has(cur)) continue;
      seen.add(cur);
      var kids = state.index.childrenByParent.get(cur) || [];
      for (var i = 0; i < kids.length; i++) {
        var k = kids[i];
        if (k.isBin) {
          stack.push(k.id);
        } else if (!k.isSeq && k.offline) {
          out.push(k.id);
        }
      }
    }
    return out;
  }

  async function actionLinkMediaNative(offlineIds, fallbackSingleId, sourceBinId) {
    if (!state.index) return;
    var targetIds = (offlineIds || []).filter(function (x) { return state.index.nodes.has(x); });
    if (!targetIds.length) {
      setStatus(t('msg.noOfflineInSel'), true);
      return;
    }
    var binNode = sourceBinId ? state.index.nodes.get(sourceBinId) : null;
    var primarySelect = (binNode && binNode.isBin && binNode.pid) ? [binNode.id] : targetIds;

    await runAction(async function () {
      state.suppressSyncUntil = Date.now() + 2000;
      await bridge.selectItems(primarySelect);
      try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (_) {}
      var res = await bridge.triggerNativeMenuAction('link-media');

      /* If selecting the bin returned DISABLED (e.g. mixed/collapsed state), retry with the exact offline clip IDs */
      if ((!res || !res.ok) && primarySelect !== targetIds) {
        await bridge.selectItems(targetIds);
        res = await bridge.triggerNativeMenuAction('link-media');
      }

      /* Arm fast online-recovery polling so PrBinView auto-refreshes right after user finishes in Pr Link Media dialog */
      state.projectLoadedAt = Date.now();
      lastOfflineCheckAt = 0;
      if (res && res.ok) {
        return { native: true, count: targetIds.length };
      }
      if (targetIds.length === 1 && fallbackSingleId) {
        var n = state.index.nodes.get(fallbackSingleId);
        var rel = await bridge.relinkMedia(fallbackSingleId, n ? n.path : '', t('picker.linkSingle'));
        if (rel) {
          metaCache.delete(fallbackSingleId);
          await refreshProject({ silent: true, force: true });
          return { singleRelinked: true };
        }
        return { cancelled: true };
      }

      /* Seamless batch folder relink fallback when Premiere 2027 custom menu bar has no HMENU/UIA MenuBar */
      var offlineNodes = targetIds.map(function (oid) {
        var nd = state.index.nodes.get(oid);
        return { id: oid, name: nd ? nd.name : '', path: nd ? nd.path : '' };
      });
      var pathMod = U.nodeRequire('path');
      var guessDir = '';
      for (var gi = 0; gi < offlineNodes.length; gi++) {
        if (offlineNodes[gi].path && pathMod) {
          guessDir = pathMod.dirname(offlineNodes[gi].path);
          break;
        }
      }
      var batch = await bridge.relinkFolderBatch(offlineNodes, guessDir);
      if (batch && batch.cancelled) return { cancelled: true };
      if (batch && batch.linked > 0) {
        targetIds.forEach(function (oid) { metaCache.delete(oid); });
        await refreshProject({ silent: true, force: true });
        return { batchLinked: batch.linked, total: targetIds.length };
      }
      throw new Error(t('msg.linkBatchNoMatch', { scanned: (batch && batch.scanned) || 0 }));
    }, function (r) {
      if (r && r.native) return t('msg.linkNativeOpened', { n: r.count });
      if (r && r.singleRelinked) return t('msg.linkSingleDone');
      if (r && r.batchLinked) return t('msg.linkBatchDone', { linked: r.batchLinked, total: r.total });
      return '';
    });
  }

  async function actionExportMedia(id) {
    if (!state.index || !state.index.nodes.has(id)) return;
    var node = state.index.nodes.get(id);
    if (!bridge.isDemo) {
      var nativeDone = false;
      await runAction(async function () {
        state.suppressSyncUntil = Date.now() + 1500;
        if (node.isSeq) {
          await bridge.openItem(id, false);
        }
        await bridge.selectItems([id]);
        try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (_) {}
        var res = await bridge.triggerNativeMenuAction('export-media');
        if (res && res.ok) {
          nativeDone = true;
          return true;
        }
        return false;
      }, function (ok) {
        return ok ? t('msg.exportSwitched', { name: node.name }) : '';
      });
      if (nativeDone) return;
    }

    var presets = bridge.discoverExportPresets ? bridge.discoverExportPresets() : [];
    var pathMod = U.nodeRequire('path');
    var defaultDir = (node.path && pathMod) ? pathMod.dirname(node.path) : ((state.projectPath && pathMod) ? pathMod.dirname(state.projectPath) : '');
    var stem = node.name.replace(/\.[^.]+$/, '') + '_export.mp4';

    var form = document.createElement('div');
    form.className = 'modal-form';
    function field(lbl, el) {
      var d = document.createElement('div');
      d.className = 'modal-field';
      var s = document.createElement('label');
      s.className = 'modal-field-label';
      s.textContent = lbl;
      d.appendChild(s);
      d.appendChild(el);
      return d;
    }

    var dirRow = document.createElement('div');
    dirRow.className = 'modal-inline-row';
    var dirIn = document.createElement('input');
    dirIn.type = 'text';
    dirIn.className = 'modal-input';
    dirIn.value = defaultDir;
    dirIn.placeholder = t('modal.exportDirPlaceholder');
    var dirBtn = document.createElement('button');
    dirBtn.type = 'button';
    dirBtn.className = 'btn';
    dirBtn.textContent = t('modal.browse');
    dirBtn.addEventListener('click', async function () {
      var picked = await bridge.pickExportFolder(dirIn.value);
      if (picked) dirIn.value = picked;
    });
    dirRow.appendChild(dirIn);
    dirRow.appendChild(dirBtn);
    form.appendChild(field(t('modal.exportDir'), dirRow));

    var fileIn = document.createElement('input');
    fileIn.type = 'text';
    fileIn.className = 'modal-input';
    fileIn.value = stem;
    form.appendChild(field(t('modal.exportFile'), fileIn));

    var presetRow = document.createElement('div');
    presetRow.className = 'modal-inline-row';
    var presetSel = document.createElement('select');
    presetSel.className = 'modal-select';
    if (presets.length) {
      presets.forEach(function (pr) {
        var o = document.createElement('option');
        o.value = pr.path;
        o.textContent = pr.label;
        presetSel.appendChild(o);
      });
    } else {
      var emptyOpt = document.createElement('option');
      emptyOpt.value = '';
      emptyOpt.textContent = t('modal.exportNoPreset');
      presetSel.appendChild(emptyOpt);
    }
    var presetBtn = document.createElement('button');
    presetBtn.type = 'button';
    presetBtn.className = 'btn';
    presetBtn.textContent = t('modal.exportPickPreset');
    presetBtn.addEventListener('click', async function () {
      var picked = await bridge.pickPresetFile();
      if (picked) {
        var o = document.createElement('option');
        o.value = picked;
        o.textContent = pathMod ? pathMod.basename(picked) : picked;
        o.selected = true;
        presetSel.appendChild(o);
      }
    });
    presetRow.appendChild(presetSel);
    presetRow.appendChild(presetBtn);
    form.appendChild(field(t('modal.exportPreset'), presetRow));

    var payload = await showModal(t('modal.exportTitle', { name: node.name }), form, t('modal.exportSend'), function () {
      var outDir = dirIn.value.trim();
      var fName = fileIn.value.trim();
      var pPath = presetSel.value;
      if (!outDir || !fName || !pPath) {
        setStatus(t('msg.exportInvalid'), true);
        return undefined;
      }
      var fullOut = pathMod ? pathMod.join(outDir, fName) : (outDir + '\\' + fName);
      return { id: id, outputPath: fullOut, presetPath: pPath };
    }, false, { wide: true });
    if (!payload) return;
    await runAction(function () { return bridge.exportToAME(payload); }, t('msg.exportAmeDone', { name: node.name }));
  }

  function actionFindGlobal() {
    if (!state.globalSearch) {
      state.globalSearch = true;
      $('toggle-global-search').classList.add('is-active');
    }
    var inp = $('search-input');
    inp.focus();
    inp.select();
  }

  /* ==================== CONTEXT MENU (PREMIERE-NATIVE + SUBMENUS) ==================== */

  function closeSubmenu() {
    clearTimeout(submenuCloseTimer);
    submenuCloseTimer = 0;
    if (activeSubmenuBtn) {
      activeSubmenuBtn.classList.remove('is-sub-open');
      activeSubmenuBtn = null;
    }
    var sub = $('context-submenu');
    if (sub) {
      sub.classList.add('hidden');
      sub.innerHTML = '';
    }
  }

  function closeContextMenu() {
    closeSubmenu();
    state.menuOpen = false;
    $('context-menu').classList.add('hidden');
  }

  function openSubmenu(anchorBtn, subItems) {
    closeSubmenu();
    if (!subItems || !subItems.length) return;
    var sub = $('context-submenu');
    sub.innerHTML = '';
    renderMenuEntries(sub, subItems, true);
    sub.classList.remove('hidden');
    anchorBtn.classList.add('is-sub-open');
    activeSubmenuBtn = anchorBtn;

    var aRect = anchorBtn.getBoundingClientRect();
    var sRect = sub.getBoundingClientRect();
    var vw = window.innerWidth, vh = window.innerHeight;
    var left = (aRect.right + sRect.width + 6 <= vw)
      ? (aRect.right - 2)
      : Math.max(6, aRect.left - sRect.width + 2);
    var top = Math.max(6, Math.min(aRect.top - 4, vh - sRect.height - 8));
    sub.style.left = left + 'px';
    sub.style.top = top + 'px';
  }

  function renderMenuEntries(container, entries, isSub) {
    entries.forEach(function (entry) {
      if (entry.sep) {
        var hr = document.createElement('div');
        hr.className = 'menu-sep';
        container.appendChild(hr);
      } else if (entry.labelPicker) {
        var targetIds = entry.ids.slice();
        var wrap = document.createElement('div');
        wrap.className = 'menu-labels';
        var cap = document.createElement('div');
        cap.className = 'menu-labels-cap';
        cap.textContent = t('menu.labelCap');
        wrap.appendChild(cap);
        var swatches = document.createElement('div');
        swatches.className = 'menu-swatches';
        U.LABEL_COLORS.forEach(function (lc) {
          var sw = document.createElement('button');
          sw.type = 'button';
          sw.className = 'swatch' + (lc.index === entry.activeLabel ? ' is-current' : '');
          sw.style.backgroundColor = lc.color;
          sw.title = lc.index + ' · ' + U.labelName(lc.index);
          sw.addEventListener('click', function () {
            closeContextMenu();
            actionSetLabel(targetIds, lc.index);
          });
          swatches.appendChild(sw);
        });
        wrap.appendChild(swatches);
        container.appendChild(wrap);
      } else {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'menu-item' + (entry.danger ? ' is-danger' : '');
        if (entry.disabled) btn.disabled = true;

        var lblSpan = document.createElement('span');
        lblSpan.className = 'menu-item-label';
        lblSpan.textContent = entry.label;
        btn.appendChild(lblSpan);

        if (entry.hint) {
          var hintSpan = document.createElement('span');
          hintSpan.className = 'menu-item-hint';
          hintSpan.textContent = entry.hint;
          btn.appendChild(hintSpan);
        }
        if (entry.submenu) {
          var arr = document.createElement('span');
          arr.className = 'menu-item-arrow';
          arr.textContent = '▸';
          btn.appendChild(arr);
        }

        if (!isSub) {
          btn.addEventListener('mouseenter', function () {
            clearTimeout(submenuCloseTimer);
            if (entry.submenu && !entry.disabled) {
              openSubmenu(btn, entry.submenu);
            } else {
              closeSubmenu();
            }
          });
        }

        if (entry.submenu && !entry.disabled) {
          btn.addEventListener('click', function (e) {
            e.stopPropagation();
            openSubmenu(btn, entry.submenu);
          });
        } else if (!entry.disabled && entry.fn) {
          btn.addEventListener('click', function () {
            closeContextMenu();
            entry.fn();
          });
        }
        container.appendChild(btn);
      }
    });
  }

  function openContextMenu(event, id, source) {
    if (!state.hasProject || !state.index) return;
    closeContextMenu();
    var menu = $('context-menu');
    menu.innerHTML = '';

    var node = id ? state.index.nodes.get(id) : null;
    var ids = (source === 'tree' && node) ? [node.id] : selectedIds();
    if (node && ids.indexOf(node.id) === -1) ids = [node.id];
    var single = ids.length === 1;
    var isBin = !!(node && node.isBin);
    var isRoot = !!(node && !node.pid);
    var isMedia = !!(node && !node.isBin);
    var isSeq = !!(node && node.isSeq);
    var isClip = isMedia && !isSeq;
    var targetBin = isBin ? node.id : (state.folderId || state.index.rootId);
    var hasClipboard = clipboard.ids.length > 0;
    var anyHiddenSel = ids.some(function (x) { return hiddenIds.has(x); });

    var items = [];
    function add(label, fn, opts) {
      items.push(Object.assign({ label: label, fn: fn }, opts || {}));
    }
    function sep() { items.push({ sep: true }); }

    if (isMedia) {
      var offlineSelIds = ids.filter(function (x) {
        var nd = state.index.nodes.get(x);
        return nd && !nd.isBin && !nd.isSeq && nd.offline;
      });
      /* === Premiere Pro Native Clip / Sequence Context Menu === */
      add(t('menu.cut'), function () { actionCut(ids); }, { hint: 'Ctrl+X' });
      add(t('menu.copy'), function () { actionCopy(ids); }, { hint: 'Ctrl+C' });
      add(t('menu.paste'), function () { actionPaste(targetBin); }, { hint: 'Ctrl+V', disabled: !hasClipboard });
      add(t('menu.clear'), function () { actionRemove(ids); }, { hint: 'Del', danger: true });
      sep();
      add(t('menu.duplicate'), function () { actionDuplicate(ids); }, { hint: 'Ctrl+D' });
      add(t('menu.clearInOut'), function () {
        runAction(function () { return bridge.clearInOut(ids); }, t('msg.clearedInOut'));
      }, { disabled: isSeq });
      sep();
      add(t(anyHiddenSel ? 'menu.unhide' : 'menu.hide'), function () { actionToggleHide(ids, !anyHiddenSel); });
      add((state.viewHidden ? '✓ ' : '') + t('menu.viewHidden'), function () { actionToggleViewHidden(); });
      sep();
      add(t('menu.mediaProps'), function () { actionMediaProperties(node.id); }, { disabled: !single });
      add(t('menu.seqSettings'), function () { actionSequenceSettings(node.id); }, { disabled: !single || !isSeq });
      add(t('menu.revealExplorer'), function () {
        if (!bridge.revealInExplorer(node.path)) setStatus(t('msg.revealUnsupported'), true);
        else setStatus(t('msg.revealDone'));
      }, { disabled: !single || !node.path || node.offline });
      add(t('menu.rename'), function () { actionRename(node.id, false); }, { hint: 'F2', disabled: !single });
      add(t('menu.moveToBin'), function () { actionMoveDialog(ids); });
      sep();
      add(t('menu.insert'), function () {
        runAction(function () { return bridge.insertToTimeline(ids, 'insert'); }, function (r) {
          return t('msg.insertedTimeline', { n: r.placed, seq: r.sequenceName });
        });
      });
      add(t('menu.overwrite'), function () {
        runAction(function () { return bridge.insertToTimeline(ids, 'overwrite'); }, function (r) {
          return t('msg.overwroteTimeline', { n: r.placed, seq: r.sequenceName });
        });
      });
      sep();
      add(t('menu.autoReframe'), function () { actionAutoReframe(node.id); }, { disabled: !single || !isSeq });
      add(t('menu.newBinFromSel'), function () { actionNewBinFromSelection(ids, node.pid || state.folderId); });
      add(t('menu.newSeqFromClip'), function () { actionCreateSequence(ids); });
      sep();
      add(t('menu.replaceFootage'), function () { actionRelink(node.id, t('picker.replaceFootage')); }, { disabled: !single || isSeq || node.offline });
      add(t('menu.linkMedia'), function () { actionLinkMediaNative(offlineSelIds, single ? node.id : ''); }, { disabled: !offlineSelIds.length });
      if (single && relinkUndoMap.has(node.id)) {
        add(t('menu.undoReplace'), function () { actionUndoRelink(node.id); });
      }
      add(t('menu.makeOffline'), function () { actionMakeOffline(ids); }, { disabled: isSeq || node.offline });
      add(t('menu.refreshMedia'), function () {
        runAction(async function () {
          await bridge.refreshMedia(ids);
          await refreshProject({ silent: true, force: true });
        }, t('msg.refreshedMedia'));
      }, { disabled: isSeq });
      sep();
      items.push({ labelPicker: true, ids: ids, activeLabel: node.label });
      sep();
      add(t('menu.makeSubclip'), function () { actionMakeSubclip(node.id); }, { disabled: !single || isSeq || node.offline });
      sep();
      add(t(isSeq ? 'menu.openTimeline' : 'menu.openSource'), function () {
        runAction(
          function () { return bridge.openItem(node.id, false); },
          t(isSeq ? 'msg.openedTimeline' : 'msg.openedSource', { name: node.name })
        );
      }, { hint: 'Space', disabled: !single });
      if (isClip) {
        add(t('menu.playSource'), function () {
          runAction(function () { return bridge.openItem(node.id, true); }, t('msg.playedSource', { name: node.name }));
        }, { disabled: !single });
      }
      sep();
      add(t('menu.editOriginal'), function () {
        if (!bridge.editOriginal(node.path)) setStatus(t('msg.editOrigFailed'), true);
        else setStatus(t('msg.editOrigDone', { name: node.name }));
      }, { disabled: !single || !node.path || node.offline });
      add(t('menu.editAudition'), function () {
        var r = bridge.editInAdobeApp('audition', node.path);
        setStatus(r.ok ? t('msg.openedInApp', { app: r.appName, name: node.name }) : r.error, !r.ok);
      }, { disabled: !single || !node.path || node.offline || (node.kind !== 'audio' && node.kind !== 'video') });
      add(t('menu.editPhotoshop'), function () {
        var r = bridge.editInAdobeApp('photoshop', node.path);
        setStatus(r.ok ? t('msg.openedInApp', { app: r.appName, name: node.name }) : r.error, !r.ok);
      }, { disabled: !single || !node.path || node.offline || node.kind !== 'image' });
      sep();
      add(t('menu.exportMedia'), function () { actionExportMedia(node.id); }, { disabled: !single || node.offline });
    } else if (isBin) {
      var offlineInBin = collectOfflineIdsInBin(node.id);
      /* === Premiere Pro Native Bin Context Menu === */
      add(t('menu.cut'), function () { actionCut(ids); }, { hint: 'Ctrl+X', disabled: isRoot });
      add(t('menu.copy'), function () { actionCopy(ids); }, { hint: 'Ctrl+C', disabled: isRoot });
      add(t('menu.paste'), function () { actionPaste(targetBin); }, { hint: 'Ctrl+V', disabled: !hasClipboard });
      add(t('menu.clear'), function () { actionRemove(ids); }, { hint: 'Del', danger: true, disabled: isRoot });
      sep();
      add(t('menu.duplicate'), function () { actionDuplicate(ids); }, { hint: 'Ctrl+D', disabled: isRoot });
      sep();
      add(t(anyHiddenSel ? 'menu.unhide' : 'menu.hide'), function () { actionToggleHide(ids, !anyHiddenSel); }, { disabled: isRoot });
      add((state.viewHidden ? '✓ ' : '') + t('menu.viewHidden'), function () { actionToggleViewHidden(); });
      sep();
      add(t('menu.newBin'), function () { actionCreateBin(targetBin); });
      add(t('menu.newBinFromSel'), function () { actionNewBinFromSelection(ids, node.pid || state.index.rootId); }, { disabled: isRoot });
      add(t('menu.import'), function () { actionImport(targetBin); });
      add(t('menu.importFolder'), function () { actionImportFolders(targetBin); });
      sep();
      add(t('menu.linkMedia') + (offlineInBin.length ? (' (' + offlineInBin.length + ')') : ''), function () {
        actionLinkMediaNative(offlineInBin, '', node.id);
      }, { disabled: !offlineInBin.length });
      add(t('menu.makeOffline'), function () { actionMakeOffline(ids); });
      add(t('menu.refreshBinMedia'), function () {
        runAction(async function () {
          var res = await bridge.refreshMedia(ids);
          await refreshProject({ silent: true, force: true });
          return res;
        }, function (res) {
          return t('msg.refreshedBinMedia', { n: (res && res.updated) || 0 });
        });
      });
      sep();
      add(t('menu.rename'), function () { actionRename(node.id, source === 'tree'); }, { hint: 'F2', disabled: !single || isRoot });
      add(t('menu.moveToBin'), function () { actionMoveDialog(ids); }, { disabled: isRoot });
      add(t('menu.find'), function () { actionFindGlobal(); }, { hint: 'Ctrl+F' });
      if (!isRoot) {
        sep();
        items.push({ labelPicker: true, ids: ids, activeLabel: node.label });
      }
    } else {
      /* === Blank Area Context Menu === */
      add(t('menu.paste'), function () { actionPaste(targetBin); }, { hint: 'Ctrl+V', disabled: !hasClipboard });
      sep();
      add(t('menu.newBin'), function () { actionCreateBin(targetBin); });
      add(t('menu.import'), function () { actionImport(targetBin); });
      add(t('menu.importFolder'), function () { actionImportFolders(targetBin); });
      sep();
      add((state.viewHidden ? '✓ ' : '') + t('menu.viewHidden'), function () { actionToggleViewHidden(); });
      add(t('menu.find'), function () { actionFindGlobal(); }, { hint: 'Ctrl+F' });
      sep();
      add(t('menu.refreshProject'), function () { refreshProject(); }, { hint: 'F5' });
    }

    renderMenuEntries(menu, items, false);

    menu.classList.remove('hidden');
    state.menuOpen = true;
    var vw = window.innerWidth, vh = window.innerHeight;
    var rect = menu.getBoundingClientRect();
    var left = Math.max(6, Math.min(event.clientX, vw - rect.width - 8));
    var top = Math.max(6, Math.min(event.clientY, vh - rect.height - 8));
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }

  /* ==================== LIGHTWEIGHT MODAL DIALOG ==================== */

  function closeModal(val) {
    if (!modalResolve) return;
    var r = modalResolve;
    modalResolve = null;
    state.modalOpen = false;
    $('modal-backdrop').classList.add('hidden');
    var card = $('modal-backdrop').querySelector('.modal-card');
    if (card) card.classList.remove('is-wide');
    $('modal-cancel').classList.remove('hidden');
    $('modal-body').innerHTML = '';
    r(val);
  }

  function showModal(title, bodyEl, okText, collectFn, danger, opts) {
    if (modalResolve) return Promise.resolve(null);
    var options = opts || {};
    state.modalOpen = true;
    var card = $('modal-backdrop').querySelector('.modal-card');
    if (card) card.classList.toggle('is-wide', !!options.wide);
    $('modal-cancel').textContent = t('modal.cancel');
    $('modal-cancel').classList.toggle('hidden', !!options.hideCancel);
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = '';
    $('modal-body').appendChild(bodyEl);
    var okBtn = $('modal-ok');
    okBtn.textContent = okText || t('modal.ok');
    okBtn.classList.toggle('btn-danger', !!danger);
    okBtn.classList.toggle('btn-primary', !danger);
    $('modal-backdrop').classList.remove('hidden');

    return new Promise(function (resolve) {
      modalResolve = resolve;
      $('modal-ok').onclick = function () {
        var value = collectFn ? collectFn() : true;
        if (value === undefined) return;
        closeModal(value);
      };
    });
  }

  function promptInput(title, labelText, initialValue) {
    var box = document.createElement('div');
    var p = document.createElement('p');
    p.className = 'modal-copy';
    p.textContent = labelText;
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'modal-input';
    input.value = initialValue || '';
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var v = input.value.trim();
        if (v) closeModal(v);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeModal(null);
      }
    });
    box.appendChild(p);
    box.appendChild(input);
    var promise = showModal(title, box, t('modal.ok'), function () {
      var v = input.value.trim();
      if (!v) { input.focus(); return undefined; }
      return v;
    });
    setTimeout(function () { input.focus(); input.select(); }, 20);
    return promise;
  }

  function confirmDialog(title, message, okText, danger) {
    var box = document.createElement('div');
    var p = document.createElement('p');
    p.className = 'modal-copy';
    p.textContent = message;
    box.appendChild(p);
    return showModal(title, box, okText || t('modal.ok'), function () { return true; }, danger);
  }

  /* ==================== SIDEBAR & RESPONSIVE SPLITTERS ==================== */

  function applySidebarState() {
    var sidebar = $('sidebar');
    var splitter = $('sidebar-splitter');
    sidebar.classList.toggle('is-collapsed', !state.sidebarOpen);
    splitter.classList.toggle('hidden', !state.sidebarOpen);
    $('btn-toggle-sidebar').classList.toggle('is-active', state.sidebarOpen);
  }

  function handleResponsiveLayout() {
    if (state.sidebarManual) return;
    var narrow = window.innerWidth < 540;
    if (state.sidebarOpen === narrow) {
      state.sidebarOpen = !narrow;
      applySidebarState();
    }
  }

  function bindSplitter(splitterEl, targetEl, cssProp, minPx, maxPx, invert, prefKey) {
    var startX = 0, startW = 0, dragging = false;
    splitterEl.addEventListener('mousedown', function (e) {
      e.preventDefault();
      dragging = true;
      startX = e.clientX;
      startW = targetEl.getBoundingClientRect().width;
      splitterEl.classList.add('is-dragging');
      document.body.classList.add('is-resizing');
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var delta = invert ? (startX - e.clientX) : (e.clientX - startX);
      var next = Math.max(minPx, Math.min(maxPx, Math.round(startW + delta)));
      targetEl.style[cssProp] = next + 'px';
    });
    window.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      splitterEl.classList.remove('is-dragging');
      document.body.classList.remove('is-resizing');
      if (prefKey) persistPref(prefKey, Math.round(targetEl.getBoundingClientRect().width));
    });
  }

  /* ==================== UI BINDINGS ==================== */

  function bindUI() {
    /* Inject crisp SVG icons into toolbar buttons */
    $('btn-toggle-sidebar').innerHTML = U.ICONS.sidebar;
    $('btn-back').innerHTML = U.ICONS.back;
    $('btn-forward').innerHTML = U.ICONS.forward;
    $('btn-up').innerHTML = U.ICONS.up;
    $('search-icon').innerHTML = U.ICONS.search;
    $('btn-col-settings').innerHTML = U.ICONS.columns;
    $('btn-view-grid').innerHTML = U.ICONS.grid;
    $('btn-view-list').innerHTML = U.ICONS.list;
    $('btn-new-bin').innerHTML = U.ICONS.plus + '<span>' + U.escapeHtml(t('top.newBin')) + '</span>';
    $('btn-import').innerHTML = U.ICONS.importFile + '<span>' + U.escapeHtml(t('top.import')) + '</span>';
    $('btn-import-folder').innerHTML = U.ICONS.importFolder + '<span>' + U.escapeHtml(t('top.importFolder')) + '</span>';
    $('btn-refresh').innerHTML = U.ICONS.refresh;

    /* Restore saved language before building headers & chrome */
    var savedLang = readPref('lang', 'zh');
    applyLanguage(savedLang === 'en' ? 'en' : 'zh', { skipRerender: true, silent: true });

    var langBtn = $('btn-lang');
    if (langBtn) {
      langBtn.addEventListener('click', function () {
        applyLanguage(I18n.getLang() === 'zh' ? 'en' : 'zh');
      });
    }

    /* Restore saved preferences */
    loadColumnPrefs();

    var savedSortBy = readPref('sortBy', 'name');
    if (columnsConfig.some(function (c) { return c.id === savedSortBy; })) state.sortBy = savedSortBy;
    state.sortDir = readPref('sortDir', 'asc') === 'desc' ? 'desc' : 'asc';

    var savedTreeSort = readPref('treeSortBy', 'name');
    if (/^(name|count|label|order)$/.test(savedTreeSort)) state.treeSortBy = savedTreeSort;
    state.treeSortDir = readPref('treeSortDir', 'asc') === 'desc' ? 'desc' : 'asc';
    $('tree-sort-select').value = state.treeSortBy;
    $('btn-tree-sort-dir').textContent = state.treeSortDir === 'asc' ? '↑' : '↓';
    $('btn-tree-sort-dir').title = state.treeSortDir === 'asc' ? t('sidebar.sortDirAsc') : t('sidebar.sortDirDesc');
    treeView.setSort(state.treeSortBy, state.treeSortDir);

    var savedW = Number(readPref('cardWidth', '184'));
    if (Number.isFinite(savedW) && savedW >= 120 && savedW <= 340) state.cardWidth = savedW;
    $('thumb-size').value = String(state.cardWidth);
    gridView.setCardWidth(state.cardWidth);

    var savedTreeSize = Number(readPref('treeSize', '27'));
    if (Number.isFinite(savedTreeSize) && savedTreeSize >= 22 && savedTreeSize <= 44) state.treeSize = savedTreeSize;
    $('tree-size').value = String(state.treeSize);
    treeView.setItemSize(state.treeSize);

    var savedSidebarW = Number(readPref('sidebarWidth', '220'));
    if (Number.isFinite(savedSidebarW) && savedSidebarW >= 150 && savedSidebarW <= 420) {
      $('sidebar').style.width = savedSidebarW + 'px';
    }

    var savedView = readPref('viewMode', 'grid');
    state.viewMode = savedView === 'list' ? 'list' : 'grid';
    gridView.setViewMode(state.viewMode);
    $('btn-view-grid').classList.toggle('is-active', state.viewMode === 'grid');
    $('btn-view-list').classList.toggle('is-active', state.viewMode === 'list');
    renderColumnHeader();

    bindSplitter($('sidebar-splitter'), $('sidebar'), 'width', 150, 420, false, 'sidebarWidth');

    $('btn-toggle-sidebar').addEventListener('click', function () {
      state.sidebarManual = true;
      state.sidebarOpen = !state.sidebarOpen;
      applySidebarState();
    });

    $('btn-back').addEventListener('click', function () {
      if (state.historyPos > 0) {
        state.historyPos -= 1;
        navigateToFolder(state.history[state.historyPos], { skipHistory: true });
      }
    });
    $('btn-forward').addEventListener('click', function () {
      if (state.historyPos < state.history.length - 1) {
        state.historyPos += 1;
        navigateToFolder(state.history[state.historyPos], { skipHistory: true });
      }
    });
    $('btn-up').addEventListener('click', function () {
      var cur = state.index && state.index.nodes.get(state.folderId);
      if (cur && cur.pid) navigateToFolder(cur.pid);
    });

    /* Search */
    $('search-input').addEventListener('input', function (e) {
      clearTimeout(searchTimer);
      var val = e.target.value;
      $('btn-search-clear').classList.toggle('hidden', !val);
      searchTimer = setTimeout(function () {
        state.query = val;
        renderCurrentFolder();
      }, 70);
    });
    $('btn-search-clear').addEventListener('click', function () {
      $('search-input').value = '';
      $('btn-search-clear').classList.add('hidden');
      state.query = '';
      renderCurrentFolder();
    });

    $('toggle-global-search').addEventListener('click', function () {
      state.globalSearch = !state.globalSearch;
      this.classList.toggle('is-active', state.globalSearch);
      if (state.query) renderCurrentFolder();
    });

    $('toggle-subfolders').addEventListener('click', function () {
      state.includeSubfolders = !state.includeSubfolders;
      this.classList.toggle('is-active', state.includeSubfolders);
      renderCurrentFolder();
    });

    /* Filter chips */
    $('type-filters').addEventListener('click', function (e) {
      var btn = e.target.closest('.chip');
      if (!btn) return;
      state.typeFilter = btn.dataset.type || 'all';
      var chips = $('type-filters').querySelectorAll('.chip');
      for (var i = 0; i < chips.length; i++) {
        chips[i].classList.toggle('is-active', chips[i] === btn);
      }
      renderCurrentFolder();
    });

    /* Left Sidebar Folder Tree Sort */
    $('tree-sort-select').addEventListener('change', function (e) {
      state.treeSortBy = e.target.value;
      persistPref('treeSortBy', state.treeSortBy);
      treeView.setSort(state.treeSortBy, state.treeSortDir);
    });
    $('btn-tree-sort-dir').addEventListener('click', function () {
      state.treeSortDir = state.treeSortDir === 'asc' ? 'desc' : 'asc';
      this.textContent = state.treeSortDir === 'asc' ? '↑' : '↓';
      this.title = state.treeSortDir === 'asc' ? t('sidebar.sortDirAsc') : t('sidebar.sortDirDesc');
      persistPref('treeSortDir', state.treeSortDir);
      treeView.setSort(state.treeSortBy, state.treeSortDir);
    });

    /* Column visibility settings */
    $('btn-col-settings').addEventListener('click', function () {
      toggleColPopover();
    });

    /* Grid / List toggle */
    $('btn-view-grid').addEventListener('click', function () {
      if (state.viewMode === 'grid') return;
      state.viewMode = 'grid';
      gridView.setViewMode('grid');
      $('btn-view-grid').classList.add('is-active');
      $('btn-view-list').classList.remove('is-active');
      persistPref('viewMode', 'grid');
      renderColumnHeader();
      renderCurrentFolder({ preserveScroll: false });
    });
    $('btn-view-list').addEventListener('click', function () {
      if (state.viewMode === 'list') return;
      state.viewMode = 'list';
      gridView.setViewMode('list');
      $('btn-view-list').classList.add('is-active');
      $('btn-view-grid').classList.remove('is-active');
      persistPref('viewMode', 'list');
      renderColumnHeader();
      renderCurrentFolder({ preserveScroll: false });
    });

    /* Instant 60fps CSS variable resize sliders (right cards + left folder tree) */
    $('thumb-size').addEventListener('input', function (e) {
      state.cardWidth = Number(e.target.value) || 184;
      gridView.setCardWidth(state.cardWidth);
    });
    $('thumb-size').addEventListener('change', function (e) {
      persistPref('cardWidth', e.target.value);
    });
    $('tree-size').addEventListener('input', function (e) {
      state.treeSize = Number(e.target.value) || 27;
      treeView.setItemSize(state.treeSize);
    });
    $('tree-size').addEventListener('change', function (e) {
      persistPref('treeSize', e.target.value);
    });

    /* Top action buttons */
    $('btn-new-bin').addEventListener('click', function () { actionCreateBin(state.folderId); });
    $('btn-import').addEventListener('click', function () { actionImport(state.folderId); });
    $('btn-import-folder').addEventListener('click', function () { actionImportFolders(state.folderId); });
    $('btn-refresh').addEventListener('click', function () { refreshProject(); });

    /* Live sync toggle pill in status bar */
    $('btn-sync-toggle').addEventListener('click', function () {
      state.followSync = !state.followSync;
      this.classList.toggle('is-active', state.followSync);
      $('sync-label').textContent = state.followSync ? t('status.syncOn') : t('status.syncPaused');
      setStatus(t(state.followSync ? 'status.syncEnabledMsg' : 'status.syncPausedMsg'));
    });

    /* Clear disk thumbnail cache button */
    $('btn-clear-cache').addEventListener('click', function () {
      var n = thumbEngine.clearCache();
      setStatus(t('status.clearCacheDone', { n: n }));
      renderCurrentFolder({ preserveScroll: true });
    });

    /* Empty grid area click / context menu */
    $('grid-scroll').addEventListener('click', function (e) {
      if (!e.target.closest('input, button, select, textarea')) {
        focusPane('grid');
      }
      if (e.target === $('grid-scroll') || e.target === $('grid')) {
        state.selected.clear();
        gridView.setSelection([]);
        updateCounters(gridView.items.length);
      }
    });
    $('grid-scroll').addEventListener('contextmenu', function (e) {
      if (e.target.closest('.card')) return;
      e.preventDefault();
      openContextMenu(e, '', 'blank');
    });
    $('sidebar').addEventListener('contextmenu', function (e) {
      if (e.target.closest('.tree-row')) return;
      if (/INPUT|TEXTAREA|SELECT/i.test((e.target && e.target.tagName) || '')) return;
      e.preventDefault();
      openContextMenu(e, '', 'blank');
    });
    /* Suppress Chromium's built-in "Print / View page source" context menu across all non-input UI chrome */
    document.addEventListener('contextmenu', function (e) {
      if (/INPUT|TEXTAREA/i.test((e.target && e.target.tagName) || '')) return;
      e.preventDefault();
    });

    /* Dismiss context menu, floating submenu, column popover & modal */
    $('context-menu').addEventListener('scroll', function () { closeSubmenu(); }, { passive: true });
    $('context-submenu').addEventListener('mouseenter', function () { clearTimeout(submenuCloseTimer); });
    document.addEventListener('mousedown', function (e) {
      if (state.menuOpen && !$('context-menu').contains(e.target) && !$('context-submenu').contains(e.target)) {
        closeContextMenu();
      }
      if (state.colPopoverOpen && !$('col-popover').contains(e.target) && !$('btn-col-settings').contains(e.target)) {
        closeColPopover();
      }
    });
    $('modal-cancel').addEventListener('click', function () { closeModal(null); });
    $('modal-backdrop').addEventListener('click', function (e) {
      if (e.target === $('modal-backdrop')) closeModal(null);
    });

    /* Keyboard shortcuts */
    document.addEventListener('keydown', function (e) {
      if (state.modalOpen) {
        if (e.key === 'Escape') { e.preventDefault(); closeModal(null); }
        return;
      }
      var inField = /INPUT|TEXTAREA|SELECT/i.test((e.target && e.target.tagName) || '');
      if (e.key === 'Escape') {
        if (state.menuOpen) { closeContextMenu(); return; }
        if (state.colPopoverOpen) { closeColPopover(); return; }
        if (inField && e.target === $('search-input') && $('search-input').value) {
          $('btn-search-clear').click();
          $('search-input').blur();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        $('search-input').focus();
        $('search-input').select();
        return;
      }
      if (inField || gridView.renamingId || treeView.renamingId) return;

      if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r')) {
        e.preventDefault();
        refreshProject();
        return;
      }
      if (e.key === ' ') {
        var ids = selectedIds();
        if (ids.length && state.index) {
          var first = state.index.nodes.get(ids[0]);
          if (first && !first.isBin) {
            e.preventDefault();
            runAction(
              function () { return bridge.openItem(first.id, false); },
              t(first.isSeq ? 'msg.openedTimeline' : 'msg.openedSource', { name: first.name })
            );
          }
        }
        return;
      }
      if (e.key === 'F2') {
        var rIds = selectedIds();
        if (rIds.length === 1) {
          e.preventDefault();
          actionRename(rIds[0], false);
        } else if (state.folderId && state.index && state.index.nodes.has(state.folderId) && state.index.nodes.get(state.folderId).pid) {
          e.preventDefault();
          actionRename(state.folderId, true);
        }
        return;
      }
      if (e.key === 'Enter') {
        var eIds = selectedIds();
        if (eIds.length === 1 && state.index) {
          var node = state.index.nodes.get(eIds[0]);
          if (node) {
            e.preventDefault();
            if (node.isBin) navigateToFolder(node.id);
            else runAction(function () { return bridge.openItem(node.id, false); }, t('msg.openedItem', { name: node.name }));
          }
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        var allIds = gridView.items.map(function (it) { return it.id; });
        state.selected = new Set(allIds);
        gridView.setSelection(allIds);
        updateCounters(gridView.items.length);
        pushHostSelection(allIds);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
        var xIds = selectedIds();
        if (xIds.length) { e.preventDefault(); actionCut(xIds); }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        var cIds = selectedIds();
        if (cIds.length) { e.preventDefault(); actionCopy(cIds); }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        if (clipboard.ids.length) { e.preventDefault(); actionPaste(state.folderId); }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        var dupIds = selectedIds();
        if (dupIds.length) { e.preventDefault(); actionDuplicate(dupIds); }
        return;
      }
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); $('btn-back').click(); return; }
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); $('btn-forward').click(); return; }
      if (!e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Home' || e.key === 'End')) {
        e.preventDefault();
        e.stopPropagation();
        if (state.lastFocusPane === 'tree' && selectedIds().length === 0) {
          var tNav = treeView.navigateByArrow(e.key);
          if (tNav && tNav.action === 'select' && tNav.id) {
            navigateToFolder(tNav.id);
            focusPane('tree');
            return;
          }
          if (!(tNav && tNav.action === 'focusGrid' && gridView.items.length > 0)) {
            return;
          }
        }
        var gKey = (state.lastFocusPane === 'tree' && e.key === 'ArrowRight') ? 'Home' : e.key;
        var gNav = gridView.navigateByArrow(gKey, e.shiftKey);
        if (gNav && gNav.ids && gNav.ids.length) {
          focusPane('grid');
          state.selected = new Set(gNav.ids);
          updateCounters(gridView.items.length);
          if (gNav.focusNode) {
            setStatus(t(gNav.focusNode.isBin ? 'msg.arrowSelectedBin' : 'msg.arrowSelectedClip', { name: gNav.focusNode.name }));
          }
          clearTimeout(arrowHostSyncTimer);
          var syncIds = gNav.ids.slice();
          arrowHostSyncTimer = setTimeout(function () {
            pushHostSelection(syncIds);
          }, 80);
        }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        var dIds = selectedIds();
        if (dIds.length) {
          e.preventDefault();
          actionRemove(dIds);
        } else if (state.lastFocusPane === 'tree' && state.folderId && state.index && state.index.nodes.has(state.folderId)) {
          var curFolder = state.index.nodes.get(state.folderId);
          if (curFolder && curFolder.pid) {
            e.preventDefault();
            actionRemove([curFolder.id]);
          }
        }
      }
    });

    /* Global OS File/Folder Drag-and-Drop guard (prevents Chromium navigating to file:/// directory index) */
    window.addEventListener('dragenter', function (e) {
      if (isAnyInternalDrag()) return;
      if (!isExternalFileDrag(e)) return;
      e.preventDefault();
      externalDragDepth += 1;
      showExternalDropBanner(state.folderId);
    });
    window.addEventListener('dragover', function (e) {
      if (isAnyInternalDrag()) return;
      if (!isExternalFileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!e.target.closest('.tree-row, .crumb-btn, .card.is-bin')) {
        showExternalDropBanner(state.folderId);
      }
    });
    window.addEventListener('dragleave', function (e) {
      if (isAnyInternalDrag()) return;
      externalDragDepth = Math.max(0, externalDragDepth - 1);
      if (externalDragDepth === 0 || !e.relatedTarget) {
        hideExternalDropBanner();
      }
    });
    window.addEventListener('drop', function (e) {
      if (isAnyInternalDrag()) return;
      e.preventDefault();
      hideExternalDropBanner();
      if (isExternalFileDrag(e)) {
        handleExternalDrop(state.folderId, e);
      }
    });

    window.addEventListener('resize', handleResponsiveLayout);
    window.addEventListener('focus', function () {
      if (!bridge.isDemo && (Date.now() - lastLabelSyncAt) >= 1500) {
        syncLabelPrefs(false);
      }
    });
    window.addEventListener('unload', function () {
      clearInterval(pollTimer);
      clearTimeout(arrowHostSyncTimer);
      clearReconcileTimers();
      thumbEngine.dispose();
    });
  }

  /* ==================== BOOTSTRAP ==================== */

  async function boot() {
    treeView = new window.PrTreeView($('folder-tree'), {
      onSelectFolder: function (binId) {
        focusPane('tree');
        navigateToFolder(binId);
      },
      onContextMenu: function (event, binId) {
        openContextMenu(event, binId, 'tree');
      },
      canDrop: function () {
        return isAnyInternalDrag();
      },
      onDragStart: function (binId, binName) {
        setStatus(t('msg.draggingBin', { name: binName }));
      },
      onDragEnd: function () {
        if (!state.busy) setStatus(t('status.ready'));
      },
      onDropToBin: handleDropToBin,
      onExternalHover: function (binId) { showExternalDropBanner(binId); },
      onExternalDrop: handleExternalDrop
    });

    gridView = new window.PrGridView($('grid-scroll'), $('grid'), $('grid-empty'), thumbEngine, {
      onEnterFolder: function (binId) {
        navigateToFolder(binId);
      },
      onSelectChange: function (ids) {
        focusPane('grid');
        state.selected = new Set(ids);
        updateCounters(gridView.items.length);
        pushHostSelection(ids);
      },
      onOpenItem: function (id) {
        var node = state.index && state.index.nodes.get(id);
        if (!node) return;
        runAction(
          function () { return bridge.openItem(id, false); },
          t(node.isSeq ? 'msg.openedTimeline' : 'msg.openedSource', { name: node.name })
        );
      },
      onInsertTimeline: function (ids, mode) {
        runAction(function () { return bridge.insertToTimeline(ids, mode); }, function (r) {
          return t(mode === 'overwrite' ? 'msg.overwroteTimeline' : 'msg.insertedTimeline', { n: r.placed, seq: r.sequenceName });
        });
      },
      onContextMenu: function (event, id) {
        openContextMenu(event, id, 'grid');
      },
      canDrop: function () {
        return !!(treeView && treeView.isDraggingInternal);
      },
      onDropToBin: handleDropToBin,
      onExternalHover: function (binId) { showExternalDropBanner(binId); },
      onExternalDrop: handleExternalDrop,
      onCardMouseDown: function () {
        if (!bridge.isDemo && state.hasProject && !state.busy && !reconcilingDrop) {
          bridge.captureTimelineBaseline().catch(function () {});
        }
      },
      onDragStart: function (ids) {
        clearReconcileTimers();
        var dragged = [];
        if (state.index) {
          for (var i = 0; i < ids.length; i++) {
            var n = state.index.nodes.get(ids[i]);
            if (n && !n.isBin && !n.isSeq && !n.offline && n.path) {
              dragged.push({ id: n.id, name: n.name, path: n.path, label: n.label });
            }
          }
        }
        if (dragged.length && !bridge.isDemo && state.hasProject) {
          startDropWatch({
            docId: state.docId,
            beforeIds: state.index ? Array.from(state.index.nodes.keys()) : [],
            dragged: dragged,
            handledInternally: false,
            foundAt: 0,
            expiresAt: Date.now() + 20000
          });
        }
        setStatus(t('msg.draggingItems', { n: ids.length }));
      },
      onDragEnd: function () {
        if (!activeDropWatch) setStatus(t('status.ready'));
      }
    });

    bindUI();
    handleResponsiveLayout();
    applySidebarState();

    if (bridge.isDemo) {
      $('demo-strip').classList.remove('hidden');
    }

    /* Detect FFmpeg & load Premiere custom label colors in parallel while loading the project tree */
    await Promise.all([
      thumbEngine.init(),
      syncLabelPrefs(true),
      refreshProject({ force: true })
    ]);

    updateEngineBadge();

    /* Background cache pruning (non-blocking) */
    setTimeout(function () { thumbEngine.pruneOldCache(); }, 4000);

    /* Fast, lightweight selection & project change sync (160ms, <1ms ExtendScript cost) */
    if (!bridge.isDemo) {
      pollTimer = setInterval(pollOnce, 160);
    }
  }

  boot();
})();
