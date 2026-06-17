function generaPageBreakScript() {
  return `<script>
    (function () {
      var A4_HEIGHT_UNSCALED = 1123;
      var PAGE_BOTTOM_MARGIN = 24;
      var PAGE_TOP_PADDING = 40;
      var paginationDone = false;

      function getBodyScale() {
        var t = window.getComputedStyle(document.body).transform;
        if (!t || t === 'none') return 1;
        var m = t.match(/matrix\\(([^)]+)\\)/);
        if (m) {
          var parts = m[1].split(',');
          return parseFloat(parts[0]) || 1;
        }
        return 1;
      }

      function getTop(el) {
        return el.getBoundingClientRect().top + window.scrollY;
      }

      function getBottom(el) {
        return el.getBoundingClientRect().bottom + window.scrollY;
      }

      function getLayoutTop(el) {
        var scale = getBodyScale();
        return (el.getBoundingClientRect().top + window.scrollY) / scale;
      }

      function getLayoutBottom(el) {
        var scale = getBodyScale();
        return (el.getBoundingClientRect().bottom + window.scrollY) / scale;
      }

      function pageLimit(pageStart, pageHeight) {
        return pageStart + pageHeight - PAGE_BOTTOM_MARGIN;
      }

      function clearLayoutAdjustments() {
        document.querySelectorAll('[data-page-spacer]').forEach(function (spacer) {
          spacer.remove();
        });
        document.querySelectorAll('[data-page-break]').forEach(function (el) {
          el.removeAttribute('data-page-break');
          el.classList.remove('page-break-marker');
          el.style.pageBreakBefore = '';
          el.style.breakBefore = '';
        });
      }

      function markBreakBefore(el) {
        el.setAttribute('data-page-break', 'true');
        el.classList.add('page-break-marker');
        el.style.pageBreakBefore = 'always';
        el.style.breakBefore = 'page';
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
        var rows = document.querySelectorAll('[data-section="servizi"] tbody > tr');
        if (rows.length) return getLayoutBottom(rows[rows.length - 1]);
        var section = document.querySelector('[data-section="servizi"]');
        return section ? getLayoutBottom(section) : 0;
      }

      function collectOrderedElements() {
        var ordered = [];
        Array.prototype.forEach.call(document.querySelectorAll('[data-paginate="intro-block"]'), function (el) {
          ordered.push({ el: el, type: 'intro' });
        });
        Array.prototype.forEach.call(document.querySelectorAll('[data-section="servizi"] tbody > tr'), function (el) {
          ordered.push({ el: el, type: 'servizio' });
        });
        var footer = document.querySelector('[data-section="footer"]');
        if (footer) ordered.push({ el: footer, type: 'footer' });
        return ordered;
      }

      function applyPreviewShift() {
        var pageIndex = window.__PREVIEW_PAGE_INDEX || 0;
        if (pageIndex > 0) {
          var scale = getBodyScale();
          var visualStep = Math.round(A4_HEIGHT_UNSCALED * scale);
          document.body.style.marginTop = '-' + (pageIndex * visualStep) + 'px';
        }
      }

      function postPreviewMessage(totalPages) {
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'page-breaks',
            pageHeightPx: A4_HEIGHT_UNSCALED,
            totalPages: totalPages,
            breakPoints: []
          }));
        }
      }

      function calcolaPreviewPagination() {
        clearLayoutAdjustments();

        var pageHeight = A4_HEIGHT_UNSCALED;
        var footer = document.querySelector('[data-section="footer"]');
        var lastBottom = getLastServiziBottom();

        if (footer && lastBottom > 0) {
          var footerTop = getLayoutTop(footer);
          var footerHeight = getLayoutBottom(footer) - footerTop;
          var pageStart = Math.floor(lastBottom / pageHeight) * pageHeight;
          var usedOnPage = lastBottom - pageStart;
          var spaceLeft = pageHeight - PAGE_BOTTOM_MARGIN - usedOnPage;
          var docBottomPre = getLayoutBottom(document.body);

          if (docBottomPre > pageHeight && footerHeight > spaceLeft) {
            var targetTop = pageStart + pageHeight + PAGE_TOP_PADDING;
            injectSpacerBefore(footer, targetTop);
          }
        }

        var totalPages = Math.max(1, Math.ceil(getLayoutBottom(document.body) / pageHeight));

        applyPreviewShift();

        if ((window.__PREVIEW_PAGE_INDEX || 0) === 0) {
          postPreviewMessage(totalPages);
        }
      }

      function calcolaPdfPageBreaks() {
        clearLayoutAdjustments();

        var PAGE_HEIGHT = A4_HEIGHT_UNSCALED;
        var ordered = collectOrderedElements();
        if (!ordered.length) return;

        var currentPageStart = 0;
        var lastBottom = 0;

        var docBottom = getBottom(document.body);
        if (docBottom <= PAGE_HEIGHT) return;

        ordered.forEach(function (item) {
          var el = item.el;
          var top = getTop(el);
          var bottom = getBottom(el);
          var height = bottom - top;

          if (item.type === 'footer') {
            var usedOnPage = lastBottom - currentPageStart;
            var spaceLeft = PAGE_HEIGHT - PAGE_BOTTOM_MARGIN - usedOnPage;
            if (height > spaceLeft && lastBottom > currentPageStart) {
              var targetTop = currentPageStart + PAGE_HEIGHT + PAGE_TOP_PADDING;
              injectSpacerBefore(el, targetTop);
              markBreakBefore(el);
              currentPageStart = targetTop;
            }
            lastBottom = getBottom(el);
            return;
          }

          if (bottom > pageLimit(currentPageStart, PAGE_HEIGHT)) {
            var targetTop = currentPageStart + PAGE_HEIGHT;
            if (top < targetTop) {
              injectSpacerBefore(el, targetTop);
              markBreakBefore(el);
              currentPageStart = targetTop;
            } else {
              currentPageStart = Math.floor(top / PAGE_HEIGHT) * PAGE_HEIGHT;
            }
          }

          lastBottom = bottom;
        });
      }

      function calcolaPageBreaks() {
        if (paginationDone) return;
        paginationDone = true;

        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          calcolaPreviewPagination();
        } else {
          calcolaPdfPageBreaks();
        }

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
