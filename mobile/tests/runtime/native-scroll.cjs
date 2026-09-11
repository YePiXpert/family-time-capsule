// Execute the installed React Native release-mode event/validation code. The
// device bridge and painted views remain doubles; never replace the list guard
// or Animated.event with a permissive callback (that hid the startup crash).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
const t = require('@babel/types');
const hermes = require('hermes-parser');
const invariant = require('invariant');
const rn = path.dirname(require.resolve('react-native/package.json'));
const lists = path.dirname(require.resolve('@react-native/virtualized-lists/package.json'));
const strip = require.resolve('@babel/plugin-transform-flow-strip-types');

function installedNode(file, wanted) {
  const ast = hermes.parse(fs.readFileSync(file, 'utf8'), { babel: true });
  let found;
  babel.traverse(ast, { enter(p) { if (wanted(p.node)) found = p.node; } });
  if (!found) throw new Error(`Installed native runtime changed: ${path.basename(file)}`);
  return found;
}
function evaluate(node, scope) {
  const ast = t.file(t.program([t.expressionStatement(node)]));
  const { code } = babel.transformFromAstSync(ast, undefined, { configFile: false, babelrc: false, plugins: [strip] });
  return vm.runInNewContext(code, { __DEV__: false, console, invariant, ...scope });
}
function nativeFunction(file, name, scope = {}) {
  const node = installedNode(file, n => (t.isFunctionDeclaration(n) && n.id?.name === name) || (t.isVariableDeclarator(n) && n.id.name === name) || (t.isClassMethod(n) && n.key.name === name));
  const expression = t.isVariableDeclarator(node) ? node.init : t.functionExpression(null, node.params, node.body);
  return evaluate(expression, scope);
}
const shouldUseNativeDriver = nativeFunction(path.join(rn, 'src/private/animated/NativeAnimatedHelper.js'), 'shouldUseNativeDriver', { NativeAnimatedModule: {} });
const eventFile = path.join(rn, 'Libraries/Animated/AnimatedEvent.js');
const eventClass = installedNode(eventFile, n => t.isClassDeclaration(n) && n.id.name === 'AnimatedEvent');
const AnimatedEvent = evaluate(t.classExpression(eventClass.id, eventClass.superClass, eventClass.body), {
  NativeAnimatedHelper: { shouldUseNativeDriver },
});
const event = nativeFunction(path.join(rn, 'Libraries/Animated/AnimatedImplementation.js'), 'eventImpl', { AnimatedEvent });
const windowSizeOrDefault = nativeFunction(path.join(lists, 'Lists/VirtualizedListProps.js'), 'windowSizeOrDefault');
const checkListProps = nativeFunction(path.join(lists, 'Lists/VirtualizedList.js'), '_checkProps', { windowSizeOrDefault });

module.exports = { AnimatedEvent, event, checkListProps };
