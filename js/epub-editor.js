// Edits an epub's metadata and cover entirely in the browser and returns a new
// Blob. The copy on the server is never modified.
const EpubEditor = (() => {
  const JSZIP_URL = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
  const DC = "http://purl.org/dc/elements/1.1/";
  const OPF = "http://www.idpf.org/2007/opf";
  const IMAGE_EXT = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif" };

  let jszipPromise;
  function loadJSZip() {
    jszipPromise ??= new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = JSZIP_URL;
      script.onload = () => resolve(window.JSZip);
      script.onerror = () => reject(new Error("no se pudo cargar JSZip"));
      document.head.appendChild(script);
    });
    return jszipPromise;
  }

  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("OPF inválido");
    return doc;
  }

  function normalizePath(path) {
    const out = [];
    for (const seg of path.split("/")) {
      if (seg === "..") out.pop();
      else if (seg && seg !== ".") out.push(seg);
    }
    return out.join("/");
  }

  const basename = (path) => path.split("/").pop();
  const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function editOpf(doc) {
    const metadata = doc.getElementsByTagNameNS(OPF, "metadata")[0];
    const prefix = metadata.lookupPrefix(DC) || "dc";
    const metas = () => [...metadata.getElementsByTagNameNS(OPF, "meta")];
    const dcAll = (name) => [...metadata.getElementsByTagNameNS(DC, name)];

    function removeRefines(el, property) {
      const id = el.getAttribute("id");
      if (!id) return;
      metas()
        .filter((m) => m.getAttribute("refines") === `#${id}`)
        .filter((m) => !property || m.getAttribute("property") === property)
        .forEach((m) => m.remove());
    }

    function remove(el) {
      removeRefines(el);
      el.remove();
    }

    function create(name, value) {
      const el = doc.createElementNS(DC, `${prefix}:${name}`);
      el.textContent = value;
      return el;
    }

    function setSingle(name, value) {
      const [first, ...rest] = dcAll(name);
      rest.forEach(remove);
      if (!value) return first && remove(first);
      if (first) first.textContent = value;
      else metadata.appendChild(create(name, value));
    }

    function setCreators(names) {
      const existing = dcAll("creator");
      let last = existing[existing.length - 1];
      names.forEach((name, i) => {
        const el = existing[i];
        if (!el) {
          const created = create("creator", name);
          if (last) last.after(created);
          else metadata.appendChild(created);
          last = created;
        } else if (el.textContent.trim() !== name) {
          el.textContent = name;
          // the old sort key ("Apellido, Nombre") no longer matches
          el.removeAttributeNS(OPF, "file-as");
          removeRefines(el, "file-as");
        }
      });
      existing.slice(names.length).forEach(remove);
    }

    function dropCalibreMeta(name) {
      metas().filter((m) => m.getAttribute("name") === name).forEach((m) => m.remove());
    }

    return { metadata, metas, setSingle, setCreators, dropCalibreMeta };
  }

  function findCoverItem(doc, items) {
    const isImage = (i) => (i.getAttribute("media-type") || "").startsWith("image/");
    const byProperty = items.find((i) =>
      (i.getAttribute("properties") || "").split(/\s+/).includes("cover-image"),
    );
    if (byProperty) return byProperty;
    const meta = [...doc.getElementsByTagNameNS(OPF, "meta")].find((m) => m.getAttribute("name") === "cover");
    const byMeta = meta && items.find((i) => i.getAttribute("id") === meta.getAttribute("content"));
    if (byMeta && isImage(byMeta)) return byMeta;
    return items.find(
      (i) => isImage(i) && /cover/i.test((i.getAttribute("id") || "") + (i.getAttribute("href") || "")),
    );
  }

  async function replaceCover(zip, doc, opfDir, file) {
    const ext = IMAGE_EXT[file.type];
    if (!ext) throw new Error("la portada tiene que ser JPG, PNG o GIF");
    const data = new Uint8Array(await file.arrayBuffer());
    const manifest = doc.getElementsByTagNameNS(OPF, "manifest")[0];
    const items = [...manifest.getElementsByTagNameNS(OPF, "item")];
    const resolve = (href) => normalizePath(opfDir + decodeURIComponent(href));
    let item = findCoverItem(doc, items);

    if (item) {
      const oldHref = item.getAttribute("href");
      const newHref = oldHref.replace(/\.[^./]+$/, "") + "." + ext;
      zip.remove(resolve(oldHref));
      zip.file(resolve(newHref), data);
      item.setAttribute("href", newHref);
      item.setAttribute("media-type", file.type);
      if (newHref !== oldHref) await rewriteReferences(zip, basename(oldHref), basename(newHref));
    } else {
      const ids = new Set(items.map((i) => i.getAttribute("id")));
      let id = "cover-image";
      for (let n = 2; ids.has(id); n++) id = `cover-image-${n}`;
      const href = `${id}.${ext}`;
      zip.file(resolve(href), data);
      item = doc.createElementNS(OPF, "item");
      item.setAttribute("id", id);
      item.setAttribute("href", href);
      item.setAttribute("media-type", file.type);
      if ((doc.documentElement.getAttribute("version") || "").startsWith("3")) {
        item.setAttribute("properties", "cover-image");
      }
      manifest.appendChild(item);
    }

    // EPUB2 readers (Kindle included) look for <meta name="cover">
    const metadata = doc.getElementsByTagNameNS(OPF, "metadata")[0];
    let meta = [...metadata.getElementsByTagNameNS(OPF, "meta")].find((m) => m.getAttribute("name") === "cover");
    if (!meta) {
      meta = doc.createElementNS(OPF, "meta");
      meta.setAttribute("name", "cover");
      metadata.appendChild(meta);
    }
    meta.setAttribute("content", item.getAttribute("id"));
  }

  // The cover page XHTML (and sometimes the NCX/CSS) points at the image by name.
  async function rewriteReferences(zip, oldName, newName) {
    const pattern = new RegExp(`(^|[/"'(])${escapeRegExp(oldName)}`, "g");
    const textFiles = Object.values(zip.files).filter((f) => !f.dir && /\.(x?html?|ncx|css)$/i.test(f.name));
    await Promise.all(
      textFiles.map(async (f) => {
        const text = await f.async("string");
        const updated = text.replace(pattern, `$1${newName}`);
        if (updated !== text) zip.file(f.name, updated);
      }),
    );
  }

  // mimetype must be the first entry and stored uncompressed.
  async function repack(JSZip, zip) {
    const out = new JSZip();
    out.file("mimetype", "application/epub+zip", { compression: "STORE" });
    const entries = Object.values(zip.files).filter((f) => !f.dir && f.name !== "mimetype");
    const contents = await Promise.all(entries.map((f) => f.async("uint8array")));
    entries.forEach((f, i) => out.file(f.name, contents[i]));
    return out.generateAsync({
      type: "blob",
      mimeType: "application/epub+zip",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
  }

  // changes: any of { title, authors: [], language, publisher, description, cover: File }
  async function edit(url, changes) {
    const [JSZip, buffer] = await Promise.all([
      loadJSZip(),
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(`no se pudo bajar el epub (${r.status})`);
        return r.arrayBuffer();
      }),
    ]);
    const zip = await JSZip.loadAsync(buffer);
    const container = parseXml(await zip.file("META-INF/container.xml").async("string"));
    const opfPath = container.getElementsByTagNameNS("*", "rootfile")[0].getAttribute("full-path");
    const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
    const opfText = await zip.file(opfPath).async("string");
    const doc = parseXml(opfText);
    const opf = editOpf(doc);

    if ("title" in changes) {
      opf.setSingle("title", changes.title);
      opf.dropCalibreMeta("calibre:title_sort");
    }
    if ("authors" in changes) opf.setCreators(changes.authors);
    if ("language" in changes) opf.setSingle("language", changes.language);
    if ("publisher" in changes) opf.setSingle("publisher", changes.publisher);
    if ("description" in changes) opf.setSingle("description", changes.description);
    if (changes.cover) await replaceCover(zip, doc, opfDir, changes.cover);

    const declaration = opfText.match(/^\s*<\?xml[^>]*\?>/)?.[0].trim() ?? '<?xml version="1.0" encoding="utf-8"?>';
    const body = new XMLSerializer().serializeToString(doc).replace(/^\s*<\?xml[^>]*\?>\s*/, "");
    zip.file(opfPath, `${declaration}\n${body}`);
    return repack(JSZip, zip);
  }

  return { edit };
})();
