/**
 * Histórico das checagens de situação de cada base local, em memória —
 * alimenta o gráfico de uptime da tela Local. Cada chamada à rota de situação
 * (automática ou forçada pelo botão) vira um ponto nesse histórico; não há
 * varredura própria em segundo plano, é o polling do front que gera as
 * amostras.
 *
 * Fica só em memória — reinicia com o servidor. Um desktop tool de um usuário
 * só não precisa persistir isso em disco.
 */

export interface AmostraDeSituacaoDaBase {
  em: string;
  servicoRodando: boolean;
  paginaInicialOk: boolean;
}

const QUANTIDADE_MAXIMA_DE_AMOSTRAS = 200;

const historicoPorBase = new Map<string, AmostraDeSituacaoDaBase[]>();

export function registrarAmostraDaBase(idDaBase: string, amostra: AmostraDeSituacaoDaBase): void {
  const amostras = historicoPorBase.get(idDaBase) ?? [];
  amostras.push(amostra);

  if (amostras.length > QUANTIDADE_MAXIMA_DE_AMOSTRAS) {
    amostras.splice(0, amostras.length - QUANTIDADE_MAXIMA_DE_AMOSTRAS);
  }

  historicoPorBase.set(idDaBase, amostras);
}

export function obterHistoricoDaBase(idDaBase: string): AmostraDeSituacaoDaBase[] {
  return historicoPorBase.get(idDaBase) ?? [];
}

export function limparHistoricoDaBase(idDaBase: string): void {
  historicoPorBase.delete(idDaBase);
}
