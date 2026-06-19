function generaPageBreakScript() {
  return `<script>
    (function () {
      var A4_HEIGHT_UNSCALED = 1123;
      var PAGE_BOTTOM_MARGIN = 50;
      var PAGE_TOP_PADDING = 40;
      var RUNNING_FOOTER_HEIGHT = 30;
      var RUNNING_FOOTER_BOTTOM_GAP = 10;
      var RUNNING_FOOTER_SIDE = 48;
      var FIRMA_CLIENTE_RESERVE_PX = 148;
      var paginationDone = false;

      function getScaleRoot() {
        return document.getElementById('preventivo-preview-scale-root') || document.body;
      }

      function getBodyScale() {
        var el = getScaleRoot();
        var t = window.getComputedStyle(el).transform;
        if (!t || t === 'none') return 1;
        var m = t.match(/matrix\\(([^)]+)\\)/);
        if (m) {
          var parts = m[1].split(',');
          return parseFloat(parts[0]) || 1;
        }
        return 1;
      }

      function getLayoutTop(el) {
        var scale = getBodyScale();
        var root = getScaleRoot();
        var rootTop = root.getBoundingClientRect().top + window.scrollY;
        return (el.getBoundingClientRect().top + window.scrollY - rootTop) / scale;
      }

      function getLayoutBottom(el) {
        var scale = getBodyScale();
        var root = getScaleRoot();
        var rootTop = root.getBoundingClientRect().top + window.scrollY;
        return (el.getBoundingClientRect().bottom + window.scrollY - rootTop) / scale;
      }

      function getDocumentLayoutBottom() {
        return getLayoutBottom(getScaleRoot());
      }

      function isPaginatedPreview() {
        return '__PREVIEW_PAGE_INDEX' in window;
      }

      function getPageBottomMargin() {
        if (isPaginatedPreview()) {
          return RUNNING_FOOTER_HEIGHT + RUNNING_FOOTER_BOTTOM_GAP + 20;
        }
        return PAGE_BOTTOM_MARGIN;
      }

      function getFooterMount() {
        return isPaginatedPreview() ? getScaleRoot() : document.body;
      }

      function clearLayoutAdjustments() {
        document.querySelectorAll('[data-page-spacer]').forEach(function (spacer) {
          spacer.remove();
        });
        document.querySelectorAll('[data-repeated-header]').forEach(function (el) {
          el.remove();
        });
        document.querySelectorAll('[data-running-footer-clone]').forEach(function (el) {
          el.remove();
        });
      }

      function injectSpacerBefore(el, targetLayoutTop) {
        var top = getLayoutTop(el);
        var height = Math.round(targetLayoutTop - top);
        if (height < 4) return false;
        var spacer = document.createElement('div');
        spacer.className = 'page-layout-spacer';
        spacer.setAttribute('data-page-spacer', 'true');
        spacer.style.height = height + 'px';
        spacer.style.width = '100%';
        spacer.style.flexShrink = '0';
        el.parentNode.insertBefore(spacer, el);
        return true;
      }

      function getLastServiziBottom() {
        var rows = document.querySelectorAll('[data-section="servizi"] tbody > tr:not([data-repeated-header])');
        if (rows.length) return getLayoutBottom(rows[rows.length - 1]);
        var section = document.querySelector('[data-section="servizi"]');
        return section ? getLayoutBottom(section) : 0;
      }

      function pushOverflowingRows() {
        var pageHeight = A4_HEIGHT_UNSCALED;
        var rows = document.querySelectorAll('[data-section="servizi"] tbody > tr:not([data-repeated-header])');
        Array.prototype.forEach.call(rows, function (row) {
          var top = getLayoutTop(row);
          var bottom = getLayoutBottom(row);
          var pageStart = Math.floor(top / pageHeight) * pageHeight;
          var limit = pageStart + pageHeight - getPageBottomMargin();
          if (bottom > limit) {
            var pushed = injectSpacerBefore(row, pageStart + pageHeight + PAGE_TOP_PADDING);
            if (pushed) row.setAttribute('data-page-start', 'true');
          }
        });
      }

      function repeatTableHeader() {
        var table = document.querySelector('[data-section="servizi"] table');
        if (!table) return;
        var thead = table.querySelector('thead');
        var headerRow = thead ? thead.querySelector('tr') : null;
        if (!headerRow) return;

        var rows = table.querySelectorAll('tbody > tr[data-page-start]');
        Array.prototype.forEach.call(rows, function (row) {
          var clone = headerRow.cloneNode(true);
          clone.setAttribute('data-repeated-header', 'true');
          row.parentNode.insertBefore(clone, row);
          row.removeAttribute('data-page-start');
        });
      }

      function applyPreviewShift() {
        var pageIndex = window.__PREVIEW_PAGE_INDEX || 0;
        if (pageIndex > 0) {
          var scale = getBodyScale();
          var visualStep = Math.round(A4_HEIGHT_UNSCALED * scale);
          getScaleRoot().style.marginTop = '-' + (pageIndex * visualStep) + 'px';
        }
      }

      function countTotalPages(pageHeight) {
        var bottom = getDocumentLayoutBottom();
        var pages = Math.max(1, Math.ceil(bottom / pageHeight));
        if (pages > 1) {
          var remainder = bottom - (pages - 1) * pageHeight;
          if (remainder < PAGE_BOTTOM_MARGIN) pages -= 1;
        }
        return pages;
      }

      function createRunningFooterClone(template, pageIndex, totalPages) {
        var clone = template.cloneNode(true);
        clone.removeAttribute('data-page-footer-template');
        clone.setAttribute('data-running-footer-clone', 'true');
        clone.style.display = 'flex';
        clone.style.position = 'absolute';
        clone.style.top = ((pageIndex + 1) * A4_HEIGHT_UNSCALED - RUNNING_FOOTER_HEIGHT - RUNNING_FOOTER_BOTTOM_GAP) + 'px';
        clone.style.left = RUNNING_FOOTER_SIDE + 'px';
        clone.style.right = RUNNING_FOOTER_SIDE + 'px';
        clone.style.width = 'auto';
        clone.style.maxWidth = 'none';
        clone.style.margin = '0';
        clone.style.boxSizing = 'border-box';
        clone.style.overflow = 'hidden';
        clone.style.zIndex = '20';
        clone.style.pointerEvents = 'none';

        var current = clone.querySelector('[data-page-current]');
        var total = clone.querySelector('[data-page-total]');
        if (current) current.textContent = String(pageIndex + 1);
        if (total) total.textContent = String(totalPages);

        return clone;
      }

      function injectRunningFooters(totalPages) {
        var template = document.querySelector('[data-page-footer-template]');
        if (!template) return;

        var mount = getFooterMount();

        if (!isPaginatedPreview()) {
          document.body.style.minHeight = (totalPages * A4_HEIGHT_UNSCALED) + 'px';
          for (var i = 0; i < totalPages; i++) {
            mount.appendChild(createRunningFooterClone(template, i, totalPages));
          }
        } else {
          var previewIndex = window.__PREVIEW_PAGE_INDEX || 0;
          if (previewIndex < totalPages) {
            mount.appendChild(createRunningFooterClone(template, previewIndex, totalPages));
          }
        }

        template.remove();
      }

      function postPreviewMessage(totalPages) {
        var payload = JSON.stringify({
          type: 'page-breaks',
          pageHeightPx: A4_HEIGHT_UNSCALED,
          totalPages: totalPages,
          breakPoints: []
        });
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(payload);
        }
        if (window.parent && window.parent !== window) {
          try { window.parent.postMessage(payload, '*'); } catch (e) {}
        }
      }

      function getClosingBlockHeight(footer) {
        var footerTop = getLayoutTop(footer);
        var firma = document.querySelector('[data-section="firma-cliente"]');
        var closingBottom;
        if (firma) {
          closingBottom = getLayoutBottom(firma);
        } else {
          var footerBottom = getLayoutBottom(footer);
          var reserve = document.body.getAttribute('data-firma-pdf') === 'true' ? FIRMA_CLIENTE_RESERVE_PX : 0;
          closingBottom = footerBottom + reserve;
        }
        return closingBottom - footerTop;
      }

      function calcolaPagination() {
        clearLayoutAdjustments();
        pushOverflowingRows();
        repeatTableHeader();

        var pageHeight = A4_HEIGHT_UNSCALED;
        var footer = document.querySelector('[data-section="footer"]');
        var lastBottom = getLastServiziBottom();

        if (footer && lastBottom > 0) {
          var closingHeight = getClosingBlockHeight(footer);
          var pageStart = Math.floor(lastBottom / pageHeight) * pageHeight;
          var usedOnPage = lastBottom - pageStart;
          var spaceLeft = pageHeight - getPageBottomMargin() - usedOnPage;
          var docBottomPre = getDocumentLayoutBottom();

          if (docBottomPre > pageHeight && closingHeight > spaceLeft) {
            var targetTop = pageStart + pageHeight + PAGE_TOP_PADDING;
            injectSpacerBefore(footer, targetTop);
          }
        }

        var totalPages = countTotalPages(pageHeight);
        injectRunningFooters(totalPages);

        applyPreviewShift();

        if ((window.__PREVIEW_PAGE_INDEX || 0) === 0) {
          postPreviewMessage(totalPages);
        }
      }

      function calcolaPageBreaks() {
        if (paginationDone) return;
        paginationDone = true;

        calcolaPagination();

        window.__preventivoPaginationReady = true;
      }

      window.addEventListener('load', function () { setTimeout(calcolaPageBreaks, 100); });
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () { setTimeout(calcolaPageBreaks, 100); });
      }
      setTimeout(calcolaPageBreaks, 600);
    })();
  </script>`
}

module.exports = { generaPageBreakScript }
