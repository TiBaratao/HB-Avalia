"use client";

import { useState } from "react";
import type { User } from "firebase/auth";
import { refreshEmailVerification, resendVerificationEmail, signOutCurrentUser } from "../lib/firebase/auth";
import { CompanyLogo } from "./CompanyLogo";
import { ThemeToggle } from "./ThemeProvider";

export function EmailVerificationPanel({ user, onVerified }: { user: User; onVerified: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function sendAgain() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await resendVerificationEmail(user);
      setMessage("Enviamos um novo link de verificação. Confira sua caixa de entrada e o spam.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível enviar o e-mail de verificação.");
    } finally {
      setBusy(false);
    }
  }

  async function checkVerification() {
    setBusy(true);
    setError("");
    try {
      if (await refreshEmailVerification(user)) onVerified();
      else setMessage("Ainda não identificamos a verificação. Abra o link recebido e tente novamente.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível confirmar a verificação.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <ThemeToggle />
      <section className="auth-card">
        <div className="auth-company-brand">
          <CompanyLogo className="auth-company-logo" />
          <span><b>HB Avalia</b><small>Desempenho e liderança</small></span>
        </div>
        <p className="eyebrow">VERIFICAÇÃO DE E-MAIL</p>
        <h1>Confirme seu endereço</h1>
        <p className="auth-intro">Enviamos um link para <b>{user.email}</b>. Verifique seu endereço para acessar o painel.</p>
        {error && <p className="form-alert error" role="alert">{error}</p>}
        {message && <p className="form-alert success" role="status">{message}</p>}
        <button className="button button-primary auth-submit" type="button" disabled={busy} onClick={() => void checkVerification()}>
          {busy ? "Verificando…" : "Já verifiquei meu e-mail"}
        </button>
        <button className="auth-link" type="button" disabled={busy} onClick={() => void sendAgain()}>Reenviar e-mail de verificação</button>
        <button className="auth-link" type="button" onClick={() => void signOutCurrentUser()}>Sair desta conta</button>
      </section>
    </main>
  );
}
