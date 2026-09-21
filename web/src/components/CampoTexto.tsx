/**
 * Campo de texto com rotulo — usado pela configuracao de e-mail e pelo formulario de
 * envio. Mora fora dos dois porque a configuracao saiu do cartao do cliente e virou
 * aba propria; deixar a definicao num deles faria o outro importar tela de tela.
 */
export function CampoTexto({
  rotulo,
  valor,
  aoMudar,
  tipo = 'text',
  dica,
}: {
  rotulo: string;
  valor: string;
  aoMudar: (valor: string) => void;
  tipo?: string;
  dica?: string;
}) {
  const id = `email-config-${rotulo.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className="campo">
      <label className="campo-nome" htmlFor={id}>{rotulo}</label>
      <input
        id={id}
        type={tipo}
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
      {dica && <small className="campo-dica">{dica}</small>}
    </div>
  );
}
