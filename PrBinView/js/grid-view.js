(function (root) {
  'use strict';

  var U = root.PrUtils;
  var I18n = root.PrI18n;
  function tr(key, vars) { return I18n ? I18n.t(key, vars) : key; }

  class GridView {
    constructor(scrollEl, gridEl, emptyEl, thumbEngine, callbacks) {
      this.scrollEl = scrollEl;
      this.gridEl = gridEl;
      this.emptyEl = emptyEl;
      this.thumbEngine = thumbEngine;
      this.cb = callbacks || {};

      this.items = [];
      this.itemMap = new Map();
      this.cardEls = new Map();
      this.selected = new Set();
      this.anchorId = '';
      this.focusId = '';
      this.viewMode = 'grid';
      this.columns = U.MEDIA_COLUMNS.filter(function (c) { return c.visible; });
      this.renderTicket = 0;
      this.rafChunk = 0;
      this.renamingId = '';
      this.isDraggingInternal = false;

      /* Shared single hover-scrub overlay */
      this._scrubHost = null;
      this._scrubNode = null;
      this._scrubTimer = 0;
      this._scrubMode = 'none'; /* 'video' | 'sprite' */
      this._scrubSprite = null;
      this._scrubPendingFrac = -1;
      this._scrubVideoError = new Set();

      this._initScrubOverlay();
      this._initObserver();
      this._bindEvents();
    }

    _initScrubOverlay() {
      var overlay = document.createElement('div');
      overlay.className = 'scrub-overlay hidden';

      var video = document.createElement('video');
      video.className = 'scrub-video hidden';
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';

      var sprite = document.createElement('div');
      sprite.className = 'scrub-sprite hidden';

      var tc = document.createElement('div');
      tc.className = 'scrub-tc hidden';

      var rail = document.createElement('div');
      rail.className = 'scrub-rail';
      var fill = document.createElement('div');
      fill.className = 'scrub-fill';
      rail.appendChild(fill);

      overlay.appendChild(video);
      overlay.appendChild(sprite);
      overlay.appendChild(tc);
      overlay.appendChild(rail);

      var self = this;
      video.addEventListener('seeked', function () {
        if (self._scrubMode !== 'video' || self._scrubPendingFrac < 0) return;
        var frac = self._scrubPendingFrac;
        self._scrubPendingFrac = -1;
        self._applyVideoSeek(frac);
      });
      video.addEventListener('loadeddata', function () {
        if (self._scrubMode === 'video') {
          video.classList.remove('hidden');
          if (self._scrubPendingFrac >= 0) {
            var frac = self._scrubPendingFrac;
            self._scrubPendingFrac = -1;
            self._applyVideoSeek(frac);
          }
        }
      });
      video.addEventListener('error', function () {
        if (!self._scrubNode) return;
        var badNode = self._scrubNode;
        self._scrubVideoError.add(U.normKey(badNode.path));
        if (self._scrubMode === 'video') {
          self._startSpriteScrub(badNode, self._scrubPendingFrac >= 0 ? self._scrubPendingFrac : 0.1);
        }
      });

      this._overlay = overlay;
      this._video = video;
      this._sprite = sprite;
      this._tc = tc;
      this._fill = fill;
    }

    _initObserver() {
      var self = this;
      if (typeof IntersectionObserver !== 'function') {
        this._observer = null;
        return;
      }
      this._observer = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (!entries[i].isIntersecting) continue;
          var card = entries[i].target;
          self._observer.unobserve(card);
          self._hydrateCardThumb(card);
        }
      }, {
        root: this.scrollEl,
        rootMargin: '260px 0px'
      });
    }

    _bindEvents() {
      var self = this;

      this.scrollEl.addEventListener('scroll', function () {
        self.stopScrub();
      }, { passive: true });

      this.gridEl.addEventListener('click', function (e) {
        if (self.renamingId) return;
        var actBtn = e.target.closest('.card-act');
        if (actBtn) {
          e.stopPropagation();
          var actCard = actBtn.closest('.card');
          if (!actCard) return;
          var actId = actCard.dataset.id;
          var act = actBtn.dataset.act;
          if (act === 'source' && self.cb.onOpenItem) self.cb.onOpenItem(actId);
          else if (act === 'insert' && self.cb.onInsertTimeline) self.cb.onInsertTimeline([actId], 'insert');
          return;
        }

        var card = e.target.closest('.card');
        if (!card) return;
        var id = card.dataset.id;
        var node = self.itemMap.get(id);
        if (!node) return;

        /* Single-click any folder card enters it immediately (unless Ctrl/Shift multi-select) */
        if (node.isBin && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
          self.stopScrub();
          if (self.cb.onEnterFolder) self.cb.onEnterFolder(id);
          return;
        }

        self._handleSelectionClick(id, e);
      });

      this.gridEl.addEventListener('dblclick', function (e) {
        if (self.renamingId) return;
        if (e.target.closest('.card-act')) return;
        var card = e.target.closest('.card');
        if (!card) return;
        var id = card.dataset.id;
        var node = self.itemMap.get(id);
        if (!node) return;
        if (node.isBin) {
          if (self.cb.onEnterFolder) self.cb.onEnterFolder(id);
        } else {
          if (self.cb.onOpenItem) self.cb.onOpenItem(id);
        }
      });

      this.gridEl.addEventListener('contextmenu', function (e) {
        var card = e.target.closest('.card');
        if (!card) return;
        e.preventDefault();
        e.stopPropagation();
        var id = card.dataset.id;
        if (!self.selected.has(id)) {
          self.selected = new Set([id]);
          self.anchorId = id;
          self.focusId = id;
          self.syncSelectionClasses();
          if (self.cb.onSelectChange) self.cb.onSelectChange(Array.from(self.selected));
        }
        if (self.cb.onContextMenu) self.cb.onContextMenu(e, id);
      });

      /* Hover scrubbing on video thumbnails */
      this.gridEl.addEventListener('mouseover', function (e) {
        if (self.isDraggingInternal || self.renamingId || self.viewMode === 'list') return;
        var thumb = e.target.closest('.card-thumb');
        if (!thumb || thumb === self._scrubHost) return;
        var card = thumb.closest('.card');
        if (!card) return;
        var node = self.itemMap.get(card.dataset.id);
        if (!node || node.kind !== 'video' || node.offline || !node.path || node.demoThumb) {
          self.stopScrub();
          return;
        }
        self._scheduleScrub(thumb, node, e);
      });

      this.gridEl.addEventListener('mousemove', function (e) {
        if (!self._scrubHost || !self._scrubNode) return;
        if (!self._scrubHost.contains(e.target) && e.target !== self._scrubHost) {
          self.stopScrub();
          return;
        }
        var frac = self._fractionForEvent(self._scrubHost, e);
        self._updateScrubPosition(frac);
      });

      this.gridEl.addEventListener('mouseleave', function () {
        self.stopScrub();
      });

      this.gridEl.addEventListener('mousedown', function (e) {
        if (e.button !== 0 || self.renamingId) return;
        var card = e.target.closest('.card');
        if (!card) return;
        var node = self.itemMap.get(card.dataset.id);
        if (node && !node.isBin && !node.isSeq && !node.offline && self.cb.onCardMouseDown) {
          self.cb.onCardMouseDown(node.id);
        }
      });

      /* Drag & Drop: internal move to bin + CEP drag-out to Premiere Timeline / Source Monitor */
      this.gridEl.addEventListener('dragstart', function (e) {
        if (self.renamingId) { e.preventDefault(); return; }
        var card = e.target.closest('.card');
        if (!card) return;
        var id = card.dataset.id;
        self.stopScrub();
        if (!self.selected.has(id)) {
          self.selected = new Set([id]);
          self.anchorId = id;
          self.syncSelectionClasses();
        }
        var ids = self._orderedSelectedIds();
        self.isDraggingInternal = true;
        /* Defer DOM mutation past dragstart so CEF does not abort or desync the OS drag hand-off */
        setTimeout(function () {
          if (self.isDraggingInternal && card.isConnected) card.classList.add('is-dragging');
        }, 0);

        try {
          e.dataTransfer.setData('application/x-prbinview-ids', JSON.stringify(ids));
          /* Populate CEP native file drag-out so user can drop clips onto Pr Timeline / Source Monitor */
          var fileIdx = 0;
          for (var i = 0; i < ids.length; i++) {
            var n = self.itemMap.get(ids[i]);
            if (n && !n.isBin && !n.isSeq && !n.offline && n.path) {
              var winPath = String(n.path).replace(/\//g, '\\');
              e.dataTransfer.setData('com.adobe.cep.dnd.file.' + fileIdx, winPath);
              fileIdx++;
            }
          }
          e.dataTransfer.effectAllowed = fileIdx > 0 ? 'copyMove' : 'move';
        } catch (_) {}

        if (self.cb.onDragStart) self.cb.onDragStart(ids);
      });

      this.gridEl.addEventListener('dragend', function () {
        self.isDraggingInternal = false;
        self._highlightDropCard(null);
        var dragging = self.gridEl.querySelectorAll('.card.is-dragging');
        for (var i = 0; i < dragging.length; i++) dragging[i].classList.remove('is-dragging');
        if (self.cb.onDragEnd) self.cb.onDragEnd();
      });

      this.gridEl.addEventListener('dragover', function (e) {
        var isInternal = self.isDraggingInternal || !!(self.cb.canDrop && self.cb.canDrop());
        var isExternal = !isInternal && !!(e.dataTransfer && e.dataTransfer.types && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1);
        if (!isInternal && !isExternal) return;
        var card = e.target.closest('.card');
        if (!card) { self._highlightDropCard(null); return; }
        var node = self.itemMap.get(card.dataset.id);
        var selfSelectedDrag = self.isDraggingInternal && self.selected.has(node && node.id);
        if (node && node.isBin && (isExternal || !selfSelectedDrag)) {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = isExternal ? 'copy' : 'move';
          self._highlightDropCard(card);
          if (isExternal && self.cb.onExternalHover) self.cb.onExternalHover(node.id);
        } else {
          self._highlightDropCard(null);
        }
      });

      this.gridEl.addEventListener('drop', function (e) {
        var card = e.target.closest('.card');
        self._highlightDropCard(null);
        if (!card) return;
        var node = self.itemMap.get(card.dataset.id);
        var isInternal = self.isDraggingInternal || !!(self.cb.canDrop && self.cb.canDrop());
        if (isInternal) {
          if (node && node.isBin && self.cb.onDropToBin) {
            e.preventDefault();
            e.stopPropagation();
            self.cb.onDropToBin(node.id, e);
          }
        } else if (self.cb.onExternalDrop) {
          e.preventDefault();
          e.stopPropagation();
          self.cb.onExternalDrop(node && node.isBin ? node.id : '', e);
        }
      });
    }

    _highlightDropCard(card) {
      if (this._dropCard && this._dropCard !== card) {
        this._dropCard.classList.remove('is-drop-target');
      }
      this._dropCard = card || null;
      if (this._dropCard) this._dropCard.classList.add('is-drop-target');
    }

    _orderedSelectedIds() {
      var out = [];
      for (var i = 0; i < this.items.length; i++) {
        if (this.selected.has(this.items[i].id)) out.push(this.items[i].id);
      }
      this.selected.forEach(function (id) {
        if (out.indexOf(id) === -1) out.push(id);
      });
      return out;
    }

    _handleSelectionClick(id, e) {
      if (e.shiftKey && this.anchorId) {
        var from = -1, to = -1;
        for (var i = 0; i < this.items.length; i++) {
          if (this.items[i].id === this.anchorId) from = i;
          if (this.items[i].id === id) to = i;
        }
        if (from >= 0 && to >= 0) {
          var a = Math.min(from, to), b = Math.max(from, to);
          if (!e.ctrlKey && !e.metaKey) this.selected.clear();
          for (var j = a; j <= b; j++) this.selected.add(this.items[j].id);
          this.focusId = id;
        } else {
          this.selected = new Set([id]);
          this.anchorId = id;
          this.focusId = id;
        }
      } else if (e.ctrlKey || e.metaKey) {
        if (this.selected.has(id)) this.selected.delete(id);
        else this.selected.add(id);
        this.anchorId = id;
        this.focusId = id;
      } else {
        this.selected = new Set([id]);
        this.anchorId = id;
        this.focusId = id;
      }
      this.syncSelectionClasses();
      if (this.cb.onSelectChange) this.cb.onSelectChange(this._orderedSelectedIds());
    }

    syncSelectionClasses() {
      var self = this;
      this.cardEls.forEach(function (el, id) {
        el.classList.toggle('is-selected', self.selected.has(id));
      });
    }

    setSelection(ids, scrollToFirst) {
      this.selected = new Set(ids || []);
      if (ids && ids.length) {
        this.anchorId = ids[0];
        this.focusId = ids[0];
      } else {
        this.anchorId = '';
        this.focusId = '';
      }
      this.syncSelectionClasses();
      if (scrollToFirst && ids && ids.length) {
        var el = this.cardEls.get(ids[0]);
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'nearest' });
        }
      }
    }

    getColumnCount() {
      if (this.viewMode === 'list') return 1;
      var kids = this.gridEl ? this.gridEl.children : null;
      if (kids && kids.length >= 2) {
        var firstTop = Math.round(kids[0].getBoundingClientRect().top);
        var cols = 1;
        for (var i = 1; i < kids.length; i++) {
          if (Math.abs(Math.round(kids[i].getBoundingClientRect().top) - firstTop) <= 4) {
            cols += 1;
          } else {
            break;
          }
        }
        if (cols >= 1) return cols;
      }
      var cardW = parseFloat(getComputedStyle(this.gridEl).getPropertyValue('--card-w')) || 184;
      var avail = Math.max(cardW, (this.gridEl ? this.gridEl.clientWidth : 0) - 24);
      return Math.max(1, Math.floor((avail + 10) / (cardW + 10)));
    }

    navigateByArrow(key, shiftKey) {
      if (!this.items || !this.items.length) return null;
      this.stopScrub();

      var curIdx = -1;
      var lookId = this.focusId || this.anchorId;
      if (lookId) {
        for (var i = 0; i < this.items.length; i++) {
          if (this.items[i].id === lookId) { curIdx = i; break; }
        }
      }
      if (curIdx < 0 && this.selected.size > 0) {
        for (var s = 0; s < this.items.length; s++) {
          if (this.selected.has(this.items[s].id)) { curIdx = s; break; }
        }
      }

      var nextIdx;
      if (key === 'Home') {
        nextIdx = 0;
      } else if (key === 'End') {
        nextIdx = this.items.length - 1;
      } else if (curIdx < 0) {
        nextIdx = (key === 'ArrowLeft' || key === 'ArrowUp') ? (this.items.length - 1) : 0;
      } else {
        var cols = this.getColumnCount();
        if (key === 'ArrowLeft') nextIdx = Math.max(0, curIdx - 1);
        else if (key === 'ArrowRight') nextIdx = Math.min(this.items.length - 1, curIdx + 1);
        else if (key === 'ArrowUp') nextIdx = Math.max(0, curIdx - cols);
        else if (key === 'ArrowDown') nextIdx = Math.min(this.items.length - 1, curIdx + cols);
        else return null;
      }

      var nextNode = this.items[nextIdx];
      if (!nextNode) return null;

      if (shiftKey) {
        var anchorIdx = -1;
        if (this.anchorId) {
          for (var a = 0; a < this.items.length; a++) {
            if (this.items[a].id === this.anchorId) { anchorIdx = a; break; }
          }
        }
        if (anchorIdx < 0) {
          anchorIdx = curIdx >= 0 ? curIdx : nextIdx;
          this.anchorId = this.items[anchorIdx].id;
        }
        var lo = Math.min(anchorIdx, nextIdx);
        var hi = Math.max(anchorIdx, nextIdx);
        this.selected.clear();
        for (var j = lo; j <= hi; j++) this.selected.add(this.items[j].id);
      } else {
        this.selected = new Set([nextNode.id]);
        this.anchorId = nextNode.id;
      }
      this.focusId = nextNode.id;
      this.syncSelectionClasses();

      var cardEl = this.cardEls.get(nextNode.id);
      if (cardEl && typeof cardEl.scrollIntoView === 'function') {
        cardEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } else if (this.scrollEl && nextIdx === this.items.length - 1) {
        this.scrollEl.scrollTop = this.scrollEl.scrollHeight;
      }

      return { ids: this._orderedSelectedIds(), focusNode: nextNode };
    }

    setViewMode(mode) {
      this.viewMode = mode === 'list' ? 'list' : 'grid';
      this.gridEl.classList.toggle('is-list', this.viewMode === 'list');
      this.scrollEl.classList.toggle('is-list-mode', this.viewMode === 'list');
      this.stopScrub();
      this._applyListColumnVars();
    }

    setColumns(columns) {
      this.columns = (columns && columns.length) ? columns.slice() : U.MEDIA_COLUMNS.filter(function (c) { return c.visible; });
      this._applyListColumnVars();
    }

    _applyListColumnVars() {
      var cols = this.columns || [];
      var tpl = [];
      var totalW = 0;
      for (var i = 0; i < cols.length; i++) {
        var w = Math.max(cols[i].minWidth || 40, Number(cols[i].width) || 90);
        tpl.push(w + 'px');
        totalW += w;
      }
      this.scrollEl.style.setProperty('--list-cols', tpl.join(' '));
      this.scrollEl.style.setProperty('--list-min-w', totalW + 'px');
    }

    patchMetadata(metaMap) {
      if (!metaMap) return;
      var self = this;
      Object.keys(metaMap).forEach(function (id) {
        var node = self.itemMap.get(id);
        var card = self.cardEls.get(id);
        if (!node || !card) return;
        node.meta = metaMap[id];
        if (self.viewMode === 'list') {
          var cells = card.querySelectorAll('.list-cell[data-col]');
          for (var i = 0; i < cells.length; i++) {
            var colId = cells[i].dataset.col;
            var txt = U.getColumnCellText(node, colId);
            cells[i].textContent = txt;
            cells[i].title = txt;
            if (colId === 'status') {
              cells[i].classList.toggle('is-offline-txt', node.offline || /^(?:offline|脱机|离线)$/i.test(txt));
            }
          }
        } else {
          var metaEl = card.querySelector('.card-meta');
          if (metaEl && !node.isBin && !node.offline) {
            metaEl.textContent = self._gridMetaText(node);
          }
        }
      });
    }

    _gridMetaText(node) {
      if (node.isBin) return tr('card.binMeta', { count: node.childCount });
      if (node.offline) return tr('card.offlineMeta');
      var m = node.meta || {};
      if (node.isSeq) {
        return m.mediaDuration ? (U.kindLabel('sequence') + ' · ' + m.mediaDuration) : tr('card.seqMetaEmpty');
      }
      var parts = [U.kindLabel(node.kind)];
      if (node.ext) parts.push(node.ext.toUpperCase());
      if (node.kind === 'image') {
        /* Still images get a nominal 29.97fps timebase in Pr; show image dimensions instead */
        if (m.videoInfo) parts.push(m.videoInfo.replace(/\s*\(1\.0\)\s*$/, ''));
        return parts.join(' · ');
      }
      if (m.mediaDuration) parts.push(m.mediaDuration);
      else if (node.demoDuration) parts.push(U.formatTime(node.demoDuration));
      if (node.kind === 'video' && m.fps) parts.push(m.fps);
      return parts.join(' · ');
    }

    setCardWidth(px) {
      this.gridEl.style.setProperty('--card-w', Math.max(120, Math.min(340, Number(px) || 184)) + 'px');
    }

    setItems(items, selectedSet, opts) {
      var options = opts || {};
      this.stopScrub();
      if (this.rafChunk) { cancelAnimationFrame(this.rafChunk); this.rafChunk = 0; }
      if (this._observer) this._observer.disconnect();

      var ticket = ++this.renderTicket;
      this.items = items || [];
      this.itemMap.clear();
      this.cardEls.clear();
      this.selected = new Set(selectedSet || []);
      this.gridEl.innerHTML = '';

      if (!options.preserveScroll) {
        this.scrollEl.scrollTop = 0;
      }

      if (!this.items.length) {
        this.emptyEl.classList.remove('hidden');
        this.emptyEl.innerHTML = options.emptyHtml || ('<strong>' + U.escapeHtml(tr('empty.defaultTitle')) + '</strong><div>' + U.escapeHtml(tr('empty.defaultDesc')) + '</div>');
        return;
      }
      this.emptyEl.classList.add('hidden');

      for (var i = 0; i < this.items.length; i++) {
        this.itemMap.set(this.items[i].id, this.items[i]);
      }

      var FIRST_BATCH = 96;
      var CHUNK_SIZE = 80;
      var cursor = 0;
      var self = this;

      function appendBatch(limit) {
        if (ticket !== self.renderTicket) return;
        var frag = document.createDocumentFragment();
        var end = Math.min(self.items.length, cursor + limit);
        var toObserve = [];
        for (var idx = cursor; idx < end; idx++) {
          var node = self.items[idx];
          var card = self.viewMode === 'list' ? self._buildListRow(node) : self._buildCard(node);
          frag.appendChild(card);
          self.cardEls.set(node.id, card);
          if (card.dataset.needThumb === '1') toObserve.push(card);
        }
        cursor = end;
        self.gridEl.appendChild(frag);

        for (var k = 0; k < toObserve.length; k++) {
          if (self._observer) self._observer.observe(toObserve[k]);
          else self._hydrateCardThumb(toObserve[k]);
        }

        if (cursor < self.items.length) {
          self.rafChunk = requestAnimationFrame(function () {
            appendBatch(CHUNK_SIZE);
          });
        } else {
          self.rafChunk = 0;
        }
      }

      appendBatch(FIRST_BATCH);
    }

    _buildCard(node) {
      var card = document.createElement('div');
      card.className = 'card' +
        (node.isBin ? ' is-bin' : '') +
        (node.offline ? ' is-offline' : '') +
        (node.isHidden ? ' is-hidden-item' : '') +
        (this.selected.has(node.id) ? ' is-selected' : '');
      card.dataset.id = node.id;
      card.setAttribute('draggable', 'true');
      card.title = node.path ? (node.name + '\n' + node.path) : node.name;

      var thumb = document.createElement('div');
      thumb.className = 'card-thumb';

      /* Instant cached thumbnail check (0ms pop-in when already in memory!) */
      var instant = this.thumbEngine.peekThumb(node);
      var canGenThumb = !node.isBin && !node.isSeq && !node.offline &&
        node.kind !== 'audio' && !!node.path && !U.isUnsupportedPreviewExt(node.ext);

      if (instant && instant.url) {
        var img = document.createElement('img');
        img.className = 'thumb-img is-loaded';
        img.decoding = 'async';
        img.loading = 'lazy';
        img.draggable = false;
        img.alt = '';
        img.src = instant.url;
        thumb.appendChild(img);
      } else {
        var ph = document.createElement('div');
        ph.className = 'thumb-placeholder' + (canGenThumb ? ' is-loading' : '');
        var iconStyle = node.isBin ? (' style="color:' + U.labelColor(node.label) + '"') : '';
        ph.innerHTML = '<span class="ph-icon"' + iconStyle + '>' + U.kindIconSvg(node.kind, node.offline) + '</span>' +
          '<span class="ph-label">' + U.escapeHtml(
            node.offline ? tr('card.offlinePlaceholder') :
            node.isBin ? tr('card.binCount', { count: node.childCount }) :
            (node.ext ? node.ext.toUpperCase() : U.kindLabel(node.kind))
          ) + '</span>';
        thumb.appendChild(ph);
        if (canGenThumb) card.dataset.needThumb = '1';
      }

      /* Corner type/extension badge */
      if (!node.isBin) {
        var extText = node.offline ? tr('card.offlineBadge') : node.isSeq ? 'SEQ' : (node.ext ? node.ext.toUpperCase() : U.kindLabel(node.kind));
        var badge = document.createElement('span');
        badge.className = 'thumb-badge' + (node.offline ? ' is-err' : node.isSeq ? ' is-seq' : '');
        badge.textContent = extText;
        thumb.appendChild(badge);
      }

      /* Hover quick-actions for media items (Preview & Insert to Timeline) */
      if (!node.isBin) {
        var acts = document.createElement('div');
        acts.className = 'card-acts';
        acts.innerHTML =
          '<button type="button" class="card-act" data-act="source" title="' + U.escapeHtml(tr('card.openSourceTitle')) + '">' + U.ICONS.play + '</button>' +
          '<button type="button" class="card-act" data-act="insert" title="' + U.escapeHtml(tr('card.insertTitle')) + '">' + U.ICONS.timeline + '</button>';
        thumb.appendChild(acts);
      }

      /* Premiere color label accent bar */
      var accent = document.createElement('span');
      accent.className = 'card-accent';
      accent.style.backgroundColor = U.labelColor(node.label);
      thumb.appendChild(accent);

      card.appendChild(thumb);

      var info = document.createElement('div');
      info.className = 'card-info';

      var titleRow = document.createElement('div');
      titleRow.className = 'card-title-row';

      var dot = document.createElement('span');
      dot.className = 'label-dot';
      dot.style.backgroundColor = U.labelColor(node.label);
      titleRow.appendChild(dot);

      var title = document.createElement('span');
      title.className = 'card-title';
      title.textContent = node.name;
      titleRow.appendChild(title);

      info.appendChild(titleRow);

      var meta = document.createElement('div');
      meta.className = 'card-meta';
      meta.textContent = this._gridMetaText(node);
      info.appendChild(meta);
      card.appendChild(info);

      return card;
    }

    _buildListRow(node) {
      var row = document.createElement('div');
      row.className = 'card list-row' +
        (node.isBin ? ' is-bin' : '') +
        (node.offline ? ' is-offline' : '') +
        (node.isHidden ? ' is-hidden-item' : '') +
        (this.selected.has(node.id) ? ' is-selected' : '');
      row.dataset.id = node.id;
      row.setAttribute('draggable', 'true');
      row.title = node.path ? (node.name + '\n' + node.path) : node.name;

      var instant = this.thumbEngine.peekThumb(node);
      var canGenThumb = !node.isBin && !node.isSeq && !node.offline &&
        node.kind !== 'audio' && !!node.path && !U.isUnsupportedPreviewExt(node.ext);

      for (var i = 0; i < this.columns.length; i++) {
        var col = this.columns[i];
        if (col.id === 'label') {
          var lCell = document.createElement('div');
          lCell.className = 'list-cell is-label-cell';
          var sq = document.createElement('span');
          sq.className = 'list-label-box';
          sq.style.backgroundColor = U.labelColor(node.label);
          sq.title = U.labelName(node.label);
          lCell.appendChild(sq);
          row.appendChild(lCell);
        } else if (col.id === 'name') {
          var nCell = document.createElement('div');
          nCell.className = 'list-cell is-name-cell';

          var thumb = document.createElement('div');
          thumb.className = 'card-thumb list-thumb';
          if (instant && instant.url) {
            var img = document.createElement('img');
            img.className = 'thumb-img is-loaded';
            img.decoding = 'async';
            img.loading = 'lazy';
            img.draggable = false;
            img.alt = '';
            img.src = instant.url;
            thumb.appendChild(img);
          } else {
            var ph = document.createElement('div');
            ph.className = 'thumb-placeholder' + (canGenThumb ? ' is-loading' : '');
            var listIconStyle = node.isBin ? (' style="color:' + U.labelColor(node.label) + '"') : '';
            ph.innerHTML = '<span class="ph-icon"' + listIconStyle + '>' + U.kindIconSvg(node.kind, node.offline) + '</span>';
            thumb.appendChild(ph);
            if (canGenThumb) row.dataset.needThumb = '1';
          }
          nCell.appendChild(thumb);

          var title = document.createElement('span');
          title.className = 'card-title';
          title.textContent = node.name;
          nCell.appendChild(title);

          if (!node.isBin) {
            var acts = document.createElement('div');
            acts.className = 'list-row-acts';
            acts.innerHTML =
              '<button type="button" class="card-act" data-act="source" title="' + U.escapeHtml(tr('card.openSourceTitle')) + '">' + U.ICONS.play + '</button>' +
              '<button type="button" class="card-act" data-act="insert" title="' + U.escapeHtml(tr('card.insertTitle')) + '">' + U.ICONS.timeline + '</button>';
            nCell.appendChild(acts);
          }
          row.appendChild(nCell);
        } else {
          var cell = document.createElement('div');
          var txt = U.getColumnCellText(node, col.id);
          cell.className = 'list-cell' +
            (col.mono ? ' is-mono' : '') +
            (col.accent ? ' is-accent' : '') +
            (col.id === 'status' && (node.offline || /^(?:offline|脱机|离线)$/i.test(txt)) ? ' is-offline-txt' : '');
          cell.dataset.col = col.id;
          cell.textContent = txt;
          cell.title = txt;
          row.appendChild(cell);
        }
      }

      return row;
    }

    _hydrateCardThumb(card) {
      var id = card.dataset.id;
      var node = this.itemMap.get(id);
      if (!node) return;
      var ticket = this.renderTicket;
      var self = this;

      this.thumbEngine.requestThumb(node, true).then(function (res) {
        if (ticket !== self.renderTicket || !card.isConnected) return;
        var thumb = card.querySelector('.card-thumb');
        if (!thumb) return;
        var ph = thumb.querySelector('.thumb-placeholder');
        if (!res || !res.url) {
          if (ph) ph.classList.remove('is-loading');
          return;
        }
        var img = document.createElement('img');
        img.className = 'thumb-img';
        img.decoding = 'async';
        img.draggable = false;
        img.alt = '';
        img.onload = function () {
          img.classList.add('is-loaded');
          if (ph && ph.parentNode) ph.remove();
        };
        img.onerror = function () {
          img.remove();
          if (ph) ph.classList.remove('is-loading');
        };
        thumb.insertBefore(img, thumb.firstChild);
        img.src = res.url;
      });
    }

    /* ================= ZERO-LAG HOVER SCRUBBING ================= */

    _fractionForEvent(box, e) {
      var rect = box.getBoundingClientRect();
      if (!rect.width) return 0;
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    }

    _scheduleScrub(thumbEl, node, initialEvent) {
      this.stopScrub();
      this._scrubHost = thumbEl;
      this._scrubNode = node;
      var startFrac = this._fractionForEvent(thumbEl, initialEvent);
      var self = this;
      this._scrubTimer = setTimeout(function () {
        if (self._scrubHost !== thumbEl || self._scrubNode !== node || !thumbEl.isConnected) return;
        self._beginScrub(thumbEl, node, startFrac);
      }, 95);
    }

    _beginScrub(thumbEl, node, frac) {
      this._overlay.classList.remove('hidden');
      this._video.classList.add('hidden');
      this._sprite.classList.add('hidden');
      this._tc.classList.add('hidden');
      this._fill.style.width = Math.round(frac * 100) + '%';
      thumbEl.appendChild(this._overlay);

      var k = U.normKey(node.path);
      var canNative = U.isNativeVideoExt(node.ext) && !this._scrubVideoError.has(k);
      if (canNative) {
        this._scrubMode = 'video';
        this._scrubPendingFrac = frac;
        this._video.src = U.pathToFileUrl(node.path);
        try { this._video.load(); } catch (_) {}
      } else {
        this._startSpriteScrub(node, frac);
      }
    }

    _startSpriteScrub(node, frac) {
      this._scrubMode = 'sprite';
      this._scrubSprite = null;
      this._video.classList.add('hidden');
      try { this._video.pause(); this._video.removeAttribute('src'); } catch (_) {}
      var targetNode = node;
      var self = this;
      this.thumbEngine.requestSprite(node).then(function (sp) {
        if (!sp || self._scrubNode !== targetNode || self._scrubMode !== 'sprite') return;
        self._scrubSprite = sp;
        self._sprite.style.backgroundImage = 'url("' + sp.url.replace(/"/g, '%22') + '")';
        self._sprite.style.backgroundSize = (sp.frames * 100) + '% 100%';
        self._sprite.classList.remove('hidden');
        self._applySpriteSeek(self._scrubPendingFrac >= 0 ? self._scrubPendingFrac : frac);
      });
    }

    _updateScrubPosition(frac) {
      this._fill.style.width = Math.round(frac * 100) + '%';
      this._scrubPendingFrac = frac;
      if (this._scrubMode === 'video') {
        if (!this._video.seeking) {
          this._scrubPendingFrac = -1;
          this._applyVideoSeek(frac);
        }
      } else if (this._scrubMode === 'sprite' && this._scrubSprite) {
        this._applySpriteSeek(frac);
      }
    }

    _applyVideoSeek(frac) {
      var dur = Number(this._video.duration);
      if (!Number.isFinite(dur) || dur <= 0) return;
      var target = Math.max(0, Math.min(dur - 0.04, frac * dur));
      try { this._video.currentTime = target; } catch (_) {}
      this._tc.textContent = U.formatTime(target) + ' / ' + U.formatTime(dur);
      this._tc.classList.remove('hidden');
    }

    _applySpriteSeek(frac) {
      var sp = this._scrubSprite;
      if (!sp || sp.frames < 1) return;
      var idx = Math.min(sp.frames - 1, Math.max(0, Math.floor(frac * sp.frames)));
      var pct = sp.frames > 1 ? (idx / (sp.frames - 1)) * 100 : 0;
      this._sprite.style.backgroundPosition = pct + '% 50%';
      if (sp.duration > 0) {
        this._tc.textContent = U.formatTime(frac * sp.duration) + ' / ' + U.formatTime(sp.duration);
        this._tc.classList.remove('hidden');
      }
    }

    stopScrub() {
      clearTimeout(this._scrubTimer);
      this._scrubTimer = 0;
      this._scrubHost = null;
      this._scrubNode = null;
      this._scrubMode = 'none';
      this._scrubSprite = null;
      this._scrubPendingFrac = -1;
      if (this._overlay.parentNode) this._overlay.parentNode.removeChild(this._overlay);
      this._overlay.classList.add('hidden');
      this._video.classList.add('hidden');
      this._sprite.classList.add('hidden');
      try {
        if (this._video.getAttribute('src')) {
          this._video.pause();
          this._video.removeAttribute('src');
          this._video.load();
        }
      } catch (_) {}
    }

    /* ================= INLINE RENAME ================= */

    startInlineRename(id, onCommit) {
      var card = this.cardEls.get(id);
      var node = this.itemMap.get(id);
      if (!card || !node) return;
      var titleEl = card.querySelector('.card-title');
      if (!titleEl || titleEl.querySelector('input')) return;

      this.stopScrub();
      this.renamingId = id;
      card.setAttribute('draggable', 'false');

      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'inline-rename-input';
      input.value = node.name;
      titleEl.textContent = '';
      titleEl.appendChild(input);

      var settled = false;
      var self = this;
      function finish(commit) {
        if (settled) return;
        settled = true;
        self.renamingId = '';
        card.setAttribute('draggable', 'true');
        var nextName = input.value.trim();
        titleEl.textContent = commit && nextName ? nextName : node.name;
        if (commit && nextName && nextName !== node.name && onCommit) {
          onCommit(nextName);
        }
      }

      ['mousedown', 'click', 'dblclick', 'dragstart'].forEach(function (ev) {
        input.addEventListener(ev, function (e) { e.stopPropagation(); });
      });
      input.addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      });
      input.addEventListener('blur', function () { finish(true); });

      input.focus();
      input.select();
    }
  }

  root.PrGridView = GridView;
})(typeof window !== 'undefined' ? window : globalThis);
