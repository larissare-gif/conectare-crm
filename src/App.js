import { useState, useMemo, useEffect, useCallback } from "react";

const SHEET_URL = "https://script.google.com/macros/s/AKfycbz17ODubOSje63NFQ3vobF1pd71ALn5jaeVgtFlpB0Qq8EVoSMIJd6YxZw5nHr4TZiowA/exec";

const STAGES = ["Novo Lead", "Em Contato", "Contato Futuro", "Fechado", "Perdido"];
const STAGE_COLORS = {
  "Novo Lead":      { bg: "#f5f5f5", accent: "#9e9e9e" },
  "Em Contato":     { bg: "#e3f2fd", accent: "#1565c0" },
  "Contato Futuro": { bg: "#fff8e1", accent: "#f57f17" },
  "Fechado":        { bg: "#e8f5e9", accent: "#1b5e20" },
  "Perdido":        { bg: "#fce4ec", accent: "#c62828" },
};
const CURSOS = ["Técnico EAD", "Certificação por Competência", "EJA"];
const ACTION_ICONS  = { mensagem: "💬", audio: "🎙️", ligacao: "📞" };
const ACTION_LABELS = { mensagem: "Mensagem", audio: "Áudio",   ligacao: "Ligação" };
const ACTION_COLORS = { mensagem: "#1e88e5", audio: "#8e24aa", ligacao: "#fb8c00" };

// ── Cadência: cada passo tem idx único (1-23), semana, dia, acao, tipo, diaRelativo
// diaRelativo = quantos dias corridos desde o início a ação deve ocorrer (base 0)
// Dias da cadência: 1, 2, 4, 7, 10, 14 — cada um com 3 ações
const DIAS_CADENCIA = [1, 2, 4, 7, 10, 14];
const CADENCIA = DIAS_CADENCIA.flatMap((diaNum, di) => [
  { idx: di*3+1, dia: di+1, diaNum, acao:1, tipo:"mensagem", diaRelativo: diaNum-1 },
  { idx: di*3+2, dia: di+1, diaNum, acao:2, tipo:"audio",    diaRelativo: diaNum-1 },
  { idx: di*3+3, dia: di+1, diaNum, acao:3, tipo:"ligacao",  diaRelativo: diaNum-1 },
]);
const TOTAL_PASSOS = 18;

function labelPasso(p) {
  return `Dia ${p.diaNum} · Ação ${p.acao}/3`;
}

// ── Dado um passo idx, retorna o objeto da cadência
function getPasso(idx) { return CADENCIA.find(p => p.idx === idx) || null; }

// ── Dias corridos desde uma data "YYYY-MM-DD" até hoje (sem fuso)
function diasDesde(dataStr) {
  if (!dataStr) return 0;
  const [y, m, d] = dataStr.split("-").map(Number);
  const t = new Date();
  const inicioMs = Date.UTC(y, m - 1, d);
  const hojeMs   = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
  return Math.floor((hojeMs - inicioMs) / 86400000);
}

// ── Quantos passos estão atrasados (deveriam ter sido feitos mas ainda não foram)
function dataProximoContato(cadencia) {
  if (!cadencia || !cadencia.dataInicio || cadencia.passo > TOTAL_PASSOS || cadencia.pausada) return null;
  const passo = getPasso(cadencia.passo);
  if (!passo) return null;
  const [y,m,d] = cadencia.dataInicio.split("-").map(Number);
  const inicio = new Date(y, m-1, d);
  inicio.setDate(inicio.getDate() + passo.diaRelativo);
  return inicio.getFullYear()+"-"+String(inicio.getMonth()+1).padStart(2,"0")+"-"+String(inicio.getDate()).padStart(2,"0");
}

function calcularAtraso(cadencia) {
  if (!cadencia || !cadencia.dataInicio || cadencia.passo > TOTAL_PASSOS || cadencia.pausada) return 0;
  const dias = diasDesde(cadencia.dataInicio);
  // Quantos passos já deveriam ter ocorrido (diaRelativo <= dias)
  const deveriam = CADENCIA.filter(p => p.diaRelativo < dias).length;
  // Quantos já foram marcados (passo atual - 1 = passos concluídos)
  const feitos = cadencia.passo - 1;
  return Math.max(0, deveriam - feitos);
}

// ── Styles
const labelStyle = { display:"block", fontSize:11, fontWeight:700, color:"#888", marginBottom:5, textTransform:"uppercase", letterSpacing:"0.06em" };
const inputStyle  = { width:"100%", padding:"9px 12px", border:"1.5px solid #e8e8e8", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box", fontFamily:"'DM Sans', sans-serif", color:"#222", background:"#fafafa" };
const btn = (bg, color="#fff") => ({ background:bg, color, border:"none", borderRadius:8, padding:"9px 18px", fontWeight:700, cursor:"pointer", fontSize:13, fontFamily:"'DM Sans', sans-serif", display:"flex", alignItems:"center", gap:6 });

function corCelula(status, tipo) {
  if (status === "feito_respondeu") return "#1b5e20";
  if (status === "feito_nao_respondeu") return "#22c55e";
  if (status === "nao_feito")  return "#ef5350";
  if (status === "atual")      return ACTION_COLORS[tipo];
  return "#e8e8e8";
}

// ── API
async function apiSave(lead, url) {
  if (!url || url === "local") return;
  await fetch(url, { method:"POST", body:JSON.stringify({ action:"save", lead }) });
}
async function apiGet(url) {
  if (!url || url === "local") return null;
  return (await fetch(url)).json();
}

// ── Avatar
function Avatar({ name, size=38 }) {
  const i = name.split(" ").slice(0,2).map(w=>w[0]).join("").toUpperCase();
  const c = "#9e9e9e";
  return <div style={{ width:size, height:size, borderRadius:"50%", background:c, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontWeight:700, fontSize:size*0.37, flexShrink:0 }}>{i}</div>;
}

// ── LeadCard
function LeadCard({ lead, onClick }) {
  const { accent } = STAGE_COLORS[lead.stage] || STAGE_COLORS["Novo Lead"];
  const pendentes  = (lead.tasks||[]).filter(t=>!t.done).length;
  const contatos   = (lead.cadencia?.historico||[]).filter(h=>h.status==="feito_respondeu"||h.status==="feito_nao_respondeu").length;
  const passoAtual = lead.cadencia ? getPasso(lead.cadencia.passo) : null;
  const encerrada  = lead.cadencia && lead.cadencia.passo > TOTAL_PASSOS;
  const atraso     = calcularAtraso(lead.cadencia);

  return (
    <div onClick={()=>onClick(lead)}
      onMouseEnter={e=>{e.currentTarget.style.boxShadow="0 4px 16px rgba(0,0,0,0.13)";e.currentTarget.style.transform="translateY(-1px)";}}
      onMouseLeave={e=>{e.currentTarget.style.boxShadow="0 1px 4px rgba(0,0,0,0.06)";e.currentTarget.style.transform="";}}
      style={{ background:"#fff", border:"1.5px solid #ececec", borderLeft:`4px solid ${accent}`, borderRadius:10, padding:"12px 14px", marginBottom:10, cursor:"pointer", transition:"box-shadow 0.15s, transform 0.1s", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:7 }}>
        <Avatar name={lead.name} />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontWeight:700, fontSize:14, color:"#1a1a1a", fontFamily:"'Syne', sans-serif", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{lead.name}</div>
          <div style={{ fontSize:11, color:"#888", fontFamily:"'DM Mono', monospace" }}>{lead.phone}</div>
        </div>
      </div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:4 }}>
        <span style={{ background:"#f0f0f0", color:"#555", fontSize:11, fontWeight:600, padding:"2px 8px", borderRadius:20, fontFamily:"'DM Mono', monospace" }}>{lead.curso||"—"}</span>
        <span style={{ fontSize:11, color:"#aaa", fontFamily:"'DM Mono', monospace" }}>{lead.dataContato ? lead.dataContato.split("-").reverse().join("/") : ""}</span>
      </div>
      {pendentes > 0 && <div style={{ fontSize:11, color:"#ffa000", fontWeight:600, fontFamily:"'DM Mono', monospace", marginBottom:3 }}>● {pendentes} tarefa(s) pendente(s)</div>}
      {atraso > 0 && !encerrada && <div style={{ fontSize:11, color:"#ef5350", fontWeight:700, fontFamily:"'DM Mono', monospace", marginBottom:3 }}>⚠️ {atraso} passos em atraso</div>}
      {atraso === 0 && lead.cadencia && !encerrada && (() => {
        const d = dataProximoContato(lead.cadencia);
        if (!d) return null;
        const hoje = new Date();
        const hojeStr = hoje.getFullYear()+"-"+String(hoje.getMonth()+1).padStart(2,"0")+"-"+String(hoje.getDate()).padStart(2,"0");
        const ehHoje = d === hojeStr;
        return ehHoje
          ? <div style={{ fontSize:11, color:"#fb8c00", fontWeight:700, fontFamily:"'DM Mono', monospace", marginBottom:3 }}>🔔 Contatos a realizar hoje</div>
          : <div style={{ fontSize:11, color:"#22c55e", fontWeight:600, fontFamily:"'DM Mono', monospace", marginBottom:3 }}>📅 Próximo contato: {d.split("-").reverse().join("/")}</div>;
      })()}
      {passoAtual && !encerrada && !lead.cadencia?.pausada && <div style={{ fontSize:11, fontWeight:700, fontFamily:"'DM Mono', monospace", color:ACTION_COLORS[passoAtual.tipo] }}>{ACTION_ICONS[passoAtual.tipo]} {labelPasso(passoAtual)}</div>}
      {passoAtual && !encerrada && lead.cadencia?.pausada && !lead.cadencia?.encerradaManualmente && <div style={{ fontSize:11, color:"#1565c0", fontWeight:600, fontFamily:"'DM Mono', monospace" }}>⏸️ Cadência pausada</div>}
      {encerrada && !lead.cadencia?.encerradaManualmente && <div style={{ fontSize:11, color:"#1b5e20", fontWeight:600, fontFamily:"'DM Mono', monospace" }}>✅ Cadência encerrada</div>}
      {lead.cadencia?.encerradaManualmente && <div style={{ fontSize:11, color:"#c62828", fontWeight:600, fontFamily:"'DM Mono', monospace" }}>❌ Cadência encerrada</div>}
      {lead.cadencia && <div style={{ fontSize:11, color:"#1a1a1a", fontWeight:600, fontFamily:"'DM Mono', monospace", marginTop:3 }}>📊 {contatos} contatos realizados</div>}
    </div>
  );
}

// ── KanbanBoard
function KanbanBoard({ leads, onCardClick, onDrop }) {
  const [dragging, setDragging]   = useState(null);
  const [overStage, setOverStage] = useState(null);
  return (
    <div style={{ display:"flex", gap:14, overflowX:"auto", paddingBottom:12 }}>
      {STAGES.map(stage => {
        const sl = leads.filter(l=>l.stage===stage);
        const { bg, accent } = STAGE_COLORS[stage];
        return (
          <div key={stage}
            onDragOver={e=>{e.preventDefault();setOverStage(stage);}}
            onDrop={e=>{e.preventDefault();if(dragging)onDrop(dragging,stage);setOverStage(null);setDragging(null);}}
            onDragLeave={()=>setOverStage(null)}
            style={{ minWidth:240, maxWidth:270, flex:"0 0 250px", background:overStage===stage?bg:"#f8f8f8", border:overStage===stage?`2px dashed ${accent}`:"2px solid transparent", borderRadius:14, padding:"12px 10px", transition:"background 0.2s, border 0.2s" }}>
            <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:12 }}>
              <span style={{ width:10, height:10, borderRadius:"50%", background:accent, display:"inline-block" }} />
              <span style={{ fontWeight:700, fontSize:13, color:"#2a2a2a", fontFamily:"'Syne', sans-serif" }}>{stage}</span>
              <span style={{ marginLeft:"auto", background:accent, color:"#fff", borderRadius:20, fontSize:11, padding:"1px 8px", fontWeight:700 }}>{sl.length}</span>
            </div>
            {sl.map(lead => (
              <div key={lead.id} draggable onDragStart={()=>setDragging(lead)} onDragEnd={()=>setDragging(null)}>
                <LeadCard lead={lead} onClick={onCardClick} />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── CadenciaGrade
function CadenciaGrade({ cadencia }) {
  const historico = cadencia?.historico || [];
  const encerrada = cadencia && cadencia.passo > TOTAL_PASSOS;

  function statusCelula(idx) {
    if (!cadencia) return "pendente";
    const h = historico.find(h => h.passo === idx);
    if (h) return h.status;
    if (idx === cadencia.passo && !encerrada) return "atual";
    return "pendente";
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:18 }}>
      {DIAS_CADENCIA.map((diaNum, di) => {
        const ps = CADENCIA.filter(p => p.dia === di+1);
        return (
          <div key={di} style={{ display:"flex", alignItems:"center", gap:6 }}>
            <div style={{ fontSize:11, fontWeight:700, color:"#aaa", fontFamily:"'DM Mono', monospace", minWidth:42 }}>Dia {diaNum}</div>
            {ps.map(p => {
              const status = statusCelula(p.idx);
              const bg  = corCelula(status, p.tipo);
              const col = status === "pendente" ? "#aaa" : "#fff";
              return (
                <div key={p.idx} title={labelPasso(p)} style={{ flex:1, background:bg, borderRadius:6, padding:"5px 4px", textAlign:"center", transition:"background 0.3s" }}>
                  <div style={{ fontSize:13 }}>{ACTION_ICONS[p.tipo]}</div>
                  <div style={{ fontSize:9, color:col, fontFamily:"'DM Mono', monospace", fontWeight:status==="atual"?700:400 }}>{ACTION_LABELS[p.tipo].slice(0,3)}</div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ── CadenciaPanel
function CadenciaPanel({ cadencia, onIniciar, onAvancar, onEncerrar, onReiniciar }) {
  const encerrada  = cadencia && cadencia.passo > TOTAL_PASSOS;
  const passoAtual = cadencia && !encerrada ? getPasso(cadencia.passo) : null;
  const atraso     = calcularAtraso(cadencia);
  const contatos   = (cadencia?.historico||[]).filter(h=>h.status==="feito_respondeu"||h.status==="feito_nao_respondeu").length;

  return (
    <div style={{ marginBottom:22 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
        <label style={labelStyle}>📅 Follow-up</label>
        {!cadencia && <button onClick={onIniciar} style={{ ...btn("#1e88e5"), fontSize:12, padding:"6px 14px" }}>▶ Iniciar cadência</button>}
        {cadencia && !encerrada && (
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={onReiniciar} style={{ ...btn("#fff3e0","#e65100"), fontSize:12, padding:"6px 14px" }}>🔄 Reiniciar</button>
          <button onClick={onEncerrar} style={{ ...btn("#ffebee","#c62828"), fontSize:12, padding:"6px 14px" }}>✕ Encerrar manualmente</button>
        </div>
      )}
      </div>

      {/* Legenda */}
      {cadencia && (
        <div style={{ display:"flex", flexDirection:"column", gap:5, marginBottom:12 }}>
          <div style={{ display:"flex", gap:14 }}>
            {[{cor:"#1e88e5",label:"Msg atual"},{cor:"#8e24aa",label:"Áud atual"},{cor:"#fb8c00",label:"Lig atual"}].map(({cor,label})=>(
              <div key={label} style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, whiteSpace:"nowrap" }}>
                <span style={{ width:12, height:12, borderRadius:3, background:cor, flexShrink:0, display:"inline-block" }} />
                <span style={{ color:"#666" }}>{label}</span>
              </div>
            ))}
          </div>
          <div style={{ display:"flex", gap:14 }}>
            {[{cor:"#22c55e",label:"Feito"},{cor:"#ef5350",label:"Não feito"},{cor:"#e8e8e8",label:"Pendente",tc:"#aaa"}].map(({cor,label,tc})=>(
              <div key={label} style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, whiteSpace:"nowrap" }}>
                <span style={{ width:12, height:12, borderRadius:3, background:cor, flexShrink:0, display:"inline-block" }} />
                <span style={{ color:tc||"#666" }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {atraso > 0 && !encerrada && (
        <div style={{ background:"#fff3e0", border:"1.5px solid #ffa000", borderRadius:10, padding:"10px 14px", marginBottom:14, display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:20 }}>⚠️</span>
          <div>
            <div style={{ fontWeight:700, fontSize:13, color:"#e65100" }}>Cadência em atraso!</div>
            <div style={{ fontSize:12, color:"#888" }}>{atraso} passos não realizados no prazo esperado.</div>
          </div>
        </div>
      )}

      <CadenciaGrade cadencia={cadencia} />

      {cadencia?.pausada && !encerrada && !cadencia?.encerradaManualmente && (
        <div style={{ background:"#e3f2fd", border:"1.5px solid #90caf9", borderRadius:10, padding:"14px 16px", marginBottom:4, display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:20 }}>⏸️</span>
          <div>
            <div style={{ fontWeight:700, fontSize:13, color:"#1565c0" }}>Cadência pausada</div>
            <div style={{ fontSize:12, color:"#333" }}>Mova o lead para o estágio Novo Lead ou Em Contato para retomar.</div>
          </div>
        </div>
      )}
      {cadencia?.encerradaManualmente && (
        <div style={{ background:"#ffebee", border:"1.5px solid #ef9a9a", borderRadius:10, padding:"14px 16px", marginBottom:4, display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:20 }}>❌</span>
          <div>
            <div style={{ fontWeight:700, fontSize:13, color:"#c62828" }}>Cadência encerrada</div>
            <div style={{ fontSize:12, color:"#333" }}>Clique em Reiniciar para começar uma nova cadência.</div>
          </div>
        </div>
      )}
      {passoAtual && !cadencia?.pausada && (
        <div style={{ background:"#fafafa", border:`2px solid ${ACTION_COLORS[passoAtual.tipo]}22`, borderLeft:`4px solid ${ACTION_COLORS[passoAtual.tipo]}`, borderRadius:10, padding:16 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
            <span style={{ fontSize:26 }}>{ACTION_ICONS[passoAtual.tipo]}</span>
            <div>
              <div style={{ fontWeight:700, fontSize:15, color:ACTION_COLORS[passoAtual.tipo], fontFamily:"'Syne', sans-serif" }}>
                {labelPasso(passoAtual)} — {ACTION_LABELS[passoAtual.tipo]}
              </div>
              <div style={{ fontSize:11, color:"#aaa" }}>
                Passo {cadencia.passo} de {TOTAL_PASSOS} · {TOTAL_PASSOS - cadencia.passo} restantes
                {cadencia.dataInicio ? ` · Iniciado em ${(() => { const [y,m,d]=cadencia.dataInicio.split("-"); return `${d}/${m}/${y}`; })()}` : ""}
              </div>
            </div>
          </div>
          <div style={{ fontSize:12, fontWeight:700, color:"#555", marginBottom:8, fontFamily:"'DM Mono', monospace" }}>REALIZOU ESTA AÇÃO?</div>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={()=>onAvancar("nao_feito")}          style={{ ...btn("#ef5350"), flex:1, justifyContent:"center", fontSize:12 }}>✗ Não</button>
            <button onClick={()=>onAvancar("feito_nao_respondeu")} style={{ ...btn("#22c55e"), flex:1, justifyContent:"center", fontSize:12 }}>✓ Sim — não respondeu</button>
            <button onClick={()=>onAvancar("feito_respondeu")}     style={{ ...btn("#1b5e20"), flex:1, justifyContent:"center", fontSize:12 }}>✓ Sim — respondeu! 🎉</button>
          </div>
        </div>
      )}

      {encerrada && (
        <div style={{ background:"#fff3e0", border:"1.5px solid #ffa000", borderRadius:10, padding:20, textAlign:"center" }}>
          <div style={{ fontSize:28, marginBottom:8 }}>✅</div>
          <div style={{ fontWeight:700, fontSize:15, color:"#1b5e20", fontFamily:"'Syne', sans-serif" }}>Cadência encerrada</div>
          <div style={{ fontSize:12, color:"#333", marginTop:6, lineHeight:1.6 }}>{contatos} contato(s) realizado(s) em 14 dias.<br/>Clique em Reiniciar para começar uma nova cadência.</div>
          <div style={{ display:"flex", gap:8, marginTop:14, justifyContent:"center" }}>
            <button onClick={onReiniciar} style={{ ...btn("#1e88e5"), fontSize:12, padding:"7px 16px" }}>🔄 Reiniciar</button>
          </div>
        </div>
      )}

      {!cadencia && (
        <div style={{ fontSize:12, color:"#ccc", textAlign:"center", padding:"16px 0", fontFamily:"'DM Mono', monospace" }}>
          Nenhuma cadência ativa. Clique em "Iniciar cadência" para começar.
        </div>
      )}
    </div>
  );
}

// ── LeadModal
function LeadModal({ lead, onClose, onSave, onDelete, saving }) {
  const [form,    setForm]    = useState({ ...lead, tasks:[...(lead.tasks||[])], cadencia:lead.cadencia?{...lead.cadencia, historico:[...(lead.cadencia.historico||[])]}:null });
  const [newTask, setNewTask] = useState("");
  const [tab,     setTab]     = useState("info");

  const update = (f, v) => setForm(prev => {
    const next = { ...prev, [f]: v };
    // Se mudou a data de contato e tem cadência ativa, atualiza o início
    if (f === "dataContato" && next.cadencia) {
      next.cadencia = { ...next.cadencia, dataInicio: v };
    }
    // Se mudou estágio para Contato Futuro ou Fechado, pausa a cadência
    if (f === "stage" && next.cadencia) {
      if (v === "Contato Futuro" || v === "Fechado") {
        next.cadencia = { ...next.cadencia, pausada: true, encerradaManualmente: false };
      } else if (v === "Perdido") {
        // Se já completou todos os passos, não marcar como encerrada manualmente
        const jaCompleta = next.cadencia && next.cadencia.passo > TOTAL_PASSOS && !next.cadencia.encerradaManualmente;
        next.cadencia = { ...next.cadencia, pausada: true, encerradaManualmente: jaCompleta ? false : true };
      } else if (v === "Novo Lead" || v === "Em Contato") {
        next.cadencia = { ...next.cadencia, pausada: false, encerradaManualmente: false };
      }
    }
    return next;
  });

  const addTask = () => {
    if (!newTask.trim()) return;
    update("tasks", [...form.tasks, { id:Date.now(), text:newTask.trim(), done:false }]);
    setNewTask("");
  };

  const [showIniciarModal, setShowIniciarModal] = useState(false);
  const [dataInicioEscolhida, setDataInicioEscolhida] = useState("");

  const abrirIniciarCadencia = () => {
    // Data padrão = data de contato + 1 dia
    const base = form.dataContato || new Date().toISOString().split("T")[0];
    const [y,m,d] = base.split("-").map(Number);
    const amanha = new Date(y, m-1, d+1);
    const dataFormatada = amanha.getFullYear()+"-"+String(amanha.getMonth()+1).padStart(2,"0")+"-"+String(amanha.getDate()).padStart(2,"0");
    setDataInicioEscolhida(dataFormatada);
    setShowIniciarModal(true);
  };

  const confirmarIniciarCadencia = () => {
    update("cadencia", { passo:1, dataInicio: dataInicioEscolhida, historico:[], pausada:false, encerradaManualmente:false });
    if (form.stage === "Novo Lead") update("stage", "Em Contato");
    setShowIniciarModal(false);
  };

  const iniciarCadencia = abrirIniciarCadencia;
  const encerrarCadencia = () => {
    update("cadencia", { ...form.cadencia, encerradaManualmente: true, pausada: true });
    update("stage", "Perdido");
  };
  const reiniciarCadencia = () => {
    if (!window.confirm("Tem certeza? Isso vai apagar todos os contatos registrados na cadência.")) return;
    abrirIniciarCadencia();
  };

  const avancar = (status) => {
    const p         = form.cadencia.passo;
    const historico = [...(form.cadencia.historico||[]), { passo:p, status }];
    const proximoPasso = p >= TOTAL_PASSOS ? TOTAL_PASSOS+1 : p+1;
    // Se completou todos os passos, move para Perdido
    if (p >= TOTAL_PASSOS) {
      update("cadencia", { ...form.cadencia, passo: TOTAL_PASSOS+1, historico, pausada: true, encerradaManualmente: false });
      update("stage", "Perdido");
      return;
    }
    update("cadencia", { ...form.cadencia, passo: proximoPasso, historico });
  };

  const passoInfo = form.cadencia && form.cadencia.passo <= TOTAL_PASSOS ? getPasso(form.cadencia.passo) : null;
  const atraso    = calcularAtraso(form.cadencia);

  const tabBtn = (t, label) => (
    <button onClick={()=>setTab(t)} style={{ padding:"8px 20px", border:"none", borderBottom:tab===t?"2.5px solid #1e88e5":"2.5px solid transparent", background:"none", cursor:"pointer", fontWeight:tab===t?700:400, color:tab===t?"#1e88e5":"#888", fontSize:13, fontFamily:"'DM Sans', sans-serif" }}>
      {label}
    </button>
  );

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.38)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{ background:"#fff", borderRadius:18, width:"min(620px, 100vw)", maxWidth:"100vw", maxHeight:"92vh", overflowY:"auto", boxShadow:"0 24px 64px rgba(0,0,0,0.22)", fontFamily:"'DM Sans', sans-serif" }}>

        <div style={{ padding:"24px 28px 0", display:"flex", alignItems:"center", gap:14 }}>
          <Avatar name={form.name||"?"} />
          <div style={{ flex:1 }}>
            <input value={form.name} onChange={e=>update("name",e.target.value)} placeholder="Nome do lead"
              style={{ border:"none", outline:"none", fontSize:20, fontWeight:700, color:"#1a1a1a", width:"100%", fontFamily:"'Syne', sans-serif" }} />
            <div style={{ fontSize:13, color:"#888" }}>{form.phone}</div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4 }}>
            {passoInfo && (
              <div style={{ background:ACTION_COLORS[passoInfo.tipo]+"22", color:ACTION_COLORS[passoInfo.tipo], borderRadius:20, fontSize:11, fontWeight:700, padding:"4px 10px", fontFamily:"'DM Mono', monospace" }}>
                {ACTION_ICONS[passoInfo.tipo]} Dia {passoInfo.diaNum} · {passoInfo.acao}/3
              </div>
            )}
            {atraso > 0 && <div style={{ background:"#fff3e0", color:"#e65100", borderRadius:20, fontSize:11, fontWeight:700, padding:"4px 10px", fontFamily:"'DM Mono', monospace" }}>⚠️ {atraso} em atraso</div>}
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", fontSize:22, cursor:"pointer", color:"#bbb" }}>✕</button>
        </div>

        <div style={{ display:"flex", borderBottom:"1px solid #eee", margin:"16px 0 0", padding:"0 28px" }}>
          {tabBtn("info", "📋 Informações")}
          {tabBtn("cadencia", `📅 Follow-up${atraso>0?" ⚠️":""}`)}
        </div>

        <div style={{ padding:"20px 28px 24px" }}>
          {tab === "info" && (
            <>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
                <div>
                  <label style={labelStyle}>Estágio</label>
                  <select value={form.stage} onChange={e=>update("stage",e.target.value)} style={inputStyle}>
                    {STAGES.map(s=><option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Curso</label>
                  <select value={form.curso||""} onChange={e=>update("curso",e.target.value)} style={inputStyle}>
                    <option value="">Selecione...</option>
                    {CURSOS.map(c=><option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
                <div>
                  <label style={labelStyle}>Telefone</label>
                  <input value={form.phone} onChange={e=>update("phone",e.target.value)} style={inputStyle} placeholder="+55 11 99999-0000" />
                </div>
                <div>
                  <label style={labelStyle}>Data de contato</label>
                  <input type="date" value={form.dataContato||""} onChange={e=>update("dataContato",e.target.value)} style={inputStyle} />
                </div>
              </div>
              <div style={{ marginBottom:16 }}>
                <label style={labelStyle}>Anotações</label>
                <textarea value={form.notes} onChange={e=>update("notes",e.target.value)} rows={3} placeholder="Observações..."
                  style={{ ...inputStyle, resize:"vertical", fontFamily:"'DM Mono', monospace", fontSize:13 }} />
              </div>
              <div style={{ marginBottom:16 }}>
                <label style={labelStyle}>Tarefas</label>
                <div style={{ display:"flex", gap:8, marginBottom:10 }}>
                  <input value={newTask} onChange={e=>setNewTask(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addTask()} placeholder="Nova tarefa..." style={{ ...inputStyle, flex:1 }} />
                  <button onClick={addTask} style={btn("#1e88e5")}>+ Add</button>
                </div>
                {form.tasks.length===0 && <div style={{ color:"#bbb", fontSize:13 }}>Nenhuma tarefa ainda.</div>}
                {form.tasks.map(t=>(
                  <div key={t.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 10px", background:t.done?"#f9f9f9":"#fff", border:"1px solid #eee", borderRadius:8, marginBottom:6 }}>
                    <input type="checkbox" checked={t.done} onChange={()=>update("tasks",form.tasks.map(x=>x.id===t.id?{...x,done:!x.done}:x))} style={{ accentColor:"#1e88e5", width:16, height:16 }} />
                    <span style={{ flex:1, fontSize:13, color:t.done?"#bbb":"#333", textDecoration:t.done?"line-through":"none" }}>{t.text}</span>
                    <button onClick={()=>update("tasks",form.tasks.filter(x=>x.id!==t.id))} style={{ background:"none", border:"none", color:"#ddd", cursor:"pointer", fontSize:16 }}>✕</button>
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === "cadencia" && (
            <>
              <CadenciaPanel cadencia={form.cadencia} onIniciar={iniciarCadencia} onAvancar={avancar} onEncerrar={encerrarCadencia} onReiniciar={reiniciarCadencia} />
              {showIniciarModal && (
                <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:2000 }}>
                  <div style={{ background:"#fff", borderRadius:16, padding:"28px 32px", width:340, boxShadow:"0 16px 48px rgba(0,0,0,0.2)", fontFamily:"'DM Sans', sans-serif" }}>
                    <div style={{ fontWeight:700, fontSize:17, color:"#1a1a1a", fontFamily:"'Syne', sans-serif", marginBottom:6 }}>📅 Iniciar cadência</div>
                    <div style={{ fontSize:13, color:"#888", marginBottom:18 }}>O Dia 1 será realizado na data abaixo. Você pode alterar se necessário.</div>
                    <label style={labelStyle}>Data de início do Dia 1</label>
                    <input type="date" value={dataInicioEscolhida} onChange={e=>setDataInicioEscolhida(e.target.value)}
                      style={{ ...inputStyle, marginBottom:20 }} />
                    <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
                      <button onClick={()=>setShowIniciarModal(false)} style={btn("#eeeeee","#555")}>Cancelar</button>
                      <button onClick={confirmarIniciarCadencia} style={btn("#1e88e5")}>▶ Iniciar</button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          <div style={{ display:"flex", gap:10, justifyContent:"space-between" }}>
            <button onClick={()=>onDelete(form.id)} style={{ ...btn("#ffebee","#c62828"), fontSize:12 }}>🗑️ Excluir lead</button>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={onClose} style={btn("#eeeeee","#555")}>Cancelar</button>
              <button onClick={()=>onSave(form)} disabled={saving} style={{ ...btn("#22c55e"), opacity:saving?0.7:1 }}>
                {saving?"⏳ Salvando...":"💾 Salvar"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ConfigScreen
function ConfigScreen({ onSave }) {
  const [url, setUrl] = useState("");
  return (
    <div style={{ minHeight:"100vh", background:"#f2f3f5", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'DM Sans', sans-serif" }}>
      <div style={{ background:"#fff", borderRadius:18, padding:"40px 44px", width:520, boxShadow:"0 8px 40px rgba(0,0,0,0.1)" }}>
        <div style={{ fontFamily:"'Syne', sans-serif", fontWeight:800, fontSize:26, marginBottom:8 }}>📋 Conectare<span style={{ color:"#1e88e5" }}>CRM</span></div>
        <div style={{ fontSize:14, color:"#888", marginBottom:28, lineHeight:1.6 }}>Para salvar os dados no Google Sheets, cole abaixo a URL gerada pelo Apps Script.</div>
        <div style={{ background:"#f8f8f8", borderRadius:10, padding:"14px 16px", marginBottom:24, fontSize:12, color:"#666", lineHeight:1.9 }}>
          <b>Como obter a URL:</b><br/>
          1. Abra sua planilha no Google Sheets<br/>
          2. Clique em <b>Extensões → Apps Script</b><br/>
          3. Cole o código do arquivo <b>.gs</b> e salve<br/>
          4. Clique em <b>Implantar → Nova implantação</b><br/>
          5. Tipo: <b>App da Web</b> · Acesso: <b>Qualquer pessoa</b><br/>
          6. Copie a URL e cole abaixo
        </div>
        <label style={labelStyle}>URL do Apps Script</label>
        <input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/..." style={{ ...inputStyle, marginBottom:16 }} />
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={()=>onSave(url)} disabled={!url.trim()} style={{ ...btn("#1e88e5"), flex:1, justifyContent:"center", opacity:url.trim()?1:0.5 }}>✅ Conectar ao Google Sheets</button>
          <button onClick={()=>onSave("local")} style={{ ...btn("#e0e0e0","#555"), fontSize:12 }}>Usar sem salvar</button>
        </div>
      </div>
    </div>
  );
}

// ── Leads de exemplo
const LEADS_EXEMPLO = [
  { id:1, name:"Ana Paula Souza",  phone:"+55 11 99123-4567", stage:"Novo Lead",  curso:"Técnico EAD",                  dataContato:"2026-06-01", notes:"Interesse no curso de Enfermagem.", tasks:[{id:1,text:"Enviar tabela de preços",done:false}], cadencia:{ passo:1, dataInicio:"2026-06-01", historico:[] } },
  { id:2, name:"Carlos Mendonça",  phone:"+55 21 98765-0001", stage:"Em Contato", curso:"EJA",                          dataContato:"2026-05-25", notes:"Quer terminar o ensino médio.", tasks:[], cadencia:{ passo:7, dataInicio:"2026-05-25", historico:[{passo:1,status:"feito_nao_respondeu"},{passo:2,status:"feito_nao_respondeu"},{passo:3,status:"nao_feito"},{passo:4,status:"feito_nao_respondeu"},{passo:5,status:"feito_nao_respondeu"},{passo:6,status:"feito_respondeu"}] } },
  { id:3, name:"Beatriz Lima",     phone:"+55 31 97654-3210", stage:"Novo Lead",  curso:"Certificação por Competência", dataContato:"2026-05-20", notes:"Já tem experiência, só precisa da certificação.", tasks:[{id:1,text:"Verificar documentação",done:true}], cadencia:{ passo:4, dataInicio:"2026-05-20", historico:[{passo:1,status:"feito_nao_respondeu"},{passo:2,status:"feito_nao_respondeu"},{passo:3,status:"feito_nao_respondeu"}] } },
  { id:4, name:"Rafael Torres",    phone:"+55 11 91234-5678", stage:"Fechado",    curso:"Técnico EAD",                  dataContato:"2026-05-10", notes:"Matriculado! Pagamento confirmado.", tasks:[], cadencia:null },
  { id:5, name:"Mariana Costa",    phone:"+55 11 99876-5432", stage:"Perdido",    curso:"EJA",                          dataContato:"2026-05-01", notes:"Não tem interesse no momento.", tasks:[], cadencia:null },
];

let nextId = Date.now();

export default function App() {
  const [sheetUrl,    setSheetUrl]    = useState(SHEET_URL || null);
  const [configured,  setConfigured]  = useState(true);
  const [leads,       setLeads]       = useState(LEADS_EXEMPLO);
  const [loading,     setLoading]     = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [syncStatus,  setSyncStatus]  = useState("idle");
  const [selected,    setSelected]    = useState(null);
  const [search,      setSearch]      = useState("");
  const [filterStage, setFilterStage] = useState("Todos");
  const [filterDataDe,  setFilterDataDe]  = useState("");
  const [filterDataAte, setFilterDataAte] = useState("");
  const [filterCurso, setFilterCurso] = useState("Todos");
  const [showAdd,     setShowAdd]     = useState(false);

  const carregarLeads = useCallback(async () => {
    if (!sheetUrl || sheetUrl === "local") return;
    setLoading(true); setSyncStatus("syncing");
    try {
      const data = await apiGet(sheetUrl);
      if (data?.leads) { setLeads(data.leads); setSyncStatus("ok"); }
      else setSyncStatus("error");
    } catch { setSyncStatus("error"); }
    finally { setLoading(false); }
  }, [sheetUrl]);

  useEffect(() => { if (configured && sheetUrl && sheetUrl !== "local") carregarLeads(); }, [configured, carregarLeads]);

  const handleSave = async (form) => {
    setSaving(true);
    setLeads(ls=>ls.map(l=>l.id===form.id?form:l));
    setSelected(null); setShowAdd(false);
    if (sheetUrl && sheetUrl !== "local") {
      setSyncStatus("syncing");
      try { await apiSave(form, sheetUrl); setSyncStatus("ok"); }
      catch { setSyncStatus("error"); }
    }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Tem certeza que deseja excluir este lead?")) return;
    setLeads(ls => ls.filter(l => l.id !== id));
    setSelected(null);
    if (sheetUrl && sheetUrl !== "local") {
      try { await fetch(sheetUrl, { method:"POST", body:JSON.stringify({ action:"delete", id }) }); }
      catch { }
    }
  };

  const handleAdd = async (form) => {
    const lead = { ...form, id:nextId++ };
    setLeads(ls=>[lead,...ls]);
    setShowAdd(false);
    if (sheetUrl && sheetUrl !== "local") {
      setSyncStatus("syncing");
      try { await apiSave(lead, sheetUrl); setSyncStatus("ok"); }
      catch { setSyncStatus("error"); }
    }
  };

  const handleDrop = async (lead, stage) => {
    let cadencia = lead.cadencia ? { ...lead.cadencia } : null;
    if (cadencia) {
      if (stage === "Contato Futuro" || stage === "Fechado") {
        cadencia = { ...cadencia, pausada: true, encerradaManualmente: false };
      } else if (stage === "Perdido") {
        const jaCompleta = cadencia.passo > TOTAL_PASSOS && !cadencia.encerradaManualmente;
        cadencia = { ...cadencia, pausada: true, encerradaManualmente: jaCompleta ? false : true };
      } else if (stage === "Novo Lead" || stage === "Em Contato") {
        cadencia = { ...cadencia, pausada: false, encerradaManualmente: false };
      }
    }
    const updated = { ...lead, stage, cadencia };
    setLeads(ls=>ls.map(l=>l.id===lead.id?updated:l));
    if (sheetUrl && sheetUrl !== "local") {
      try { await apiSave(updated, sheetUrl); setSyncStatus("ok"); }
      catch { setSyncStatus("error"); }
    }
  };

  const filtered = useMemo(() => leads.filter(l => {
    const q = search.toLowerCase();
    return (!q || l.name.toLowerCase().includes(q) || l.phone.includes(q) || (l.curso||"").toLowerCase().includes(q))
      && (filterStage==="Todos" || l.stage===filterStage)
      && (filterCurso==="Todos" || l.curso===filterCurso)
      && (!filterDataDe  || (l.dataContato && l.dataContato >= filterDataDe))
      && (!filterDataAte || (l.dataContato && l.dataContato <= filterDataAte));
  }).sort((a, b) => {
    const atrasoA = calcularAtraso(a.cadencia);
    const atrasoB = calcularAtraso(b.cadencia);
    const temCadA = a.cadencia && a.cadencia.passo <= TOTAL_PASSOS;
    const temCadB = b.cadencia && b.cadencia.passo <= TOTAL_PASSOS;
    // 1º: em atraso primeiro → mais atrasado primeiro → nome A-Z
    if (atrasoA > 0 && atrasoB === 0) return -1;
    if (atrasoB > 0 && atrasoA === 0) return 1;
    if (atrasoA > 0 && atrasoB > 0) {
      if (atrasoB !== atrasoA) return atrasoB - atrasoA;
      return a.name.localeCompare(b.name, "pt-BR");
    }
    // 2º: cadência ativa em dia → próximo contato → nome A-Z
    if (temCadA && temCadB && atrasoA === 0 && atrasoB === 0) {
      const proxA = dataProximoContato(a.cadencia) || "9999";
      const proxB = dataProximoContato(b.cadencia) || "9999";
      if (proxA !== proxB) return proxA.localeCompare(proxB);
      return a.name.localeCompare(b.name, "pt-BR");
    }
    if (temCadA && !temCadB) return -1;
    if (temCadB && !temCadA) return 1;
    // 3º: sem cadência → data contato → nome A-Z
    const da = a.dataContato ? a.dataContato.replace(/-/g,"") : "0";
    const db = b.dataContato ? b.dataContato.replace(/-/g,"") : "0";
    if (da !== db) return da.localeCompare(db);
    return a.name.localeCompare(b.name, "pt-BR");
  }), [leads, search, filterStage, filterCurso, filterDataDe, filterDataAte]);

  const emAtraso  = leads.filter(l=>calcularAtraso(l.cadencia)>0).length;
  const syncIcon  = syncStatus==="syncing"?"⏳":syncStatus==="ok"?"🟢":syncStatus==="error"?"🔴":"";
  const syncLabel = syncStatus==="syncing"?"Sincronizando...":syncStatus==="ok"?"Salvo no Sheets":syncStatus==="error"?"Erro ao sincronizar":"";

  if (!configured) return <ConfigScreen onSave={(url)=>{setSheetUrl(url);setConfigured(true);}} />;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;700&family=DM+Mono&display=swap');
        * { box-sizing:border-box; margin:0; padding:0; }
        body { background:#f2f3f5; }
        ::-webkit-scrollbar { width:6px; height:6px; }
        ::-webkit-scrollbar-thumb { background:#ddd; border-radius:6px; }
      `}</style>
      <div style={{ minHeight:"100vh", background:"#f2f3f5", fontFamily:"'DM Sans', sans-serif" }}>
        <div style={{ background:"#fff", borderBottom:"1.5px solid #ececec", padding:"0 28px", display:"flex", alignItems:"center", gap:16, height:64 }}>
          <div style={{ fontFamily:"'Syne', sans-serif", fontWeight:800, fontSize:22, color:"#1a1a1a", letterSpacing:"-0.02em", display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:26 }}>📋</span> Conectare<span style={{ color:"#1e88e5" }}>CRM</span>
          </div>
          {emAtraso > 0 && (
            <div style={{ background:"#fff3e0", color:"#e65100", borderRadius:20, fontSize:12, fontWeight:700, padding:"4px 12px", fontFamily:"'DM Mono', monospace" }}>
              ⚠️ {emAtraso} lead(s) em atraso
            </div>
          )}
          <div style={{ flex:1 }} />
          {syncLabel && <div style={{ fontSize:12, color:"#aaa", fontFamily:"'DM Mono', monospace" }}>{syncIcon} {syncLabel}</div>}
          {sheetUrl && sheetUrl !== "local" && (
            <button onClick={carregarLeads} disabled={loading} style={{ ...btn("#f0f0f0","#555"), fontSize:12, padding:"6px 12px" }}>{loading?"⏳":"🔄"} Atualizar</button>
          )}
          <button onClick={()=>setShowAdd(true)} style={btn("#1e88e5")}>+ Novo Lead</button>
        </div>

        <div style={{ padding:"16px 28px 10px", display:"flex", gap:12, alignItems:"center", flexWrap:"wrap" }}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍  Buscar por nome, telefone ou curso..."
            style={{ ...inputStyle, maxWidth:300, flex:"0 0 auto", background:"#fff", fontSize:13 }} />
          <select value={filterStage} onChange={e=>setFilterStage(e.target.value)} style={{ ...inputStyle, width:"auto", flex:"0 0 auto", background:"#fff" }}>
            <option>Todos</option>{STAGES.map(s=><option key={s}>{s}</option>)}
          </select>
          <select value={filterCurso} onChange={e=>setFilterCurso(e.target.value)} style={{ ...inputStyle, width:"auto", flex:"0 0 auto", background:"#fff" }}>
            <option>Todos</option>{CURSOS.map(c=><option key={c}>{c}</option>)}
          </select>
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ fontSize:12, color:"#888" }}>De</span>
            <input type="date" value={filterDataDe} onChange={e=>setFilterDataDe(e.target.value)} style={{ ...inputStyle, width:"auto", flex:"0 0 auto", background:"#fff", fontSize:12 }} />
            <span style={{ fontSize:12, color:"#888" }}>Até</span>
            <input type="date" value={filterDataAte} onChange={e=>setFilterDataAte(e.target.value)} style={{ ...inputStyle, width:"auto", flex:"0 0 auto", background:"#fff", fontSize:12 }} />
            {(filterDataDe||filterDataAte) && <button onClick={()=>{setFilterDataDe("");setFilterDataAte("");}} style={{ ...btn("#f0f0f0","#555"), fontSize:11, padding:"6px 10px" }}>✕</button>}
          </div>
          <span style={{ fontSize:13, color:"#aaa", fontFamily:"'DM Mono', monospace" }}>{filtered.length} lead(s)</span>
        </div>

        {loading ? (
          <div style={{ textAlign:"center", padding:"40px", color:"#aaa", fontSize:14 }}>⏳ Carregando leads do Google Sheets...</div>
        ) : (
          <div style={{ padding:"8px 28px 28px" }}>
            <KanbanBoard leads={filtered} onCardClick={setSelected} onDrop={handleDrop} />
          </div>
        )}

        {selected && <LeadModal lead={selected} onClose={()=>setSelected(null)} onSave={handleSave} onDelete={handleDelete} saving={saving} />}
        {showAdd  && <LeadModal lead={{ id:0, name:"", phone:"", curso:"", stage:"Novo Lead", dataContato: (() => { const h = new Date(); return h.getFullYear()+"-"+String(h.getMonth()+1).padStart(2,"0")+"-"+String(h.getDate()).padStart(2,"0"); })(), notes:"", tasks:[], cadencia:null }} onClose={()=>setShowAdd(false)} onSave={handleAdd} onDelete={()=>{}} saving={saving} />}
      </div>
    </>
  );
}
