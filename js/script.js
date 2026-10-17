document.addEventListener("DOMContentLoaded", async function () {
  const grid = document.getElementById("grid");
  const search = document.getElementById("search");
  const count = document.getElementById("count");
  const empty = document.getElementById("empty");

  const dialog = document.getElementById("book");
  const coverImg = document.getElementById("book-cover");
  const coverPicker = dialog.querySelector(".cover-picker");
  const coverInput = document.getElementById("cover-input");
  const info = document.getElementById("book-info");
  const form = document.getElementById("edit-form");
  const status = document.getElementById("edit-status");

  const books = await fetch("books.json").then((r) => r.json());
  const fileUrl = (path) => path.split("/").map(encodeURIComponent).join("/");
  const authorsText = (book) => book.authors.join(", ") || "anónimo";
  let current = null;
  let coverPreviewUrl = null;

  // grid

  const items = books.map((book) => {
    const li = document.createElement("li");
    const poster = document.createElement("button");
    poster.type = "button";
    poster.className = "poster";
    poster.title = `${book.title} — ${authorsText(book)}`;

    const img = document.createElement("img");
    img.src = fileUrl(book.cover);
    img.alt = book.title;
    img.loading = "lazy";

    const caption = document.createElement("span");
    caption.className = "caption";
    caption.textContent = book.title;

    poster.append(img, caption);
    poster.addEventListener("click", () => openBook(book));
    li.appendChild(poster);
    grid.appendChild(li);
    return { li, book, haystack: normalize(`${book.title} ${book.authors.join(" ")}`) };
  });

  function normalize(text) {
    return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }

  function filter() {
    const q = normalize(search.value.trim());
    let shown = 0;
    for (const item of items) {
      item.li.hidden = q && !item.haystack.includes(q);
      if (!item.li.hidden) shown++;
    }
    count.textContent = q ? `${shown} de ${books.length} libros` : `${books.length} libros`;
    empty.hidden = shown > 0;
  }

  search.addEventListener("input", filter);
  filter();

  // book dialog

  function openBook(book) {
    current = book;
    showInfo();
    coverImg.src = fileUrl(book.cover);
    coverImg.alt = book.title;
    document.getElementById("book-title").textContent = book.title;
    document.getElementById("book-authors").textContent = authorsText(book);
    document.getElementById("book-meta").textContent = [book.language, book.publisher].filter(Boolean).join(" · ");
    document.getElementById("book-description").textContent = book.description;
    const download = document.getElementById("book-download");
    download.href = fileUrl(book.file);
    download.setAttribute("download", book.file.split("/").pop());
    dialog.showModal();
  }

  function showInfo() {
    info.hidden = false;
    form.hidden = true;
    coverPicker.hidden = true;
    coverInput.value = "";
    status.textContent = "";
    if (coverPreviewUrl) {
      URL.revokeObjectURL(coverPreviewUrl);
      coverPreviewUrl = null;
      coverImg.src = fileUrl(current.cover);
    }
  }

  function showForm() {
    form.elements.title.value = current.title;
    form.elements.authors.value = current.authors.join(" & ");
    form.elements.language.value = current.language;
    form.elements.publisher.value = current.publisher;
    form.elements.description.value = current.description;
    info.hidden = true;
    form.hidden = false;
    coverPicker.hidden = false;
    form.elements.title.focus();
  }

  document.getElementById("book-edit").addEventListener("click", showForm);
  document.getElementById("edit-cancel").addEventListener("click", showInfo);
  dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", showInfo);

  coverInput.addEventListener("change", () => {
    const file = coverInput.files[0];
    if (!file) return;
    if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    coverPreviewUrl = URL.createObjectURL(file);
    coverImg.src = coverPreviewUrl;
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const book = current;
    const authors = form.elements.authors.value.split("&").map((a) => a.trim()).filter(Boolean);
    const changes = {};
    const title = form.elements.title.value.trim();
    if (title !== book.title) changes.title = title;
    if (authors.join("&") !== book.authors.join("&")) changes.authors = authors;
    for (const field of ["language", "publisher", "description"]) {
      const value = form.elements[field].value.trim();
      if (value !== book[field]) changes[field] = value;
    }
    if (coverInput.files[0]) changes.cover = coverInput.files[0];

    const submit = form.querySelector("[type=submit]");
    submit.disabled = true;
    status.className = "status";
    status.textContent = "armando el epub…";
    try {
      const blob = await EpubEditor.edit(fileUrl(book.file), changes);
      const name = `${title} - ${authors.join(", ") || "anónimo"}.epub`.replace(/[\\/:*?"<>|]/g, "");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      status.textContent = "listo, se descargó tu copia.";
    } catch (err) {
      status.className = "status error";
      status.textContent = err.message;
    } finally {
      submit.disabled = false;
    }
  });
});
