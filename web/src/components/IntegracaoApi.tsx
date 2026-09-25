import { useEffect, useState } from 'react';
import { useModoDesktop } from '../hooks/useModoDesktop.ts';

interface Estado {
  habilitada: boolean; apiUrl: string; installationId: string; apiVersion: 1; temChave: boolean;
  ultimaValidacao: string; ultimoEnvio: string; ultimoErro: string; proximaTentativa: string;
  pendentes: number; rejeitados: number; enviando: boolean;
  eventos: { id: string; tipo: string; estado: string; tentativas: number; erro: string }[];
}
interface Canal {
  estado(): Promise<Estado>;
  salvar(dados: { apiUrl: string; installationId: string }): Promise<Estado>;
  trocarChave(chave: string): Promise<Estado>;
  removerChave(): Promise<Estado>;
  validar(): Promise<Estado>;
  enviarPendencias(): Promise<Estado>;
}
const canal = () => (window as Window & { integracaoDesktop?: Canal }).integracaoDesktop;
const data = (valor: string) => valor ? new Date(valor).toLocaleString('pt-BR') : '—';

export function IntegracaoApi() {
  const desktop = useModoDesktop();
  const [canalPronto, setCanalPronto] = useState(() => Boolean(canal()));
  const [estado, setEstado] = useState<Estado | null>(null);
  const [url, setUrl] = useState('');
  const [id, setId] = useState('');
  const [chave, setChave] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState('');

  useEffect(() => {
    if (!desktop) return;
    let ativo = true;
    const carregar = () => {
      const c = canal();
      if (!c) return;
      setCanalPronto(true);
      void c.estado().then((novo) => {
        if (!ativo) return;
        setEstado(novo); setUrl(novo.apiUrl); setId(novo.installationId);
      }).catch(() => { if (ativo) setMensagem('Não foi possível ler o estado do desktop.'); });
    };
    carregar();
    window.addEventListener('integracao-desktop-pronta', carregar);
    return () => { ativo = false; window.removeEventListener('integracao-desktop-pronta', carregar); };
  }, [desktop]);

  const executar = async (operacao: (c: Canal) => Promise<Estado>, sucesso: string) => {
    const c = canal(); if (!c) { setMensagem('Canal do desktop indisponível.'); return; }
    setOcupado(true); setMensagem('');
    try { const novo = await operacao(c); setEstado(novo); setMensagem(sucesso); }
    catch (erro) { setMensagem(erro instanceof Error ? erro.message : 'Operação falhou'); }
    finally { setOcupado(false); }
  };

  if (!desktop || !canalPronto) return <section className="card detail-card"><h2>Integração API</h2><p>Esta configuração pertence à instalação desktop. Abra o Hub no aplicativo para cadastrar a chave e consultar a fila.</p></section>;
  return <section className="card detail-card">
    <div className="detail-head"><div className="card-title"><h2>Integração API</h2><p>Destino e credencial desta instalação.</p></div></div>
    {!estado ? <p>Carregando estado da integração…</p> : <div className="form-campos">
      <label className="campo"><span className="campo-nome">URL da API</span><input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…/public/serverFunction/60689/15/execute" /></label>
      <label className="campo"><span className="campo-nome">ID da instalação</span><input value={id} onChange={e => setId(e.target.value)} placeholder="UUID fornecido pelo administrador" /></label>
      <label className="campo"><span className="campo-nome">Chave da API</span><input type="password" autoComplete="new-password" value={chave} onChange={e => setChave(e.target.value)} placeholder={estado.temChave ? 'Configurada — deixe em branco para manter' : 'Pendente'} /></label>
      <p>Chave: {estado.temChave ? 'configurada' : 'pendente'}. A chave nunca é exibida após salvar.</p>
      <div className="form-acoes">
        <button className="btn tiny" disabled={ocupado} onClick={() => void executar(c => c.salvar({ apiUrl: url.trim(), installationId: id.trim() }), 'Configuração salva.')}>Salvar configuração</button>
        <button className="btn tiny ghost" disabled={ocupado || !chave} onClick={() => void executar(async c => { const r = await c.trocarChave(chave); setChave(''); return r; }, 'Chave substituída.')}>Substituir chave</button>
        <button className="btn tiny ghost" disabled={ocupado || !estado.temChave} onClick={() => void executar(c => c.removerChave(), 'Chave removida.')}>Remover chave</button>
        <button className="btn tiny ghost" disabled={ocupado} onClick={() => void executar(c => c.validar(), 'Campos validados localmente; autenticação não verificada.')}>Validar configuração</button>
        <button className="btn tiny ghost" disabled={ocupado || !estado.temChave || !estado.pendentes} onClick={() => void executar(c => c.enviarPendencias(), 'Tentativa de envio concluída; consulte a fila.')}>Enviar pendências</button>
      </div>
      {mensagem && <p role="status">{mensagem}</p>}
      <p><strong>Envio automático:</strong> ainda não disponível; aguarda adaptadores e homologação.</p>
      <p>Estado: {estado.enviando ? 'Enviando' : estado.temChave && estado.apiUrl && estado.installationId ? 'Configurada' : 'Pendente'} · Última validação local: {data(estado.ultimaValidacao)} · Último envio: {data(estado.ultimoEnvio)}</p>
      <p>Fila: {estado.pendentes} pendentes · {estado.rejeitados} rejeitados · Próxima tentativa: {data(estado.proximaTentativa)}</p>
      {estado.ultimoErro && <p role="alert">Último erro: {estado.ultimoErro}</p>}
      {estado.eventos.length > 0 && <ul>{estado.eventos.map(e => <li key={e.id}>{e.id} · {e.tipo} · {e.estado} · {e.tentativas} tentativas {e.erro && `· ${e.erro}`}</li>)}</ul>}
    </div>}
  </section>;
}
