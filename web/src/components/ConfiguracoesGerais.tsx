/**
 * Configuracao de envio de e-mail — do hub inteiro, nao de um cliente.
 *
 * Morava dentro do cartao do cliente, onde dava a impressao de ser por cliente: SMTP,
 * assinatura e contatos fixos sempre foram os mesmos para todos os envios, e reabrir o
 * mesmo formulario a cada cliente so' cansava. Aqui e' uma aba, aberta direto.
 */
import { useEffect, useState } from 'react';
import { useEmailConfig } from '../hooks/useEmailConfig.ts';
import type { Avisar } from '../hooks/useToasts.ts';
import { CampoTexto } from './CampoTexto.tsx';

export function PainelConfiguracoes({ toast }: { toast: Avisar }) {
  const config = useEmailConfig(toast);

  return (
    <div className="painel-config">
      <header className="painel-config-head">
        <h2>Configurações</h2>
        <p>Valem para o hub inteiro — não são por cliente.</p>
      </header>
      {config.carregando ? <p className="detail-empty">Carregando configuração…</p> : <Formulario config={config} />}
    </div>
  );
}

function Formulario({ config }: { config: ReturnType<typeof useEmailConfig> }) {
  const [host, setHost] = useState(config.config.smtpHost);
  const [porta, setPorta] = useState(String(config.config.smtpPorta));
  const [usuario, setUsuario] = useState(config.config.smtpUsuario);
  const [remetente, setRemetente] = useState(config.config.smtpRemetente);
  const [senha, setSenha] = useState('');
  const [assinatura, setAssinatura] = useState(config.config.assinatura);
  const [liderNome, setLiderNome] = useState(config.config.liderImediato.nome);
  const [liderEmail, setLiderEmail] = useState(config.config.liderImediato.email);
  const [orcamentoNome, setOrcamentoNome] = useState(config.config.responsavelOrcamento.nome);
  const [orcamentoEmail, setOrcamentoEmail] = useState(config.config.responsavelOrcamento.email);
  const [resumoAtivo, setResumoAtivo] = useState(config.config.resumoAnotacoes.ativo);
  const [resumoHora, setResumoHora] = useState(config.config.resumoAnotacoes.hora);

  // A visão recarregada traz o que está gravado; sem isto o rascunho ficaria mostrando
  // o que já foi salvo com sucesso, escondendo a confirmação.
  useEffect(() => {
    setHost(config.config.smtpHost);
    setPorta(String(config.config.smtpPorta));
    setUsuario(config.config.smtpUsuario);
    setRemetente(config.config.smtpRemetente);
    setSenha('');
    setAssinatura(config.config.assinatura);
    setLiderNome(config.config.liderImediato.nome);
    setLiderEmail(config.config.liderImediato.email);
    setOrcamentoNome(config.config.responsavelOrcamento.nome);
    setOrcamentoEmail(config.config.responsavelOrcamento.email);
    setResumoAtivo(config.config.resumoAnotacoes.ativo);
    setResumoHora(config.config.resumoAnotacoes.hora);
  }, [config.config]);

  const salvar = () =>
    void config.salvar(
      {
        smtpHost: host,
        smtpPorta: Number(porta) || 465,
        smtpUsuario: usuario,
        smtpRemetente: remetente,
        assinatura,
        liderImediato: { nome: liderNome, email: liderEmail },
        responsavelOrcamento: { nome: orcamentoNome, email: orcamentoEmail },
        resumoAnotacoes: { ativo: resumoAtivo, hora: resumoHora },
      },
      senha === '' ? undefined : senha,
    );

  return (
    <section className="card detail-card">
      <div className="detail-head">
        <div className="card-title">
          <h2>Envio de e-mail</h2>
          <p>SMTP do Gmail, assinatura e os contatos fixos que entram em todo envio.</p>
        </div>
        <span className="painel-nota">
          {config.config.temSenha ? `configurado (${config.config.smtpUsuario})` : 'ainda não configurado'}
        </span>
      </div>

      {(
        <div className="form-campos">
          <CampoTexto rotulo="Host SMTP" valor={host} aoMudar={setHost} />
          <CampoTexto rotulo="Porta" valor={porta} aoMudar={setPorta} tipo="number" />
          <CampoTexto rotulo="Usuário (e-mail Gmail)" valor={usuario} aoMudar={setUsuario} />
          <CampoTexto rotulo="Nome do remetente" valor={remetente} aoMudar={setRemetente} />
          <CampoTexto
            rotulo="Senha de app do Gmail"
            valor={senha}
            aoMudar={setSenha}
            tipo="password"
            dica={
              config.config.temSenha
                ? 'Guardada — deixe em branco para manter a atual.'
                : 'Gere em myaccount.google.com/apppasswords — exige verificação em 2 etapas ativa. Nunca a senha normal da conta.'
            }
          />

          <div className="campo">
            <label className="campo-nome" htmlFor="email-config-assinatura">Assinatura</label>
            <textarea
              id="email-config-assinatura"
              rows={4}
              value={assinatura}
              onChange={(e) => setAssinatura(e.target.value)}
            />
            <small className="campo-dica">
              Texto simples, anexado ao final de todo e-mail enviado — não é a assinatura de
              verdade da conta Gmail (SMTP com senha de app não tem acesso a ela).
            </small>
          </div>

          <p className="campo-dica">Contatos fixos — entram em todo envio, de qualquer cliente.</p>
          <CampoTexto rotulo="Líder imediato — nome" valor={liderNome} aoMudar={setLiderNome} />
          <CampoTexto rotulo="Líder imediato — e-mail" valor={liderEmail} aoMudar={setLiderEmail} />
          <CampoTexto rotulo="Responsável pelo orçamento — nome" valor={orcamentoNome} aoMudar={setOrcamentoNome} />
          <CampoTexto rotulo="Responsável pelo orçamento — e-mail" valor={orcamentoEmail} aoMudar={setOrcamentoEmail} />

          {/* O resumo vai para o PRÓPRIO endereço do SMTP, não para os contatos acima:
              é lembrete de quem usa o hub, não comunicação com o cliente. */}
          <div className="campo campo-resumo-anotacoes">
            <label className="campo-nome">Resumo diário das anotações</label>
            <label className="anotacoes-avisar">
              <input
                type="checkbox"
                checked={resumoAtivo}
                onChange={(event) => setResumoAtivo(event.target.checked)}
              />
              <span>
                Enviar um e-mail por dia para {config.config.smtpUsuario || 'o e-mail configurado acima'}
                <small>Só os clientes com “Ativar notificações” marcado no cartão.</small>
              </span>
            </label>
            <input
              type="time"
              className="campo-hora"
              value={resumoHora}
              disabled={!resumoAtivo}
              onChange={(event) => setResumoHora(event.target.value)}
            />
          </div>

          <div className="form-acoes">
            <button
              className="btn tiny ghost"
              type="button"
              disabled={config.ocupado}
              onClick={() => void config.testar()}
            >
              Testar conexão
            </button>
            <button
              className="btn tiny ghost"
              type="button"
              disabled={config.ocupado}
              onClick={() => void config.testarResumo()}
            >
              Enviar resumo agora
            </button>
            <span className="modal-acoes-spacer" />
            <button className="btn tiny" type="button" disabled={config.ocupado} onClick={salvar}>
              Salvar configuração
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
