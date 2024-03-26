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

document.addEventListener("DOMContentLoaded", function () {
  const imageGrid = document.getElementById("image-grid");
  const folderPath =
    "https://api.github.com/repos/aguolmedo/aguolmedo.github.io/contents/photos";

  fetch(folderPath)
    .then((response) => response.json())
    .then((data) => {
      data.forEach((image) => {
        if (
          image.type === "file" &&
          image.name.match(/\.(jpg|jpeg|png|gif)$/)
        ) {
          const imageItem = document.createElement("div");
          const img = document.createElement("img");
          img.src = image.download_url;
          img.alt = image.name;
          imageItem.appendChild(img);
          imageGrid.appendChild(imageItem);
        }
      });
    });
});
