/*
 * "Mis paquetes": user sticker-pack management for the Netsus studio.
 * Users assemble packs in the private 'sticker-uploads' staging bucket
 * (<uid>/<pack_id>/<file>) and submit them for admin review. Only the admin
 * panel can publish anything to the public Stickers bucket, so nothing here
 * is visible in the app until a pack is approved.
 */
(function () {
  "use strict";

  const BUCKET = "sticker-uploads";
  const MAX_FILES_PER_PACK = 30;
  const MAX_FILE_BYTES = 8 * 1024 * 1024;
  const ALLOWED_EXTENSIONS = new Set(["webp", "png", "jpg", "jpeg", "gif", "avif", "nsticker"]);
  const NORMALIZABLE_EXTENSIONS = new Set(["png", "jpg", "jpeg"]);
  const MIME_BY_EXTENSION = {
    webp: "image/webp",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    avif: "image/avif",
    nsticker: "application/zip"
  };
  const STATUS_LABELS = {
    draft: "Borrador",
    pending: "En revisión",
    approved: "Aprobado",
    rejected: "Rechazado"
  };
  const THUMB_CACHE_LIMIT = 150;

  const packsState = {
    session: null,
    packs: [],
    selectedPackId: null,
    files: [],
    loadingFiles: false,
    uploading: false,
    thumbCache: new Map()
  };

  const els = {
    viewCreateBtn: document.getElementById("viewCreateBtn"),
    viewPacksBtn: document.getElementById("viewPacksBtn"),
    authChip: document.getElementById("authChip"),
    creatorShell: document.querySelector(".app-shell"),
    packsShell: document.getElementById("packsShell"),
    packListPanel: document.getElementById("packListPanel"),
    packList: document.getElementById("packList"),
    newPackButton: document.getElementById("newPackButton"),
    packDetail: document.getElementById("packDetail")
  };

  const sb = window.NetsusSupabase;

  init();

  async function init() {
    if (!els.packsShell) return;
    els.viewCreateBtn?.addEventListener("click", () => switchView("create"));
    els.viewPacksBtn?.addEventListener("click", () => switchView("packs"));
    els.newPackButton?.addEventListener("click", () => openCreatePackDialog());

    if (!sb) {
      renderAuthChip(null);
      renderLoginPrompt();
      return;
    }

    packsState.session = await sb.getSession();
    renderAuthChip(packsState.session);
    sb.onAuth(session => {
      const changed = session?.user?.id !== packsState.session?.user?.id;
      packsState.session = session;
      renderAuthChip(session);
      if (changed) {
        packsState.packs = [];
        packsState.selectedPackId = null;
        packsState.files = [];
        if (isPacksViewActive()) refreshPacksView();
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* View switching + header chip                                        */
  /* ------------------------------------------------------------------ */

  function isPacksViewActive() {
    return !els.packsShell.hidden;
  }

  function switchView(view) {
    const packs = view === "packs";
    els.packsShell.hidden = !packs;
    if (els.creatorShell) els.creatorShell.hidden = packs;
    els.viewPacksBtn?.classList.toggle("active", packs);
    els.viewCreateBtn?.classList.toggle("active", !packs);
    if (packs) refreshPacksView();
  }

  function renderAuthChip(session) {
    if (!els.authChip) return;
    els.authChip.replaceChildren();
    if (!session) {
      const link = document.createElement("a");
      link.className = "auth-link";
      link.href = sb ? sb.loginUrl("index.html") : "../../login.html";
      link.textContent = "Iniciar sesión";
      els.authChip.appendChild(link);
      return;
    }
    const name = document.createElement("span");
    name.className = "auth-name";
    name.textContent = session.user?.email || "Cuenta";
    els.authChip.appendChild(name);
    if (sb) {
      sb.displayName(session).then(value => {
        if (value) name.textContent = value;
      });
    }
    const out = document.createElement("button");
    out.type = "button";
    out.className = "auth-out";
    out.textContent = "Salir";
    out.addEventListener("click", async () => {
      await sb?.signOut();
      showToast("Sesión cerrada.");
    });
    els.authChip.appendChild(out);
  }

  /* ------------------------------------------------------------------ */
  /* Pack list                                                           */
  /* ------------------------------------------------------------------ */

  async function refreshPacksView() {
    if (!sb || !packsState.session) {
      renderLoginPrompt();
      return;
    }
    els.packListPanel.hidden = false;
    await loadPacks();
    renderPackList();
    const selected = currentPack();
    if (selected) {
      await openPackDetail(selected.id);
    } else {
      renderDetailPlaceholder();
    }
  }

  function renderLoginPrompt() {
    els.packListPanel.hidden = true;
    els.packDetail.replaceChildren(
      buildCard(card => {
        card.appendChild(makeEl("h2", null, "Inicia sesión para crear paquetes"));
        card.appendChild(makeEl(
          "p",
          "detail-note",
          "Necesitas tu cuenta de Netsus para subir paquetes de stickers. Tus paquetes pasan por revisión antes de aparecer en la app."
        ));
        const link = document.createElement("a");
        link.className = "primary-button";
        link.href = sb ? sb.loginUrl("index.html") : "../../login.html";
        link.textContent = "Iniciar sesión";
        card.appendChild(link);
      })
    );
  }

  async function loadPacks() {
    const { data, error } = await sb.client
      .from("sticker_packs")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) {
      showToast("No se pudieron cargar tus paquetes.", "error");
      console.error(error);
      return;
    }
    packsState.packs = data || [];
    if (!packsState.packs.some(pack => pack.id === packsState.selectedPackId)) {
      packsState.selectedPackId = packsState.packs[0]?.id || null;
    }
  }

  function currentPack() {
    return packsState.packs.find(pack => pack.id === packsState.selectedPackId) || null;
  }

  function renderPackList() {
    els.packList.replaceChildren();
    if (!packsState.packs.length) {
      els.packList.appendChild(makeEl("p", "pack-empty", "Aún no tienes paquetes. Crea el primero."));
      return;
    }
    for (const pack of packsState.packs) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "pack-card" + (pack.id === packsState.selectedPackId ? " active" : "");
      card.appendChild(makeEl("strong", "pack-card-name", pack.name));
      card.appendChild(statusChip(pack.status));
      card.addEventListener("click", () => openPackDetail(pack.id));
      els.packList.appendChild(card);
    }
  }

  function statusChip(status) {
    const chip = makeEl("span", "chip chip--" + status, STATUS_LABELS[status] || status);
    return chip;
  }

  /* ------------------------------------------------------------------ */
  /* Pack detail                                                         */
  /* ------------------------------------------------------------------ */

  function renderDetailPlaceholder() {
    els.packDetail.replaceChildren(
      buildCard(card => {
        card.appendChild(makeEl("h2", null, "Tus paquetes de stickers"));
        card.appendChild(makeEl(
          "p",
          "detail-note",
          "Crea un paquete, agrega de 1 a 30 stickers (WEBP, PNG, JPG, GIF, AVIF o .nsticker) y envíalo a revisión. Cuando se apruebe aparecerá en la tienda de stickers de Netsus."
        ));
        const button = document.createElement("button");
        button.type = "button";
        button.className = "primary-button";
        button.textContent = "Nuevo paquete";
        button.addEventListener("click", () => openCreatePackDialog());
        card.appendChild(button);
      })
    );
  }

  async function openPackDetail(packId) {
    packsState.selectedPackId = packId;
    renderPackList();
    const pack = currentPack();
    if (!pack) return;
    packsState.loadingFiles = true;
    renderPackDetail();
    packsState.files = await listPackFiles(pack);
    packsState.loadingFiles = false;
    renderPackDetail();
  }

  async function listPackFiles(pack) {
    const prefix = packsState.session.user.id + "/" + pack.id;
    const { data, error } = await sb.client.storage
      .from(BUCKET)
      .list(prefix, { limit: 100, sortBy: { column: "name", order: "asc" } });
    if (error) {
      console.error(error);
      showToast("No se pudieron listar los stickers del paquete.", "error");
      return [];
    }
    return (data || []).filter(entry => entry.id !== null);
  }

  function isEditable(pack) {
    return pack.status === "draft" || pack.status === "rejected";
  }

  function renderPackDetail() {
    const pack = currentPack();
    if (!pack) {
      renderDetailPlaceholder();
      return;
    }
    const editable = isEditable(pack);

    els.packDetail.replaceChildren(
      buildCard(card => {
        const head = makeEl("div", "detail-head");
        const titleWrap = makeEl("div");
        titleWrap.appendChild(makeEl("h2", "detail-title", pack.name));
        titleWrap.appendChild(makeEl(
          "p",
          "detail-note",
          "En la app se verá como: “" + folderDisplayName(pack.folder_name) + "”"
        ));
        head.appendChild(titleWrap);
        head.appendChild(statusChip(pack.status));
        card.appendChild(head);

        if (pack.status === "rejected" && pack.review_note) {
          const note = makeEl("div", "review-note");
          note.appendChild(makeEl("strong", null, "Motivo del rechazo: "));
          note.appendChild(document.createTextNode(pack.review_note));
          card.appendChild(note);
        }
        if (pack.status === "pending") {
          card.appendChild(makeEl(
            "div",
            "info-note",
            "El paquete está en revisión. No se puede editar hasta que el equipo lo apruebe o lo rechace, o hasta que lo vuelvas a borrador."
          ));
        }
        if (pack.status === "approved") {
          card.appendChild(makeEl(
            "div",
            "info-note ok",
            "¡Aprobado! El paquete está publicado en la tienda de stickers. Si lo editas, los cambios pasarán por revisión antes de publicarse."
          ));
        }

        card.appendChild(buildActionBar(pack));

        if (editable) {
          card.appendChild(buildUploader(pack));
        }

        card.appendChild(buildStickerGrid(pack, editable));
      })
    );
  }

  function buildActionBar(pack) {
    const bar = makeEl("div", "detail-actions");
    const editable = isEditable(pack);

    if (editable) {
      bar.appendChild(actionButton("Renombrar", "secondary-button", () => openRenameDialog(pack)));
      const submitLabel = pack.status === "rejected" ? "Reenviar a revisión" : "Enviar a revisión";
      bar.appendChild(actionButton(submitLabel, "primary-button", () => submitPack(pack)));
      bar.appendChild(actionButton("Eliminar paquete", "danger-button", () => openDeleteDialog(pack)));
    } else {
      bar.appendChild(actionButton("Volver a borrador para editar", "secondary-button", () => revertPack(pack)));
    }
    return bar;
  }

  function actionButton(label, className, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function buildUploader(pack) {
    const wrap = makeEl("div", "uploader");

    const drop = makeEl("div", "drop-zone pack-drop");
    drop.setAttribute("role", "button");
    drop.tabIndex = 0;
    const icon = makeEl("div", "drop-icon");
    icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
    drop.appendChild(icon);
    const textWrap = makeEl("div");
    textWrap.appendChild(makeEl("strong", null, "Agrega stickers (varios a la vez)"));
    textWrap.appendChild(makeEl("span", null, "WEBP, PNG, JPG, GIF, AVIF o .nsticker · máx. " + MAX_FILES_PER_PACK));
    drop.appendChild(textWrap);

    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".webp,.png,.jpg,.jpeg,.gif,.avif,.nsticker";
    input.hidden = true;

    drop.addEventListener("click", () => input.click());
    drop.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        input.click();
      }
    });
    ["dragenter", "dragover"].forEach(name => drop.addEventListener(name, event => {
      event.preventDefault();
      drop.classList.add("dragover");
    }));
    ["dragleave", "drop"].forEach(name => drop.addEventListener(name, event => {
      event.preventDefault();
      drop.classList.remove("dragover");
    }));
    drop.addEventListener("drop", event => {
      const files = [...(event.dataTransfer?.files || [])];
      if (files.length) uploadFiles(pack, files);
    });
    input.addEventListener("change", () => {
      const files = [...(input.files || [])];
      input.value = "";
      if (files.length) uploadFiles(pack, files);
    });

    const optimizeRow = document.createElement("label");
    optimizeRow.className = "check-row compact optimize-row";
    const optimize = document.createElement("input");
    optimize.type = "checkbox";
    optimize.checked = true;
    optimize.id = "optimizeUploads";
    optimizeRow.appendChild(optimize);
    optimizeRow.appendChild(document.createTextNode("Optimizar PNG/JPG a WEBP 512px"));

    wrap.appendChild(drop);
    wrap.appendChild(input);
    wrap.appendChild(optimizeRow);
    wrap.appendChild(makeEl("div", "upload-progress", ""));
    return wrap;
  }

  function buildStickerGrid(pack, editable) {
    const section = makeEl("div", "grid-section");
    const count = packsState.files.length;
    section.appendChild(makeEl(
      "h3",
      "grid-title",
      packsState.loadingFiles ? "Cargando stickers…" : "Stickers (" + count + "/" + MAX_FILES_PER_PACK + ")"
    ));

    const grid = makeEl("div", "sticker-grid");
    if (!packsState.loadingFiles && !count) {
      grid.appendChild(makeEl("p", "pack-empty", "El paquete está vacío. Agrega al menos un sticker para poder enviarlo."));
    }
    for (const file of packsState.files) {
      grid.appendChild(buildStickerCell(pack, file, editable));
    }
    section.appendChild(grid);
    return section;
  }

  function buildStickerCell(pack, file, editable) {
    const cell = makeEl("div", "sticker-cell");
    const frame = makeEl("div", "sticker-frame");
    const img = document.createElement("img");
    img.alt = file.name;
    frame.appendChild(img);
    cell.appendChild(frame);

    const meta = makeEl("div", "sticker-meta");
    meta.appendChild(makeEl("span", "sticker-name", file.name));
    const size = file.metadata?.size;
    if (size) meta.appendChild(makeEl("span", "sticker-size", formatBytes(size)));
    cell.appendChild(meta);

    if (editable) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "sticker-remove";
      remove.title = "Eliminar sticker";
      remove.setAttribute("aria-label", "Eliminar " + file.name);
      remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      remove.addEventListener("click", () => deleteSticker(pack, file.name));
      cell.appendChild(remove);
    }

    const path = packsState.session.user.id + "/" + pack.id + "/" + file.name;
    loadThumb(BUCKET, path).then(thumb => {
      if (!thumb) {
        frame.classList.add("thumb-error");
        return;
      }
      img.src = thumb.url;
      if (thumb.hasAudio) {
        const badge = makeEl("span", "sound-mini", "♪");
        badge.title = "Sticker con sonido";
        frame.appendChild(badge);
      }
    });

    return cell;
  }

  /* ------------------------------------------------------------------ */
  /* Uploads                                                             */
  /* ------------------------------------------------------------------ */

  async function uploadFiles(pack, files) {
    if (packsState.uploading) {
      showToast("Espera a que termine la subida actual.", "warn");
      return;
    }
    if (!isEditable(pack)) {
      showToast("El paquete no se puede editar en su estado actual.", "warn");
      return;
    }

    const existing = new Set(packsState.files.map(file => file.name));
    const room = MAX_FILES_PER_PACK - existing.size;
    if (room <= 0) {
      showToast("El paquete ya tiene el máximo de " + MAX_FILES_PER_PACK + " stickers.", "warn");
      return;
    }
    if (files.length > room) {
      showToast("Solo caben " + room + " stickers más; se subirán los primeros.", "warn");
      files = files.slice(0, room);
    }

    const optimize = document.getElementById("optimizeUploads")?.checked !== false;
    const progressHost = els.packDetail.querySelector(".upload-progress");
    const rows = new Map();
    if (progressHost) {
      progressHost.replaceChildren();
      for (const file of files) {
        const row = makeEl("div", "upload-row", "");
        row.appendChild(makeEl("span", "upload-name", file.name));
        const status = makeEl("span", "upload-status", "En cola…");
        row.appendChild(status);
        progressHost.appendChild(row);
        rows.set(file, status);
      }
    }

    packsState.uploading = true;
    const prefix = packsState.session.user.id + "/" + pack.id + "/";
    let uploaded = 0;
    let failed = 0;

    const queue = [...files];
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length) {
        const file = queue.shift();
        const status = rows.get(file);
        try {
          if (status) status.textContent = "Preparando…";
          const prepared = await prepareUpload(file, optimize);
          const name = dedupeName(prepared.name, existing);
          existing.add(name);
          if (status) status.textContent = "Subiendo…";
          const { error } = await sb.client.storage
            .from(BUCKET)
            .upload(prefix + name, prepared.blob, {
              contentType: prepared.contentType,
              cacheControl: "3600",
              upsert: false
            });
          if (error) throw new Error(friendlyStorageError(error));
          uploaded += 1;
          if (status) {
            status.textContent = "Listo ✓";
            status.classList.add("ok");
          }
        } catch (error) {
          failed += 1;
          console.error(error);
          if (status) {
            status.textContent = error.message || "Error";
            status.classList.add("error");
          }
        }
      }
    });
    await Promise.all(workers);
    packsState.uploading = false;

    if (uploaded) showToast(uploaded + " sticker(s) agregados al paquete.");
    if (failed) showToast(failed + " archivo(s) no se pudieron subir.", "error");
    packsState.files = await listPackFiles(pack);
    renderPackDetail();
  }

  async function prepareUpload(file, optimize) {
    const extension = extensionOf(file.name);
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      throw new Error("Formato no permitido (" + extension + ").");
    }

    if (extension === "nsticker") {
      await validateNsticker(file);
      if (file.size > MAX_FILE_BYTES) throw new Error("Supera 8 MB.");
      return {
        name: safeFileName(file.name, "nsticker"),
        blob: file,
        contentType: "application/zip"
      };
    }

    if (optimize && NORMALIZABLE_EXTENSIONS.has(extension)) {
      const blob = await imageToWebp512(file).catch(() => null);
      if (blob && blob.size <= MAX_FILE_BYTES) {
        return {
          name: safeFileName(file.name, "webp"),
          blob,
          contentType: "image/webp"
        };
      }
    }

    if (file.size > MAX_FILE_BYTES) throw new Error("Supera 8 MB.");
    return {
      name: safeFileName(file.name, extension),
      blob: file,
      contentType: MIME_BY_EXTENSION[extension] || "application/octet-stream"
    };
  }

  async function validateNsticker(file) {
    if (!window.JSZip) return;
    let zip;
    try {
      zip = await window.JSZip.loadAsync(file);
    } catch (_error) {
      throw new Error("El .nsticker no es un paquete válido.");
    }
    const manifestEntry = zip.file("manifest.json");
    if (!manifestEntry) throw new Error("El .nsticker no tiene manifest.json.");
    let manifest;
    try {
      manifest = JSON.parse(await manifestEntry.async("string"));
    } catch (_error) {
      throw new Error("El manifest del .nsticker es inválido.");
    }
    if (!manifest.image || !zip.file(manifest.image)) {
      throw new Error("El .nsticker no incluye su imagen.");
    }
    const badEntry = Object.keys(zip.files).some(name => name.includes("/") || name.includes("\\") || name.includes(".."));
    if (badEntry) throw new Error("El .nsticker contiene rutas no permitidas.");
  }

  function imageToWebp512(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        try {
          const size = 512;
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("canvas");
          const ratio = image.naturalWidth / image.naturalHeight;
          let width = size;
          let height = size;
          if (ratio > 1) height = size / ratio;
          else width = size * ratio;
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = "high";
          context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
          canvas.toBlob(blob => {
            URL.revokeObjectURL(url);
            if (blob) resolve(blob);
            else reject(new Error("No se pudo convertir la imagen."));
          }, "image/webp", 0.9);
        } catch (error) {
          URL.revokeObjectURL(url);
          reject(error);
        }
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("No se pudo leer la imagen."));
      };
      image.src = url;
    });
  }

  function safeFileName(originalName, extension) {
    const stem = String(originalName || "sticker")
      .replace(/\.[^.]+$/, "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "sticker";
    return stem + "." + extension;
  }

  function dedupeName(name, takenSet) {
    if (!takenSet.has(name)) return name;
    const dot = name.lastIndexOf(".");
    const stem = name.slice(0, dot);
    const ext = name.slice(dot);
    for (let i = 2; i < 100; i++) {
      const candidate = stem + "-" + i + ext;
      if (!takenSet.has(candidate)) return candidate;
    }
    return stem + "-" + Date.now() + ext;
  }

  function friendlyStorageError(error) {
    const message = String(error?.message || "");
    if (/row-level security|violates|policy/i.test(message)) {
      return "El servidor rechazó el archivo (límite del paquete o estado no editable).";
    }
    if (/duplicate|already exists/i.test(message)) {
      return "Ya existe un archivo con ese nombre.";
    }
    if (/payload too large|maximum allowed size/i.test(message)) {
      return "El archivo supera el límite de 8 MB.";
    }
    if (/mime type|content-type/i.test(message)) {
      return "Tipo de archivo no permitido.";
    }
    return message || "Error de subida.";
  }

  /* ------------------------------------------------------------------ */
  /* Pack mutations                                                      */
  /* ------------------------------------------------------------------ */

  async function callRpc(fn, args) {
    const { data, error } = await sb.client.rpc(fn, args);
    if (error) {
      const message = error.message && !/^(TypeError|NetworkError)/.test(error.message)
        ? error.message
        : "No se pudo completar la operación.";
      throw new Error(message);
    }
    return data;
  }

  function openCreatePackDialog() {
    if (!packsState.session) {
      showToast("Inicia sesión para crear paquetes.", "warn");
      return;
    }
    openNameDialog({
      title: "Nuevo paquete",
      confirmLabel: "Crear paquete",
      initial: "",
      onConfirm: async name => {
        const pack = await callRpc("create_sticker_pack", { p_name: name });
        showToast("Paquete creado. Agrega tus stickers.");
        await loadPacks();
        packsState.selectedPackId = pack?.id || packsState.selectedPackId;
        renderPackList();
        await openPackDetail(packsState.selectedPackId);
      }
    });
  }

  function openRenameDialog(pack) {
    openNameDialog({
      title: "Renombrar paquete",
      confirmLabel: "Guardar",
      initial: pack.name,
      onConfirm: async name => {
        await callRpc("rename_sticker_pack", { p_pack_id: pack.id, p_name: name });
        showToast("Paquete renombrado.");
        await loadPacks();
        renderPackList();
        renderPackDetail();
      }
    });
  }

  async function submitPack(pack) {
    if (!packsState.files.length) {
      showToast("Agrega al menos un sticker antes de enviar.", "warn");
      return;
    }
    try {
      await callRpc("submit_sticker_pack", { p_pack_id: pack.id });
      showToast("Paquete enviado a revisión. Te avisaremos cuando se apruebe.");
      await loadPacks();
      renderPackList();
      renderPackDetail();
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function revertPack(pack) {
    try {
      await callRpc("revert_sticker_pack_to_draft", { p_pack_id: pack.id });
      showToast("El paquete volvió a borrador; ya puedes editarlo.");
      await loadPacks();
      renderPackList();
      renderPackDetail();
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  function openDeleteDialog(pack) {
    const dialog = buildDialog("Eliminar paquete");
    dialog.body.appendChild(makeEl(
      "p",
      "detail-note",
      "Se eliminarán el paquete y todos sus stickers subidos. Esta acción no se puede deshacer."
    ));
    dialog.body.appendChild(makeEl("p", "detail-note", "Escribe el nombre del paquete para confirmar:"));
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = pack.name;
    dialog.body.appendChild(input);

    const confirm = actionButton("Eliminar definitivamente", "danger-button", async () => {
      if (input.value.trim() !== pack.name) {
        showToast("El nombre no coincide.", "warn");
        return;
      }
      confirm.disabled = true;
      try {
        await deletePackFlow(pack);
        dialog.close();
        showToast("Paquete eliminado.");
        await loadPacks();
        renderPackList();
        const next = currentPack();
        if (next) await openPackDetail(next.id);
        else renderDetailPlaceholder();
      } catch (error) {
        confirm.disabled = false;
        showToast(error.message, "error");
      }
    });
    dialog.footer.appendChild(confirm);
    dialog.show();
  }

  async function deletePackFlow(pack) {
    const files = await listPackFiles(pack);
    if (files.length) {
      const prefix = packsState.session.user.id + "/" + pack.id + "/";
      const paths = files.map(file => prefix + file.name);
      const { error } = await sb.client.storage.from(BUCKET).remove(paths);
      if (error) throw new Error("No se pudieron borrar los stickers: " + error.message);
    }
    await callRpc("delete_sticker_pack", { p_pack_id: pack.id });
  }

  async function deleteSticker(pack, fileName) {
    const path = packsState.session.user.id + "/" + pack.id + "/" + fileName;
    const { error } = await sb.client.storage.from(BUCKET).remove([path]);
    if (error) {
      showToast("No se pudo eliminar: " + error.message, "error");
      return;
    }
    dropThumb(BUCKET + "/" + path);
    packsState.files = packsState.files.filter(file => file.name !== fileName);
    renderPackDetail();
    showToast("Sticker eliminado.");
  }

  /* ------------------------------------------------------------------ */
  /* Wizard hook: add a freshly exported .nsticker to a pack             */
  /* ------------------------------------------------------------------ */

  async function addBlobToPack(blob, suggestedName) {
    if (!sb) {
      showToast("Supabase no está disponible en esta página.", "error");
      return;
    }
    if (!packsState.session) {
      packsState.session = await sb.getSession();
    }
    if (!packsState.session) {
      showToast("Inicia sesión para guardar el sticker en un paquete.", "warn");
      window.location.href = sb.loginUrl("index.html");
      return;
    }
    if (blob.size > MAX_FILE_BYTES) {
      showToast("El sticker supera el límite de 8 MB.", "error");
      return;
    }

    await loadPacks();
    const editable = packsState.packs.filter(isEditable);

    const dialog = buildDialog("Agregar al paquete");
    if (!editable.length) {
      dialog.body.appendChild(makeEl(
        "p",
        "detail-note",
        "No tienes paquetes editables. Crea uno nuevo para guardar este sticker."
      ));
    } else {
      dialog.body.appendChild(makeEl("p", "detail-note", "Elige el paquete de destino:"));
    }

    let select = null;
    if (editable.length) {
      select = document.createElement("select");
      for (const pack of editable) {
        const option = document.createElement("option");
        option.value = pack.id;
        option.textContent = pack.name + " (" + (STATUS_LABELS[pack.status] || pack.status) + ")";
        select.appendChild(option);
      }
      dialog.body.appendChild(select);
    }

    const createNew = actionButton("Crear paquete nuevo…", "secondary-button", () => {
      dialog.close();
      openNameDialog({
        title: "Nuevo paquete",
        confirmLabel: "Crear y agregar",
        initial: "",
        onConfirm: async name => {
          const pack = await callRpc("create_sticker_pack", { p_name: name });
          await uploadBlobIntoPack(pack, blob, suggestedName);
        }
      });
    });
    dialog.footer.appendChild(createNew);

    if (editable.length) {
      const confirm = actionButton("Agregar", "primary-button", async () => {
        const pack = editable.find(item => item.id === select.value) || editable[0];
        confirm.disabled = true;
        try {
          await uploadBlobIntoPack(pack, blob, suggestedName);
          dialog.close();
        } catch (error) {
          confirm.disabled = false;
          showToast(error.message, "error");
        }
      });
      dialog.footer.appendChild(confirm);
    }
    dialog.show();
  }

  async function uploadBlobIntoPack(pack, blob, suggestedName) {
    const files = await listPackFiles(pack);
    if (files.length >= MAX_FILES_PER_PACK) {
      throw new Error("Ese paquete ya tiene el máximo de " + MAX_FILES_PER_PACK + " stickers.");
    }
    const taken = new Set(files.map(file => file.name));
    const name = dedupeName(safeFileName(suggestedName || "sticker.nsticker", "nsticker"), taken);
    const path = packsState.session.user.id + "/" + pack.id + "/" + name;
    const { error } = await sb.client.storage.from(BUCKET).upload(path, blob, {
      contentType: "application/zip",
      cacheControl: "3600",
      upsert: false
    });
    if (error) throw new Error(friendlyStorageError(error));
    showToast("Sticker agregado a “" + pack.name + "”. Revisa Mis paquetes.");
    if (packsState.selectedPackId === pack.id && isPacksViewActive()) {
      packsState.files = await listPackFiles(pack);
      renderPackDetail();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Thumbnails (blob URLs; .nsticker unpacked with JSZip)               */
  /* ------------------------------------------------------------------ */

  async function loadThumb(bucket, path) {
    const key = bucket + "/" + path;
    const cached = packsState.thumbCache.get(key);
    if (cached) return cached;

    const { data, error } = await sb.client.storage.from(bucket).download(path);
    if (error || !data) {
      console.error(error);
      return null;
    }

    let thumb = null;
    if (extensionOf(path) === "nsticker" && window.JSZip) {
      try {
        const zip = await window.JSZip.loadAsync(data);
        const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
        const imageEntry = zip.file(manifest.image);
        if (imageEntry) {
          const imageBlob = await imageEntry.async("blob");
          thumb = {
            url: URL.createObjectURL(imageBlob),
            hasAudio: Boolean(manifest.audio)
          };
        }
      } catch (error) {
        console.error("nsticker thumb", error);
      }
    }
    if (!thumb) {
      thumb = { url: URL.createObjectURL(data), hasAudio: false };
    }

    packsState.thumbCache.set(key, thumb);
    if (packsState.thumbCache.size > THUMB_CACHE_LIMIT) {
      const oldestKey = packsState.thumbCache.keys().next().value;
      const oldest = packsState.thumbCache.get(oldestKey);
      packsState.thumbCache.delete(oldestKey);
      if (oldest?.url) URL.revokeObjectURL(oldest.url);
    }
    return thumb;
  }

  function dropThumb(key) {
    const cached = packsState.thumbCache.get(key);
    if (cached?.url) URL.revokeObjectURL(cached.url);
    packsState.thumbCache.delete(key);
  }

  /* ------------------------------------------------------------------ */
  /* Small UI helpers                                                    */
  /* ------------------------------------------------------------------ */

  function openNameDialog({ title, confirmLabel, initial, onConfirm }) {
    const dialog = buildDialog(title);
    dialog.body.appendChild(makeEl("p", "detail-note", "Nombre del paquete (3 a 30 caracteres):"));
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 30;
    input.value = initial || "";
    dialog.body.appendChild(input);
    const preview = makeEl("p", "folder-preview", "");
    dialog.body.appendChild(preview);

    const updatePreview = () => {
      const folder = folderFromName(input.value);
      preview.textContent = folder
        ? "En la app se verá como: “" + folderDisplayName(folder) + "”"
        : "Usa letras, números y espacios (3 a 30 caracteres).";
      preview.classList.toggle("invalid", !folder);
    };
    input.addEventListener("input", updatePreview);
    updatePreview();

    const confirm = actionButton(confirmLabel, "primary-button", async () => {
      const name = input.value.trim();
      if (!folderFromName(name)) {
        showToast("Nombre inválido: usa letras, números y espacios.", "warn");
        return;
      }
      confirm.disabled = true;
      try {
        await onConfirm(name);
        dialog.close();
      } catch (error) {
        confirm.disabled = false;
        showToast(error.message, "error");
      }
    });
    dialog.footer.appendChild(confirm);
    dialog.show();
    setTimeout(() => input.focus(), 50);
  }

  function buildDialog(title) {
    const dialog = document.createElement("dialog");
    dialog.className = "studio-dialog";
    const card = makeEl("div", "dialog-card");
    const head = makeEl("div", "dialog-head");
    head.appendChild(makeEl("h3", null, title));
    const close = document.createElement("button");
    close.type = "button";
    close.className = "icon-button ghost";
    close.setAttribute("aria-label", "Cerrar");
    close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    close.addEventListener("click", () => closeAndRemove());
    head.appendChild(close);
    card.appendChild(head);
    const body = makeEl("div", "dialog-body");
    card.appendChild(body);
    const footer = makeEl("div", "dialog-footer");
    card.appendChild(footer);
    dialog.appendChild(card);
    document.body.appendChild(dialog);

    dialog.addEventListener("close", () => dialog.remove());
    dialog.addEventListener("click", event => {
      if (event.target === dialog) closeAndRemove();
    });
    function closeAndRemove() {
      try { dialog.close(); } catch (_error) { dialog.remove(); }
    }

    return {
      show: () => dialog.showModal(),
      close: () => closeAndRemove(),
      body,
      footer
    };
  }

  // Mirrors public.sticker_pack_folder_from_name (NFD strip covers ñ/accents).
  function folderFromName(name) {
    let folder = String(name || "").trim().toLowerCase();
    folder = folder.normalize("NFD").replace(/[̀-ͯ]/g, "");
    folder = folder.replace(/[^a-z0-9_-]+/g, "_").replace(/[_-]{2,}/g, "_").replace(/^[_-]+|[_-]+$/g, "");
    return /^[a-z0-9][a-z0-9_-]{2,29}$/.test(folder) ? folder : null;
  }

  function folderDisplayName(folder) {
    return String(folder || "").replace(/[_-]+/g, " ");
  }

  function extensionOf(name) {
    return String(name || "").split(".").pop().toLowerCase();
  }

  function formatBytes(bytes) {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB"];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return (bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1) + " " + units[exponent];
  }

  function makeEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null && text !== "") el.textContent = text;
    return el;
  }

  function buildCard(fill) {
    const card = makeEl("div", "detail-card");
    fill(card);
    return card;
  }

  let toastTimer = 0;
  function showToast(message, level = "ok") {
    let host = document.getElementById("studioToast");
    if (!host) {
      host = makeEl("div", "studio-toast");
      host.id = "studioToast";
      document.body.appendChild(host);
    }
    host.textContent = message;
    host.className = "studio-toast show " + level;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => host.classList.remove("show"), 4200);
  }

  window.NetsusPacks = {
    addBlobToPack,
    showToast,
    loadThumb,
    folderDisplayName,
    STATUS_LABELS
  };
})();
