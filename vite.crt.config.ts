import {defineConfig} from 'vite';
export default defineConfig({
    publicDir:false,
    base:'./',
    worker:{format:'es'},
    build:{
        outDir:'package/crt-1.0.0',
        emptyOutDir:true,
        target:'es2022',
        assetsInlineLimit:0,
        sourcemap:true,
        minify:true,
        license:{fileName:'notices/npm.json'},
        rollupOptions:{input:'src/crt/index.ts',preserveEntrySignatures:'strict',output:{entryFileNames:'crt.js',chunkFileNames:'assets/[name]-[hash].js',assetFileNames:'assets/[name]-[hash][extname]'}},
    },
});
