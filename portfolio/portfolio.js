// ===== EDITE AQUI os seus dados =====
const DADOS = {
  nome: "Seu Nome",
  cidade: "Sua cidade, UF",
  anos: "10+",
  whatsapp: "5500000000000", // DDI + DDD + número, só dígitos
  email: "seuemail@exemplo.com",
  instagram: "seuperfil", // sem o @
};
// ====================================

document.querySelectorAll("[data-campo]").forEach((el) => {
  const v = DADOS[el.dataset.campo];
  if (v) el.textContent = v;
});

const msg = encodeURIComponent("Olá! Vi seu portfólio e quero um orçamento de acabamento gráfico.");
const links = {
  whatsapp: `https://wa.me/${DADOS.whatsapp}?text=${msg}`,
  email: `mailto:${DADOS.email}?subject=${encodeURIComponent("Orçamento de acabamento gráfico")}`,
  instagram: `https://instagram.com/${DADOS.instagram}`,
};
document.querySelectorAll("[data-link]").forEach((a) => {
  a.href = links[a.dataset.link];
  if (a.dataset.link !== "email") {
    a.target = "_blank";
    a.rel = "noopener";
  }
});

document.getElementById("ano").textContent = new Date().getFullYear();

// Filtro de serviços
const filtros = document.querySelectorAll(".filtro");
const cartoes = document.querySelectorAll(".cartao");
filtros.forEach((b) =>
  b.addEventListener("click", () => {
    filtros.forEach((x) => {
      x.classList.toggle("ativo", x === b);
      x.setAttribute("aria-pressed", x === b);
    });
    const f = b.dataset.filtro;
    cartoes.forEach((c) => (c.hidden = f !== "todos" && c.dataset.cat !== f));
  })
);

// Barras de habilidade: preenchem ao aparecer na tela
const barras = document.querySelectorAll(".barras b");
barras.forEach((b) => b.style.setProperty("--n", "0%"));
const encher = (b) => b.style.setProperty("--n", b.dataset.nivel + "%");
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (ents) =>
      ents.forEach((e) => {
        if (e.isIntersecting) {
          encher(e.target);
          io.unobserve(e.target);
        }
      }),
    { threshold: 0.4 }
  );
  barras.forEach((b) => io.observe(b));
} else barras.forEach(encher);
