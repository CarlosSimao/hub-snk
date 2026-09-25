import { lerJson, gravarJson } from './integracaoArquivo';
import { validarEvento, type EventoApi, type TipoEvento } from './integracaoValidacao';

export interface Pendente { evento: EventoApi; criadoEm: string; estado: 'pendente' | 'falhou'; tentativas: number; proximaTentativa: string; ultimoErro: string; bloqueioManual?: boolean }
interface ArquivoFila { apiUrl: string; installationId: string; eventos: Pendente[]; confirmados: string[]; ultimoEnvio: string; ultimoErro: string }
const prioridade: Record<TipoEvento, number> = { 'usuario.upsert': 0, 'os.upsert': 1, 'os.progresso': 2, 'horas.apontar': 3 };
const esperas = [5000, 15000, 30000, 60000];
const seguro = (texto: unknown) => typeof texto === 'string' ? texto.replace(/dsk_[A-Za-z0-9._:-]+/g, '[segredo]').replace(/(?:key|token|authorization)\s*[:=]\s*\S+/gi, '[segredo]').replace(/https?:\/\/\S+/g, '[url]').slice(0, 240) : '';

export class FilaIntegracao {
  private dados: ArquivoFila;
  private enviando = false;
  constructor(private readonly arquivo: string, private readonly fetcher: typeof fetch = fetch) {
    this.dados = lerJson(arquivo, { apiUrl: '', installationId: '', eventos: [], confirmados: [], ultimoEnvio: '', ultimoErro: '' });
  }
  identidade() { return { apiUrl: this.dados.apiUrl, installationId: this.dados.installationId }; }
  podeAlterarIdentidade(apiUrl: string, installationId: string): boolean {
    return this.dados.eventos.length === 0 || !this.dados.installationId || (this.dados.apiUrl === apiUrl && this.dados.installationId === installationId);
  }
  definirIdentidade(apiUrl: string, installationId: string): void {
    if (!this.podeAlterarIdentidade(apiUrl, installationId)) throw new Error('Fila pendente pertence a URL e instalacao anteriores');
    if (this.dados.apiUrl !== apiUrl || this.dados.installationId !== installationId) {
      const anterior = this.dados;
      this.dados = { apiUrl, installationId, eventos: [], confirmados: [], ultimoEnvio: '', ultimoErro: '' };
      try { this.salvar(); } catch (erro) { this.dados = anterior; throw erro; }
    }
  }
  enfileirar(evento: unknown, apiUrl: string, installationId: string): boolean {
    return this.enfileirarLote([evento], apiUrl, installationId) > 0;
  }
  enfileirarLote(eventos: unknown[], apiUrl: string, installationId: string): number {
    for (const evento of eventos) validarEvento(evento);
    if (this.dados.apiUrl !== apiUrl || this.dados.installationId !== installationId) throw new Error('Identidade da fila difere da configuracao');
    const anterior = this.dados.eventos.slice();
    let adicionados = 0;
    for (const evento of eventos as EventoApi[]) {
      if (this.dados.confirmados.includes(evento.id) || this.dados.eventos.some(p => p.evento.id === evento.id)) continue;
      this.dados.eventos.push({ evento: structuredClone(evento), criadoEm: new Date().toISOString(), estado: 'pendente', tentativas: 0, proximaTentativa: '', ultimoErro: '' });
      adicionados++;
    }
    if (adicionados) try { this.salvar(); } catch (erro) { this.dados.eventos = anterior; throw erro; }
    return adicionados;
  }
  estado() {
    return { pendentes: this.dados.eventos.filter(p => p.estado === 'pendente').length,
      rejeitados: this.dados.eventos.filter(p => p.estado === 'falhou').length,
      eventos: this.dados.eventos.map(p => ({ id: p.evento.id, tipo: p.evento.type, estado: p.estado, tentativas: p.tentativas, erro: p.ultimoErro })),
      proximaTentativa: this.dados.eventos.map(p => p.proximaTentativa).filter(Boolean).sort()[0] ?? '',
      ultimoEnvio: this.dados.ultimoEnvio, ultimoErro: this.dados.ultimoErro, enviando: this.enviando };
  }
  private salvar() { gravarJson(this.arquivo, this.dados); }
  private bloqueado(p: Pendente): boolean {
    const d = p.evento.data;
    return this.dados.eventos.some(outro => {
      if (outro.estado !== 'falhou') return false;
      const od = outro.evento.data;
      const usuario = outro.evento.type === 'usuario.upsert' && od.externalId === d.userExternalId;
      const os = outro.evento.type === 'os.upsert' && od.externalId === d.osExternalId;
      const mesmaEntidade = outro.evento.type === p.evento.type && od.externalId && od.externalId === d.externalId && outro.criadoEm <= p.criadoEm;
      return usuario || os || Boolean(mesmaEntidade);
    });
  }
  async enviar(apiUrl: string, installationId: string, key: string, forcar = false): Promise<void> {
    if (this.enviando) return;
    if (!key || this.dados.apiUrl !== apiUrl || this.dados.installationId !== installationId) return;
    const agora = Date.now();
    const lote = this.dados.eventos.filter(p => p.estado === 'pendente' && (forcar || !p.bloqueioManual) && !this.bloqueado(p)
      && (forcar || !p.proximaTentativa || Date.parse(p.proximaTentativa) <= agora))
      .sort((a, b) => prioridade[a.evento.type] - prioridade[b.evento.type] || a.criadoEm.localeCompare(b.criadoEm))
      .slice(0, 200);
    if (!lote.length) return;
    this.enviando = true;
    try {
      let resposta: Response;
      try {
        resposta = await this.fetcher(apiUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ version: 1, installationId, key, events: lote.map(p => p.evento) }), signal: AbortSignal.timeout(20000) });
      } catch {
        this.reagendar(lote, 'Falha de rede ou timeout'); return;
      }
      // Só o que pode passar sozinho volta ao retry (timeout, limite, servidor fora). Erro
      // de pedido ou de credencial (4xx) repetiria a cada 60 s para sempre: pede ação.
      if (!resposta.ok) {
        const transitorio = resposta.status === 408 || resposta.status === 429 || resposta.status >= 500;
        if (transitorio) this.reagendar(lote, `HTTP ${resposta.status}`);
        else this.bloquearLote(lote, `HTTP ${resposta.status}: revise URL, instalacao ou chave`);
        return;
      }
      let envelope: unknown;
      try { envelope = await resposta.json(); } catch { this.bloquearLote(lote, 'Resposta JSON invalida'); return; }
      if (!envelope || typeof envelope !== 'object' || (envelope as { status?: unknown }).status !== 'COMPLETED') {
        this.bloquearLote(lote, 'Execucao nao concluida'); return;
      }
      let output = (envelope as { output?: unknown }).output;
      if (typeof output === 'string') { try { output = JSON.parse(output); } catch { output = null; } }
      if (!output || typeof output !== 'object' || !Array.isArray((output as { results?: unknown }).results)) {
        this.bloquearLote(lote, 'Resultados ausentes'); return;
      }
      const ids = new Set(lote.map(p => p.evento.id));
      const vistos = new Set<string>();
      for (const resultado of (output as { results: unknown[] }).results) {
        if (!resultado || typeof resultado !== 'object') continue;
        const r = resultado as { id?: unknown; status?: unknown; error?: unknown };
        if (typeof r.id !== 'string' || !ids.has(r.id) || vistos.has(r.id)) continue;
        if (!['accepted', 'duplicate', 'failed'].includes(String(r.status))) continue;
        vistos.add(r.id);
        const item = this.dados.eventos.find(p => p.evento.id === r.id)!;
        if (r.status === 'failed') { item.estado = 'falhou'; item.ultimoErro = seguro(r.error) || 'Rejeitado pelo receptor'; item.proximaTentativa = ''; }
        else { this.dados.confirmados.push(r.id); this.dados.eventos = this.dados.eventos.filter(p => p !== item); }
      }
      this.dados.ultimoEnvio = new Date().toISOString();
      this.dados.ultimoErro = vistos.size < lote.length ? 'Resposta parcial: eventos sem resultado mantidos' : '';
      if (vistos.size < lote.length) for (const p of lote) if (!vistos.has(p.evento.id)) { p.bloqueioManual = true; p.ultimoErro = this.dados.ultimoErro; }
      this.salvar();
    } finally { this.enviando = false; }
  }
  private reagendar(lote: Pendente[], erro: string) {
    for (const p of lote) { p.tentativas++; p.ultimoErro = erro; p.bloqueioManual = false; p.proximaTentativa = new Date(Date.now() + esperas[Math.min(p.tentativas - 1, 3)]).toISOString(); }
    this.dados.ultimoErro = erro; this.salvar();
  }
  private bloquearLote(lote: Pendente[], erro: string) {
    for (const p of lote) { p.ultimoErro = erro; p.bloqueioManual = true; p.proximaTentativa = ''; }
    this.dados.ultimoErro = erro; this.salvar();
  }
}
