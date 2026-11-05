"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Star } from "@phosphor-icons/react";
import { CompanyLogo } from "./CompanyLogo";
import {
  loadPublicCustomerFeedbackForm,
  sendPublicCustomerFeedback,
  type PublicCustomerFeedbackForm as PublicForm,
} from "../lib/customer-feedback-api";

export function CustomerFeedbackForm({ token }: { token: string }) {
  const [form, setForm] = useState<PublicForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [overallRating, setOverallRating] = useState(0);
  const [evaluateCashier, setEvaluateCashier] = useState(false);
  const [cashierId, setCashierId] = useState("");
  const [cashierRating, setCashierRating] = useState(0);
  const [comment, setComment] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let active = true;
    loadPublicCustomerFeedbackForm(token)
      .then((result) => {
        if (!active) return;
        setForm(result);
        if (result.location.kind === "CASHIER") setCashierId(result.location.id);
        setLoadError("");
      })
      .catch((loadFailure: unknown) => {
        if (active) setLoadError(loadFailure instanceof Error ? loadFailure.message : "Não foi possível abrir esta avaliação.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (!overallRating) {
      setError("Selecione uma nota para sua experiência no supermercado.");
      return;
    }
    if (evaluateCashier && (!cashierId || !cashierRating)) {
      setError(form?.location.kind === "GENERAL"
        ? "Selecione o caixa e dê uma nota para o atendimento."
        : "Dê uma nota para o atendimento do caixa.");
      return;
    }

    setBusy(true);
    try {
      await sendPublicCustomerFeedback({
        token,
        overallRating,
        ...(evaluateCashier ? { cashierId, cashierRating } : {}),
        comment: comment.trim(),
        website,
      });
      setSubmitted(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Não foi possível enviar sua avaliação. Tente novamente.");
    } finally {
      setBusy(false);
    }
  };

  return <main className="customer-feedback-page">
    <section className="customer-feedback-card">
      <div className="customer-feedback-brand"><CompanyLogo className="auth-company-logo"/></div>
      {loading ? <div className="customer-feedback-state" role="status"><span className="customer-feedback-spinner"/><p>Carregando avaliação…</p></div>
        : loadError ? <div className="customer-feedback-state" role="alert"><h1>Este QR Code não está disponível</h1><p>{loadError}</p></div>
          : submitted ? <div className="customer-feedback-state customer-feedback-thanks" role="status"><span aria-hidden="true">✓</span><h1>Obrigado pela sua avaliação!</h1><p>Sua opinião nos ajuda a melhorar a experiência no {form?.companyName}.</p></div>
            : form && <>
              <span className="customer-feedback-eyebrow">SUA OPINIÃO IMPORTA</span>
              <h1>Avalie sua experiência</h1>
              <p className="customer-feedback-intro">{form.companyName}{form.location.kind === "CASHIER" ? ` · ${form.location.name}` : ""}</p>
              <form className="customer-feedback-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
                <fieldset className="customer-feedback-question">
                  <legend>Como foi sua experiência no supermercado?</legend>
                  <RatingInput label="Avaliação do supermercado" value={overallRating} onChange={setOverallRating}/>
                </fieldset>

                <section className="customer-feedback-cashier-question">
                  {form.location.kind === "CASHIER" || form.cashiers.length > 0
                    ? <label className="customer-feedback-checkbox">
                      <input type="checkbox" checked={evaluateCashier} onChange={(event) => { setEvaluateCashier(event.target.checked); if (!event.target.checked) setCashierRating(0); }}/>
                      <span>{form.location.kind === "CASHIER" ? `Também quero avaliar o atendimento de ${form.location.name}` : "Também quero avaliar o atendimento do caixa"}</span>
                    </label>
                    : <p className="customer-feedback-no-cashiers">O atendimento do caixa poderá ser avaliado quando houver caixas cadastrados.</p>}
                  {evaluateCashier && <div className="customer-feedback-cashier-fields">
                    {form.location.kind === "GENERAL" && <label>Qual caixa atendeu você?
                      <select value={cashierId} onChange={(event) => setCashierId(event.target.value)} required>
                        <option value="">Selecione o caixa</option>
                        {form.cashiers.map((cashier) => <option key={cashier.id} value={cashier.id}>{cashier.name}</option>)}
                      </select>
                    </label>}
                    <fieldset className="customer-feedback-question">
                      <legend>Como foi o atendimento?</legend>
                      <RatingInput label="Avaliação do atendimento do caixa" value={cashierRating} onChange={setCashierRating}/>
                    </fieldset>
                  </div>}
                </section>

                <label className="customer-feedback-comment-label">Comentário <span>opcional</span>
                  <textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={1000} rows={4} placeholder="Conte o que podemos melhorar…"/>
                  <small>{comment.length}/1.000</small>
                </label>
                <label className="customer-feedback-honeypot" aria-hidden="true" tabIndex={-1}>Não preencher<input value={website} onChange={(event) => setWebsite(event.target.value)} autoComplete="off" tabIndex={-1}/></label>
                {error && <p className="customer-feedback-error" role="alert">{error}</p>}
                <button type="submit" className="customer-feedback-submit" disabled={busy}>{busy ? "Enviando…" : "Enviar avaliação"}</button>
                <p className="customer-feedback-privacy">Sua avaliação é anônima e será usada para melhorar nosso atendimento.</p>
              </form>
            </>}
    </section>
  </main>;
}

function RatingInput({ label, value, onChange }: { label: string; value: number; onChange: (rating: number) => void }) {
  return <div className="customer-feedback-stars" role="group" aria-label={label}>
    {Array.from({ length: 5 }, (_, index) => {
      const rating = index + 1;
      return <button key={rating} type="button" aria-pressed={value === rating} aria-label={`${rating} ${rating === 1 ? "estrela" : "estrelas"}`} onClick={() => onChange(rating)}>
        <Star size={34} weight={value >= rating ? "fill" : "regular"} aria-hidden="true"/>
      </button>;
    })}
  </div>;
}
