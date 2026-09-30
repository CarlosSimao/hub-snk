/**
 * O que fazer quando o Git AutoSync falha, a partir da saída dele.
 *
 * O push rejeitado já vem diagnosticado pelo próprio autosync (`diagnose_push_failure`):
 * sem terminal interativo ele não corrige, só imprime `sugestao: <comando>`. Esse
 * comando é o preferido, porque sabe o remoto e a branch certos. Os outros erros são
 * reconhecidos pelo texto que o autosync escreve.
 *
 * Nada aqui roda comando: a tela mostra a sugestão, copia o comando e abre o terminal
 * na pasta. `pull --rebase` reescreve commits locais e pode parar em conflito — quem
 * decide é a pessoa, vendo o terminal.
 */

export interface SugestaoDeCorrecao {
  explicacao: string;
  /** Um por linha: `&&` não funciona no PowerShell 5.1, e o segundo só vale se o primeiro der certo. */
  comandos: string[];
  /** Ação da tela além do terminal, quando o remédio não é comando Git. */
  acao?: 'configurar-gitlab' | 'politica';
}

interface Regra {
  casa: RegExp;
  sugestao: (casamento: RegExpMatchArray) => SugestaoDeCorrecao;
}

const EXPLICACAO_POR_TIPO_DE_PUSH: [RegExp, string][] = [
  [/remoto tem commits/i, 'O remoto tem commits que você não tem: traga-os antes de enviar.'],
  [/upstream/i, 'A branch local nunca foi enviada: falta configurar o upstream.'],
];

/*
 * Ordem importa: as primeiras são as mais específicas. Uma saída pode casar mais de
 * uma (commit recusado e push pulado na mesma rodada), e todas entram.
 */
const REGRAS: Regra[] = [
  {
    casa: /has no upstream branch/i,
    sugestao: () => ({
      explicacao: 'A branch local nunca foi enviada: falta configurar o upstream.',
      comandos: ['git push -u origin HEAD'],
    }),
  },
  {
    casa: /\[rejected\].*(non-fast-forward|fetch first)/i,
    sugestao: () => ({
      explicacao: 'O remoto tem commits que você não tem: traga-os antes de enviar.',
      comandos: ['git pull --rebase', 'git push'],
    }),
  },
  {
    casa: /falta token do GitLab/i,
    sugestao: () => ({
      explicacao: 'Falta o token do GitLab. Informe o host e o token em Configurações › Git.',
      comandos: [],
      acao: 'configurar-gitlab',
    }),
  },
  {
    casa: /remoto inacessivel/i,
    sugestao: () => ({
      explicacao:
        'O remoto não respondeu. Confira a rede ou a VPN e se a URL do remoto está certa.',
      comandos: ['git remote -v', 'git fetch'],
    }),
  },
  {
    casa: /Authentication failed|could not read Username|HTTP Basic: Access denied|returned error: 40[13]/i,
    sugestao: () => ({
      explicacao:
        'O servidor recusou a credencial do Git. Rode o comando no terminal para entrar de novo.',
      comandos: ['git fetch'],
    }),
  },
  {
    casa: /HEAD destacado/i,
    sugestao: () => ({
      explicacao: 'O repositório está sem branch (HEAD destacado). Volte para uma branch.',
      comandos: ['git branch', 'git switch -'],
    }),
  },
  {
    casa: /Operacao Git em andamento \(([^)]+)\)/i,
    sugestao: (casamento) => ({
      explicacao: `Há um ${casamento[1]} em andamento. Termine-o ou cancele antes de sincronizar.`,
      comandos: ['git status'],
    }),
  },
  {
    casa: /Conflitos pendentes/i,
    sugestao: () => ({
      explicacao: 'Há conflitos pendentes. Resolva os arquivos em conflito e faça o commit.',
      comandos: ['git status'],
    }),
  },
  {
    casa: /Branch nao permitida pela politica: (\S+)/i,
    sugestao: (casamento) => ({
      explicacao: `A branch ${casamento[1]} não está entre as permitidas pela política do repositório.`,
      comandos: ['git branch'],
      acao: 'politica',
    }),
  },
  {
    casa: /(Arquivo sensivel\/excluido no commit|Arquivo fora da politica de inclusao|Arquivo excede limite da politica|Possivel segredo detectado): (\S+?)(?=\.?(?:\s|$))/im,
    sugestao: (casamento) => ({
      explicacao: `O commit foi recusado por causa de ${casamento[2]}. Tire o arquivo do commit (por exemplo, no .gitignore) ou ajuste a política.`,
      comandos: ['git status'],
      acao: 'politica',
    }),
  },
  {
    casa: /Configure um remoto de push valido/i,
    sugestao: () => ({
      explicacao: 'A branch não tem remoto de push. Confira os remotos do repositório.',
      comandos: ['git remote -v'],
    }),
  },
];

/** `sugestao: <cmd>`, na linha de aviso do CLI ou no fim da mensagem do status. */
function sugestaoDoProprioAutosync(saida: string): SugestaoDeCorrecao | null {
  const casamento = /sugest[aã]o:\s*([^\r\n]+)/i.exec(saida);
  if (!casamento?.[1]) {
    return null;
  }

  /* `correcao recusada (sugestao: <cmd>)` fecha o parêntese depois do comando. */
  let comando = casamento[1].trim();
  if (comando.endsWith(')') && !comando.includes('(')) {
    comando = comando.slice(0, -1).trim();
  }

  const comandos = comando
    .split('&&')
    .map((parte) => parte.trim())
    .filter(Boolean);
  const motivo = /push falhou \(([^)]+)\)/i.exec(saida)?.[1] ?? '';
  const explicacao =
    EXPLICACAO_POR_TIPO_DE_PUSH.find(
      ([padrao]) => padrao.test(motivo) || padrao.test(saida),
    )?.[1] ?? 'O push falhou. O Git AutoSync sugere:';

  return { explicacao, comandos };
}

export function sugerirCorrecoes(saida: string): SugestaoDeCorrecao[] {
  const sugestoes: SugestaoDeCorrecao[] = [];
  const doAutosync = sugestaoDoProprioAutosync(saida);
  if (doAutosync) {
    sugestoes.push(doAutosync);
  }

  for (const regra of REGRAS) {
    const casamento = saida.match(regra.casa);
    if (!casamento) {
      continue;
    }
    const sugestao = regra.sugestao(casamento);
    /* A sugestão do autosync já cobre o push rejeitado, com remoto e branch certos. */
    if (doAutosync && sugestao.explicacao === doAutosync.explicacao) {
      continue;
    }
    if (!sugestoes.some((existente) => existente.explicacao === sugestao.explicacao)) {
      sugestoes.push(sugestao);
    }
  }

  return sugestoes;
}
