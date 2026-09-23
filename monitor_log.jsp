<%@ page language="java" contentType="text/html; charset=UTF-8" pageEncoding="UTF-8" isELIgnored="true"%>
<%@ page import="java.util.*,java.util.regex.*,java.text.*,java.io.*,java.nio.charset.*"%>
<%!
/* =========================================================================
   Monitor de Log WildFly - pesquisa server-side, sem baixar o log.
   Le direto de jboss.server.log.dir dentro da propria JVM do WildFly.
   Arquivos de 200 MB sao varridos por streaming; nada e carregado inteiro.
   ========================================================================= */

private static final String SAL       = "queaforcaestejacomvoce";
private static final String SENHA_H2  = "1bebf67e2b2059ff4c4f8fe66883f680458f095b166bdb110e97cef157c355d7";

private static final String ENC_LOG   = "ISO-8859-1";   // file.encoding do WildFly
private static final long   MAX_MS    = 25000L;         // teto de tempo por busca
private static final int    MAX_LIM   = 5000;           // teto de resultados
private static final int    MAX_MSG   = 8000;           // truncagem da mensagem
private static final int    MAX_CONT  = 300;            // linhas de stacktrace por entrada
private static final long   JAN_CTX   = 131072L;        // janela p/ contexto (128 KB)

private static final Pattern P_CAB = Pattern.compile(
    "^(\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}),(\\d{3}) +([A-Z]+) +(?:\\[([^\\]]*)\\] *)?(?:\\(([^)]*)\\) *)?(.*)$");
private static final Pattern P_ARQ_DATA = Pattern.compile(".*\\.(\\d{4}-\\d{2}-\\d{2})$");

/* ----------------------------------------------------------- utilitarios */

private static String je(String s) {
    if (s == null) return "";
    StringBuilder sb = new StringBuilder(s.length() + 16);
    for (int i = 0; i < s.length(); i++) {
        char c = s.charAt(i);
        switch (c) {
            case '\\': sb.append("\\\\"); break;
            case '"' : sb.append("\\\""); break;
            case '\n': sb.append("\\n");  break;
            case '\r': sb.append("\\r");  break;
            case '\t': sb.append("\\t");  break;
            default:
                if (c < 0x20 || c == 0x7f) sb.append(String.format("\\u%04x", (int) c));
                else sb.append(c);
        }
    }
    return sb.toString();
}

private static String erro(String msg) { return "{\"ok\":false,\"erro\":\"" + je(msg) + "\"}"; }

private static String fmtTam(long b) {
    if (b < 1024) return b + " B";
    if (b < 1048576) return String.format("%.1f KB", b / 1024.0);
    if (b < 1073741824L) return String.format("%.1f MB", b / 1048576.0);
    return String.format("%.2f GB", b / 1073741824.0);
}

private static String fmtDt(long ms) {
    return new SimpleDateFormat("dd/MM/yyyy HH:mm:ss").format(new Date(ms));
}

/** Aceita "yyyy-MM-ddTHH:mm", "yyyy-MM-dd HH:mm[:ss]" e "yyyy-MM-dd". Retorna -1 se vazio. */
private static long parseData(String s, boolean fimDoDia) {
    if (s == null) return -1L;
    s = s.trim().replace('T', ' ');
    if (s.isEmpty()) return -1L;
    String[] fmts = { "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd HH:mm", "yyyy-MM-dd" };
    for (String f : fmts) {
        if (s.length() < f.length()) continue;
        try {
            SimpleDateFormat sdf = new SimpleDateFormat(f);
            sdf.setLenient(false);
            Date d = sdf.parse(s.substring(0, f.length()));
            long t = d.getTime();
            if (fimDoDia) {
                if (f.equals("yyyy-MM-dd")) t += 86399999L;
                else if (f.equals("yyyy-MM-dd HH:mm")) t += 59999L;
                else t += 999L;
            }
            return t;
        } catch (Exception e) { /* tenta o proximo */ }
    }
    return -1L;
}

private static long tsMillis(String data, String milis) {
    try {
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
        sdf.setLenient(false);
        return sdf.parse(data).getTime() + Long.parseLong(milis);
    } catch (Exception e) { return -1L; }
}

/** Erro com stack, para nao virar HTTP 500 opaco dentro do gadget. */
private static String erroTrace(Throwable t) {
    StringBuilder sb = new StringBuilder();
    sb.append(t.getClass().getName());
    if (t.getMessage() != null) sb.append(": ").append(t.getMessage());
    StackTraceElement[] st = t.getStackTrace();
    for (int i = 0; i < Math.min(12, st.length); i++) sb.append("\n    at ").append(st[i].toString());
    Throwable c = t.getCause();
    if (c != null && c != t) {
        sb.append("\nCaused by: ").append(c.getClass().getName());
        if (c.getMessage() != null) sb.append(": ").append(c.getMessage());
        StackTraceElement[] cs = c.getStackTrace();
        for (int i = 0; i < Math.min(8, cs.length); i++) sb.append("\n    at ").append(cs[i].toString());
    }
    return "{\"ok\":false,\"erro\":\"" + je(sb.toString()) + "\"}";
}

/* --------------------------------------------------------- raiz dos logs */

private static String raizPadrao() {
    String d = System.getProperty("jboss.server.log.dir");
    if (d == null || d.trim().isEmpty()) {
        String b = System.getProperty("jboss.server.base.dir");
        if (b != null && !b.trim().isEmpty()) d = b + File.separator + "log";
    }
    if (d == null || d.trim().isEmpty()) d = "/opt/wildfly_producao/standalone/log";
    return d;
}

/** Caminhos plausiveis de pasta de log, para diagnostico quando a raiz vem errada. */
private static List<String> candidatos() {
    LinkedHashSet<String> c = new LinkedHashSet<String>();
    String[] props = { "jboss.server.log.dir", "jboss.server.base.dir", "jboss.home.dir", "user.dir" };
    for (String pr : props) {
        String v = System.getProperty(pr);
        if (v == null || v.trim().isEmpty()) continue;
        v = v.trim();
        if (pr.endsWith("log.dir")) c.add(v);
        else if (pr.equals("jboss.server.base.dir")) c.add(v + "/log");
        else if (pr.equals("jboss.home.dir")) { c.add(v + "/standalone/log"); c.add(v + "/domain/log"); }
        else c.add(v + "/log");
    }
    String[] bases = { "/opt", "/home", "/srv", "/usr/local", "/dados", "/app" };
    for (String b : bases) {
        File d = new File(b);
        File[] fs = d.listFiles();
        if (fs == null) continue;
        for (File f1 : fs) {
            if (!f1.isDirectory()) continue;
            c.add(f1.getAbsolutePath() + "/standalone/log");
            File[] fs2 = f1.listFiles();
            if (fs2 == null) continue;
            for (File f2 : fs2) {
                if (!f2.isDirectory()) continue;
                String n = f2.getName().toLowerCase();
                if (n.contains("wildfly") || n.contains("jboss") || n.contains("sankhya") || n.contains("standalone"))
                    c.add(f2.getAbsolutePath() + "/standalone/log");
            }
        }
    }
    // so devolve o que existe de fato; caminhos vindos de propriedade ficam sempre na lista
    List<String> fim = new ArrayList<String>();
    for (String cx : c) if (new File(cx).isDirectory()) fim.add(cx);
    for (String pr : props) {
        String v = System.getProperty(pr);
        if (v == null || v.trim().isEmpty()) continue;
        String cx = pr.endsWith("log.dir") ? v.trim() : v.trim() + "/log";
        if (!fim.contains(cx)) fim.add(cx);
    }
    return fim;
}

private static File raiz(javax.servlet.http.HttpSession s) {
    Object v = (s != null) ? s.getAttribute("mlog_raiz") : null;
    String p = (v != null && !v.toString().trim().isEmpty()) ? v.toString().trim() : raizPadrao();
    try { return new File(p).getCanonicalFile(); } catch (Exception e) { return new File(p).getAbsoluteFile(); }
}

/** Resolve caminho relativo dentro da raiz. Bloqueia traversal e symlink pra fora. */
private static File dentro(File raizDir, String rel) {
    try {
        if (rel == null) rel = "";
        rel = rel.trim().replace('\\', '/');
        while (rel.startsWith("/")) rel = rel.substring(1);
        File alvo = (rel.isEmpty() ? raizDir : new File(raizDir, rel)).getCanonicalFile();
        String r = raizDir.getCanonicalPath();
        String a = alvo.getCanonicalPath();
        if (!a.equals(r) && !a.startsWith(r + File.separator)) return null;
        return alvo;
    } catch (Exception e) { return null; }
}

/* ------------------------------------------------- leitor de linhas cru */

/** Le linhas em ISO-8859-1 controlando o offset em bytes (para ancorar contexto). */
private static class Leitor implements Closeable {
    private static final int MAX_LINHA = 1 << 20;   // 1 MB por linha, o resto e descartado
    private final FileInputStream fis;
    private final byte[] buf = new byte[1 << 16];
    private byte[] linha = new byte[8192];
    private int lim = 0, idx = 0;
    private long pos;

    Leitor(File f, long inicio) throws IOException {
        fis = new FileInputStream(f);
        long pulado = 0;
        while (pulado < inicio) {
            long n = fis.skip(inicio - pulado);
            if (n <= 0) break;
            pulado += n;
        }
        this.pos = pulado;
    }

    long pos() { return pos; }

    private boolean encher() throws IOException {
        lim = fis.read(buf);
        idx = 0;
        return lim > 0;
    }

    /** Le uma linha varrendo o buffer em bloco (bem mais rapido que read() byte a byte). */
    String linha() throws IOException {
        int n = 0; boolean leu = false;
        while (true) {
            if (idx >= lim) { if (!encher()) break; }
            leu = true;
            int i = idx;
            while (i < lim && buf[i] != (byte) '\n') i++;
            int qtd = i - idx;
            if (n + qtd <= MAX_LINHA) {
                if (n + qtd > linha.length) linha = Arrays.copyOf(linha, Math.max(linha.length * 2, n + qtd + 1024));
                System.arraycopy(buf, idx, linha, n, qtd);
                n += qtd;
            }
            pos += qtd; idx = i;
            if (i < lim) { idx++; pos++; break; }   // consumiu o \n
        }
        if (!leu && n == 0) return null;
        int fim = n;
        if (fim > 0 && linha[fim - 1] == (byte) '\r') fim--;
        return new String(linha, 0, fim, ENC_LOG);
    }

    public void close() { try { fis.close(); } catch (Exception e) {} }
}

/** Primeiro cabecalho de log a partir de um offset. Retorna {offsetDaLinha, tsMillis} ou null. */
private static long[] proximoCab(File f, long de) throws IOException {
    Leitor l = null;
    try {
        l = new Leitor(f, de);
        if (de > 0) l.linha();                 // descarta linha parcial
        long limite = l.pos() + (4L << 20);    // no maximo 4 MB procurando cabecalho
        while (l.pos() < limite) {
            long antes = l.pos();
            String s = l.linha();
            if (s == null) return null;
            Matcher m = P_CAB.matcher(s);
            if (m.matches()) {
                long t = tsMillis(m.group(1), m.group(2));
                if (t > 0) return new long[] { antes, t };
            }
        }
        return null;
    } finally { if (l != null) l.close(); }
}

/** Busca binaria: offset da primeira entrada com ts >= alvo. */
private static long offsetPorData(File f, long alvo) throws IOException {
    long len = f.length();
    if (alvo <= 0 || len == 0) return 0L;
    long lo = 0, hi = len, resp = -1;
    while (lo < hi) {
        long mid = lo + (hi - lo) / 2;
        long[] r = proximoCab(f, mid);
        if (r == null) { hi = mid; continue; }
        if (r[1] >= alvo) { resp = r[0]; hi = mid; }
        else { lo = Math.max(mid + 1, r[0] + 1); }
    }
    if (resp >= 0) return resp;
    long[] pri = proximoCab(f, 0);
    return (pri == null) ? 0L : len;   // sem cabecalho: varre tudo; com: tudo e anterior ao alvo
}

/* ------------------------------------------------------------- filtragem */

private static class Filtro {
    String modo = "contem";        // contem | todas | qualquer | regex
    String campo = "tudo";         // tudo | msg | logger | thread
    String[] termos = new String[0];
    Pattern regex;
    boolean ic = true;             // ignorar maiusculas/minusculas
    Set<String> niveis = new HashSet<String>();
    long tIni = -1, tFim = -1;

    boolean temTexto() { return regex != null || termos.length > 0; }

    boolean casa(String nivel, String logger, String thread, String msg) {
        if (!niveis.isEmpty() && (nivel == null || !niveis.contains(nivel))) return false;
        if (!temTexto()) return true;

        String alvo;
        if ("msg".equals(campo))         alvo = (msg == null ? "" : msg);
        else if ("logger".equals(campo)) alvo = (logger == null ? "" : logger);
        else if ("thread".equals(campo)) alvo = (thread == null ? "" : thread);
        else alvo = (nivel == null ? "" : nivel) + " [" + (logger == null ? "" : logger) + "] ("
                  + (thread == null ? "" : thread) + ") " + (msg == null ? "" : msg);

        if (regex != null) return regex.matcher(alvo).find();

        String cmp = ic ? alvo.toLowerCase() : alvo;
        if ("qualquer".equals(modo)) {
            for (String t : termos) if (!t.isEmpty() && cmp.contains(t)) return true;
            return false;
        }
        for (String t : termos) if (!t.isEmpty() && !cmp.contains(t)) return false;
        return true;
    }
}

private static Filtro montarFiltro(javax.servlet.http.HttpServletRequest req) throws Exception {
    Filtro f = new Filtro();
    String texto = req.getParameter("texto");
    String b64 = req.getParameter("textoB64");
    if (!vazio(b64)) {
        try { texto = new String(b64dec(b64.trim()), "UTF-8"); }
        catch (Throwable t) { /* mantem o texto simples */ }
    }
    f.modo  = vazio(req.getParameter("modo"))  ? "contem" : req.getParameter("modo").trim();
    f.campo = vazio(req.getParameter("campo")) ? "tudo"   : req.getParameter("campo").trim();
    f.ic    = !"0".equals(req.getParameter("ic"));

    if (!vazio(texto)) {
        if ("regex".equals(f.modo)) {
            f.regex = Pattern.compile(texto, f.ic ? (Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE) : 0);
        } else if ("contem".equals(f.modo)) {
            f.termos = new String[] { f.ic ? texto.toLowerCase() : texto };
        } else {
            String[] ps = texto.trim().split("\\s+");
            List<String> l = new ArrayList<String>();
            for (String p : ps) if (!p.isEmpty()) l.add(f.ic ? p.toLowerCase() : p);
            f.termos = l.toArray(new String[0]);
        }
    }
    String nv = req.getParameter("niveis");
    if (!vazio(nv)) for (String n : nv.split(",")) if (!n.trim().isEmpty()) f.niveis.add(n.trim().toUpperCase());

    f.tIni = parseData(req.getParameter("dtIni"), false);
    f.tFim = parseData(req.getParameter("dtFim"), true);
    return f;
}

private static boolean vazio(String s) { return s == null || s.trim().isEmpty(); }

/** Base64 na mao: java.util.Base64 e Java 8+ e javax.xml.bind some no Java 11. */
private static byte[] b64dec(String s) {
    String tab = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    ByteArrayOutputStream bo = new ByteArrayOutputStream();
    int acc = 0, bits = 0;
    for (int i = 0; i < s.length(); i++) {
        char c = s.charAt(i);
        if (c == '=' ) break;
        int v = tab.indexOf(c);
        if (v < 0) continue;
        acc = (acc << 6) | v; bits += 6;
        if (bits >= 8) { bits -= 8; bo.write((acc >> bits) & 0xff); }
    }
    return bo.toByteArray();
}

/* ----------------------------------------------------------- entrada JSON */

private static String entradaJson(String arq, long off, String ts, String nivel, String logger,
                                  String thread, String msg, int contLinhas, boolean trunc) {
    return "{\"arq\":\"" + je(arq) + "\",\"off\":" + off
         + ",\"ts\":\"" + je(ts) + "\",\"nv\":\"" + je(nivel) + "\""
         + ",\"lg\":\"" + je(logger) + "\",\"th\":\"" + je(thread) + "\""
         + ",\"cont\":" + contLinhas + ",\"trunc\":" + trunc
         + ",\"msg\":\"" + je(msg) + "\"}";
}

/* -------------------------------------------------------------- varredura */

/** Resultado agregado de uma varredura. */
private static class Resultado {
    List<String> itens = new ArrayList<String>();   // sempre em ordem cronologica crescente
    long lidos = 0, achados = 0;
    boolean parcial = false, estourouTempo = false;
    Map<String,int[]> porNivel = new LinkedHashMap<String,int[]>();
    Map<String,int[]> porLogger = new HashMap<String,int[]>();

    void conta(String nivel, String logger) {
        int[] a = porNivel.get(nivel); if (a == null) { a = new int[1]; porNivel.put(nivel, a); } a[0]++;
        int[] b = porLogger.get(logger); if (b == null) { b = new int[1]; porLogger.put(logger, b); } b[0]++;
    }
}

/** Offset do primeiro cabecalho a partir de base (para nao cortar uma entrada no meio). */
private static long alinhar(File f, long base) throws IOException {
    if (base <= 0) return 0L;
    long[] r = proximoCab(f, base);
    return (r == null) ? f.length() : r[0];
}

/**
 * Varre um arquivo aplicando o filtro.
 *
 * Ordem decrescente (mais recentes primeiro) varre de tras pra frente, em janelas
 * que dobram de tamanho: num server.log de 13 GB os ultimos minutos saem na hora,
 * em vez de estourar o tempo ainda no comeco do arquivo e devolver o log mais antigo.
 * Linhas sem cabecalho (stacktrace) sao anexadas a entrada anterior, entao um
 * "Caused by" tambem e encontravel.
 */
private static void varrer(File f, String nomeExibido, Filtro filtro, int limite, boolean desc,
                           long deadline, Resultado res) throws IOException {
    long len = f.length();
    long ini = (filtro.tIni > 0) ? offsetPorData(f, filtro.tIni) : 0L;
    long fim = (filtro.tFim > 0) ? offsetPorData(f, filtro.tFim + 1L) : len;
    if (fim > len) fim = len;
    if (fim <= ini) return;

    if (!desc) {
        List<String> saida = new ArrayList<String>();
        varrerJanela(f, nomeExibido, filtro, limite, deadline, res, ini, fim, saida, false);
        res.itens.addAll(saida);
        if (res.itens.size() >= limite) res.parcial = true;
        return;
    }

    long janela = 64L << 20;                 // 64 MB, dobrando ate 1 GB
    long topo = fim;
    while (topo > ini && res.itens.size() < limite) {
        if (System.currentTimeMillis() > deadline) { res.parcial = true; res.estourouTempo = true; break; }
        long base = Math.max(ini, topo - janela);
        long alvo = (base > ini) ? alinhar(f, base) : ini;
        if (alvo >= topo) { topo = base; janela = Math.min(janela * 2, 1L << 30); continue; }

        List<String> chunk = new ArrayList<String>();
        varrerJanela(f, nomeExibido, filtro, limite, deadline, res, alvo, topo, chunk, true);
        res.itens.addAll(0, chunk);
        while (res.itens.size() > limite) { res.itens.remove(0); res.parcial = true; }
        topo = alvo;
        janela = Math.min(janela * 2, 1L << 30);
    }
    if (topo > ini) res.parcial = true;      // sobrou log mais antigo sem varrer
}

/**
 * Varre [ini, fim) e devolve os casamentos em ordem cronologica crescente.
 * Com manterUltimos, guarda so os `limite` ultimos da janela (os mais recentes).
 */
private static void varrerJanela(File f, String nomeExibido, Filtro filtro, int limite, long deadline,
                                 Resultado res, long ini, long fim, List<String> saida,
                                 boolean manterUltimos) throws IOException {
    Leitor l = null;
    ArrayDeque<String> ring = manterUltimos ? new ArrayDeque<String>() : null;
    try {
        l = new Leitor(f, ini);
        long offAtual = -1, tsAtual = -1;
        String ts = null, nivel = null, logger = null, thread = null;
        StringBuilder msg = null;
        int cont = 0; boolean trunc = false;
        int check = 0;

        while (true) {
            if ((++check & 0x3ff) == 0 && System.currentTimeMillis() > deadline) {
                res.parcial = true; res.estourouTempo = true; break;
            }
            long antes = l.pos();
            String linha = l.linha();
            if (linha == null) {
                if (offAtual >= 0) guardar(res, ring, saida, limite, manterUltimos, nomeExibido,
                                           offAtual, ts, nivel, logger, thread, msg, cont, trunc, filtro);
                break;
            }
            Matcher m = P_CAB.matcher(linha);
            if (m.matches()) {
                if (offAtual >= 0) {
                    if (!guardar(res, ring, saida, limite, manterUltimos, nomeExibido,
                                 offAtual, ts, nivel, logger, thread, msg, cont, trunc, filtro)) {
                        res.parcial = true; offAtual = -1; break;
                    }
                }
                if (antes >= fim) { offAtual = -1; break; }     // saiu da janela
                ts      = m.group(1) + "," + m.group(2);
                tsAtual = tsMillis(m.group(1), m.group(2));
                nivel   = m.group(3);
                logger  = m.group(4) == null ? "" : m.group(4);
                thread  = m.group(5) == null ? "" : m.group(5);
                msg     = new StringBuilder(m.group(6) == null ? "" : m.group(6));
                offAtual = antes; cont = 0; trunc = false;

                if (filtro.tFim > 0 && tsAtual > 0 && tsAtual > filtro.tFim) { offAtual = -1; break; }
                if (filtro.tIni > 0 && tsAtual > 0 && tsAtual < filtro.tIni) { offAtual = -1; }
            } else if (offAtual >= 0) {
                if (cont < MAX_CONT && msg.length() < MAX_MSG * 4) { msg.append('\n').append(linha); cont++; }
                else trunc = true;
            }
            res.lidos += (l.pos() - antes);
        }
    } finally { if (l != null) l.close(); }

    if (ring != null) saida.addAll(ring);
}

/** Testa o filtro e guarda. Retorna false quando a janela ja encheu (so no modo crescente). */
private static boolean guardar(Resultado res, ArrayDeque<String> ring, List<String> saida, int limite,
                               boolean manterUltimos, String arq, long off, String ts, String nivel,
                               String logger, String thread, StringBuilder msgSb, int cont, boolean trunc,
                               Filtro f) {
    String msg = msgSb == null ? "" : msgSb.toString();
    if (!f.casa(nivel, logger, thread, msg)) return true;
    boolean corte = trunc;
    if (msg.length() > MAX_MSG) { msg = msg.substring(0, MAX_MSG); corte = true; }
    res.achados++;
    res.conta(nivel == null ? "?" : nivel, logger == null ? "" : logger);
    String j = entradaJson(arq, off, ts, nivel, logger, thread, msg, cont, corte);
    if (manterUltimos) {
        ring.addLast(j);
        if (ring.size() > limite) ring.removeFirst();
        return true;
    }
    saida.add(j);
    return saida.size() < limite;
}

/* ------------------------------------------------------ selecao de arquivos */

private static List<File> arquivosAlvo(File raizDir, String sub, String param, Filtro f) {
    List<File> out = new ArrayList<File>();
    File base = dentro(raizDir, sub);
    if (base == null || !base.isDirectory()) base = raizDir;

    if (!vazio(param) && !"*".equals(param.trim())) {
        for (String nome : param.split("\\|")) {
            if (nome.trim().isEmpty()) continue;
            File a = dentro(raizDir, nome.trim());
            if (a != null && a.isFile()) out.add(a);
        }
        return out;
    }
    File[] fs = base.listFiles();
    if (fs == null) return out;
    String dIni = null, dFim = null;
    if (f != null && f.tIni > 0) dIni = new SimpleDateFormat("yyyy-MM-dd").format(new Date(f.tIni));
    if (f != null && f.tFim > 0) dFim = new SimpleDateFormat("yyyy-MM-dd").format(new Date(f.tFim));
    for (File a : fs) {
        if (!a.isFile()) continue;
        String n = a.getName();
        if (!(n.contains(".log") || n.endsWith(".txt"))) continue;
        Matcher m = P_ARQ_DATA.matcher(n);
        if (m.matches()) {                                   // server.log.2026-06-24
            String d = m.group(1);
            if (dIni != null && d.compareTo(dIni) < 0) continue;
            if (dFim != null && d.compareTo(dFim) > 0) continue;
        }
        out.add(a);
    }
    Collections.sort(out, new Comparator<File>() {
        public int compare(File a, File b) { return Long.compare(a.lastModified(), b.lastModified()); }
    });
    return out;
}

/** Le de volta um campo string de um JSON de entrada ja montado (uso no export texto). */
private static String extrai(String json, String chave) {
    int i = json.indexOf(chave);
    if (i < 0) return "";
    i += chave.length();
    StringBuilder sb = new StringBuilder();
    for (; i < json.length(); i++) {
        char c = json.charAt(i);
        if (c == '"') break;
        if (c == '\\' && i + 1 < json.length()) {
            char n = json.charAt(++i);
            switch (n) {
                case 'n': sb.append('\n'); break;
                case 'r': sb.append('\r'); break;
                case 't': sb.append('\t'); break;
                case 'u':
                    if (i + 4 < json.length()) {
                        sb.append((char) Integer.parseInt(json.substring(i + 1, i + 5), 16));
                        i += 4;
                    }
                    break;
                default: sb.append(n);
            }
        } else sb.append(c);
    }
    return sb.toString();
}

private static String rel(File raizDir, File f) {
    try {
        String r = raizDir.getCanonicalPath();
        String a = f.getCanonicalPath();
        if (a.startsWith(r + File.separator)) return a.substring(r.length() + 1);
        return f.getName();
    } catch (Exception e) { return f.getName(); }
}
%>
<%
/* Parametros chegam em UTF-8 (o corpo POST do front). Sem isso, acento na busca vem quebrado. */
try { request.setCharacterEncoding("UTF-8"); } catch (Exception _e) {}

/* ------------------------------------------------------------ autenticacao */
boolean _ok = Boolean.TRUE.equals(session.getAttribute("dstech_auth_ok"));
if (!_ok) {
    String _pw = request.getParameter("_p");
    if (_pw != null) {
        try {
            java.security.MessageDigest _md = java.security.MessageDigest.getInstance("SHA-256");
            byte[] _r1 = _md.digest((_pw + SAL).getBytes("UTF-8"));
            StringBuilder _h1 = new StringBuilder();
            for (byte _b : _r1) _h1.append(String.format("%02x", _b & 0xff));
            _md.reset();
            byte[] _r2 = _md.digest((SAL + _h1).getBytes("UTF-8"));
            StringBuilder _h2 = new StringBuilder();
            for (byte _b : _r2) _h2.append(String.format("%02x", _b & 0xff));
            if (SENHA_H2.equals(_h2.toString())) { session.setAttribute("dstech_auth_ok", Boolean.TRUE); _ok = true; }
        } catch (Exception _e) {}
    }
}
if (!_ok) {
    String _a = request.getParameter("action");
    if (_a != null && !_a.isEmpty()) {
        response.setContentType("application/json;charset=UTF-8");
        out.print("{\"ok\":false,\"erro\":\"N\\u00e3o autorizado\"}");
        return;
    }
%><!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Monitor de Log — Autenticação</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#1e1e2e;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:monospace}
.box{background:#2a2a3e;border:1px solid #444;border-radius:8px;padding:36px 40px;width:330px;text-align:center}
h2{color:#cdd6f4;margin-bottom:24px;font-size:1.05rem;letter-spacing:.05em}
input[type=password]{width:100%;padding:10px 12px;background:#1e1e2e;border:1px solid #555;border-radius:4px;color:#cdd6f4;font-size:1rem;margin-bottom:16px;outline:none}
input[type=password]:focus{border-color:#89b4fa}
button{width:100%;padding:10px;background:#89b4fa;border:none;border-radius:4px;color:#1e1e2e;font-size:1rem;font-weight:bold;cursor:pointer}
button:hover{background:#74c7ec}
.erro{color:#f38ba8;font-size:.85rem;margin-top:12px;display:none}
</style>
</head>
<body>
<div class="box">
  <h2>Monitor de Log WildFly</h2>
  <form id="frm">
    <input type="password" id="pw" placeholder="Senha" autofocus autocomplete="current-password">
    <button type="submit">Entrar</button>
    <div class="erro" id="msg">Senha incorreta.</div>
  </form>
</div>
<script>
document.getElementById('frm').addEventListener('submit', function(e){
  e.preventDefault();
  var pw = document.getElementById('pw').value;
  var url = window.location.href.split('#')[0].replace(/[?&]_p=[^&]*/g,'');
  url += (url.indexOf('?') >= 0 ? '&' : '?') + '_p=' + encodeURIComponent(pw);
  window.location.href = url;
});
if (window.location.search.indexOf('_p=') !== -1) document.getElementById('msg').style.display='block';
</script>
</body>
</html>
<%
    return;
}
/* -------------------------------------------------------------- dispatcher */
String acao = request.getParameter("action");
File RAIZ = null;
try {
RAIZ = raiz(session);

if ("diag".equals(acao)) {
    response.setContentType("application/json;charset=UTF-8");
    StringBuilder sb = new StringBuilder("{\"ok\":true,\"props\":{");
    String[] pr = { "jboss.server.log.dir", "jboss.server.base.dir", "jboss.home.dir", "jboss.server.name",
                    "user.dir", "user.name", "file.encoding", "java.version", "os.name" };
    for (int i = 0; i < pr.length; i++) {
        if (i > 0) sb.append(",");
        sb.append("\"").append(je(pr[i])).append("\":\"").append(je(String.valueOf(System.getProperty(pr[i])))).append("\"");
    }
    sb.append("},\"raizAtual\":\"").append(je(RAIZ.getAbsolutePath())).append("\"");
    File[] fsr = RAIZ.listFiles();
    sb.append(",\"raizExiste\":").append(RAIZ.isDirectory())
      .append(",\"raizLegivel\":").append(RAIZ.canRead())
      .append(",\"raizArquivos\":").append(fsr == null ? -1 : fsr.length)
      .append(",\"candidatos\":[");
    List<String> cs = candidatos();
    boolean pri1 = true;
    for (String cx : cs) {
        File d = new File(cx);
        File[] fs = d.listFiles();
        int n = 0; String amostra = "";
        if (fs != null) {
            for (File a : fs) if (a.isFile() && a.getName().contains(".log")) { n++; if (amostra.isEmpty()) amostra = a.getName(); }
        }
        if (!pri1) sb.append(","); pri1 = false;
        sb.append("{\"caminho\":\"").append(je(cx)).append("\",\"existe\":").append(d.isDirectory())
          .append(",\"legivel\":").append(d.canRead()).append(",\"logs\":").append(n)
          .append(",\"amostra\":\"").append(je(amostra)).append("\"}");
    }
    sb.append("]}");
    out.print(sb.toString());
    return;
}

if ("raiz".equals(acao)) {
    response.setContentType("application/json;charset=UTF-8");
    String cam = request.getParameter("caminho");
    if (vazio(cam)) { session.removeAttribute("mlog_raiz"); out.print("{\"ok\":true,\"raiz\":\"" + je(raizPadrao()) + "\"}"); return; }
    File nova = new File(cam.trim());
    if (!nova.isDirectory() || !nova.canRead()) { out.print(erro("Diretorio inexistente ou sem leitura")); return; }
    session.setAttribute("mlog_raiz", nova.getAbsolutePath());
    out.print("{\"ok\":true,\"raiz\":\"" + je(nova.getAbsolutePath()) + "\"}");
    return;
}

if ("arquivos".equals(acao)) {
    response.setContentType("application/json;charset=UTF-8");
    String sub = request.getParameter("sub");
    File base = dentro(RAIZ, sub);
    if (base == null || !base.isDirectory()) { out.print(erro("Pasta fora da raiz de logs")); return; }
    File[] fs = base.listFiles();
    List<String> dirs = new ArrayList<String>(), arqs = new ArrayList<String>();
    if (fs != null) {
        Arrays.sort(fs, new Comparator<File>() {
            public int compare(File a, File b) { return Long.compare(b.lastModified(), a.lastModified()); }
        });
        for (File a : fs) {
            String r = rel(RAIZ, a);
            if (a.isDirectory()) {
                dirs.add("{\"nome\":\"" + je(a.getName()) + "\",\"rel\":\"" + je(r) + "\"}");
            } else {
                arqs.add("{\"nome\":\"" + je(a.getName()) + "\",\"rel\":\"" + je(r) + "\""
                    + ",\"bytes\":" + a.length() + ",\"tam\":\"" + je(fmtTam(a.length())) + "\""
                    + ",\"modMs\":" + a.lastModified() + ",\"mod\":\"" + je(fmtDt(a.lastModified())) + "\"}");
            }
        }
    }
    StringBuilder sb = new StringBuilder("{\"ok\":true,\"raiz\":\"" + je(RAIZ.getAbsolutePath()) + "\"");
    sb.append(",\"sub\":\"").append(je(vazio(sub) ? "" : sub.trim())).append("\",\"pastas\":[");
    for (int i = 0; i < dirs.size(); i++) { if (i > 0) sb.append(","); sb.append(dirs.get(i)); }
    sb.append("],\"arquivos\":[");
    for (int i = 0; i < arqs.size(); i++) { if (i > 0) sb.append(","); sb.append(arqs.get(i)); }
    sb.append("]}");
    out.print(sb.toString());
    return;
}

if ("buscar".equals(acao) || "exportar".equals(acao)) {
    boolean exportar = "exportar".equals(acao);
    if (!exportar) response.setContentType("application/json;charset=UTF-8");
    try {
        Filtro f = montarFiltro(request);
        int limite = 300;
        try { limite = Integer.parseInt(request.getParameter("limite")); } catch (Exception e) {}
        if (limite < 1) limite = 1;
        if (limite > MAX_LIM) limite = MAX_LIM;
        boolean desc = !"asc".equals(request.getParameter("ordem"));
        long maxMs = MAX_MS;
        try { maxMs = Math.min(60000L, Long.parseLong(request.getParameter("maxMs"))); } catch (Exception e) {}

        List<File> alvos = arquivosAlvo(RAIZ, request.getParameter("sub"), request.getParameter("arq"), f);
        if (alvos.isEmpty()) {
            if (exportar) { response.setContentType("text/plain;charset=UTF-8"); out.print("Nenhum arquivo selecionado."); return; }
            out.print(erro("Nenhum arquivo de log corresponde a selecao/periodo")); return;
        }
        long t0 = System.currentTimeMillis(), deadline = t0 + maxMs;
        Resultado res = new Resultado();
        long lidosTotal = 0; int nArq = 0;
        List<File> ordem = new ArrayList<File>(alvos);
        if (desc) Collections.reverse(ordem);   // mais recentes primeiro
        List<String> itens = new ArrayList<String>();   // ja na ordem de exibicao
        for (File a : ordem) {
            if (System.currentTimeMillis() > deadline) { res.parcial = true; res.estourouTempo = true; break; }
            if (itens.size() >= limite) { res.parcial = true; break; }
            res.itens = new ArrayList<String>();
            varrer(a, rel(RAIZ, a), f, limite - itens.size(), desc, deadline, res);
            List<String> parc = new ArrayList<String>(res.itens);
            if (desc) Collections.reverse(parc);        // dentro do arquivo, recentes primeiro
            itens.addAll(parc);
            lidosTotal += res.lidos; res.lidos = 0; nArq++;
        }
        if (itens.size() > limite) itens = new ArrayList<String>(itens.subList(0, limite));
        if (res.achados > itens.size()) res.parcial = true;

        if (exportar) {
            response.setContentType("text/plain;charset=UTF-8");
            response.setHeader("Content-Disposition", "attachment; filename=\"log-filtrado.txt\"");
            out.print("# Monitor de Log WildFly - resultado filtrado\r\n");
            out.print("# gerado em " + fmtDt(System.currentTimeMillis()) + " | " + itens.size() + " entrada(s)\r\n\r\n");
            for (String j : itens) {
                String ts = extrai(j, "\"ts\":\""), nv = extrai(j, "\"nv\":\""), lg = extrai(j, "\"lg\":\"");
                String th = extrai(j, "\"th\":\""), ms = extrai(j, "\"msg\":\"");
                out.print(ts + " " + nv + " [" + lg + "] (" + th + ") " + ms.replace("\\n", "\r\n") + "\r\n");
            }
            return;
        }

        StringBuilder sb = new StringBuilder(256 + itens.size() * 256);
        sb.append("{\"ok\":true,\"achados\":").append(res.achados)
          .append(",\"retornados\":").append(itens.size())
          .append(",\"parcial\":").append(res.parcial)
          .append(",\"tempoEsgotado\":").append(res.estourouTempo)
          .append(",\"ms\":").append(System.currentTimeMillis() - t0)
          .append(",\"bytesLidos\":").append(lidosTotal)
          .append(",\"lidoFmt\":\"").append(je(fmtTam(lidosTotal))).append("\"")
          .append(",\"arquivos\":").append(nArq)
          .append(",\"niveis\":{");
        boolean pri = true;
        for (Map.Entry<String,int[]> e : res.porNivel.entrySet()) {
            if (!pri) sb.append(","); pri = false;
            sb.append("\"").append(je(e.getKey())).append("\":").append(e.getValue()[0]);
        }
        sb.append("},\"topLoggers\":[");
        List<Map.Entry<String,int[]>> tops = new ArrayList<Map.Entry<String,int[]>>(res.porLogger.entrySet());
        Collections.sort(tops, new Comparator<Map.Entry<String,int[]>>() {
            public int compare(Map.Entry<String,int[]> a, Map.Entry<String,int[]> b) {
                return Integer.compare(b.getValue()[0], a.getValue()[0]);
            }
        });
        for (int i = 0; i < Math.min(8, tops.size()); i++) {
            if (i > 0) sb.append(",");
            sb.append("{\"lg\":\"").append(je(tops.get(i).getKey())).append("\",\"n\":").append(tops.get(i).getValue()[0]).append("}");
        }
        sb.append("],\"entradas\":[");
        for (int i = 0; i < itens.size(); i++) { if (i > 0) sb.append(","); sb.append(itens.get(i)); }
        sb.append("]}");
        out.print(sb.toString());
    } catch (PatternSyntaxException pe) {
        out.print(erro("Regex invalida: " + pe.getDescription()));
    } catch (Exception e) {
        out.print(erro(e.getClass().getSimpleName() + ": " + e.getMessage()));
    }
    return;
}

if ("contexto".equals(acao)) {
    response.setContentType("application/json;charset=UTF-8");
    try {
        File a = dentro(RAIZ, request.getParameter("arq"));
        if (a == null || !a.isFile()) { out.print(erro("Arquivo fora da raiz de logs")); return; }
        long off = Long.parseLong(request.getParameter("off"));
        int antes = 15, depois = 15;
        try { antes = Math.min(200, Integer.parseInt(request.getParameter("antes"))); } catch (Exception e) {}
        try { depois = Math.min(200, Integer.parseInt(request.getParameter("depois"))); } catch (Exception e) {}

        long ini = Math.max(0, off - JAN_CTX);
        Leitor l = new Leitor(a, ini);
        try {
            if (ini > 0) l.linha();
            List<long[]> offs = new ArrayList<long[]>();
            List<String> linhas = new ArrayList<String>();
            int idxAlvo = -1;
            while (true) {
                long p = l.pos();
                String s = l.linha();
                if (s == null) break;
                if (idxAlvo < 0 && p >= off) idxAlvo = linhas.size();
                linhas.add(s); offs.add(new long[]{p});
                if (idxAlvo >= 0 && linhas.size() - idxAlvo > depois) break;
                if (idxAlvo < 0 && linhas.size() > 20000) { linhas.clear(); offs.clear(); }
            }
            if (idxAlvo < 0) idxAlvo = Math.max(0, linhas.size() - 1);
            int de = Math.max(0, idxAlvo - antes);
            int ate = Math.min(linhas.size(), idxAlvo + depois + 1);
            StringBuilder sb = new StringBuilder("{\"ok\":true,\"arq\":\"" + je(rel(RAIZ, a)) + "\",\"linhas\":[");
            for (int i = de; i < ate; i++) {
                if (i > de) sb.append(",");
                sb.append("{\"off\":").append(offs.get(i)[0])
                  .append(",\"alvo\":").append(i == idxAlvo)
                  .append(",\"txt\":\"").append(je(linhas.get(i))).append("\"}");
            }
            sb.append("]}");
            out.print(sb.toString());
        } finally { l.close(); }
    } catch (Exception e) { out.print(erro(e.getMessage())); }
    return;
}

if ("tail".equals(acao)) {
    response.setContentType("application/json;charset=UTF-8");
    try {
        File a = dentro(RAIZ, request.getParameter("arq"));
        if (a == null || !a.isFile()) { out.print(erro("Arquivo fora da raiz de logs")); return; }
        long len = a.length();
        long desde = -1;
        try { desde = Long.parseLong(request.getParameter("desde")); } catch (Exception e) {}
        int limite = 200;
        try { limite = Math.min(2000, Integer.parseInt(request.getParameter("limite"))); } catch (Exception e) {}

        boolean reiniciou = false;
        long ini;
        if (desde < 0 || desde > len) { ini = Math.max(0, len - 262144L); reiniciou = (desde > len); }
        else ini = desde;
        boolean pularParcial = (desde < 0 || desde > len) && ini > 0;

        Deque<String> ring = new ArrayDeque<String>();
        Leitor l = new Leitor(a, ini);
        try {
            if (pularParcial) l.linha();
            long offAtual = -1; String ts=null,nv=null,lg=null,th=null; StringBuilder msg=null; int cont=0;
            while (l.pos() < len) {
                long p = l.pos();
                String s = l.linha();
                if (s == null) break;
                Matcher m = P_CAB.matcher(s);
                if (m.matches()) {
                    if (offAtual >= 0) {
                        ring.addLast(entradaJson(rel(RAIZ,a), offAtual, ts, nv, lg, th,
                                     msg.length() > MAX_MSG ? msg.substring(0, MAX_MSG) : msg.toString(), cont, msg.length() > MAX_MSG));
                        if (ring.size() > limite) ring.removeFirst();
                    }
                    ts = m.group(1) + "," + m.group(2); nv = m.group(3);
                    lg = m.group(4) == null ? "" : m.group(4);
                    th = m.group(5) == null ? "" : m.group(5);
                    msg = new StringBuilder(m.group(6) == null ? "" : m.group(6));
                    offAtual = p; cont = 0;
                } else if (offAtual >= 0 && cont < MAX_CONT) { msg.append('\n').append(s); cont++; }
            }
            if (offAtual >= 0) {
                ring.addLast(entradaJson(rel(RAIZ,a), offAtual, ts, nv, lg, th,
                             msg.length() > MAX_MSG ? msg.substring(0, MAX_MSG) : msg.toString(), cont, msg.length() > MAX_MSG));
                if (ring.size() > limite) ring.removeFirst();
            }
        } finally { l.close(); }

        StringBuilder sb = new StringBuilder("{\"ok\":true,\"fim\":" + len + ",\"reiniciou\":" + reiniciou
            + ",\"tam\":\"" + je(fmtTam(len)) + "\",\"mod\":\"" + je(fmtDt(a.lastModified())) + "\",\"entradas\":[");
        boolean pri = true;
        for (String j : ring) { if (!pri) sb.append(","); pri = false; sb.append(j); }
        sb.append("]}");
        out.print(sb.toString());
    } catch (Exception e) { out.print(erro(e.getMessage())); }
    return;
}

} catch (Throwable _t) {
    try { out.clearBuffer(); } catch (Exception _x) {}
    try { if (!response.isCommitted()) response.setContentType("application/json;charset=UTF-8"); } catch (Exception _x) {}
    out.print(erroTrace(_t));
    return;
}
if (RAIZ == null) RAIZ = new File(raizPadrao());
String RAIZ_TXT = RAIZ.getAbsolutePath();

/* BASE_FOLDER e publicado pelo html5component do Sankhya; sem EL, busca em todos os escopos. */
Object _bf = pageContext.findAttribute("BASE_FOLDER");
if (_bf == null) _bf = request.getAttribute("BASE_FOLDER");
String BASE_TXT = (_bf == null) ? "" : String.valueOf(_bf);
String CTX_TXT  = request.getContextPath() == null ? "" : request.getContextPath();

/* O gadget e INCLUIDO por html5component.mge. O caminho real do arquivo
   (/mge/html5component/<nuGdg>_<timestamp>/monitor_log.jsp) vem nos atributos de include,
   e e ele que aceita as chamadas AJAX — o servlet nao aceita. */
String _self = (String) request.getAttribute("javax.servlet.include.servlet_path");
if (_self == null) _self = (String) request.getAttribute("javax.servlet.forward.servlet_path");
if (_self == null) _self = request.getServletPath();
if (_self == null) _self = "";
String SELF_TXT = _self.startsWith("/") ? (CTX_TXT + _self) : _self;
%>
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Monitor de Log — WildFly</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
<style>
:root{
  --bg:#1e1e2e; --bg2:#252537; --bg3:#2d2d42; --bd:#3d3d55;
  --fg:#cdd6f4; --fg2:#9aa3c0; --ac:#89b4fa; --ok:#a6e3a1;
  --wa:#f9e2af; --er:#f38ba8; --dg:#94a3b8; --tr:#cba6f7;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:var(--bg);color:var(--fg);font:13px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;display:flex;flex-direction:column;overflow:hidden}
button,input,select,textarea{font-family:inherit;font-size:13px}
.topo{display:flex;align-items:center;gap:12px;padding:8px 14px;background:var(--bg2);border-bottom:1px solid var(--bd);flex:0 0 auto}
.topo h1{font-size:14px;font-weight:600;letter-spacing:.02em;white-space:nowrap}
.topo h1 i{color:var(--ac);margin-right:6px}
.raiz{font:11px/1 monospace;color:var(--fg2);background:var(--bg3);padding:5px 8px;border-radius:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:340px}
.abas{margin-left:auto;display:flex;gap:4px}
.aba{padding:6px 14px;background:var(--bg3);border:1px solid var(--bd);border-radius:5px;color:var(--fg2);cursor:pointer}
.aba.on{background:var(--ac);border-color:var(--ac);color:#1e1e2e;font-weight:600}
.cfgraiz{display:none;gap:8px;align-items:flex-end;padding:10px 14px;background:var(--bg3);border-bottom:1px solid var(--bd);flex:0 0 auto}
.cfgraiz.on{display:flex}
.cfgraiz input{width:100%;background:var(--bg);border:1px solid var(--bd);border-radius:4px;color:var(--fg);padding:6px 8px;outline:none;font-family:ui-monospace,Menlo,monospace}
.cand{display:block;width:100%;text-align:left;margin:2px 0;padding:6px 8px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--fg);cursor:pointer;font:12px/1.4 ui-monospace,Menlo,monospace}
.cand:hover{border-color:var(--ac)}
.cand.mau{opacity:.45;cursor:not-allowed}
.painel{flex:1;display:none;flex-direction:column;min-height:0}
.painel.on{display:flex}
.filtros{background:var(--bg2);border-bottom:1px solid var(--bd);padding:10px 14px;display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;flex:0 0 auto}
.cmp{display:flex;flex-direction:column;gap:3px}
.cmp label{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--fg2)}
.cmp input,.cmp select{background:var(--bg);border:1px solid var(--bd);border-radius:4px;color:var(--fg);padding:6px 8px;outline:none}
.cmp input:focus,.cmp select:focus{border-color:var(--ac)}
#texto{width:340px}
.chips{display:flex;gap:4px}
.chip{padding:6px 9px;border:1px solid var(--bd);border-radius:4px;background:var(--bg);color:var(--fg2);cursor:pointer;font-size:11px;font-weight:600}
.chip.on{background:var(--bg3);color:var(--fg);border-color:currentColor}
.chip[data-nv=ERROR].on,.chip[data-nv=FATAL].on{color:var(--er)}
.chip[data-nv=WARN].on{color:var(--wa)}
.chip[data-nv=INFO].on{color:var(--ac)}
.chip[data-nv=DEBUG].on{color:var(--dg)}
.chip[data-nv=TRACE].on{color:var(--tr)}
.bt{padding:7px 13px;border:none;border-radius:4px;background:var(--bg3);color:var(--fg);cursor:pointer;border:1px solid var(--bd)}
.bt:hover{border-color:var(--ac);color:var(--ac)}
.bt.pri{background:var(--ac);color:#1e1e2e;font-weight:600;border-color:var(--ac)}
.bt.pri:hover{background:#74c7ec;color:#1e1e2e}
.atalhos{display:flex;gap:4px}
.atalhos .bt{padding:5px 9px;font-size:11px}
.barra{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:6px 14px;background:var(--bg);border-bottom:1px solid var(--bd);font-size:11px;color:var(--fg2);flex:0 0 auto;min-height:31px}
.barra b{color:var(--fg)}
.pill{padding:2px 7px;border-radius:9px;background:var(--bg3);font-weight:600}
.pill.ERROR,.pill.FATAL{color:var(--er)} .pill.WARN{color:var(--wa)} .pill.INFO{color:var(--ac)}
.pill.DEBUG{color:var(--dg)} .pill.TRACE{color:var(--tr)}
.alerta{color:var(--wa)}
.lista{flex:1;overflow:auto;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
.ln{display:grid;grid-template-columns:150px 62px 190px 165px 1fr;gap:8px;padding:3px 14px;border-bottom:1px solid rgba(61,61,85,.4);cursor:pointer;align-items:start}
.ln:hover{background:var(--bg2)}
.ln.sel{background:var(--bg3)}
.ln .c-ts{color:var(--fg2);white-space:nowrap}
.ln .c-nv{font-weight:700}
.ln .c-lg,.ln .c-th{color:var(--fg2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ln .c-msg{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ln.aberta .c-msg{white-space:pre-wrap;overflow:visible}
.nv-ERROR,.nv-FATAL{color:var(--er)} .nv-WARN{color:var(--wa)} .nv-INFO{color:var(--ac)}
.nv-DEBUG{color:var(--dg)} .nv-TRACE{color:var(--tr)}
.acoes{grid-column:5;display:flex;gap:6px;margin-top:6px}
.acoes .bt{padding:3px 8px;font-size:11px}
.vazio{padding:40px;text-align:center;color:var(--fg2)}
.carregando{padding:30px;text-align:center;color:var(--ac)}
.modal{position:fixed;inset:0;background:rgba(0,0,0,.6);display:none;align-items:center;justify-content:center;z-index:50}
.modal.on{display:flex}
.modal .cx{background:var(--bg2);border:1px solid var(--bd);border-radius:8px;width:90vw;height:82vh;display:flex;flex-direction:column}
.modal .cab{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--bd)}
.modal .cab b{font-size:13px}
.modal .cab .bt{margin-left:auto}
.modal pre{flex:1;overflow:auto;margin:0;padding:12px 14px;font:12px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-word}
.modal pre .alvo{background:rgba(137,180,250,.18);display:block}
.tailbar{display:flex;gap:8px;align-items:flex-end;padding:10px 14px;background:var(--bg2);border-bottom:1px solid var(--bd);flex:0 0 auto;flex-wrap:wrap}
.led{width:9px;height:9px;border-radius:50%;background:var(--dg);display:inline-block;margin-right:5px}
.led.on{background:var(--ok);box-shadow:0 0 6px var(--ok)}
mark{background:rgba(249,226,175,.35);color:inherit;border-radius:2px}
.lista::-webkit-scrollbar,.modal pre::-webkit-scrollbar{width:10px;height:10px}
.lista::-webkit-scrollbar-thumb,.modal pre::-webkit-scrollbar-thumb{background:var(--bd);border-radius:5px}
</style>
</head>
<body>

<div id="appCfg" data-base="<%=BASE_TXT%>" data-ctx="<%=CTX_TXT%>" data-self="<%=SELF_TXT%>" style="display:none"></div>

<div class="topo">
  <h1><i class="fa-solid fa-magnifying-glass-chart"></i>Monitor de Log — WildFly</h1>
  <div class="raiz" id="raizTxt" title="raiz dos logs — clique na engrenagem para trocar"><%=RAIZ_TXT%></div>
  <button class="bt" id="btCfg" title="trocar pasta de logs / diagnóstico"><i class="fa-solid fa-gear"></i></button>
  <div class="cmp" style="flex-direction:row;align-items:center;gap:6px">
    <select id="arq" style="min-width:270px;background:var(--bg);border:1px solid var(--bd);border-radius:4px;color:var(--fg);padding:6px 8px"></select>
    <button class="bt" id="btRecarregar" title="recarregar lista de arquivos"><i class="fa-solid fa-rotate"></i></button>
  </div>
  <div class="abas">
    <div class="aba on" data-p="pesquisa"><i class="fa-solid fa-magnifying-glass"></i> Pesquisa</div>
    <div class="aba" data-p="tail"><i class="fa-solid fa-satellite-dish"></i> Ao vivo</div>
  </div>
</div>

<div class="cfgraiz" id="cfgRaiz">
  <div class="cmp" style="flex:1">
    <label>Pasta de logs no servidor</label>
    <input id="raizInput" placeholder="/opt/wildfly_producao/standalone/log">
  </div>
  <button class="bt pri" id="btAplicarRaiz"><i class="fa-solid fa-check"></i> Aplicar</button>
  <button class="bt" id="btPadraoRaiz" title="voltar ao caminho detectado pelo WildFly">Padrão</button>
  <button class="bt" id="btDiag"><i class="fa-solid fa-stethoscope"></i> Diagnóstico</button>
</div>

<div class="painel on" id="p-pesquisa">
  <div class="filtros">
    <div class="cmp">
      <label>Descrição / texto</label>
      <input id="texto" placeholder="ex.: NullPointer, CODPARC 1234, timeout..." autofocus>
    </div>
    <div class="cmp">
      <label>Modo</label>
      <select id="modo">
        <option value="contem">contém a frase</option>
        <option value="todas">todas as palavras</option>
        <option value="qualquer">qualquer palavra</option>
        <option value="regex">regex</option>
      </select>
    </div>
    <div class="cmp">
      <label>Campo</label>
      <select id="campo">
        <option value="tudo">linha toda</option>
        <option value="msg">mensagem</option>
        <option value="logger">classe/logger</option>
        <option value="thread">thread</option>
      </select>
    </div>
    <div class="cmp">
      <label>Níveis</label>
      <div class="chips" id="chips">
        <span class="chip" data-nv="ERROR">ERROR</span>
        <span class="chip" data-nv="WARN">WARN</span>
        <span class="chip" data-nv="INFO">INFO</span>
        <span class="chip" data-nv="DEBUG">DEBUG</span>
        <span class="chip" data-nv="FATAL">FATAL</span>
      </div>
    </div>
    <div class="cmp"><label>De (data/hora)</label><input type="datetime-local" id="dtIni" step="1"></div>
    <div class="cmp"><label>Até</label><input type="datetime-local" id="dtFim" step="1"></div>
    <div class="cmp">
      <label>Período rápido</label>
      <div class="atalhos">
        <button class="bt" data-at="1h">1h</button>
        <button class="bt" data-at="hoje">hoje</button>
        <button class="bt" data-at="ontem">ontem</button>
        <button class="bt" data-at="7d">7d</button>
        <button class="bt" data-at="limpar">✕</button>
      </div>
    </div>
    <div class="cmp">
      <label>Limite</label>
      <select id="limite"><option>200</option><option selected>500</option><option>1000</option><option>5000</option></select>
    </div>
    <div class="cmp">
      <label>Tempo máx.</label>
      <select id="maxMs"><option value="15000">15s</option><option value="25000" selected>25s</option><option value="45000">45s</option><option value="60000">60s</option></select>
    </div>
    <div class="cmp">
      <label>Ordem</label>
      <select id="ordem"><option value="desc">recentes primeiro</option><option value="asc">antigos primeiro</option></select>
    </div>
    <div class="cmp">
      <label><input type="checkbox" id="todosArq"> todos do período</label>
      <label><input type="checkbox" id="ic" checked> ignorar maiúsc.</label>
    </div>
    <button class="bt pri" id="btBuscar"><i class="fa-solid fa-magnifying-glass"></i> Pesquisar</button>
    <button class="bt" id="btExportar" title="baixar só o resultado filtrado"><i class="fa-solid fa-file-arrow-down"></i></button>
  </div>
  <div class="barra" id="stats"><span>Informe um filtro e pesquise. Nada é baixado: a varredura roda no servidor.</span></div>
  <div class="lista" id="res"><div class="vazio">Sem resultados ainda.</div></div>
</div>

<div class="painel" id="p-tail">
  <div class="tailbar">
    <button class="bt pri" id="btTail"><i class="fa-solid fa-play"></i> Iniciar</button>
    <div class="cmp"><label>Intervalo</label>
      <select id="tInt"><option value="2000">2s</option><option value="5000" selected>5s</option><option value="10000">10s</option><option value="30000">30s</option></select>
    </div>
    <div class="cmp"><label>Filtro rápido (cliente)</label><input id="tFiltro" placeholder="destacar/filtrar linhas..." style="width:260px"></div>
    <div class="cmp"><label><input type="checkbox" id="tAuto" checked> rolar automático</label>
      <label><input type="checkbox" id="tSoErro"> só ERROR/WARN</label></div>
    <button class="bt" id="btLimpaTail"><i class="fa-solid fa-eraser"></i> Limpar</button>
    <span class="barra" style="border:none;background:none;padding:0"><span class="led" id="led"></span><span id="tStatus">parado</span></span>
  </div>
  <div class="lista" id="tail"><div class="vazio">Clique em Iniciar para acompanhar o log em tempo real.</div></div>
</div>

<div class="modal" id="modal">
  <div class="cx">
    <div class="cab">
      <b id="mTitulo">Contexto</b>
      <button class="bt" id="mCopiar"><i class="fa-solid fa-copy"></i> Copiar</button>
      <button class="bt" id="mFechar"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <pre id="mCorpo"></pre>
  </div>
</div>
<script>
(function(){
"use strict";
var $ = function(id){ return document.getElementById(id); };
var EPS = [], EP_OK = null, TRANSP = null, TENTATIVAS = [];

function esc(s){ return (s==null?'':String(s)).replace(/[&<>"]/g, function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

function qs(o){
  var p=[]; for (var k in o) if (o[k]!==null && o[k]!==undefined && o[k]!=='') p.push(encodeURIComponent(k)+'='+encodeURIComponent(o[k]));
  return p.join('&');
}

function b64utf8(s){ try { return btoa(unescape(encodeURIComponent(s))); } catch(e){ return null; } }

/* O gadget é servido por html5component.mge?entryPoint=monitor_log.jsp&nuGdg=...
   A query string ORIGINAL tem que ir junto, senão o servlet não sabe qual JSP incluir
   e devolve 500. GET vem antes de POST porque o servlet do ERP recusa POST. */
function montarEndpoints(){
  var cfg  = $('appCfg');
  var base = cfg ? (cfg.getAttribute('data-base') || '') : '';
  var ctx  = cfg ? (cfg.getAttribute('data-ctx')  || '') : '';
  var self = cfg ? (cfg.getAttribute('data-self') || '') : '';
  var full = window.location.href.split('#')[0];      // COM a query original
  var semq = full.split('?')[0];
  var dir  = semq.replace(/[^\/]*$/, '');
  var l = [];
  function add(u, m){
    if (!u || u.indexOf('$' + '{') >= 0) return;
    for (var i=0;i<l.length;i++) if (l[i].u === u && l[i].m === m) return;
    l.push({ u:u, m:m });
  }
  if (self) { add(self, 'GET'); add(self, 'POST'); }     // caminho real do arquivo incluido
  add(full, 'GET');  add(full, 'POST');
  if (base){ var bu = base.replace(/\/+$/,'') + '/monitor_log.jsp'; add(bu,'GET'); add(bu,'POST'); }
  add(dir + 'monitor_log.jsp', 'GET');
  add(semq + '?entryPoint=monitor_log.jsp', 'GET');
  if (base) add(base.replace(/\/+$/,''), 'GET');
  if (ctx){ add(ctx.replace(/\/+$/,'') + '/monitor_log.jsp', 'GET'); }
  add(semq, 'GET');
  EPS = l;
}

function urlCom(u, corpo){ return u + (u.indexOf('?') >= 0 ? '&' : '?') + corpo; }

/* A plataforma exige mgeSession em quase tudo; o iframe do gadget nem sempre recebe. */
function sessaoMge(){
  var m = /[?&]mgeSession=([^&]+)/.exec(window.location.search);
  if (m) return m[1];
  try { m = /[?&]mgeSession=([^&]+)/.exec(window.top.location.search); if (m) return m[1]; } catch(e){}
  try { m = /[?&]mgeSession=([^&]+)/.exec(window.parent.location.search); if (m) return m[1]; } catch(e){}
  m = /[?&]mgeSession=([^&]+)/.exec(document.referrer || ''); if (m) return m[1];
  m = /(?:^|;\s*)JSESSIONID=([^;.]+)/.exec(document.cookie || ''); if (m) return m[1];
  return null;
}

function api(params, cb, cbErr){
  if (!params.mgeSession){ var sm = sessaoMge(); if (sm) params.mgeSession = sm; }
  if (params.texto){ var b = b64utf8(params.texto); if (b){ params.textoB64 = b; params.texto = ''; } }
  var corpo = qs(params);
  var tent  = EP_OK ? [EP_OK] : EPS.slice();
  TENTATIVAS = [];
  proximo(0);

  function proximo(k){
    if (k >= tent.length){
      if (EP_OK){ EP_OK = null; api(params, cb, cbErr); return; }   // endpoint fixado caiu: redescobre
      var cfg2 = $('appCfg');
      mostrarModal('Falha de comunicação com o JSP',
        'Nenhuma das tentativas devolveu JSON.\n\n' + TENTATIVAS.join('\n\n')
        + '\n\nURL da página: ' + window.location.href
        + '\ncaminho real (include): [' + (cfg2 ? cfg2.getAttribute('data-self') : '?') + ']'
        + '\nBASE_FOLDER: [' + (cfg2 ? cfg2.getAttribute('data-base') : '?') + ']'
        + '\ncontextPath: [' + (cfg2 ? cfg2.getAttribute('data-ctx') : '?') + ']');
      (cbErr || function(m){ alerta(m); })('sem resposta válida — veja a janela');
      return;
    }
    var t = tent[k], x = new XMLHttpRequest();
    var url = (t.m === 'GET') ? urlCom(t.u, corpo) : t.u;
    if (t.m === 'GET' && url.length > 7000){ TENTATIVAS.push('GET ' + t.u + '\n   -> pulado: URL longa demais'); proximo(k+1); return; }
    try { x.open(t.m, url, true); } catch(e){ TENTATIVAS.push(t.m+' '+t.u+' -> '+e); proximo(k+1); return; }
    if (t.m === 'POST') x.setRequestHeader('Content-Type','application/x-www-form-urlencoded; charset=UTF-8');
    x.onreadystatechange = function(){
      if (x.readyState !== 4) return;
      var r = null;
      try { r = JSON.parse(x.responseText); } catch(e){ r = null; }
      if (r && typeof r.ok !== 'undefined'){
        EP_OK = t; TRANSP = t.m;
        if (!r.ok){ (cbErr || function(m){ alerta(m); })(r.erro || 'erro desconhecido'); return; }
        cb(r); return;
      }
      var trecho = (x.responseText || '').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').substring(0, 400);
      TENTATIVAS.push(t.m + ' ' + t.u + '\n   -> HTTP ' + x.status + ' | ' + (trecho || '(corpo vazio)'));
      proximo(k+1);
    };
    try { x.send(t.m === 'POST' ? corpo : null); }
    catch(e){ TENTATIVAS.push(t.m+' '+t.u+' -> '+e); proximo(k+1); }
  }
}

function alerta(msg){ $('stats').innerHTML = '<span class="alerta"><i class="fa-solid fa-triangle-exclamation"></i> '+esc(msg)+'</span>'; }

function mostrarModal(titulo, texto, html){
  $('mTitulo').textContent = titulo;
  if (html) $('mCorpo').innerHTML = html; else $('mCorpo').textContent = texto;
  $('modal').classList.add('on');
}

/* -------------------------------------------------- raiz / diagnóstico */
$('btCfg').onclick = function(){
  var c = $('cfgRaiz');
  c.classList.toggle('on');
  if (c.classList.contains('on')) { $('raizInput').value = $('raizTxt').textContent.trim(); $('raizInput').focus(); }
};
function aplicarRaiz(caminho){
  api({action:'raiz', caminho:caminho}, function(r){
    $('raizTxt').textContent = r.raiz;
    $('raizInput').value = r.raiz;
    $('modal').classList.remove('on');
    carregarArquivos();
  });
}
$('btAplicarRaiz').onclick = function(){ aplicarRaiz($('raizInput').value.trim()); };
$('btPadraoRaiz').onclick  = function(){ aplicarRaiz(''); };
$('raizInput').addEventListener('keydown', function(ev){ if (ev.key==='Enter') aplicarRaiz(this.value.trim()); });

$('btDiag').onclick = function(){
  mostrarModal('Diagnóstico', 'carregando...');
  api({action:'diag'}, function(r){
    var cfg3 = $('appCfg');
    var h = '<b>Comunicação</b>\n  endpoint = ' + esc(EP_OK ? EP_OK.u : '?') + '\n  método = ' + esc(TRANSP)
          + '\n  caminho real = ' + esc(cfg3 ? cfg3.getAttribute('data-self') : '')
          + '\n  BASE_FOLDER = ' + esc(cfg3 ? cfg3.getAttribute('data-base') : '')
          + '\n  página  = ' + esc(window.location.href) + '\n\n<b>Propriedades da JVM do WildFly</b>\n';
    for (var k in r.props) h += '  ' + esc(k) + ' = ' + esc(r.props[k]) + '\n';
    h += '\n<b>Raiz em uso</b>\n  ' + esc(r.raizAtual)
       + '\n  existe=' + r.raizExiste + '  legível=' + r.raizLegivel + '  arquivos=' + r.raizArquivos + '\n';
    h += '\n<b>Candidatos encontrados no servidor</b> (clique para usar)\n';
    r.candidatos.sort(function(x,y){
      var a1=(x.existe&&x.legivel)?1:0, b1=(y.existe&&y.legivel)?1:0;
      if (a1!==b1) return b1-a1;
      return y.logs-x.logs;
    });
    for (var i=0;i<r.candidatos.length;i++){
      var c = r.candidatos[i];
      var ok = c.existe && c.legivel;
      h += '<button class="cand' + (ok?'':' mau') + '" ' + (ok?('data-cam="'+esc(c.caminho)+'"'):'disabled') + '>'
         + (ok?'✅':'❌') + ' ' + esc(c.caminho)
         + '  —  ' + c.logs + ' log(s)' + (c.amostra?(' · ex.: '+esc(c.amostra)):'')
         + (c.existe? (c.legivel?'':' · SEM PERMISSÃO DE LEITURA') : ' · não existe')
         + '</button>';
    }
    mostrarModal('Diagnóstico da pasta de logs', null, h);
    var bs = $('mCorpo').querySelectorAll('.cand[data-cam]');
    for (var j=0;j<bs.length;j++) bs[j].onclick = function(){ aplicarRaiz(this.dataset.cam); };
  }, function(m){ mostrarModal('Diagnóstico', 'Erro: ' + m); });
};

/* ------------------------------------------------------------- abas */
var abas = document.querySelectorAll('.aba');
for (var i=0;i<abas.length;i++) abas[i].onclick = function(){
  for (var j=0;j<abas.length;j++) abas[j].classList.remove('on');
  this.classList.add('on');
  $('p-pesquisa').classList.toggle('on', this.dataset.p==='pesquisa');
  $('p-tail').classList.toggle('on', this.dataset.p==='tail');
};

/* -------------------------------------------------------- arquivos */
function carregarArquivos(sel){
  api({action:'arquivos'}, function(r){
    var s = $('arq'); s.innerHTML='';
    $('raizTxt').textContent = r.raiz;
    for (var i=0;i<r.arquivos.length;i++){
      var a = r.arquivos[i];
      var o = document.createElement('option');
      o.value = a.rel;
      o.textContent = a.nome + '  —  ' + a.tam + '  —  ' + a.mod;
      o.setAttribute('data-bytes', a.bytes);
      s.appendChild(o);
    }
    if (r.pastas.length){
      var g = document.createElement('optgroup'); g.label='(subpastas com logs)';
      for (var k=0;k<r.pastas.length;k++){
        var op=document.createElement('option'); op.value='@'+r.pastas[k].rel;
        op.textContent='📁 '+r.pastas[k].nome+' — abrir'; g.appendChild(op);
      }
      s.appendChild(g);
    }
    if (sel) s.value = sel;
    if (!r.arquivos.length){
      alerta('Nenhum arquivo em ' + r.raiz + '. Abra a engrenagem → Diagnóstico para localizar a pasta de logs.');
      $('cfgRaiz').classList.add('on');
      $('raizInput').value = r.raiz;
    }
  }, function(m){
    alerta(m + ' — abra a engrenagem → Diagnóstico.');
    $('cfgRaiz').classList.add('on');
  });
}
$('arq').onchange = function(){
  if (this.value.charAt(0) === '@'){
    var sub = this.value.substring(1);
    api({action:'arquivos', sub:sub}, function(r){
      var s = $('arq'); s.innerHTML='';
      var volta=document.createElement('option'); volta.value='@'; volta.textContent='⬅ voltar à raiz'; s.appendChild(volta);
      for (var i=0;i<r.arquivos.length;i++){
        var a=r.arquivos[i], o=document.createElement('option');
        o.value=a.rel; o.textContent=a.nome+'  —  '+a.tam+'  —  '+a.mod; s.appendChild(o);
      }
      if (r.arquivos.length) s.value = r.arquivos[0].rel;
    });
  }
};
$('btRecarregar').onclick = function(){ carregarArquivos($('arq').value); };

/* ----------------------------------------------------------- níveis */
var chips = document.querySelectorAll('.chip');
for (var c=0;c<chips.length;c++) chips[c].onclick = function(){ this.classList.toggle('on'); };
function niveisSel(){
  var l=[]; for (var i=0;i<chips.length;i++) if (chips[i].classList.contains('on')) l.push(chips[i].dataset.nv);
  return l.join(',');
}

/* --------------------------------------------------- período rápido */
function fmtLocal(d){
  function p(n){ return (n<10?'0':'')+n; }
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds());
}
var ats = document.querySelectorAll('.atalhos .bt');
for (var a=0;a<ats.length;a++) ats[a].onclick = function(){
  var agora=new Date(), ini=new Date(), fim=new Date(), t=this.dataset.at;
  if (t==='limpar'){ $('dtIni').value=''; $('dtFim').value=''; return; }
  if (t==='1h'){ ini=new Date(agora.getTime()-3600000); }
  else if (t==='hoje'){ ini.setHours(0,0,0,0); }
  else if (t==='ontem'){ ini.setDate(ini.getDate()-1); ini.setHours(0,0,0,0); fim=new Date(ini); fim.setHours(23,59,59,0); }
  else if (t==='7d'){ ini.setDate(ini.getDate()-7); ini.setHours(0,0,0,0); }
  $('dtIni').value = fmtLocal(ini);
  $('dtFim').value = fmtLocal(fim);
};

/* ---------------------------------------------------------- pesquisa */
function paramsBusca(){
  return {
    action:'buscar',
    arq: $('todosArq').checked ? '*' : $('arq').value,
    texto: $('texto').value,
    modo: $('modo').value,
    campo: $('campo').value,
    niveis: niveisSel(),
    dtIni: $('dtIni').value,
    dtFim: $('dtFim').value,
    limite: $('limite').value,
    ordem: $('ordem').value,
    maxMs: $('maxMs').value,
    ic: $('ic').checked ? '1' : '0'
  };
}

var ultimos = [];
function buscar(){
  var p = paramsBusca();
  if (!p.arq){ alerta('Selecione um arquivo de log.'); return; }
  var op = $('arq').options[$('arq').selectedIndex];
  var bytes = op ? parseInt(op.getAttribute('data-bytes') || '0', 10) : 0;
  if (bytes > 2147483648 && !p.dtIni && !p.dtFim)
    alerta('Arquivo de ' + (bytes/1073741824).toFixed(1) + ' GB sem filtro de data: varrendo do fim para trás, pode não alcançar o log mais antigo.');
  $('res').innerHTML = '<div class="carregando"><i class="fa-solid fa-spinner fa-spin"></i> varrendo no servidor...</div>';
  $('stats').innerHTML = '<span>varrendo...</span>';
  var t0 = Date.now();
  api(p, function(r){
    ultimos = r.entradas;
    renderStats(r, Date.now()-t0);
    renderLista(r.entradas, $('res'), p.texto, p.modo);
  }, function(m){ $('res').innerHTML='<div class="vazio">—</div>'; alerta(m); });
}

function renderStats(r, msCliente){
  var h = '<span><b>'+r.retornados+'</b> exibidas de <b>'+r.achados+'</b> encontradas</span>';
  h += '<span>· '+r.arquivos+' arquivo(s) · '+r.lidoFmt+' varridos · '+r.ms+' ms (servidor)</span>';
  for (var nv in r.niveis) h += '<span class="pill '+esc(nv)+'">'+esc(nv)+' '+r.niveis[nv]+'</span>';
  if (r.topLoggers && r.topLoggers.length){
    h += '<span>· top: ';
    for (var i=0;i<Math.min(3,r.topLoggers.length);i++){
      var lg=r.topLoggers[i].lg.split('.').pop();
      h += (i?', ':'')+esc(lg)+' ('+r.topLoggers[i].n+')';
    }
    h += '</span>';
  }
  if (r.tempoEsgotado) h += '<span class="alerta">· tempo limite atingido — refine o período</span>';
  else if (r.parcial) h += '<span class="alerta">· resultado truncado no limite — aumente o limite ou refine</span>';
  $('stats').innerHTML = h;
}

function marcar(txt, termo, modo){
  var h = esc(txt);
  if (!termo || modo==='regex') return h;
  var ts = (modo==='contem') ? [termo] : termo.split(/\s+/);
  for (var i=0;i<ts.length;i++){
    if (!ts[i]) continue;
    var re = new RegExp(ts[i].replace(/[.*+?^$\{\}()|[\]\\]/g,'\\$&'), 'gi');
    h = h.replace(re, function(m){ return '<mark>'+m+'</mark>'; });
  }
  return h;
}

function renderLista(itens, alvo, termo, modo){
  if (!itens || !itens.length){ alvo.innerHTML = '<div class="vazio">Nenhuma entrada encontrada com esses filtros.</div>'; return; }
  var h = [];
  for (var i=0;i<itens.length;i++){
    var e = itens[i];
    var pri = e.msg.split('\n')[0];
    var lgCurto = e.lg ? e.lg.split('.').pop() : '';
    h.push('<div class="ln" data-i="'+i+'">'
      + '<span class="c-ts">'+esc(e.ts)+'</span>'
      + '<span class="c-nv nv-'+esc(e.nv)+'">'+esc(e.nv)+'</span>'
      + '<span class="c-lg" title="'+esc(e.lg)+'">'+esc(lgCurto)+'</span>'
      + '<span class="c-th" title="'+esc(e.th)+'">'+esc(e.th)+'</span>'
      + '<span class="c-msg">'+marcar(pri, termo, modo)+(e.cont?' <span style="color:var(--fg2)">▾ +'+e.cont+' linhas</span>':'')+'</span>'
      + '</div>');
  }
  alvo.innerHTML = h.join('');
  var lns = alvo.querySelectorAll('.ln');
  for (var k=0;k<lns.length;k++) lns[k].onclick = function(){ abrirLinha(this, itens, termo, modo); };
}

function abrirLinha(el, itens, termo, modo){
  var e = itens[parseInt(el.dataset.i,10)];
  if (el.classList.contains('aberta')){
    el.classList.remove('aberta');
    el.querySelector('.c-msg').innerHTML = marcar(e.msg.split('\n')[0], termo, modo)
      + (e.cont?' <span style="color:var(--fg2)">▾ +'+e.cont+' linhas</span>':'');
    var ac = el.querySelector('.acoes'); if (ac) ac.remove();
    return;
  }
  el.classList.add('aberta');
  el.querySelector('.c-msg').innerHTML = marcar(e.msg, termo, modo) + (e.trunc?'\n<span class="alerta">[mensagem truncada]</span>':'');
  var d = document.createElement('div');
  d.className='acoes';
  d.innerHTML = '<button class="bt" data-ac="ctx"><i class="fa-solid fa-list"></i> Contexto ±25</button>'
              + '<button class="bt" data-ac="cp"><i class="fa-solid fa-copy"></i> Copiar</button>'
              + '<span style="color:var(--fg2);font-size:11px;align-self:center">'+esc(e.arq)+' @ byte '+e.off+'</span>';
  el.appendChild(d);
  d.querySelector('[data-ac=ctx]').onclick = function(ev){ ev.stopPropagation(); contexto(e.arq, e.off); };
  d.querySelector('[data-ac=cp]').onclick  = function(ev){ ev.stopPropagation();
    copiar(e.ts+' '+e.nv+' ['+e.lg+'] ('+e.th+') '+e.msg); this.innerHTML='<i class="fa-solid fa-check"></i> copiado'; };
}

function copiar(txt){
  if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt); return; }
  var ta=document.createElement('textarea'); ta.value=txt; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch(e){}
  document.body.removeChild(ta);
}

/* ---------------------------------------------------------- contexto */
function contexto(arq, off){
  $('mTitulo').textContent = 'Contexto — '+arq+' @ '+off;
  $('mCorpo').textContent = 'carregando...';
  $('modal').classList.add('on');
  api({action:'contexto', arq:arq, off:off, antes:25, depois:25}, function(r){
    var h='';
    for (var i=0;i<r.linhas.length;i++){
      var l=r.linhas[i];
      h += l.alvo ? '<span class="alvo">'+esc(l.txt)+'</span>\n' : esc(l.txt)+'\n';
    }
    $('mCorpo').innerHTML = h;
  }, function(m){ $('mCorpo').textContent = 'Erro: '+m; });
}
$('mFechar').onclick = function(){ $('modal').classList.remove('on'); };
$('modal').onclick = function(ev){ if (ev.target===this) this.classList.remove('on'); };
$('mCopiar').onclick = function(){ copiar($('mCorpo').innerText); this.innerHTML='<i class="fa-solid fa-check"></i> copiado'; };

/* ---------------------------------------------------------- exportar */
$('btExportar').onclick = function(){
  var p = paramsBusca(); p.action='exportar';
  var bt = b64utf8(p.texto); if (bt){ p.textoB64 = bt; p.texto=''; }
  var alvo = EP_OK || EPS[0];
  if (!alvo){ alerta('Faça uma pesquisa antes de exportar.'); return; }
  window.open(urlCom(alvo.u, qs(p)), '_blank');
};

$('btBuscar').onclick = buscar;
$('texto').addEventListener('keydown', function(ev){ if (ev.key==='Enter') buscar(); });

/* -------------------------------------------------------------- tail */
var tRodando=false, tDesde=-1, tTimer=null, tArq=null, tBuffer=[];
function tailPasso(){
  api({action:'tail', arq:tArq, desde:tDesde, limite:300}, function(r){
    if (r.reiniciou) { tBuffer=[]; }
    tDesde = r.fim;
    if (r.entradas.length){
      tBuffer = tBuffer.concat(r.entradas);
      if (tBuffer.length > 3000) tBuffer = tBuffer.slice(tBuffer.length-3000);
      pintarTail();
    }
    $('tStatus').textContent = 'ao vivo — '+r.tam+' — última alteração '+r.mod;
    if (tRodando) tTimer = setTimeout(tailPasso, parseInt($('tInt').value,10));
  }, function(m){
    $('tStatus').textContent = 'erro: '+m;
    if (tRodando) tTimer = setTimeout(tailPasso, 10000);
  });
}
function pintarTail(){
  var filtro = $('tFiltro').value.toLowerCase();
  var soErro = $('tSoErro').checked;
  var el = $('tail'), h=[];
  for (var i=0;i<tBuffer.length;i++){
    var e = tBuffer[i];
    if (soErro && e.nv!=='ERROR' && e.nv!=='WARN' && e.nv!=='FATAL') continue;
    var linha = e.ts+' '+e.nv+' ['+e.lg+'] ('+e.th+') '+e.msg;
    if (filtro && linha.toLowerCase().indexOf(filtro)<0) continue;
    h.push('<div class="ln" style="grid-template-columns:150px 62px 190px 1fr">'
      + '<span class="c-ts">'+esc(e.ts)+'</span>'
      + '<span class="c-nv nv-'+esc(e.nv)+'">'+esc(e.nv)+'</span>'
      + '<span class="c-lg" title="'+esc(e.lg)+'">'+esc(e.lg?e.lg.split('.').pop():'')+'</span>'
      + '<span class="c-msg" style="white-space:pre-wrap">'+marcar(e.msg, $('tFiltro').value, 'contem')+'</span></div>');
  }
  el.innerHTML = h.join('') || '<div class="vazio">Nada no filtro atual.</div>';
  if ($('tAuto').checked) el.scrollTop = el.scrollHeight;
}
$('btTail').onclick = function(){
  tRodando = !tRodando;
  if (tRodando){
    tArq = $('arq').value; tDesde = -1; tBuffer=[];
    if (!tArq || tArq.charAt(0)==='@'){ tRodando=false; $('tStatus').textContent='selecione um arquivo'; return; }
    this.innerHTML = '<i class="fa-solid fa-pause"></i> Pausar';
    $('led').classList.add('on'); $('tStatus').textContent='conectando...';
    tailPasso();
  } else {
    this.innerHTML = '<i class="fa-solid fa-play"></i> Iniciar';
    $('led').classList.remove('on'); $('tStatus').textContent='pausado';
    if (tTimer) clearTimeout(tTimer);
  }
};
$('btLimpaTail').onclick = function(){ tBuffer=[]; pintarTail(); };
$('tFiltro').addEventListener('input', pintarTail);
$('tSoErro').addEventListener('change', pintarTail);

document.addEventListener('keydown', function(ev){
  if (ev.key==='Escape') $('modal').classList.remove('on');
  if ((ev.ctrlKey||ev.metaKey) && ev.key==='Enter') buscar();
});

montarEndpoints();
carregarArquivos();
})();
</script>
</body>
</html>
