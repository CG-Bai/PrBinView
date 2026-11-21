(function (root) {
  'use strict';

  var U = root.PrUtils;
  var I18n = root.PrI18n;
  function tr(key, vars) { return I18n ? I18n.t(key, vars) : key; }

  class TreeView {
    constructor(container, callbacks) {
      this.container = container;
      this.cb = callbacks || {};
      this.index = null;
      this.activeId = '';
      this.expanded = new Set();
      this.rowEls = new Map();
      this.sortBy = 'name';
      this.sortDir = 'asc';
      this.hiddenIds = null;
      this.viewHidden = false;
      this.renamingId = '';
      this.isDraggingInternal = false;
      this.draggedBinId = '';
      this._hoverExpandTimer = 0;
      this._hoverExpandId = '';
      this._bindDelegatedEvents();
    }

    _bindDelegatedEvents() {
      var self = this;
      this.container.addEventListener('click', function (e) {
        if (self.renamingId) return;
        var toggleBtn = e.target.closest('.tree-toggle');
        if (toggleBtn) {
          e.stopPropagation();
          var toggleId = toggleBtn.dataset.id;
          self.toggleExpand(toggleId);
          return;
        }
        var row = e.target.closest('.tree-row');
        if (!row) return;
        var id = row.dataset.id;
        if (self.cb.onSelectFolder) self.cb.onSelectFolder(id);
      });

      this.container.addEventListener('dblclick', function (e) {
        if (self.renamingId) return;
        var row = e.target.closest('.tree-row');
        if (!row) return;
        var id = row.dataset.id;
        if (self.index) {
          var sub = self.index.subBinsByParent.get(id) || [];
          if (sub.length) self.toggleExpand(id);
        }
      });

      this.container.addEventListener('contextmenu', function (e) {
        if (e.target && e.target.tagName === 'INPUT') return;
        e.preventDefault();
        e.stopPropagation();
        var row = e.target.closest('.tree-row');
        if (self.cb.onContextMenu) self.cb.onContextMenu(e, row ? row.dataset.id : '');
      });

      this.container.addEventListener('dragstart', function (e) {
        if (self.renamingId) { e.preventDefault(); return; }
        var row = e.target.closest('.tree-row');
        if (!row) { e.preventDefault(); return; }
        var id = row.dataset.id;
        var node = self.index && self.index.nodes.get(id);
        if (!node || !node.pid) { e.preventDefault(); return; }

        self.isDraggingInternal = true;
        self.draggedBinId = id;
        setTimeout(function () {
          if (self.isDraggingInternal && row.isConnected) row.classList.add('is-dragging');
        }, 0);

        try {
          e.dataTransfer.setData('application/x-prbinview-ids', JSON.stringify([id]));
          e.dataTransfer.setData('text/plain', node.name);
          e.dataTransfer.effectAllowed = 'move';
        } catch (_) {}

        if (self.cb.onDragStart) self.cb.onDragStart(id, node.name);
      });

      this.container.addEventListener('dragend', function () {
        self.isDraggingInternal = false;
        self.draggedBinId = '';
        self._clearHoverExpand();
        self._highlightDrop(null);
        var dragging = self.container.querySelectorAll('.tree-row.is-dragging');
        for (var i = 0; i < dragging.length; i++) dragging[i].classList.remove('is-dragging');
        if (self.cb.onDragEnd) self.cb.onDragEnd();
      });

      this.container.addEventListener('dragover', function (e) {
        var isInternal = self.isDraggingInternal || !!(self.cb.canDrop && self.cb.canDrop());
        var isExternal = !isInternal && !!(e.dataTransfer && e.dataTransfer.types && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1);
        if (!isInternal && !isExternal) return;
        var row = e.target.closest('.tree-row');
        if (!row) {
          self._clearHoverExpand();
          self._highlightDrop(null);
          return;
        }
        var targetId = row.dataset.id;
        if (isInternal && !self._canAcceptInternalDrop(targetId)) {
          self._clearHoverExpand();
          self._highlightDrop(null);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = isExternal ? 'copy' : 'move';
        self._highlightDrop(row);
        self._scheduleHoverExpand(targetId);
        if (isExternal && self.cb.onExternalHover) self.cb.onExternalHover(targetId);
      });

      this.container.addEventListener('dragleave', function (e) {
        if (!self.container.contains(e.relatedTarget)) {
          self._clearHoverExpand();
          self._highlightDrop(null);
        }
      });

      this.container.addEventListener('drop', function (e) {
        var row = e.target.closest('.tree-row');
        self._clearHoverExpand();
        self._highlightDrop(null);
        if (!row) return;
        var targetId = row.dataset.id;
        var isInternal = self.isDraggingInternal || !!(self.cb.canDrop && self.cb.canDrop());
        if (isInternal) {
          if (!self._canAcceptInternalDrop(targetId) || !self.cb.onDropToBin) return;
          e.preventDefault();
          e.stopPropagation();
          self.cb.onDropToBin(targetId, e);
        } else if (self.cb.onExternalDrop) {
          e.preventDefault();
          e.stopPropagation();
          self.cb.onExternalDrop(targetId, e);
        }
      });
    }

    _canAcceptInternalDrop(targetBinId) {
      if (!targetBinId || !this.index) return false;
      if (!this.isDraggingInternal || !this.draggedBinId) return true;
      var dragId = this.draggedBinId;
      if (targetBinId === dragId) return false;
      var dragged = this.index.nodes.get(dragId);
      if (!dragged || !dragged.pid) return false;
      if (dragged.pid === targetBinId) return false;
      var ancestors = U.getAncestors(this.index.nodes, targetBinId);
      for (var i = 0; i < ancestors.length; i++) {
        if (ancestors[i].id === dragId) return false;
      }
      return true;
    }

    _clearHoverExpand() {
      if (this._hoverExpandTimer) {
        clearTimeout(this._hoverExpandTimer);
        this._hoverExpandTimer = 0;
      }
      this._hoverExpandId = '';
    }

    _scheduleHoverExpand(binId) {
      if (!binId || !this.index || this.expanded.has(binId)) {
        this._clearHoverExpand();
        return;
      }
      var subs = this.index.subBinsByParent.get(binId) || [];
      if (!subs.length) {
        this._clearHoverExpand();
        return;
      }
      if (this._hoverExpandId === binId) return;
      this._clearHoverExpand();
      this._hoverExpandId = binId;
      var self = this;
      this._hoverExpandTimer = setTimeout(function () {
        self._hoverExpandTimer = 0;
        self._hoverExpandId = '';
        if (self.index && !self.expanded.has(binId)) {
          self.expanded.add(binId);
          self.render();
        }
      }, 550);
    }

    _highlightDrop(row) {
      if (this._dropRow && this._dropRow !== row) {
        this._dropRow.classList.remove('is-drop-target');
      }
      this._dropRow = row || null;
      if (this._dropRow) this._dropRow.classList.add('is-drop-target');
    }

    setData(index, activeId, autoExpandRoot) {
      this.index = index;
      this.activeId = activeId || (index ? index.rootId : '');
      if (index && autoExpandRoot) {
        this.expanded.add(index.rootId);
        /* Expand first-level bins that have children so structure is immediately obvious */
        var topBins = index.subBinsByParent.get(index.rootId) || [];
        if (topBins.length <= 12) {
          for (var i = 0; i < topBins.length; i++) {
            this.expanded.add(topBins[i].id);
          }
        }
      }
      if (this.activeId && index) {
        var ancestors = U.getAncestors(index.nodes, this.activeId);
        for (var j = 0; j < ancestors.length - 1; j++) {
          this.expanded.add(ancestors[j].id);
        }
      }
      this.render();
    }

    setActive(binId) {
      if (!this.index || !binId) return;
      var needsRerender = false;
      var ancestors = U.getAncestors(this.index.nodes, binId);
      for (var i = 0; i < ancestors.length - 1; i++) {
        if (!this.expanded.has(ancestors[i].id)) {
          this.expanded.add(ancestors[i].id);
          needsRerender = true;
        }
      }
      var prev = this.activeId;
      this.activeId = binId;
      if (needsRerender) {
        this.render();
      } else {
        if (prev && this.rowEls.has(prev)) {
          var prevRow = this.rowEls.get(prev);
          prevRow.classList.remove('is-active');
          var prevIcon = prevRow.querySelector('.tree-icon');
          if (prevIcon) prevIcon.innerHTML = U.ICONS.folder;
        }
        if (this.rowEls.has(binId)) {
          var nextRow = this.rowEls.get(binId);
          nextRow.classList.add('is-active');
          var nextIcon = nextRow.querySelector('.tree-icon');
          if (nextIcon) nextIcon.innerHTML = U.ICONS.folderOpen;
        }
      }
      var activeEl = this.rowEls.get(binId);
      if (activeEl && typeof activeEl.scrollIntoView === 'function') {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }

    toggleExpand(binId) {
      if (this.expanded.has(binId)) this.expanded.delete(binId);
      else this.expanded.add(binId);
      this.render();
    }

    navigateByArrow(key) {
      if (!this.index) return null;
      var rows = this.container.querySelectorAll('.tree-row');
      if (!rows || !rows.length) return null;

      var curIdx = -1;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].dataset.id === this.activeId) { curIdx = i; break; }
      }
      if (curIdx < 0) curIdx = 0;
      var curId = rows[curIdx].dataset.id;
      var curNode = this.index.nodes.get(curId);
      var self = this;
      var rawSubs = this.index.subBinsByParent.get(curId) || [];
      var hasVisibleSub = rawSubs.some(function (sb) {
        return self.viewHidden || !(self.hiddenIds && self.hiddenIds.has(sb.id));
      });

      if (key === 'ArrowUp') {
        if (curIdx > 0) return { action: 'select', id: rows[curIdx - 1].dataset.id };
        return { action: 'noop', id: curId };
      }
      if (key === 'ArrowDown') {
        if (curIdx < rows.length - 1) return { action: 'select', id: rows[curIdx + 1].dataset.id };
        return { action: 'noop', id: curId };
      }
      if (key === 'Home') {
        return { action: 'select', id: rows[0].dataset.id };
      }
      if (key === 'End') {
        return { action: 'select', id: rows[rows.length - 1].dataset.id };
      }
      if (key === 'ArrowRight') {
        if (hasVisibleSub && !this.expanded.has(curId)) {
          this.toggleExpand(curId);
          return { action: 'expand', id: curId };
        }
        if (curIdx + 1 < rows.length) {
          var nextId = rows[curIdx + 1].dataset.id;
          var nextNode = this.index.nodes.get(nextId);
          if (nextNode && nextNode.pid === curId) {
            return { action: 'select', id: nextId };
          }
        }
        return { action: 'focusGrid', id: curId };
      }
      if (key === 'ArrowLeft') {
        if (hasVisibleSub && this.expanded.has(curId)) {
          this.toggleExpand(curId);
          return { action: 'collapse', id: curId };
        }
        if (curNode && curNode.pid) {
          return { action: 'select', id: curNode.pid };
        }
        return { action: 'noop', id: curId };
      }
      return null;
    }

    setSort(sortBy, sortDir) {
      this.sortBy = sortBy || 'name';
      this.sortDir = sortDir === 'desc' ? 'desc' : 'asc';
      if (this.index) this.render();
    }

    setHiddenFilter(hiddenSet, viewHidden) {
      this.hiddenIds = hiddenSet || null;
      this.viewHidden = !!viewHidden;
      if (this.index) this.render();
    }

    setItemSize(px) {
      var h = Math.max(22, Math.min(44, Math.round(Number(px) || 27)));
      var t = (h - 22) / 22;
      var s = this.container.style;
      s.setProperty('--tree-row-h', h + 'px');
      s.setProperty('--tree-font', (10.5 + t * 5.5).toFixed(1) + 'px');
      s.setProperty('--tree-icon', Math.round(12 + t * 10) + 'px');
      s.setProperty('--tree-toggle', Math.round(12 + t * 7) + 'px');
      s.setProperty('--tree-dot', (4.5 + t * 3.5).toFixed(1) + 'px');
      s.setProperty('--tree-gap', Math.round(4 + t * 4) + 'px');
      s.setProperty('--tree-indent', Math.round(12 + t * 8) + 'px');
      s.setProperty('--tree-badge-font', (9.5 + t * 3).toFixed(1) + 'px');
      s.setProperty('--tree-badge-h', Math.round(14 + t * 7) + 'px');
    }

    render() {
      this.container.innerHTML = '';
      this.rowEls.clear();
      if (!this.index || !this.index.rootId) return;

      var frag = document.createDocumentFragment();
      var self = this;

      function appendBin(binId, depth) {
        var node = self.index.nodes.get(binId);
        if (!node) return;
        var isHidden = !!(node.pid && self.hiddenIds && self.hiddenIds.has(binId));
        if (isHidden && !self.viewHidden) return;
        var rawSubBins = self.index.subBinsByParent.get(binId) || [];
        var subBins = rawSubBins.length > 1
          ? U.sortFolderList(rawSubBins, self.index.mediaCounts, self.sortBy, self.sortDir)
          : rawSubBins;
        var hasSub = subBins.some(function (sb) {
          return self.viewHidden || !(self.hiddenIds && self.hiddenIds.has(sb.id));
        });
        var isOpen = self.expanded.has(binId);
        var isActive = binId === self.activeId;
        var count = self.index.mediaCounts.get(binId) || 0;

        var row = document.createElement('div');
        row.className = 'tree-row' +
          (isActive ? ' is-active' : '') +
          (isHidden ? ' is-hidden-item' : '') +
          (self.isDraggingInternal && self.draggedBinId === binId ? ' is-dragging' : '');
        row.dataset.id = binId;
        if (node.pid) row.setAttribute('draggable', 'true');
        row.style.paddingLeft = 'calc(8px + ' + depth + ' * var(--tree-indent, 14px))';
        row.title = node.pid ? tr('tree.binTitle', { name: node.name }) : tr('tree.rootTitle', { name: node.name });

        var toggle = document.createElement('span');
        toggle.className = 'tree-toggle' + (hasSub ? (isOpen ? ' is-open' : '') : ' is-leaf');
        toggle.dataset.id = binId;
        if (hasSub) toggle.innerHTML = U.ICONS.chevronRight;
        row.appendChild(toggle);

        var labelHex = U.labelColor(node.label);

        var dot = document.createElement('span');
        dot.className = 'tree-dot';
        dot.style.backgroundColor = labelHex;
        row.appendChild(dot);

        var icon = document.createElement('span');
        icon.className = 'tree-icon';
        icon.style.color = labelHex;
        icon.innerHTML = isActive ? U.ICONS.folderOpen : U.ICONS.folder;
        row.appendChild(icon);

        var name = document.createElement('span');
        name.className = 'tree-name';
        name.textContent = node.pid ? node.name : tr('tree.rootName');
        row.appendChild(name);

        if (count > 0) {
          var badge = document.createElement('span');
          badge.className = 'tree-count';
          badge.textContent = String(count);
          row.appendChild(badge);
        }

        frag.appendChild(row);
        self.rowEls.set(binId, row);

        if (hasSub && isOpen) {
          for (var i = 0; i < subBins.length; i++) {
            appendBin(subBins[i].id, depth + 1);
          }
        }
      }

      appendBin(this.index.rootId, 0);
      this.container.appendChild(frag);
    }

    startInlineRename(id, onCommit) {
      if (!this.index || !id) return false;
      var node = this.index.nodes.get(id);
      if (!node || !node.pid) return false;

      /* Ensure ancestor folders are expanded so the target row is visible in DOM */
      if (!this.rowEls.has(id)) {
        var ancestors = U.getAncestors(this.index.nodes, id);
        for (var i = 0; i < ancestors.length - 1; i++) {
          this.expanded.add(ancestors[i].id);
        }
        this.render();
      }

      var row = this.rowEls.get(id);
      if (!row) return false;
      var nameEl = row.querySelector('.tree-name');
      if (!nameEl || nameEl.querySelector('input')) return false;

      if (typeof row.scrollIntoView === 'function') {
        row.scrollIntoView({ block: 'nearest' });
      }

      this.renamingId = id;
      row.setAttribute('draggable', 'false');
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'inline-rename-input tree-rename-input';
      input.value = node.name;
      nameEl.textContent = '';
      nameEl.appendChild(input);

      var settled = false;
      var self = this;
      function finish(commit) {
        if (settled) return;
        settled = true;
        self.renamingId = '';
        if (node.pid) row.setAttribute('draggable', 'true');
        var nextName = input.value.trim();
        nameEl.textContent = commit && nextName ? nextName : node.name;
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
      return true;
    }
  }

  root.PrTreeView = TreeView;
})(typeof window !== 'undefined' ? window : globalThis);
