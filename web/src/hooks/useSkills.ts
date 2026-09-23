/**
 * Conversa com uma skill do Claude Code — ver `src/skills.ts` no backend.
 *
 * O turno de uma skill dura minutos e produz dezenas de eventos, então a leitura é por
 * SSE e não por polling. O que chega é o stream cru da CLI; aqui ele vira uma lista de
 * itens que a tela sabe desenhar: fala do usuário, fala da skill, ferramenta executada.
 *
 * `thinking` fica de fora de propósito: é raciocínio interno, muda a cada versão do
 * modelo e encheria a tela sem dizer o que a skill fez.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EstadoSessaoSkill, SkillDisponivel } from '../types.ts';
import { enviar, requisitar } from '../lib/api.ts';
import type { Avisar } from './useToasts.ts';

export type ItemConversa =
  | { tipo: 'usuario'; texto: string; seq: number }
  | { tipo: 'skill'; texto: string; seq: number }
  | { tipo: 'ferramenta'; nome: string; detalhe: string; seq: number }
  | { tipo: 'fim'; custoUsd: number; turnos: number; erro: boolean; seq: number };

/** O modelo escolhido vale para a próxima execução e fica salvo como padrão. */
const CHAVE_MODELO = 'sankhya-hub-skill-modelo';
/** Idem para o nível de raciocínio (`--effort`). */
const CHAVE_ESFORCO = 'sankhya-hub-skill-esforco';

export function modeloSalvo(): string {
  try {
    return localStorage.getItem(CHAVE_MODELO) ?? '';
  } catch {
    return '';
  }
}

export function salvarModelo(modelo: string): void {
  try {
    localStorage.setItem(CHAVE_MODELO, modelo);
  } catch {
    // Navegador sem storage (janela privada): a escolha vale só para esta execução.
  }
}

export function esforcoSalvo(): string {
  try {
    return localStorage.getItem(CHAVE_ESFORCO) ?? '';
  } catch {
    return '';
  }
}

export function salvarEsforco(esforco: string): void {
  try {
    localStorage.setItem(CHAVE_ESFORCO, esforco);
  } catch {
    // Navegador sem storage (janela privada): a escolha vale só para esta execução.
  }
}

/** O resumo do que a ferramenta fez, curto o bastante para caber numa linha da tela. */
function detalheDaFerramenta(nome: string, entrada: Record<string, unknown>): string {
  const texto = (chave: string) => (typeof entrada[chave] === 'string' ? (entrada[chave] as string) : '');
  if (nome === 'Bash' || nome === 'PowerShell') return texto('description') || texto('command').slice(0, 120);
  if (nome === 'Read' || nome === 'Write' || nome === 'Edit') return texto('file_path');
  if (nome === 'Skill') return texto('skill');
  if (nome === 'Glob' || nome === 'Grep') return texto('pattern');
  const bruto = JSON.stringify(entrada);
  return bruto.length > 120 ? `${bruto.slice(0, 120)}…` : bruto;
}

interface EventoBruto {
  seq: number;
  bruto: {
    type?: string;
    subtype?: string;
    origem?: string;
    num_turns?: number;
    total_cost_usd?: number;
    is_error?: boolean;
    message?: { content?: { type?: string; text?: string; name?: string; input?: Record<string, unknown> }[] };
  };
}

function traduzir(evento: EventoBruto): ItemConversa[] {
  const { bruto, seq } = evento;
  const itens: ItemConversa[] = [];

  if (bruto.type === 'result') {
    itens.push({
      tipo: 'fim',
      custoUsd: bruto.total_cost_usd ?? 0,
      turnos: bruto.num_turns ?? 0,
      erro: Boolean(bruto.is_error) || bruto.subtype !== 'success',
      seq,
    });
    return itens;
  }

  for (const parte of bruto.message?.content ?? []) {
    if (parte.type === 'text' && parte.text?.trim()) {
      // A mensagem que o hub mandou volta no stream como se fosse do usuário; só a
      // nossa (marcada na origem) vira balão de usuário. As outras são o eco que a CLI
      // devolve das ferramentas e não interessam à conversa.
      if (bruto.type === 'assistant') itens.push({ tipo: 'skill', texto: parte.text, seq });
      else if (bruto.origem === 'hub') itens.push({ tipo: 'usuario', texto: parte.text, seq });
    }
    if (parte.type === 'tool_use' && parte.name) {
      itens.push({
        tipo: 'ferramenta',
        nome: parte.name,
        detalhe: detalheDaFerramenta(parte.name, parte.input ?? {}),
        seq,
      });
    }
  }
  return itens;
}

export function useSkills(toast: Avisar) {
  const [skills, setSkills] = useState<SkillDisponivel[]>([]);
  const [sessao, setSessao] = useState<EstadoSessaoSkill | null>(null);
  const [conversa, setConversa] = useState<ItemConversa[]>([]);
  const [ocupado, setOcupado] = useState(false);
  /** A skill está pensando: entre a mensagem enviada e o `result` do turno. */
  const [rodando, setRodando] = useState(false);
  const fonte = useRef<EventSource | null>(null);

  const carregarSkills = useCallback(async () => {
    const { ok, body } = await requisitar<{ skills: SkillDisponivel[] }>('/api/skills');
    if (ok) setSkills(body.skills ?? []);
    else toast('Não consegui listar as skills', 'err', body.error);
  }, [toast]);

  useEffect(() => {
    void carregarSkills();
  }, [carregarSkills]);


  const desconectar = useCallback(() => {
    fonte.current?.close();
    fonte.current = null;
  }, []);

  useEffect(() => desconectar, [desconectar]);

  const acompanhar = useCallback((id: string) => {
    desconectar();
    // `desde=0`: o backend reenvia o que ja' passou antes de a tela assinar. E' isso que
    // permite voltar para a aba (ou recarregar a pagina) no meio de um turno sem perder
    // a conversa — a sessao vive no backend, nao no componente.
    const stream = new EventSource(`/api/skills/sessoes/${id}/eventos?desde=0`);
    stream.onmessage = (mensagem) => {
      const evento = JSON.parse(mensagem.data) as EventoBruto;
      const itens = traduzir(evento);
      if (itens.some((item) => item.tipo === 'fim')) setRodando(false);
      if (itens.length) setConversa((atual) => [...atual, ...itens]);
    };
    // Sem `onerror` o navegador reabre sozinho e o histórico chegaria duplicado.
    stream.onerror = () => desconectar();
    fonte.current = stream;
  }, [desconectar]);

  /**
   * Reassume a sessao que ficou rodando enquanto a tela estava noutra aba.
   *
   * Sem isto, sair da aba Skills e voltar deixava a conversa em branco com a skill ainda
   * trabalhando por tras — e um alerta critico chega a trocar a aba sozinho.
   */
  useEffect(() => {
    let cancelado = false;
    void requisitar<{ sessoes: EstadoSessaoSkill[] }>('/api/skills/sessoes').then(({ ok, body }) => {
      if (cancelado || !ok) return;
      const viva = (body.sessoes ?? []).filter((item) => item.viva).at(-1);
      if (!viva) return;
      setSessao(viva);
      setConversa([]);
      acompanhar(viva.id);
    });
    return () => {
      cancelado = true;
    };
  }, [acompanhar]);

  const iniciar = useCallback(
    async (entrada: { skill: string; pasta: string; modelo: string; esforco: string; mensagem: string }) => {
      setOcupado(true);
      try {
        const { ok, body } = await enviar<EstadoSessaoSkill>('/api/skills/sessoes', entrada);
        if (!ok) {
          toast('Não consegui iniciar a skill', 'err', body.error);
          return;
        }
        salvarModelo(entrada.modelo);
        salvarEsforco(entrada.esforco);
        setConversa([]);
        setSessao(body as EstadoSessaoSkill);
        setRodando(true);
        acompanhar((body as EstadoSessaoSkill).id);
      } finally {
        setOcupado(false);
      }
    },
    [acompanhar, toast],
  );

  const responder = useCallback(
    async (mensagem: string) => {
      if (!sessao) return;
      setOcupado(true);
      try {
        const { ok, body } = await enviar<EstadoSessaoSkill>(`/api/skills/sessoes/${sessao.id}/mensagem`, { mensagem });
        if (!ok) {
          toast('Não consegui enviar a mensagem', 'err', body.error);
          return;
        }
        setSessao(body as EstadoSessaoSkill);
        setRodando(true);
      } finally {
        setOcupado(false);
      }
    },
    [sessao, toast],
  );

  const encerrar = useCallback(async () => {
    if (!sessao) return;
    const { ok, body } = await enviar<EstadoSessaoSkill>(`/api/skills/sessoes/${sessao.id}/encerrar`, {});
    if (ok) setSessao(body as EstadoSessaoSkill);
    setRodando(false);
    desconectar();
  }, [desconectar, sessao]);

  return { skills, sessao, conversa, ocupado, rodando, iniciar, responder, encerrar, recarregarSkills: carregarSkills };
}
