// Flat ESLint config. Plain browser scripts (no modules, no build) that share globalThis.Evo;
// tests and tools run in Node. Run: npx eslint@10 .
'use strict';

// The scripts index.html marks data-headless: they also run in Node, so they get no page globals
// (no-undef catches a headless script touching the page), and they must be deterministic
const headless = require('./tests/load').headlessScripts();

// Globals beyond the language's own: in both browsers and Node, the page's own, Node's own
const shared = ['console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'structuredClone',
  'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'atob', 'btoa'];
const browser = ['window', 'document', 'location', 'navigator', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame',
  'performance', 'Image', 'Path2D', 'OffscreenCanvas', 'ImageData', 'AudioContext', 'webkitAudioContext', 'ResizeObserver',
  'MutationObserver', 'HTMLElement', 'HTMLCanvasElement', 'Event', 'KeyboardEvent', 'PointerEvent', 'matchMedia',
  'devicePixelRatio', 'fetch', 'DOMMatrix', 'Blob', 'FileReader', 'getComputedStyle', 'innerWidth', 'innerHeight', 'alert',
  'confirm', 'prompt'];
const node = ['require', 'module', 'process', '__dirname', '__filename', 'Buffer', 'performance'];
const asGlobals = (names, mode = 'readonly') => Object.fromEntries(names.map(n => [n, mode]));

// Bugs, not style: ESLint's recommended correctness rules, listed because the config can't import
// @eslint/js without an install
const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
  'no-redeclare': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-dupe-class-members': 'error',
  'no-dupe-else-if': 'error',
  'no-duplicate-case': 'error',
  'no-unreachable': 'error',
  'no-fallthrough': 'error',
  'no-self-assign': 'error',
  'no-const-assign': 'error',
  'no-func-assign': 'error',
  'no-class-assign': 'error',
  'no-ex-assign': 'error',
  'no-import-assign': 'error',
  'no-global-assign': 'error',
  'no-cond-assign': ['error', 'except-parens'],
  'no-compare-neg-zero': 'error',
  'no-constant-binary-expression': 'error',
  'no-loss-of-precision': 'error',
  'no-sparse-arrays': 'error',
  'no-unsafe-negation': 'error',
  'no-unsafe-finally': 'error',
  'no-unsafe-optional-chaining': 'error',
  'no-unused-private-class-members': 'error',
  'no-invalid-regexp': 'error',
  'no-empty-character-class': 'error',
  'no-misleading-character-class': 'error',
  'no-useless-backreference': 'error',
  'no-irregular-whitespace': 'error',
  'no-shadow-restricted-names': 'error',
  'no-async-promise-executor': 'error',
  'no-setter-return': 'error',
  'getter-return': 'error',
  'constructor-super': 'error',
  'no-this-before-super': 'error',
  'for-direction': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
  'no-debugger': 'error'
};

// A world is the same every time from its seed, so the headless scripts use Evo.random and ticks
const unseeded = 'The simulation is deterministic: use Evo.random() and ticks, not unseeded randomness or the clock.';

module.exports = [
  { ignores: ['node_modules/**', '.claude/**'] },
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script' },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules
  },
  {
    files: ['src/**/*.js', 'dev/**/*.js'],
    ignores: headless,
    languageOptions: { globals: { ...asGlobals([...shared, ...browser]), Evo: 'writable' } }
  },
  {
    files: headless,
    languageOptions: { globals: { ...asGlobals(shared), Evo: 'writable' } },
    rules: {
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: unseeded },
        { object: 'Date', property: 'now', message: unseeded }],
      'no-restricted-syntax': ['error', { selector: "NewExpression[callee.name='Date']", message: unseeded }]
    }
  },
  {
    files: ['tests/**/*.js', 'tools/**/*.js', 'eslint.config.js'],
    languageOptions: { globals: { ...asGlobals([...shared, ...node]), test: 'writable' } }
  }
];
