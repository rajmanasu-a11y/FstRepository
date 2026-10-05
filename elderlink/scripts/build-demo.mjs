// Builds dist/elderlink-demo.html: one self-contained file with the web app and the engine bundled
// in. It runs fully in the browser on localStorage (window.ELDERLINK_MODE = 'local'), so it can be
// opened from disk or hosted anywhere static without the Node server.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(ROOT, 'dist', 'elderlink-demo.html');

const js = await build({
  entryPoints: [path.join(ROOT, 'web/js/app.js')],
  bundle: true, format: 'iife', minify: true, write: false, target: 'es2020', legalComments: 'none',
});
const css = await build({ entryPoints: [path.join(ROOT, 'web/css/app.css')], bundle: true, minify: true, write: false, loader: { '.css': 'css' } });
const icon = 'data:image/svg+xml,' + encodeURIComponent(fs.readFileSync(path.join(ROOT, 'web/icons/icon.svg'), 'utf8'));
const code = js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>ElderLink demo</title>
<meta name="description" content="ElderLink: verified home nurses, hospitals and helpers for senior citizens in India, with medicine reminders, check visits and 24x7 SOS. Clickable demo with sample data.">
<meta name="theme-color" content="#0b6b62">
<link rel="icon" href="${icon}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;600;700;800&family=Noto+Sans+Devanagari:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>${css.outputFiles[0].text}</style>
</head>
<body>
<div id="root"><div class="loading" style="padding:40px;text-align:center">Loading ElderLink…</div></div>
<script>window.ELDERLINK_MODE = 'local';</script>
<script>${code}</script>
</body>
</html>
`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`Wrote ${path.relative(ROOT, out)} (${Math.round(html.length / 1024)} KB)`);

// Variant for hosting inside a sandboxed viewer (no doctype wrapper; printing and file downloads hidden
// because embedded frames block them).
const fragment = `<title>ElderLink</title>
<meta name="description" content="ElderLink clickable demo with sample data.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;600;700;800&family=Noto+Sans+Devanagari:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>${css.outputFiles[0].text}[data-print],[data-export]{display:none!important}</style>
<div id="root"><div class="loading" style="padding:40px;text-align:center">Loading ElderLink…</div></div>
<script>window.ELDERLINK_MODE = 'local';</script>
<script>${code}</script>
`;
const fragOut = path.join(ROOT, 'dist', 'elderlink-artifact.html');
fs.writeFileSync(fragOut, fragment);
console.log(`Wrote ${path.relative(ROOT, fragOut)} (${Math.round(fragment.length / 1024)} KB)`);
