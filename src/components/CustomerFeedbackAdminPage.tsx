"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Star, ArrowClockwise, Copy, DownloadSimple, PencilSimple, Plus, QrCode } from "@phosphor-icons/react";
import {
  createCustomerFeedbackCashier,
  loadCustomerFeedbackDashboard,
  renameCustomerFeedbackCashier,
  rotateCustomerFeedbackQr,
  setCustomerFeedbackCashierActive,
  type CustomerFeedbackDashboard,
  type CustomerFeedbackLocation,
} from "../lib/customer-feedback-api";
import { ConfirmButton } from "./ui/modal";

export function CustomerFeedbackAdminPage({ companyId }: { companyId: string }) {
  const [dashboard, setDashboard] = useState<CustomerFeedbackDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cashierName, setCashierName] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setDashboard(await loadCustomerFeedbackDashboard(companyId));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar as avaliações de clientes.");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const perform = async (operation: () => Promise<unknown>, successMessage: string): Promise<boolean> => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
      await refresh();
      setNotice(successMessage);
      return true;
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : "Não foi possível concluir a operação.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submitCashier = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = cashierName.trim();
    if (name.length < 2) {
      setError("Informe o nome do caixa com pelo menos 2 caracteres.");
      return;
    }
    if (await perform(() => createCustomerFeedbackCashier(companyId, name), "Caixa e QR Code cadastrados.")) {
      setCashierName("");
    }
  };

  const overallAverage = dashboard?.summary.averageRating ?? null;
  const cashiers = useMemo(() => dashboard?.locations.filter((location) => location.kind === "CASHIER") ?? [], [dashboard]);
  const generalLocation = dashboard?.locations.find((location) => location.kind === "GENERAL");

  return <>
    <header className="live-page-heading">
      <h1>Avaliação de Clientes</h1>
      <p>Receba opiniões por QR Code. Essas respostas ficam separadas das avaliações internas e não alteram indicadores de colaboradores.</p>
    </header>
    {error && <div className="live-notice error" role="alert">{error}</div>}
    {notice && <div className="live-notice success" role="status">{notice}</div>}
    {loading && !dashboard ? <section className="live-panel"><p>Carregando avaliações de clientes…</p></section> : dashboard ? <>
      <dl className="overview-summary overview-summary-3 customer-feedback-summary" aria-label="Resumo das avaliações de clientes">
        <div><dt>Avaliações recebidas</dt><dd>{dashboard.summary.responseCount}</dd></div>
        <div><dt>Média do supermercado</dt><dd>{overallAverage === null ? "—" : overallAverage.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}<small>{overallAverage === null ? `Disponível após ${dashboard.privacyThreshold} respostas` : "/ 5"}</small></dd></div>
        <div><dt>Caixas cadastrados</dt><dd>{cashiers.length}</dd></div>
      </dl>

      <section className="live-panel customer-feedback-panel">
        <div className="live-panel-heading">
          <div><h2>QR Code geral do supermercado</h2><p>Para colocar em mesas, entrada ou outros pontos da loja.</p></div>
        </div>
        {generalLocation && <FeedbackQrCard location={generalLocation} busy={busy} privacyThreshold={dashboard.privacyThreshold} onRotate={() => perform(
          () => rotateCustomerFeedbackQr(companyId, generalLocation.id),
          "O QR Code geral foi renovado. Atualize os materiais impressos.",
        )}/>}
      </section>

      <section className="live-panel customer-feedback-panel">
        <div className="live-panel-heading">
          <div><h2>QR Codes por caixa</h2><p>Cadastre o nome usado para identificar o caixa. Isso não cria nem altera uma conta de colaborador.</p></div>
        </div>
        <form className="customer-feedback-cashier-form" onSubmit={(event) => void submitCashier(event)}>
          <label>Nome do caixa<input value={cashierName} maxLength={60} onChange={(event) => setCashierName(event.target.value)} placeholder="Ex.: Caixa 01" required/></label>
          <button type="submit" className="button button-primary" disabled={busy}><Plus size={16}/> Adicionar caixa</button>
        </form>
        <div className="customer-feedback-cashiers">
          {cashiers.map((cashier) => <CashierQrCard
            key={cashier.id}
            cashier={cashier}
            busy={busy}
            privacyThreshold={dashboard.privacyThreshold}
            onRename={(name) => perform(() => renameCustomerFeedbackCashier(companyId, cashier.id, name), "Nome do caixa atualizado.")}
            onToggle={() => perform(() => setCustomerFeedbackCashierActive(companyId, cashier.id, !cashier.active), cashier.active ? "Caixa desativado; seu QR Code não aceitará novas respostas." : "Caixa reativado.")}
            onRotate={() => perform(() => rotateCustomerFeedbackQr(companyId, cashier.id), "QR Code do caixa renovado. Atualize o material impresso.")}
          />)}
          {!cashiers.length && <p className="empty-inline">Cadastre caixas para criar QR Codes específicos e consultar a avaliação do atendimento.</p>}
        </div>
      </section>

      <section className="live-panel customer-feedback-panel">
        <div className="live-panel-heading"><div><h2>Comentários recentes</h2><p>Os comentários aparecem assim que são enviados. As médias são liberadas após {dashboard.privacyThreshold} respostas. Exibindo até {dashboard.maxRecentResponses} avaliações recentes.</p></div></div>
        {dashboard.recentResponses.length ? <div className="customer-feedback-comments">
          {dashboard.recentResponses.map((response) => <article className="customer-feedback-comment" key={response.id}>
            <div className="customer-feedback-comment-heading">
              <span><b>{response.sourceLocationName}</b>{response.cashierName && <small> · Atendimento: {response.cashierName}</small>}</span>
              <time dateTime={response.submittedAt ?? undefined}>{response.submittedAt ? new Date(response.submittedAt).toLocaleString("pt-BR") : "Data indisponível"}</time>
            </div>
            <div className="customer-feedback-comment-ratings">
              <span>Supermercado <RatingDisplay rating={response.overallRating}/></span>
              {response.cashierRating !== null && <span>Caixa <RatingDisplay rating={response.cashierRating}/></span>}
            </div>
            <p>{response.comment || "Nenhum comentário enviado."}</p>
          </article>)}
        </div> : <p className="empty-inline">Ainda não há avaliações de clientes.</p>}
      </section>
    </> : <section className="live-panel"><p>Os dados das avaliações de clientes não estão disponíveis.</p><button className="button button-outline" onClick={() => void refresh()}>Tentar novamente</button></section>}
  </>;
}

function FeedbackQrCard({ location, busy, privacyThreshold, onRotate }: { location: CustomerFeedbackLocation; busy: boolean; privacyThreshold: number; onRotate: () => void }) {
  const [url, setUrl] = useState("");
  const [copyError, setCopyError] = useState("");
  const qrElementId = `customer-feedback-qr-${location.id}`;

  useEffect(() => {
    setUrl(`${window.location.origin}/avaliar/${encodeURIComponent(location.publicToken)}`);
  }, [location.publicToken]);

  const copyLink = async () => {
    setCopyError("");
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      setCopyError("Não foi possível copiar o link. Selecione e copie o endereço manualmente.");
    }
  };

  const downloadQr = () => {
    setCopyError("");
    const qrElement = document.getElementById(qrElementId);
    if (!(qrElement instanceof SVGSVGElement)) {
      setCopyError("Não foi possível preparar o arquivo do QR Code.");
      return;
    }
    const svg = new XMLSerializer().serializeToString(qrElement);
    const objectUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const link = document.createElement("a");
    const fileName = location.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLocaleLowerCase("pt-BR") || "qr-code";
    link.href = objectUrl;
    link.download = `avaliacao-${fileName}.svg`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  };

  return <div className="customer-feedback-qr-card">
    {location.active && url ? <QRCodeSVG id={qrElementId} value={url} size={180} level="M" includeMargin aria-label={`QR Code de ${location.name}`}/> : <span className="customer-feedback-qr-unavailable"><QrCode size={42}/>{location.active ? "Preparando QR Code…" : "QR Code desativado"}</span>}
    <div className="customer-feedback-qr-copy">
      <b>{location.name}</b>
      {location.kind === "CASHIER" && <small>{location.cashierRatingCount} {location.cashierRatingCount === 1 ? "avaliação de atendimento" : "avaliações de atendimento"} · Média {location.cashierAverage === null
        ? location.cashierRatingCount ? `disponível após ${privacyThreshold} respostas` : "—"
        : `${location.cashierAverage.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}/5`}</small>}
      {url && <label>Link público<input readOnly value={url} onFocus={(event) => event.currentTarget.select()}/></label>}
      <div className="customer-feedback-qr-actions">
        <button type="button" className="button button-outline button-small" disabled={!url || !location.active} onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>Testar avaliação</button>
        <button type="button" className="button button-outline button-small" disabled={!url || !location.active} onClick={() => void copyLink()}><Copy size={15}/> Copiar link</button>
        <button type="button" className="button button-outline button-small" disabled={!url || !location.active} onClick={downloadQr}><DownloadSimple size={15}/> Baixar QR</button>
        <ConfirmButton
          dialogTitle="Renovar QR Code"
          description="O QR Code atual deixará de funcionar imediatamente. Será necessário substituir os materiais impressos por um novo código."
          className="button button-outline button-small"
          confirmLabel="Renovar"
          onConfirm={onRotate}
          disabled={busy}
        ><ArrowClockwise size={15}/> Renovar</ConfirmButton>
      </div>
      {copyError && <small className="customer-feedback-copy-error" role="alert">{copyError}</small>}
    </div>
  </div>;
}

function CashierQrCard({ cashier, busy, privacyThreshold, onRename, onToggle, onRotate }: {
  cashier: CustomerFeedbackLocation;
  busy: boolean;
  privacyThreshold: number;
  onRename: (name: string) => Promise<boolean>;
  onToggle: () => void;
  onRotate: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(cashier.name);

  return <article className={`customer-feedback-cashier${cashier.active ? "" : " is-inactive"}`}>
    <div className="customer-feedback-cashier-heading">
      <div><h3>{cashier.name}</h3><span className={`status-chip ${cashier.active ? "done" : "pending"}`}>{cashier.active ? "Ativo" : "Inativo"}</span></div>
      <div className="customer-feedback-cashier-actions">
        <button type="button" className="button button-outline button-small" onClick={() => { setName(cashier.name); setEditing((current) => !current); }}><PencilSimple size={15}/>{editing ? "Cancelar" : "Renomear"}</button>
        <ConfirmButton
          dialogTitle={cashier.active ? "Desativar caixa" : "Reativar caixa"}
          description={cashier.active ? <>O QR Code de <b>{cashier.name}</b> deixará de aceitar novas respostas. As avaliações existentes serão mantidas.</> : <>O QR Code existente de <b>{cashier.name}</b> voltará a aceitar respostas.</>}
          className="button button-outline button-small"
          confirmLabel={cashier.active ? "Desativar" : "Reativar"}
          onConfirm={onToggle}
          disabled={busy}
        >{cashier.active ? "Desativar" : "Reativar"}</ConfirmButton>
      </div>
    </div>
    {editing && <form className="customer-feedback-rename-form" onSubmit={(event) => { event.preventDefault(); void onRename(name.trim()).then((saved) => { if (saved) setEditing(false); }); }}>
      <label>Novo nome<input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} minLength={2} required/></label>
      <button className="button button-primary button-small" disabled={busy || name.trim() === cashier.name}>Salvar</button>
    </form>}
    <FeedbackQrCard location={cashier} busy={busy} privacyThreshold={privacyThreshold} onRotate={onRotate}/>
  </article>;
}

function RatingDisplay({ rating }: { rating: number }) {
  return <span className="customer-feedback-rating-display" aria-label={`${rating} de 5 estrelas`}>
    {Array.from({ length: 5 }, (_, index) => <Star key={index} size={14} weight={index < rating ? "fill" : "regular"} aria-hidden="true"/>)} <b>{rating}/5</b>
  </span>;
}
