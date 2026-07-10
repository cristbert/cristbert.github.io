# Third-Party Notices

This tool vendors browser runtime files so it can run without a CDN.

## JSZip

- Package: `jszip`
- Version: `3.10.1`
- License: MIT or GPLv3
- Vendored files: `vendor/jszip/jszip.min.js`, `vendor/jszip/LICENSE.markdown`

## ffmpeg.wasm wrapper

- Package: `@ffmpeg/ffmpeg`
- Version: `0.12.15`
- License: MIT
- Vendored files: `vendor/ffmpeg/ffmpeg.js`, `vendor/ffmpeg/814.ffmpeg.js`, `vendor/ffmpeg/package.json`

## ffmpeg.wasm core

- Package: `@ffmpeg/core`
- Version: `0.12.10`
- License: LGPL-2.1-or-later
- Vendored files: `vendor/ffmpeg-core/ffmpeg-core.js`, `vendor/ffmpeg-core/ffmpeg-core.wasm`, `vendor/ffmpeg-core/package.json`

## supabase-js

- Package: `@supabase/supabase-js`
- Version: `2.110.2`
- License: MIT
- Vendored files: `vendor/supabase/supabase.min.js`, `vendor/supabase/package.json`

FFmpeg itself includes codecs and components with their own license obligations. Keep this notice with the vendored runtime when publishing the tool.
