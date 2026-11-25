// ===== EDITE AQUI os seus dados =====
const DADOS = {
  nome: "Seu Nome",
  cidade: "Sua cidade",
  anos: "10+",
  whatsapp: "351900000000", // indicativo do país + número, só dígitos
  email: "seuemail@exemplo.com",
  instagram: "seuperfil", // sem o @
};
// ====================================

document.querySelectorAll("[data-campo]").forEach((el) => {
  const v = DADOS[el.dataset.campo];
  if (v) el.textContent = v;
});

const msg = encodeURIComponent("Olá! Vi o seu portfólio e quero um orçamento.");
const links = {
  whatsapp: `https://wa.me/${DADOS.whatsapp}?text=${msg}`,
  email: `mailto:${DADOS.email}?subject=${encodeURIComponent("Pedido de orçamento")}`,
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

// Filtro da galeria
const filtros = document.querySelectorAll(".filtro");
const itens = [...document.querySelectorAll(".galeria li")];
filtros.forEach((b) =>
  b.addEventListener("click", () => {
    filtros.forEach((x) => {
      x.classList.toggle("ativo", x === b);
      x.setAttribute("aria-pressed", x === b);
    });
    const f = b.dataset.filtro;
    itens.forEach((li) => (li.hidden = f !== "todos" && li.dataset.cat !== f));
  })
);

// Foto ampliada
const caixa = document.querySelector(".caixa-foto");
const cImg = caixa.querySelector("img");
const cLeg = caixa.querySelector("figcaption");
let atual = 0;
const visiveis = () => itens.filter((li) => !li.hidden);
function mostrar(li) {
  const b = li.querySelector("button");
  cImg.src = `fotos/${b.dataset.foto}.webp`;
  cImg.alt = li.querySelector("img").alt;
  cLeg.textContent = b.dataset.legenda;
  atual = visiveis().indexOf(li);
}
function passar(d) {
  const v = visiveis();
  mostrar(v[(atual + d + v.length) % v.length]);
}
itens.forEach((li) =>
  li.querySelector("button").addEventListener("click", () => {
    mostrar(li);
    caixa.showModal();
  })
);
caixa.querySelector(".fechar").addEventListener("click", () => caixa.close());
caixa.querySelector(".ant").addEventListener("click", () => passar(-1));
caixa.querySelector(".prox").addEventListener("click", () => passar(1));
caixa.addEventListener("click", (e) => e.target === caixa && caixa.close());
caixa.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") passar(-1);
  if (e.key === "ArrowRight") passar(1);
});
let toqueX = null;
caixa.addEventListener("touchstart", (e) => (toqueX = e.touches[0].clientX), { passive: true });
caixa.addEventListener("touchend", (e) => {
  if (toqueX === null) return;
  const dx = e.changedTouches[0].clientX - toqueX;
  if (Math.abs(dx) > 50) passar(dx < 0 ? 1 : -1);
  toqueX = null;
});

// Antes e depois
const comp = document.querySelector(".comparar");
comp.querySelector("input").addEventListener("input", (e) =>
  comp.style.setProperty("--pos", e.target.value + "%")
);

// Barras de habilidade: preenchem ao aparecer na tela
const barras = document.querySelectorAll(".barras b");
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
