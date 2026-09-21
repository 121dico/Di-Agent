import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
await build({entryPoints:[fileURLToPath(new URL('../app/offline-entry.js',import.meta.url))],outfile:fileURLToPath(new URL('../app/offline-model.js',import.meta.url)),bundle:true,format:'iife',platform:'browser',minify:true,legalComments:'none'});
