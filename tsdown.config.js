import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['cjs'],
  // Node built-ins stay external.
  platform: 'node',
  sourcemap: true,
  clean: true,
  outExtensions: () => ({ js: '.js' }),
  deps: {
    // Provided by the host app at runtime.
    neverBundle: [
      'react',
      'react/jsx-runtime',
      'react-dom',
      'inkdrop',
      'event-kit',
      'inkdrop-model',
      'electron',
      // The editor's own CodeMirror, so decorations and widgets work with it.
      '@codemirror/state',
      '@codemirror/view'
    ]
  }
})
