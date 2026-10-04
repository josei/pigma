/**
 * Guest bootstrap: the Plugin API shim evaluated inside the QuickJS sandbox.
 *
 * It reaches the host only through the `__pigma*` bridge globals the engine
 * installs. Kept as a raw string in its own module so the guest program is
 * reviewable separately from the host-side engine.
 */
export const BOOTSTRAP = String.raw`
(function () {
  'use strict';
  var create = globalThis.__pigmaCreate;
  var combine = globalThis.__pigmaCombine;
  var boolean = globalThis.__pigmaBoolean;
  var get = globalThis.__pigmaGet;
  var set = globalThis.__pigmaSet;
  var call = globalThis.__pigmaCall;
  var pageId = globalThis.__pigmaPageId;
  var documentId = globalThis.__pigmaDocumentId;
  var hasNode = globalThis.__pigmaHasNode;
  var childrenOf = globalThis.__pigmaChildren;
  var selection = globalThis.__pigmaSelection;
  var setSelection = globalThis.__pigmaSetSelection;
  var log = globalThis.__pigmaLog;
  var warn = globalThis.__pigmaWarn;
  var close = globalThis.__pigmaClose;

  function json(value) { return value === undefined ? 'null' : JSON.stringify(value); }
  function parse(text) { return JSON.parse(text); }

  // Union / subtract / intersect / exclude, delegated to the model's boolean engine.
  function booleanOperation(mode, nodes, parent) {
    if (!Array.isArray(nodes) || nodes.length === 0) {
      throw new Error(mode.toLowerCase() + ' requires an array of nodes');
    }
    var ids = nodes.map(function (node) { return node.id; });
    var parentId = parent === undefined || parent === null ? null : (parent.id || parent);
    return boolean(JSON.stringify(ids), mode, parentId === null ? null : String(parentId));
  }

  var PROPS = [
    'name', 'visible', 'opacity', 'width', 'height', 'x', 'y', 'rotation', 'fills', 'strokes',
    'characters', 'fontSize', 'fontName', 'letterSpacing', 'lineHeight',
    'textAlignHorizontal', 'textAlignVertical', 'textCase', 'textDecoration',
    'cornerRadius', 'layoutAlign', 'layoutGrow', 'vectorPaths',
    'effects', 'description', 'windingRule', 'rectangleCornerRadii',
    'styles', 'boundVariables', 'componentPropertyReferences', 'componentProperties', 'componentId',
    'layoutMode', 'itemSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'primaryAxisSizingMode', 'counterAxisSizingMode', 'primaryAxisAlignItems', 'counterAxisAlignItems',
    'layoutWrap', 'layoutSizingHorizontal', 'layoutSizingVertical',
  ];

  /**
   * Wrap a guest object so anything outside the supported subset fails
   * explicitly instead of silently returning undefined. Used for nodes and for
   * figma.currentPage, so the guarantee is uniform.
   */
  function strict(target, supported, label) {
    var BENIGN = ['then', 'toJSON', 'constructor', 'valueOf', 'toString'];
    return new Proxy(target, {
      get: function (object, prop) {
        if (typeof prop === 'symbol' || prop in object || BENIGN.indexOf(prop) >= 0) return Reflect.get(object, prop);
        throw new Error(
          'Unsupported Plugin API member "' + String(prop) + '" on ' + label + '. Supported: ' + supported.join(', ') + '.',
        );
      },
      set: function (object, prop, value) {
        if (prop in object) return Reflect.set(object, prop, value);
        throw new Error('Unsupported Plugin API property "' + String(prop) + '" on ' + label + '.');
      },
    });
  }

  function wrapNode(id) {
    var node = {};
    Object.defineProperty(node, 'id', { value: id, enumerable: true });
    Object.defineProperty(node, 'type', { get: function () { return parse(get(id, 'type')); }, enumerable: true });
    Object.defineProperty(node, 'componentPropertyDefinitions', {
      get: function () { return parse(get(id, 'componentPropertyDefinitions')); }, enumerable: true,
    });
    PROPS.forEach(function (prop) {
      Object.defineProperty(node, prop, {
        get: function () { return parse(get(id, prop)); },
        set: function (value) { set(id, prop, json(value)); },
        enumerable: true,
      });
    });
    Object.defineProperty(node, 'children', { get: function () { return parse(childrenOf(id)).map(wrapNode); }, enumerable: true });
    ['vectorNetwork', 'vectorNetworkAsync'].forEach(function (name) {
      // Routed to the host: a set is converted to pathData (logged); a read
      // returns null because Pigma does not retain editable networks.
      Object.defineProperty(node, name, {
        get: function () { return parse(get(id, name)); },
        set: function (value) { set(id, name, json(value)); },
        enumerable: false,
      });
    });
    node.createInstance = function () { return wrapNode(parse(call(id, 'createInstance', json([])))); };
    node.resize = function (width, height) { call(id, 'resize', json([width, height])); };
    node.setProperties = function (values) { call(id, 'setProperties', json([values || {}])); return node; };
    // Figma exposes the main component as a node reference, not an id.
    Object.defineProperty(node, 'mainComponent', {
      get: function () {
        var componentId = node.componentId;
        return componentId === undefined || componentId === null ? null : wrapNode(componentId);
      },
      enumerable: false,
    });
    node.appendChild = function (child) { call(id, 'appendChild', json([child.id])); return child; };
    node.remove = function () { call(id, 'remove', json([])); };
    return strict(node, PROPS.concat(['id', 'type', 'children', 'resize', 'appendChild', 'remove', 'setProperties', 'mainComponent', 'vectorPaths', 'vectorNetwork']), 'a node');
  }

  var currentPage = strict({
    id: pageId(),
    type: 'PAGE',
    get name() { return 'Page'; },
    get children() { return parse(childrenOf(pageId())).map(wrapNode); },
    get selection() { return parse(selection()).map(wrapNode); },
    set selection(nodes) { setSelection(json(nodes.map(function (node) { return node.id; }))); },
    appendChild: function (node) { call(pageId(), 'appendChild', json([node.id])); return node; },
  }, ['id', 'type', 'name', 'children', 'selection', 'appendChild'], 'figma.currentPage');

  var runContext = (function () {
    try { return JSON.parse(globalThis.__pigmaRunContextJson()); } catch (error) { return {}; }
  })();
  var runHandlers = [];

  var figma = {
    root: wrapNode(documentId()),
    currentPage: currentPage,
    mixed: { __pigmaMixed: true },
    createFrame: function (a) { return wrapNode(create('FRAME', json(a || {}))); },
    createRectangle: function (a) { return wrapNode(create('RECTANGLE', json(a || {}))); },
    createEllipse: function (a) { return wrapNode(create('ELLIPSE', json(a || {}))); },
    createLine: function (a) { return wrapNode(create('LINE', json(a || {}))); },
    createPolygon: function (a) { return wrapNode(create('POLYGON', json(a || {}))); },
    createStar: function (a) { return wrapNode(create('STAR', json(a || {}))); },
    createText: function (a) { return wrapNode(create('TEXT', json(a || {}))); },
    createVector: function (a) { return wrapNode(create('VECTOR', json(a || {}))); },
    createComponent: function (a) { return wrapNode(create('COMPONENT', json(a || {}))); },
    union: function (nodes, parent) { return wrapNode(booleanOperation('UNION', nodes, parent)); },
    subtract: function (nodes, parent) { return wrapNode(booleanOperation('SUBTRACT', nodes, parent)); },
    intersect: function (nodes, parent) { return wrapNode(booleanOperation('INTERSECT', nodes, parent)); },
    exclude: function (nodes, parent) { return wrapNode(booleanOperation('EXCLUDE', nodes, parent)); },
    combineAsVariants: function (nodes, parent) {
      return wrapNode(combine(json((nodes || []).map(function (node) { return node.id; })), parent ? parent.id : null));
    },
    createInstance: function () {
      var selected = currentPage.selection;
      if (selected.length !== 1 || selected[0].type !== 'COMPONENT') {
        throw new Error('figma.createInstance requires exactly one selected COMPONENT; use component.createInstance() instead.');
      }
      return selected[0].createInstance();
    },
    getNodeById: function (id) { return hasNode(id) ? wrapNode(id) : null; },
    closePlugin: function () { close(); },
    notify: function (message) { log(String(message)); },
    loadFontAsync: function () { return Promise.resolve(); },
    on: function (type, handler) {
      if (type === 'run') { runHandlers.push(handler); return; }
      warn('figma.on("' + String(type) + '") is not delivered in Pigma');
    },
    once: function (type, handler) {
      var wrapped = function (event) { figma.off(type, wrapped); return handler(event); };
      figma.on(type, wrapped);
    },
    off: function (type, handler) {
      if (type !== 'run') return;
      var index = runHandlers.indexOf(handler);
      if (index >= 0) runHandlers.splice(index, 1);
    },
    showUI: function () { throw new Error('figma.showUI is not supported by Pigma (headless interpreter).'); },
  };
  // Plugin parameters: values are delivered to the run handler (Figma's model).
  // There is no interactive parameter UI in Pigma, so on('input') never fires.
  figma.parameters = {
    values: runContext.parameters || {},
    on: function (type) {
      if (type === 'input') {
        warn('figma.parameters.on("input") is not fired in Pigma (no interactive parameter UI); pass parameters to the engine instead');
      }
    },
    once: function (type, handler) { this.on(type, handler); },
    off: function () {},
  };

  // Invoked by the host after the script body: Figma's real entry point.
  globalThis.__pigmaFireRun = function () {
    if (runHandlers.length === 0) return false;
    var event = { type: 'run', command: runContext.command === null ? undefined : runContext.command };
    if (runContext.parameters !== null && runContext.parameters !== undefined) event.parameters = runContext.parameters;
    var handlers = runHandlers;
    runHandlers = [];
    var result;
    for (var i = 0; i < handlers.length; i++) {
      var value = handlers[i](event);
      if (value !== undefined) result = value;
    }
    if (result && typeof result.then === 'function') {
      result.then(
        function (resolved) { if (resolved !== undefined) globalThis.__pigmaResult(json(resolved)); },
        function (error) { globalThis.__pigmaError(String((error && error.message) || error)); },
      );
    } else if (result !== undefined) {
      globalThis.__pigmaResult(json(result));
    }
    return true;
  };

  Object.defineProperty(figma, 'ui', {
    get: function () { throw new Error('figma.ui is not supported by Pigma (headless interpreter).'); },
  });

  globalThis.figma = figma;
  globalThis.console = {
    log: function () { log(Array.prototype.map.call(arguments, String).join(' ')); },
    warn: function () { log(Array.prototype.map.call(arguments, String).join(' ')); },
    error: function () { log(Array.prototype.map.call(arguments, String).join(' ')); },
  };

  delete globalThis.__pigmaRunContextJson;
  delete globalThis.__pigmaCreate;
  delete globalThis.__pigmaCombine;
  delete globalThis.__pigmaBoolean;
  delete globalThis.__pigmaGet;
  delete globalThis.__pigmaSet;
  delete globalThis.__pigmaCall;
  delete globalThis.__pigmaPageId;
  delete globalThis.__pigmaDocumentId;
  delete globalThis.__pigmaHasNode;
  delete globalThis.__pigmaChildren;
  delete globalThis.__pigmaSelection;
  delete globalThis.__pigmaSetSelection;
  delete globalThis.__pigmaLog;
  delete globalThis.__pigmaWarn;
  delete globalThis.__pigmaClose;
})();
`;
