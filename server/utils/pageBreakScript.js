function generaPageBreakScript() {
  return `<script>
    (function () {
      var A4_HEIGHT_UNSCALED = 1123;
      var PAGE_BOTTOM_MARGIN = 24;

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

      function pageBottom(pageStart, pageHeight) {
        return pageStart + pageHeight - PAGE_BOTTOM_MARGIN;
      }

      function pageStartForY(y, pageHeight) {
        return Math.floor(y / pageHeight) * pageHeight;
      }

      function nextPageStart(y, pageHeight) {
        return pageStartForY(y, pageHeight) + pageHeight;
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
        if (height < 4) return;
        var spacer = document.createElement('div');
        spacer.className = 'page-layout-spacer';
        spacer.setAttribute('data-page-spacer', 'true');
        spacer.style.height = height + 'px';
        spacer.style.width = '100%';
        spacer.style.flexShrink = '0';
        el.parentNode.insertBefore(spacer, el);
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

      function postMessage(totalPages, pageOffsets, breakPoints, pageHeight) {
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'page-breaks',
            pageHeightPx: pageHeight,
            totalPages: totalPages,
            pageOffsets: pageOffsets,
            breakPoints: breakPoints
          }));
        }
      }

      function calcolaPageBreaks() {
        clearLayoutAdjustments();

        var scale = getBodyScale();
        var PAGE_HEIGHT = Math.round(A4_HEIGHT_UNSCALED * scale);
        if (PAGE_HEIGHT < 200) PAGE_HEIGHT = Math.round(A4_HEIGHT_UNSCALED * 0.45);

        var ordered = collectOrderedElements();
        if (!ordered.length) {
          postMessage(1, [0], [], PAGE_HEIGHT);
          window.__preventivoPaginationReady = true;
          return;
        }

        var docBottom = getBottom(document.body);
        if (docBottom <= PAGE_HEIGHT) {
          postMessage(1, [0], [], PAGE_HEIGHT);
          window.__preventivoPaginationReady = true;
          return;
        }

        var breakPoints = [];
        var currentPageStart = 0;
        var lastBottom = 0;

        ordered.forEach(function (item) {
          var el = item.el;
          var top = getTop(el);
          var bottom = getBottom(el);
          var height = bottom - top;

          if (item.type === 'footer') {
            var spaceLeft = pageBottom(currentPageStart, PAGE_HEIGHT) - lastBottom;
            if (height > spaceLeft && lastBottom > currentPageStart) {
              var targetTop = nextPageStart(lastBottom, PAGE_HEIGHT);
              injectSpacerBefore(el, targetTop);
              markBreakBefore(el);
              top = getTop(el);
              bottom = getBottom(el);
              currentPageStart = pageStartForY(top, PAGE_HEIGHT);
              breakPoints.push({ page: Math.round(currentPageStart / PAGE_HEIGHT) + 1, offsetTop: Math.round(top), tag: 'footer' });
            }
            lastBottom = bottom;
            return;
          }

          if (top - currentPageStart >= PAGE_HEIGHT) {
            currentPageStart = pageStartForY(top, PAGE_HEIGHT);
          }

          if (bottom > pageBottom(currentPageStart, PAGE_HEIGHT)) {
            var targetTop = nextPageStart(top, PAGE_HEIGHT);
            injectSpacerBefore(el, targetTop);
            markBreakBefore(el);
            top = getTop(el);
            bottom = getBottom(el);
            currentPageStart = pageStartForY(top, PAGE_HEIGHT);
            breakPoints.push({ page: Math.round(currentPageStart / PAGE_HEIGHT) + 1, offsetTop: Math.round(top), tag: item.type });
          }

          lastBottom = bottom;
        });

        docBottom = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
        var totalPages = Math.max(1, Math.ceil(docBottom / PAGE_HEIGHT));
        var pageOffsets = [];
        for (var i = 0; i < totalPages; i++) pageOffsets.push(i * PAGE_HEIGHT);

        postMessage(totalPages, pageOffsets, breakPoints, PAGE_HEIGHT);
        window.__preventivoPaginationReady = true;
      }

      window.addEventListener('load', calcolaPageBreaks);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(calcolaPageBreaks);
      setTimeout(calcolaPageBreaks, 300);
      setTimeout(calcolaPageBreaks, 1000);
    })();
  </script>`
}

module.exports = { generaPageBreakScript }
