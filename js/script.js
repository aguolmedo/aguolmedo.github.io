

document.addEventListener("DOMContentLoaded", function() {
  const fileList = document.getElementById("file-list");
  const folderPath = "https://api.github.com/repos/aguolmedo/aguolmedo.github.io/contents/pdfs"; 

  fetch(folderPath)
        .then(response => response.text())
        .then(data => {
            const parser = new DOMParser();
            const htmlDocument = parser.parseFromString(data, "text/html");
            const links = htmlDocument.querySelectorAll("a");
            
            links.forEach(link => {
                const listItem = document.createElement("li");
                const anchor = document.createElement("a");
                anchor.href = folderPath + link.getAttribute("href");
                anchor.textContent = link.textContent;
                listItem.appendChild(anchor);
                fileList.appendChild(listItem);
            });
        })
        .catch(error => {
            console.error("Error fetching file list:", error);
        });
})
