import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const primitives = fileURLToPath(new URL('./ui/src/primitives.js', import.meta.url))

// The plugin's Bot views take DSH's interface primitives from one module; the window does
// not load DSH's interface, so its own module stands in for that one.
const ownPrimitives = {
  name: 'ds-bot-primitives',
  enforce: 'pre',
  resolveId(source, importer) {
    return source === './dsh-primitives.js' && importer?.replaceAll('\\', '/').includes('/ds-bot/src/client/') ? primitives : null
  },
}

// The window loads the build from the app's own scheme, so asset paths stay relative.
export default defineConfig({
  root: fileURLToPath(new URL('./ui', import.meta.url)),
  base: './',
  plugins: [ownPrimitives],
  // The Bot views come from the plugin's interface code in ../ds-bot, which has no React
  // of its own.
  resolve: { dedupe: ['react', 'react-dom'] },
  // One bundle: the window loads it from disk, not over a network.
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2048 },
})
