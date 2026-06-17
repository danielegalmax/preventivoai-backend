function generaPageBreakScript() {
  return `<script>
    (function () {
      var A4_HEIGHT_UNSCALED = 1123;
      var PAGE_BOTTOM_MARGIN = 24;
      var paginationDone = false;

      function getTop(el) {
        return el.getBoundingClientRect().top + window.scrollY;
      }

      function getBottom(el) {
        return el.getBoundingClientRect().bottom + window.scrollY;
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

      function injectSpacerBefore(el, targetTop) {
        var top = getTop(el);
        var height = Math.round(targetTop - top);
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

      function calcolaPreviewPageCount() {
        var docHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
        var totalPages = Math.max(1, Math.ceil(docHeight / A4_HEIGHT_UNSCALED));
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'page-breaks',
          pageHeightPx: A4_HEIGHT_UNSCALED,
          totalPages: totalPages,
          breakPoints: []
        }));
      }

      function calcolaPdfPageBreaks() {
        clearLayoutAdjustments();

        var PAGE_HEIGHT = A4_HEIGHT_UNSCALED;
        var ordered = collectOrderedElements();
        if (!ordered.length) return;

        var breakPoints = [];
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
              var targetTop = currentPageStart + PAGE_HEIGHT;
              injectSpacerBefore(el, targetTop);
              markBreakBefore(el);
              top = getTop(el);
              bottom = getBottom(el);
              currentPageStart = targetTop;
              breakPoints.push({ page: Math.round(currentPageStart / PAGE_HEIGHT) + 1, offsetTop: Math.round(top), tag: 'footer' });
            }
            lastBottom = bottom;
            return;
          }

          if (bottom > pageLimit(currentPageStart, PAGE_HEIGHT)) {
            var targetTop = currentPageStart + PAGE_HEIGHT;
            if (top < targetTop) {
              injectSpacerBefore(el, targetTop);
              markBreakBefore(el);
              top = getTop(el);
              bottom = getBottom(el);
              currentPageStart = targetTop;
              breakPoints.push({ page: Math.round(currentPageStart / PAGE_HEIGHT) + 1, offsetTop: Math.round(top), tag: item.type });
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
          calcolaPreviewPageCount();
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
