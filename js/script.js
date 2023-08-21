document.addEventListener("DOMContentLoaded", function () {
  const fileList = document.getElementById("file-list");
  const folderPath =
    "https://api.github.com/repos/aguolmedo/aguolmedo.github.io/contents/pdfs";

  fetch(folderPath)
    .then((response) => response.json())
    .then((data) => {
      data.forEach((file) => {
        const listItem = document.createElement("li");
        const anchor = document.createElement("a");
        anchor.href = file.download_url;
        anchor.textContent = file.name.split(".")[0];
        listItem.appendChild(anchor);
        fileList.appendChild(listItem);
      });
    });
});
