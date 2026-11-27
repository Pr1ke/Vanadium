// Beta storage. The copy installed in a folder named vanadiumBeta (any letter case) keeps its own
// browser storage, separate from the main copy on the same domain: every localStorage/sessionStorage
// key, IndexedDB database and Cache Storage name gets the prefix "vanadiumBeta:". Any other folder is
// left exactly as it is. Inlined first in index.html and respite.html by the build, before any other
// script, so app.js, sync.js and Respite need no changes.
(function () {
  if (!/(^|\/)vanadiumbeta$/i.test(location.pathname.replace(/\/[^/]*$/, ''))) return;
  var NS = 'vanadiumBeta:'; window.VANADIUM_NS = NS;
  try {
    var P = Storage.prototype, g = P.getItem, s = P.setItem, r = P.removeItem, k = P.key, len = Object.getOwnPropertyDescriptor(P, 'length').get;
    var own = function (st) { var out = []; for (var i = 0, n = len.call(st); i < n; i++) { var x = k.call(st, i); if (x != null && x.indexOf(NS) === 0) out.push(x.slice(NS.length)); } return out; };
    P.getItem = function (x) { return g.call(this, NS + x); };
    P.setItem = function (x, v) { return s.call(this, NS + x, v); };
    P.removeItem = function (x) { return r.call(this, NS + x); };
    P.key = function (i) { var o = own(this); return i >= 0 && i < o.length ? o[i] : null; };
    P.clear = function () { var t = this; own(t).forEach(function (x) { r.call(t, NS + x); }); };
    Object.defineProperty(P, 'length', { configurable: true, enumerable: true, get: function () { return own(this).length; } });
  } catch (e) { }
  try {
    var I = IDBFactory.prototype, o = I.open, d = I.deleteDatabase;
    I.open = function (n) { var a = [].slice.call(arguments); a[0] = NS + n; return o.apply(this, a); };
    I.deleteDatabase = function (n) { return d.call(this, NS + n); };
  } catch (e) { }
  try {
    if (window.CacheStorage) {
      var C = CacheStorage.prototype, op = C.open, de = C.delete, ha = C.has, ke = C.keys;
      C.open = function (n) { return op.call(this, NS + n); };
      C.delete = function (n) { return de.call(this, NS + n); };
      C.has = function (n) { return ha.call(this, NS + n); };
      C.keys = function () { return ke.call(this).then(function (ks) { return ks.filter(function (x) { return x.indexOf(NS) === 0; }).map(function (x) { return x.slice(NS.length); }); }); };
    }
  } catch (e) { }
})();
