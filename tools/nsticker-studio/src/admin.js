/*
 * Admin panel: review user sticker packs and mirror the decision to storage.
 * The DB decision (review_sticker_pack RPC) always lands first; the storage
 * side-effects (copying staged files into the public Stickers bucket, or
 * deleting a published folder) run from this page and are idempotent, so a
 * "Re-sincronizar" retry can always repair a half-finished publish.
 *
 * The page gate here is cosmetic: the real enforcement is the is_app_admin()
 * check inside the RPCs and the storage RLS policies.
 */
(function () {
  "use strict";

  const STAGING_BUCKET = "sticker-uploads";
  const PUBLIC_BUCKET = "Stickers";
  const STATUS_LABELS = { draft: "Borrador", pending: "En revisión", approved: "Aprobado", rejected: "Rechazado" };

  const state = {
    session: null,
    packs: [],
    owners: new Map(),
    publicFolders: [],
    tab: "pending",
    busy: new Set()
  };

  const els = {
    gate: document.getElementById("adminGate"),
    content: document.getElementById("adminContent"),
    tabs: document.getElementById("adminTabs"),
    list: document.getElementById("adminList"),
    authChip: document.getElementById("adminAuthChip")
  };

  const sb = window.NetsusSupabase;
  const ui = window.NetsusPacks;

  init();

  async function init() {
    if (!sb) {
      gateMessage("Error", "No se pudo inicializar Supabase en esta página.");
      return;
    }

    state.session = await sb.getSession();
    renderAuthChip();
    if (!state.session) {
      gateMessage(
        "Inicia sesión",
        "Necesitas iniciar sesión con una cuenta de administrador para revisar paquetes.",
        { label: "Iniciar sesión", href: sb.loginUrl("admin.html") }
      );
      return;
    }

    const { data: isAdmin, error } = await sb.client.rpc("is_app_admin");
    if (error || isAdmin !== true) {
      gateMessage("Acceso restringido", "Tu cuenta no tiene permisos de administrador.");
      return;
    }

    els.gate.hidden = true;
    els.content.hidden = false;
    els.tabs.addEventListener("click", event => {
      const button = event.target.closest("[data-tab]");
      if (!button) return;
      state.tab = button.dataset.tab;
      [...els.tabs.querySelectorAll(".admin-tab")].forEach(tab => {
        tab.classList.toggle("active", tab.dataset.tab === state.tab);
      });
      renderList();
    });

    await reloadData();
  }

  function gateMessage(title, text, action) {
    els.gate.replaceChildren();
    const heading = document.createElement("h2");
    heading.textContent = title;
    els.gate.appendChild(heading);
    const note = document.createElement("p");
    note.className = "detail-note";
    note.textContent = text;
    els.gate.appendChild(note);
    if (action) {
      const link = document.createElement("a");
      link.className = "primary-button";
      link.href = action.href;
      link.textContent = action.label;
      els.gate.appendChild(link);
    }
  }

  function renderAuthChip() {
    if (!els.authChip) return;
    els.authChip.replaceChildren();
    if (!state.session) return;
    const name = document.createElement("span");
    name.className = "auth-name";
    name.textContent = state.session.user?.email || "Cuenta";
    els.authChip.appendChild(name);
    const out = document.createElement("button");
    out.type = "button";
    out.className = "auth-out";
    out.textContent = "Salir";
    out.addEventListener("click", async () => {
      await sb.signOut();
      window.location.reload();
    });
    els.authChip.appendChild(out);
  }

  /* ------------------------------------------------------------------ */
  /* Data                                                                */
  /* ------------------------------------------------------------------ */

  async function reloadData() {
    const [packsResult, foldersResult] = await Promise.all([
      sb.client.from("sticker_packs").select("*").order("updated_at", { ascending: false }),
      listPublicFolders()
    ]);

    if (packsResult.error) {
      toast("No se pudieron cargar los paquetes.", "error");
      console.error(packsResult.error);
      return;
    }
    state.packs = packsResult.data || [];
    state.publicFolders = foldersResult;

    const ownerIds = [...new Set(state.packs.map(pack => pack.owner_id))].filter(id => !state.owners.has(id));
    if (ownerIds.length) {
      const { data } = await sb.client.from("profiles").select("id, username").in("id", ownerIds);
      for (const row of data || []) state.owners.set(row.id, row.username || row.id);
      for (const id of ownerIds) if (!state.owners.has(id)) state.owners.set(id, id);
    }

    renderTabCounts();
    renderList();
  }

  async function listPublicFolders() {
    const { data, error } = await sb.client.storage
      .from(PUBLIC_BUCKET)
      .list("", { limit: 1000, sortBy: { column: "name", order: "asc" } });
    if (error) {
      console.error(error);
      return [];
    }
    return (data || []).filter(entry => entry.id === null).map(entry => entry.name);
  }

  async function listFolderFiles(bucket, prefix) {
    const { data, error } = await sb.client.storage
      .from(bucket)
      .list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(error.message);
    return (data || []).filter(entry => entry.id !== null).map(entry => entry.name);
  }

  function renderTabCounts() {
    const counts = { pending: 0, approved: 0, rejected: 0 };
    for (const pack of state.packs) {
      if (counts[pack.status] !== undefined) counts[pack.status] += 1;
    }
    for (const tab of els.tabs.querySelectorAll(".admin-tab")) {
      const key = tab.dataset.tab;
      const span = tab.querySelector(".count");
      if (span && counts[key] !== undefined) span.textContent = " (" + counts[key] + ")";
    }
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  function renderList() {
    els.list.replaceChildren();
    if (state.tab === "recon") {
      renderReconciliation();
      return;
    }
    const packs = state.packs.filter(pack => pack.status === state.tab);
    if (!packs.length) {
      els.list.appendChild(emptyNote("No hay paquetes en esta categoría."));
      return;
    }
    for (const pack of packs) {
      els.list.appendChild(buildPackCard(pack));
    }
  }

  function emptyNote(text) {
    const note = document.createElement("p");
    note.className = "pack-empty";
    note.textContent = text;
    return note;
  }

  function buildPackCard(pack) {
    const card = document.createElement("div");
    card.className = "admin-card";

    const head = document.createElement("div");
    head.className = "admin-card-head";
    const info = document.createElement("div");
    const title = document.createElement("h3");
    title.style.margin = "0 0 4px";
    title.textContent = pack.name;
    info.appendChild(title);
    const meta = document.createElement("div");
    meta.className = "admin-meta";
    meta.append(
      line("Carpeta pública: " + pack.folder_name + (pack.published_folder_name && pack.published_folder_name !== pack.folder_name ? " (antes: " + pack.published_folder_name + ")" : "")),
      line("Autor: " + (state.owners.get(pack.owner_id) || pack.owner_id)),
      line("Actualizado: " + formatDate(pack.updated_at) + (pack.reviewed_at ? " · Revisado: " + formatDate(pack.reviewed_at) : ""))
    );
    if (pack.review_note) meta.appendChild(line("Nota: " + pack.review_note));
    info.appendChild(meta);
    head.appendChild(info);

    const chip = document.createElement("span");
    chip.className = "chip chip--" + pack.status;
    chip.textContent = STATUS_LABELS[pack.status] || pack.status;
    head.appendChild(chip);
    card.appendChild(head);

    const thumbs = document.createElement("div");
    thumbs.className = "admin-thumbs";
    card.appendChild(thumbs);
    fillThumbs(thumbs, pack);

    const strip = document.createElement("div");
    strip.className = "sync-strip";
    strip.hidden = true;
    card.appendChild(strip);

    card.appendChild(buildCardActions(pack, strip));
    return card;
  }

  async function fillThumbs(host, pack) {
    let names = [];
    try {
      names = await listFolderFiles(STAGING_BUCKET, pack.owner_id + "/" + pack.id);
    } catch (error) {
      console.error(error);
      host.appendChild(emptyNote("No se pudieron listar los archivos."));
      return;
    }
    if (!names.length) {
      host.appendChild(emptyNote("Sin archivos en preparación (paquete vacío)."));
      return;
    }
    for (const name of names) {
      const frame = document.createElement("div");
      frame.className = "sticker-frame";
      const img = document.createElement("img");
      img.alt = name;
      img.title = name;
      frame.appendChild(img);
      host.appendChild(frame);
      const path = pack.owner_id + "/" + pack.id + "/" + name;
      ui.loadThumb(STAGING_BUCKET, path).then(thumb => {
        if (!thumb) {
          frame.classList.add("thumb-error");
          return;
        }
        img.src = thumb.url;
        if (thumb.hasAudio) {
          const badge = document.createElement("span");
          badge.className = "sound-mini";
          badge.textContent = "♪";
          frame.appendChild(badge);
        }
      });
    }
  }

  function buildCardActions(pack, strip) {
    const actions = document.createElement("div");
    actions.className = "admin-actions";

    const note = document.createElement("textarea");
    note.className = "note-input";
    note.rows = 1;
    note.maxLength = 500;
    note.placeholder = "Nota para el autor (opcional, obligatoria si rechazas)…";
    actions.appendChild(note);

    if (pack.status === "pending") {
      actions.appendChild(button("Aprobar y publicar", "primary-button", () => approvePack(pack, note.value, strip)));
      actions.appendChild(button("Rechazar", "danger-button", () => rejectPack(pack, note.value, strip)));
    } else if (pack.status === "approved") {
      actions.appendChild(button("Re-sincronizar archivos", "secondary-button", () => resyncPack(pack, strip)));
      actions.appendChild(button("Rechazar y despublicar", "danger-button", () => rejectPack(pack, note.value, strip)));
    } else if (pack.status === "rejected" && pack.published_folder_name) {
      actions.appendChild(button("Reintentar limpieza de carpeta pública", "secondary-button", () => cleanupRejected(pack, strip)));
    }
    return actions;
  }

  function button(label, className, onClick) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = className;
    el.textContent = label;
    el.addEventListener("click", async () => {
      if (state.busy.has(el)) return;
      state.busy.add(el);
      el.disabled = true;
      try {
        await onClick();
      } finally {
        state.busy.delete(el);
        el.disabled = false;
      }
    });
    return el;
  }

  function line(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div;
  }

  function log(strip, text, level) {
    strip.hidden = false;
    const row = document.createElement("div");
    if (level) row.className = level;
    row.textContent = text;
    strip.appendChild(row);
    strip.scrollTop = strip.scrollHeight;
  }

  /* ------------------------------------------------------------------ */
  /* Storage side-effects                                                */
  /* ------------------------------------------------------------------ */

  async function copyToPublic(sourceKey, destinationKey) {
    try {
      const { error } = await sb.client.storage
        .from(STAGING_BUCKET)
        .copy(sourceKey, destinationKey, { destinationBucket: PUBLIC_BUCKET });
      if (!error) return;
      if (/already exists|duplicate/i.test(String(error.message))) return; // idempotent
      throw new Error(error.message);
    } catch (error) {
      if (/already exists|duplicate/i.test(String(error.message))) return;
      // Fallback for clients without destinationBucket support.
      const token = (await sb.client.auth.getSession()).data?.session?.access_token;
      const response = await fetch(sb.url + "/storage/v1/object/copy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: sb.anonKey,
          Authorization: "Bearer " + token
        },
        body: JSON.stringify({
          bucketId: STAGING_BUCKET,
          sourceKey,
          destinationBucket: PUBLIC_BUCKET,
          destinationKey
        })
      });
      if (!response.ok) {
        const body = await response.text();
        if (/already exists|duplicate/i.test(body)) return;
        throw new Error("copy " + response.status + ": " + body.slice(0, 160));
      }
    }
  }

  async function withRetries(label, strip, fn) {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await fn();
        return;
      } catch (error) {
        lastError = error;
        log(strip, label + " — intento " + attempt + " falló: " + error.message, "error");
        await sleep(400 * attempt);
      }
    }
    throw lastError;
  }

  async function deletePublicFolder(folder, strip) {
    const names = await listFolderFiles(PUBLIC_BUCKET, folder).catch(() => []);
    if (!names.length) {
      log(strip, "La carpeta pública “" + folder + "” ya está vacía.");
      return;
    }
    const paths = names.map(name => folder + "/" + name);
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const { error } = await sb.client.storage.from(PUBLIC_BUCKET).remove(chunk);
      if (error) throw new Error("No se pudo borrar “" + folder + "”: " + error.message);
    }
    log(strip, "Carpeta pública “" + folder + "” eliminada (" + names.length + " archivos).", "ok");
  }

  async function syncPackToPublic(pack, strip) {
    const stagingPrefix = pack.owner_id + "/" + pack.id;
    const staged = await listFolderFiles(STAGING_BUCKET, stagingPrefix);
    if (!staged.length) throw new Error("El paquete no tiene archivos en preparación.");

    const published = await listFolderFiles(PUBLIC_BUCKET, pack.folder_name).catch(() => []);
    const stagedSet = new Set(staged);
    const publishedSet = new Set(published);

    const extraneous = published.filter(name => !stagedSet.has(name));
    if (extraneous.length) {
      log(strip, "Borrando " + extraneous.length + " archivo(s) sobrantes…");
      const { error } = await sb.client.storage
        .from(PUBLIC_BUCKET)
        .remove(extraneous.map(name => pack.folder_name + "/" + name));
      if (error) throw new Error(error.message);
    }

    const missing = staged.filter(name => !publishedSet.has(name));
    log(strip, "Copiando " + missing.length + " de " + staged.length + " archivo(s)…");
    for (const name of missing) {
      await withRetries("Copiar " + name, strip, () =>
        copyToPublic(stagingPrefix + "/" + name, pack.folder_name + "/" + name)
      );
      log(strip, "✓ " + name, "ok");
    }

    const finalNames = await listFolderFiles(PUBLIC_BUCKET, pack.folder_name);
    const finalSet = new Set(finalNames);
    const complete = staged.every(name => finalSet.has(name)) && finalNames.length === staged.length;
    if (!complete) {
      throw new Error("Verificación fallida: la carpeta pública no coincide con el paquete. Usa Re-sincronizar.");
    }
    log(strip, "Verificado: " + finalNames.length + " archivo(s) publicados en “" + pack.folder_name + "”.", "ok");
  }

  /* ------------------------------------------------------------------ */
  /* Review flows                                                        */
  /* ------------------------------------------------------------------ */

  async function approvePack(pack, noteValue, strip) {
    strip.hidden = false;
    strip.replaceChildren();
    const previousFolder = pack.published_folder_name;
    try {
      log(strip, "Registrando aprobación…");
      const { data, error } = await sb.client.rpc("review_sticker_pack", {
        p_pack_id: pack.id,
        p_approve: true,
        p_note: noteValue?.trim() || null
      });
      if (error) throw new Error(error.message);
      const updated = Array.isArray(data) ? data[0] : data;
      log(strip, "Aprobado en la base de datos.", "ok");

      if (previousFolder && previousFolder !== updated.folder_name) {
        log(strip, "Limpiando carpeta anterior “" + previousFolder + "”…");
        await deletePublicFolder(previousFolder, strip);
      }

      await syncPackToPublic(updated, strip);
      toast("Paquete “" + pack.name + "” publicado.");
      await reloadData();
    } catch (error) {
      console.error(error);
      log(strip, error.message, "error");
      toast(error.message, "error");
      await reloadData();
    }
  }

  async function resyncPack(pack, strip) {
    strip.hidden = false;
    strip.replaceChildren();
    try {
      await syncPackToPublic(pack, strip);
      toast("Sincronización completa.");
    } catch (error) {
      console.error(error);
      log(strip, error.message, "error");
      toast(error.message, "error");
    }
  }

  async function rejectPack(pack, noteValue, strip) {
    const note = noteValue?.trim();
    if (!note) {
      toast("Escribe una nota con el motivo del rechazo.", "warn");
      return;
    }
    strip.hidden = false;
    strip.replaceChildren();
    try {
      log(strip, "Registrando rechazo…");
      const { data, error } = await sb.client.rpc("review_sticker_pack", {
        p_pack_id: pack.id,
        p_approve: false,
        p_note: note
      });
      if (error) throw new Error(error.message);
      const updated = Array.isArray(data) ? data[0] : data;
      log(strip, "Rechazado en la base de datos.", "ok");

      if (updated.published_folder_name) {
        log(strip, "Despublicando “" + updated.published_folder_name + "”…");
        await deletePublicFolder(updated.published_folder_name, strip);
        const { error: clearError } = await sb.client.rpc("clear_sticker_pack_published_folder", {
          p_pack_id: pack.id
        });
        if (clearError) throw new Error(clearError.message);
        log(strip, "Estado de publicación limpiado.", "ok");
      }

      toast("Paquete rechazado; el autor puede corregirlo y reenviarlo.");
      await reloadData();
    } catch (error) {
      console.error(error);
      log(strip, error.message, "error");
      toast(error.message, "error");
      await reloadData();
    }
  }

  async function cleanupRejected(pack, strip) {
    strip.hidden = false;
    strip.replaceChildren();
    try {
      await deletePublicFolder(pack.published_folder_name, strip);
      const { error } = await sb.client.rpc("clear_sticker_pack_published_folder", { p_pack_id: pack.id });
      if (error) throw new Error(error.message);
      toast("Carpeta pública limpiada.");
      await reloadData();
    } catch (error) {
      console.error(error);
      log(strip, error.message, "error");
      toast(error.message, "error");
    }
  }

  /* ------------------------------------------------------------------ */
  /* Reconciliation                                                      */
  /* ------------------------------------------------------------------ */

  function renderReconciliation() {
    const byPublished = new Map();
    for (const pack of state.packs) {
      if (pack.published_folder_name) byPublished.set(pack.published_folder_name.toLowerCase(), pack);
    }
    const approvedByFolder = new Map();
    for (const pack of state.packs) {
      if (pack.status === "approved") approvedByFolder.set(pack.folder_name.toLowerCase(), pack);
    }

    const intro = document.createElement("p");
    intro.className = "detail-note";
    intro.textContent =
      "Carpetas públicas del bucket Stickers frente a los paquetes registrados. Las carpetas “manuales” son las que subiste directamente desde el dashboard: no se tocan desde aquí salvo que tú lo pidas.";
    els.list.appendChild(intro);

    const folderSet = new Set(state.publicFolders.map(folder => folder.toLowerCase()));

    // Approved packs whose public folder is missing entirely.
    for (const pack of state.packs) {
      if (pack.status !== "approved") continue;
      if (!folderSet.has(pack.folder_name.toLowerCase())) {
        els.list.appendChild(reconRow(
          pack.folder_name,
          "Aprobado pero sin carpeta pública",
          "chip--rejected",
          [button("Re-sincronizar", "primary-button", async () => {
            const strip = ensureReconStrip();
            await resyncPack(pack, strip);
            await reloadData();
          })]
        ));
      }
    }

    for (const folder of state.publicFolders) {
      const lower = folder.toLowerCase();
      const publishedPack = byPublished.get(lower);
      const approvedPack = approvedByFolder.get(lower);

      if (approvedPack && publishedPack && publishedPack.id === approvedPack.id) {
        els.list.appendChild(reconRow(folder, "Gestionada · " + approvedPack.name, "chip--approved", []));
      } else if (publishedPack) {
        els.list.appendChild(reconRow(
          folder,
          "Publicada, pero el paquete “" + publishedPack.name + "” está en estado " + (STATUS_LABELS[publishedPack.status] || publishedPack.status),
          "chip--pending",
          [button("Despublicar carpeta", "danger-button", async () => {
            const strip = ensureReconStrip();
            await deletePublicFolder(folder, strip).catch(error => {
              toast(error.message, "error");
            });
            if (publishedPack.status !== "approved") {
              await sb.client.rpc("clear_sticker_pack_published_folder", { p_pack_id: publishedPack.id });
            }
            await reloadData();
          })]
        ));
      } else {
        els.list.appendChild(reconRow(
          folder,
          "Manual o huérfana (sin paquete registrado)",
          "chip",
          [button("Eliminar carpeta…", "danger-button", async () => {
            const confirmation = prompt(
              "Esta carpeta no pertenece a ningún paquete registrado. Escribe su nombre (" + folder + ") para eliminarla del bucket público:"
            );
            if (confirmation !== folder) {
              toast("Nombre no confirmado; no se eliminó nada.", "warn");
              return;
            }
            const strip = ensureReconStrip();
            try {
              await deletePublicFolder(folder, strip);
              toast("Carpeta eliminada.");
            } catch (error) {
              toast(error.message, "error");
            }
            await reloadData();
          })]
        ));
      }
    }

    if (!state.publicFolders.length) {
      els.list.appendChild(emptyNote("El bucket público no tiene carpetas."));
    }
  }

  function ensureReconStrip() {
    let strip = document.getElementById("reconStrip");
    if (!strip) {
      strip = document.createElement("div");
      strip.id = "reconStrip";
      strip.className = "sync-strip";
      els.list.prepend(strip);
    }
    strip.hidden = false;
    return strip;
  }

  function reconRow(folder, description, chipClass, actions) {
    const row = document.createElement("div");
    row.className = "recon-row";
    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = folder;
    info.appendChild(title);
    const desc = document.createElement("div");
    desc.className = "admin-meta";
    desc.textContent = description;
    info.appendChild(desc);
    row.appendChild(info);
    const right = document.createElement("div");
    right.className = "admin-actions";
    for (const action of actions) right.appendChild(action);
    row.appendChild(right);
    return row;
  }

  /* ------------------------------------------------------------------ */
  /* Utils                                                               */
  /* ------------------------------------------------------------------ */

  function toast(message, level) {
    if (ui?.showToast) ui.showToast(message, level);
    else console.log("[admin]", level || "ok", message);
  }

  function formatDate(value) {
    if (!value) return "—";
    try {
      return new Date(value).toLocaleString("es", { dateStyle: "short", timeStyle: "short" });
    } catch (_error) {
      return String(value);
    }
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
})();
