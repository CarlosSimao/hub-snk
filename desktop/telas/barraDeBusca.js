'use strict';

const campo = document.getElementById('campo');
const contador = document.getElementById('contador');

function buscar(paraTras) {
  void window.barraDeBusca.buscar(campo.value, paraTras);
}

function fechar() {
  void window.barraDeBusca.fechar();
}

campo.addEventListener('input', () => buscar(false));
campo.addEventListener('keydown', (evento) => {
  if (evento.key !== 'Enter') return;
  evento.preventDefault();
  buscar(evento.shiftKey);
});
// No documento, e não só no campo: o Esc também fecha com o foco num dos botões.
document.addEventListener('keydown', (evento) => {
  if (evento.key !== 'Escape') return;
  evento.preventDefault();
  fechar();
});

document.getElementById('btn-anterior').addEventListener('click', () => buscar(true));
document.getElementById('btn-proxima').addEventListener('click', () => buscar(false));
document.getElementById('btn-fechar').addEventListener('click', fechar);

// Reaberta, a barra traz o texto de antes selecionado e já destacado, como no Chrome.
window.barraDeBusca.aoAbrir(() => {
  campo.focus();
  campo.select();
  if (campo.value) buscar(false);
});

window.barraDeBusca.aoResultado(({ atual, total }) => {
  const temTexto = campo.value !== '';
  contador.textContent = temTexto ? `${atual}/${total}` : '';
  contador.classList.toggle('sem-resultado', temTexto && total === 0);
});
