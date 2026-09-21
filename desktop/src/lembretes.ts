/**
 * Lembretes das anotacoes de cliente, na abertura do aplicativo.
 *
 * O hub guarda, por cliente, um campo de anotacoes e uma marca "avisar". Quem marcou
 * quer ser lembrado ao abrir o aplicativo — nao a cada ciclo, nao por e-mail (isso e' o
 * resumo diario, em `src/resumoAnotacoes.ts`), mas uma vez, quando senta para trabalhar.
 *
 * Notificacao nativa do Windows, e nao um modal dentro da janela: o aviso precisa
 * aparecer mesmo com o hub atras de outra janela, que e' o caso normal de quem abre o
 * aplicativo e vai direto para o Sankhya.
 */
import { Notification } from 'electron';
import { HUB_URL, ICONE } from './config';
import { logEvento } from './log';

/** Primeira linha da anotacao, que e' o que cabe num balao de notificacao. */
function resumir(texto: string, limite = 120): string {
  const primeira = texto.split(/\r?\n/).find((l) => l.trim()) ?? '';
  return primeira.length > limite ? `${primeira.slice(0, limite - 1)}…` : primeira;
}

interface Lembrete {
  id: number;
  nome: string;
  anotacoes: string;
}

/**
 * Busca no backend e notifica. Best-effort: sem backend, sem suporte a notificacao ou
 * com erro de rede, nao acontece nada — lembrete que falha nao pode atrapalhar a
 * abertura do aplicativo.
 */
export async function avisarAnotacoes(): Promise<number> {
  if (!Notification.isSupported()) {
    logEvento('lembretes-sem-suporte');
    return 0;
  }

  let lembretes: Lembrete[];
  try {
    const resposta = await fetch(`${HUB_URL}/api/email/lembretes`, { signal: AbortSignal.timeout(5_000) });
    if (!resposta.ok) return 0;
    lembretes = ((await resposta.json()) as { lembretes?: Lembrete[] }).lembretes ?? [];
  } catch {
    return 0;
  }

  for (const lembrete of lembretes) {
    new Notification({
      title: `Anotação — ${lembrete.nome}`,
      body: resumir(lembrete.anotacoes),
      icon: ICONE,
      // Sem som: pode ser mais de um cliente, e uma salva de bipes ao abrir o app é
      // exatamente o tipo de coisa que faz a pessoa desligar o aviso.
      silent: true,
    }).show();
  }

  // Sem o conteúdo das anotações no log: são notas de trabalho sobre cliente.
  if (lembretes.length) logEvento('lembretes-notificados', { total: lembretes.length });
  return lembretes.length;
}
