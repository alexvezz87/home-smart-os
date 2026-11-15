/**
 * Legacy Kiosk Compatibility Layer (#5)
 * Polyfill ES2019+ e ottimizzazione rendering per tablet Android datati (es. Asus Nexus 7).
 */
(function initLegacyKiosk() {
  if (!Object.fromEntries) {
    Object.fromEntries = function (iterable) {
      var obj = {};
      if (!iterable) return obj;
      if (Array.isArray(iterable)) {
        for (var i = 0; i < iterable.length; i++) {
          var pair = iterable[i];
          if (pair) obj[pair[0]] = pair[1];
        }
      } else if (typeof Symbol !== 'undefined' && iterable[Symbol.iterator]) {
        var it = iterable[Symbol.iterator]();
        var step;
        while (!(step = it.next()).done) {
          if (step.value) obj[step.value[0]] = step.value[1];
        }
      }
      return obj;
    };
  }

  if (!Array.prototype.at) {
    Object.defineProperty(Array.prototype, 'at', {
      value: function (n) {
        var idx = Math.trunc(n) || 0;
        if (idx < 0) idx += this.length;
        if (idx < 0 || idx >= this.length) return undefined;
        return this[idx];
      },
      writable: true,
      configurable: true
    });
  }

  if (!String.prototype.replaceAll) {
    String.prototype.replaceAll = function (str, newStr) {
      if (Object.prototype.toString.call(str).toLowerCase() === '[object regexp]') {
        return this.replace(str, newStr);
      }
      return this.split(str).join(newStr);
    };
  }

  if (typeof window !== 'undefined' && !window.ResizeObserver) {
    window.ResizeObserver = function (callback) {
      this._cb = callback;
    };
    window.ResizeObserver.prototype.observe = function () {};
    window.ResizeObserver.prototype.unobserve = function () {};
    window.ResizeObserver.prototype.disconnect = function () {};
  }

  if (typeof navigator === 'undefined' || typeof document === 'undefined') return;

  var ua = navigator.userAgent || '';
  var chromeMatch = ua.match(/Chrome\/(\d+)/i);
  var androidMatch = ua.match(/Android\s+(\d+)/i);
  var chromeVer = chromeMatch ? parseInt(chromeMatch[1], 10) : 999;
  var androidVer = androidMatch ? parseInt(androidMatch[1], 10) : 99;
  var forceParam = false;
  var forceStorage = false;

  try {
    forceParam = typeof URLSearchParams !== 'undefined' &&
      new URLSearchParams(window.location.search).get('kiosk') === 'legacy';
    forceStorage = window.localStorage && window.localStorage.getItem('kiosk_legacy') === '1';
  } catch (_) {}

  var isLegacy = forceParam || forceStorage || chromeVer < 88 || androidVer < 9;
  if (isLegacy) {
    document.documentElement.classList.add('legacy-kiosk');
    var style = document.createElement('style');
    style.id = 'legacy-kiosk-styles';
    style.textContent =
      'html.legacy-kiosk *, html.legacy-kiosk *::before, html.legacy-kiosk *::after {' +
      '  backdrop-filter: none !important;' +
      '  -webkit-backdrop-filter: none !important;' +
      '  animation-duration: 0.01ms !important;' +
      '  transition-duration: 0.01ms !important;' +
      '}';
    if (document.head) {
      document.head.appendChild(style);
    } else {
      document.addEventListener('DOMContentLoaded', function () {
        if (document.head) document.head.appendChild(style);
      });
    }
  }
})();
