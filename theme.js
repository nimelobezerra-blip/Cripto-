// Aplica o tema guardado antes do primeiro desenho, para não piscar.
try {
  var t = localStorage.getItem("cripto.theme");
  if (t === '"light"' || t === '"dark"') document.documentElement.dataset.theme = JSON.parse(t);
} catch (e) {
  /* sem armazenamento: segue o sistema */
}
