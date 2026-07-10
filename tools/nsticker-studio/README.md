# Netsus Sticker Studio

Herramienta estática para crear paquetes `.nsticker` compatibles con Netsus y
para gestionar **paquetes de stickers de la comunidad**.

## Páginas

- `index.html` — el estudio: la vista **Crear** genera `.nsticker` (imagen +
  audio opcional) y la vista **Mis paquetes** permite a usuarios con sesión
  crear paquetes, subir varios stickers a la vez (WEBP/PNG/JPG/GIF/AVIF o
  `.nsticker`), eliminar stickers, renombrar y **enviar el paquete a revisión**.
- `admin.html` — panel de administración (solo cuentas en `app_admins`):
  aprobar/rechazar paquetes, re-sincronizar la carpeta pública y reconciliar
  el bucket `Stickers`.

Los paquetes se preparan en el bucket privado `sticker-uploads`
(`<uid>/<pack_id>/…`) y **solo se publican** en el bucket público `Stickers`
cuando un administrador los aprueba; ahí la app Android los muestra en su
tienda de stickers sin cambios de código. El login se reutiliza desde
`login.html` en la raíz del sitio (parámetro `?redirect=`).

## Ejecutar local

```powershell
cd tools\nsticker-studio
npm start
```

Abre `http://localhost:4177`.
Si ese puerto está ocupado, el servidor usará automáticamente el siguiente disponible y lo imprimirá en la consola.

La herramienta usa FFmpeg WASM vendorizado. Para exportar stickers con audio debes servirla por HTTP local o GitHub Pages; no abras `index.html` con `file://`, porque Chrome bloquea el Worker de FFmpeg desde origin `null`.

## Formato exportado

Cada descarga genera un ZIP con extensión `.nsticker` y archivos en la raíz:

```text
manifest.json
sticker.webp | sticker.png | sticker.gif
sound.m4a | sound.mp3 | sound.ogg
```

El audio es opcional. Si se incluye, el exportador lo recorta a la duración del sticker y aplica offset/fades antes de empaquetarlo.

## Publicar en GitHub Pages

Configura GitHub Pages para servir la carpeta `tools/nsticker-studio` o copia su contenido a la ruta pública que uses para herramientas internas. No requiere backend.

## Compatibilidad

- Imagen: `.webp`, `.png`, `.gif`
- Audio: `.m4a`, `.mp3`, `.ogg`
- Paquete recomendado: menor a `8 MB`
- Manifest: versión `1`

## Dependencias vendorizadas

- JSZip `3.10.1`
- `@ffmpeg/ffmpeg` `0.12.15`
- `@ffmpeg/core` `0.12.10`
- `@supabase/supabase-js` `2.110.2` (UMD)

Consulta `THIRD_PARTY_NOTICES.md` para notas de licencia.
