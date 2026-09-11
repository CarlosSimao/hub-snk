/**
 * Escuro é o padrão; claro é opt-in e fica no localStorage.
 *
 * A leitura inicial é um script inline no index.html, antes do primeiro paint — o
 * bundle carrega tarde demais e o tema claro abriria escuro por um quadro.
 */
export function alternarTema(): void {
  const proximo = document.documentElement.dataset['theme'] === 'light' ? 'dark' : 'light';
  document.documentElement.dataset['theme'] = proximo;
  localStorage.setItem('sankhya-hub-theme', proximo);
}
