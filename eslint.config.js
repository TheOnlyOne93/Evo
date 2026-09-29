// Flat ESLint config. Plain browser scripts (no modules, no build) that share globalThis.Evo;
// tests and tools run in Node. Run: npx eslint@9 .
'use strict';

const browser = ['window', 'document', 'location', 'navigator', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'console', 'URLSearchParams', 'URL', 'Image',
  'Path2D', 'OffscreenCanvas', 'ImageData', 'AudioContext', 'webkitAudioContext', 'ResizeObserver', 'MutationObserver',
  'HTMLElement', 'HTMLCanvasElement', 'Event', 'KeyboardEvent', 'PointerEvent', 'matchMedia', 'devicePixelRatio', 'fetch',
  'DOMMatrix', 'Blob', 'FileReader', 'getComputedStyle', 'innerWidth', 'innerHeight', 'alert', 'confirm', 'prompt', 'queueMicrotask',
  'structuredClone', 'atob', 'btoa', 'TextEncoder', 'TextDecoder', 'Float32Array', 'Float64Array', 'Int32Array', 'Uint8Array', 'Uint8ClampedArray', 'Uint32Array'];
const node = ['require', 'module', 'process', '__dirname', '__filename', 'Buffer', 'console', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'URL', 'structuredClone', 'queueMicrotask', 'performance', 'TextEncoder', 'TextDecoder'];
const asGlobals = (names, mode = 'readonly') => Object.fromEntries(names.map(n => [n, mode]));

const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
  'no-redeclare': 'error',
  'no-dupe-keys': 'error',
  'no-unreachable': 'error',
  'no-self-assign': 'error',
  'no-const-assign': 'error',
  'no-func-assign': 'error',
  'no-import-assign': 'error',
  'no-cond-assign': ['error', 'except-parens'],
  'no-shadow': 'off'
};

module.exports = [
  { ignores: ['node_modules/**'] },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...asGlobals(browser), Evo: 'writable', globalThis: 'readonly' }
    },
    rules
  },
  {
    files: ['tests/**/*.js', 'tools/**/*.js', 'eslint.config.js'],
    languageOptions: { globals: { ...asGlobals(node), test: 'writable', Evo: 'off' } }
  }
];
