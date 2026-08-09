/**
 * Histórico das checagens de situação de cada banco local, em memória —
 * alimenta o gráfico de uptime da tela Local. Cada chamada à rota de situação
 * (automática ou forçada pelo botão) vira um ponto nesse histórico; não há
 * varredura própria em segundo plano, é o polling do front que gera as
 * amostras.
 *
 * Fica só em memória — reinicia com o servidor. Um desktop tool de um usuário
 * só não precisa persistir isso em disco.
 */

export interface AmostraDeSituacao {
  em: string;
  containerRodando: boolean;
  bancoAcessivel: boolean;
}

const QUANTIDADE_MAXIMA_DE_AMOSTRAS = 200;

const historicoPorBanco = new Map<string, AmostraDeSituacao[]>();

export function registrarAmostra(idDoBanco: string, amostra: AmostraDeSituacao): void {
  const amostras = historicoPorBanco.get(idDoBanco) ?? [];
  amostras.push(amostra);

  if (amostras.length > QUANTIDADE_MAXIMA_DE_AMOSTRAS) {
    amostras.splice(0, amostras.length - QUANTIDADE_MAXIMA_DE_AMOSTRAS);
  }

  historicoPorBanco.set(idDoBanco, amostras);
}

export function obterHistorico(idDoBanco: string): AmostraDeSituacao[] {
  return historicoPorBanco.get(idDoBanco) ?? [];
}

export function limparHistorico(idDoBanco: string): void {
  historicoPorBanco.delete(idDoBanco);
}
