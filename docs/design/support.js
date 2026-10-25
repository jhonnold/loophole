// Minimal stand-in for the design-canvas runtime so the .dc.html artboards open in a plain browser.
// Supports what these files use: {{dotted.path}} holes, <sc-for>, <sc-if>, on* handlers, <helmet>,
// and a `class Component extends DCLogic` with renderVals(), setState() and componentDidMount().
// It is a viewer for the design kit, not production code.
(function () {
  var hide = document.createElement('style');
  hide.textContent = 'x-dc{display:contents}x-dc:not([data-ready]){visibility:hidden}';
  document.head.appendChild(hide);

  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var WHOLE = /^\{\{\s*([^}]+?)\s*\}\}$/;

  function lookup(path, scope) {
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    var parts = path.split('.'), val = scope[parts[0]];
    for (var i = 1; i < parts.length && val != null; i++) val = val[parts[i]];
    return val;
  }

  function interpolate(text, scope) {
    return text.replace(HOLE, function (_, p) { var v = lookup(p, scope); return v == null ? '' : String(v); });
  }

  function build(node, scope, out) {
    if (node.nodeType === 3) { out.push(document.createTextNode(interpolate(node.nodeValue, scope))); return; }
    if (node.nodeType !== 1) return;
    var tag = node.localName, kids = node.childNodes, i;
    if (tag === 'sc-for') {
      var list = lookup(WHOLE.exec(node.getAttribute('list'))[1], scope) || [];
      var as = node.getAttribute('as');
      list.forEach(function (item, idx) {
        var inner = Object.assign({}, scope, { $index: idx });
        inner[as] = item;
        for (var k = 0; k < kids.length; k++) build(kids[k], inner, out);
      });
      return;
    }
    if (tag === 'sc-if') {
      if (lookup(WHOLE.exec(node.getAttribute('value'))[1], scope)) for (i = 0; i < kids.length; i++) build(kids[i], scope, out);
      return;
    }
    var el = node.cloneNode(false);
    Array.prototype.slice.call(el.attributes).forEach(function (attr) {
      var name = attr.name, v = attr.value, whole = WHOLE.exec(v);
      if (name.indexOf('hint-') === 0) { el.removeAttribute(name); return; }
      if (v.indexOf('{{') < 0) return;
      if (name.indexOf('on') === 0) {
        el.removeAttribute(name);
        var fn = whole && lookup(whole[1], scope);
        if (typeof fn === 'function') el.addEventListener(name.slice(2).toLowerCase(), fn);
        return;
      }
      if (whole) {
        var val = lookup(whole[1], scope);
        if (val === false || val == null) el.removeAttribute(name);
        else el.setAttribute(name, val === true ? '' : String(val));
      } else {
        el.setAttribute(name, interpolate(v, scope));
      }
    });
    for (i = 0; i < kids.length; i++) {
      var built = [];
      build(kids[i], scope, built);
      built.forEach(function (b) { el.appendChild(b); });
    }
    out.push(el);
  }

  var queued = false, renderNow = function () {};
  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (patch) {
    if (typeof patch === 'function') patch = patch(this.state, this.props);
    this.state = Object.assign({}, this.state, patch);
    this.forceUpdate();
  };
  DCLogic.prototype.forceUpdate = function () {
    if (queued) return;
    queued = true;
    Promise.resolve().then(function () { queued = false; renderNow(); });
  };
  window.DCLogic = DCLogic;

  document.addEventListener('DOMContentLoaded', function () {
    var root = document.querySelector('x-dc');
    var helmet = root.querySelector('helmet');
    if (helmet) { while (helmet.firstChild) document.head.appendChild(helmet.firstChild); helmet.remove(); }
    var tpl = document.createDocumentFragment();
    while (root.firstChild) tpl.appendChild(root.firstChild);

    var src = document.querySelector('script[data-dc-script]').textContent;
    var Component = new Function('DCLogic', src + '\n;return Component;')(DCLogic);
    var inst = new Component({});
    if (!inst.state) inst.state = {};

    renderNow = function () {
      var vals = inst.renderVals(), out = [];
      for (var i = 0; i < tpl.childNodes.length; i++) build(tpl.childNodes[i], vals, out);
      root.replaceChildren.apply(root, out);
      root.setAttribute('data-ready', '');
    };
    renderNow();
    if (inst.componentDidMount) inst.componentDidMount();
  });
})();
