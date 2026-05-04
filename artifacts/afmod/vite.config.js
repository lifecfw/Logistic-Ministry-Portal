import { defineConfig } from "vite";
import path from "path";

const basePath = process.env.BASE_PATH || "/";
const apiPort = 5000;

export default defineConfig({
  base: basePath,
  root: path.resolve(import.meta.dirname),
  publicDir: path.resolve(import.meta.dirname, "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    sourcemap: false,
    minify: "terser",
    terserOptions: {
      compress: {
        passes: 3,
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ["console.log", "console.info", "console.debug"],
      },
      mangle: {
        toplevel: true,
        properties: false,
      },
      format: {
        comments: false,
      },
    },
    rollupOptions: {
      input: {
        index:           path.resolve(import.meta.dirname, "index.html"),
        ministry:        path.resolve(import.meta.dirname, "ministry.html"),
        houses:          path.resolve(import.meta.dirname, "houses.html"),
        cars:            path.resolve(import.meta.dirname, "cars.html"),
        gas:             path.resolve(import.meta.dirname, "gas.html"),
        grocery:         path.resolve(import.meta.dirname, "grocery.html"),
        "my-properties": path.resolve(import.meta.dirname, "my-properties.html"),
        messages:        path.resolve(import.meta.dirname, "messages.html"),
        social:          path.resolve(import.meta.dirname, "social.html"),
        business:        path.resolve(import.meta.dirname, "business.html"),
        barber:          path.resolve(import.meta.dirname, "barber.html"),
        manufacture:     path.resolve(import.meta.dirname, "manufacture.html"),
        "house-manage":  path.resolve(import.meta.dirname, "house-manage.html"),
        "house-map":     path.resolve(import.meta.dirname, "house-map.html"),
        marketplace:     path.resolve(import.meta.dirname, "marketplace.html"),
        gangs:           path.resolve(import.meta.dirname, "gangs.html"),
        cafes:           path.resolve(import.meta.dirname, "cafes.html"),
        restaurants:     path.resolve(import.meta.dirname, "restaurants.html"),
        bank:            path.resolve(import.meta.dirname, "bank.html"),
        stores:          path.resolve(import.meta.dirname, "stores.html"),
        twitter:         path.resolve(import.meta.dirname, "twitter.html"),
      },
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  server: {
    port: 3000,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 3000,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
