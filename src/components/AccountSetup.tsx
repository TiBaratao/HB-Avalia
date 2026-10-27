"use client";

import { useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { signOutCurrentUser } from "../lib/firebase/auth";
import { createCompanyForAdmin, selfEnrollInCompany } from "../lib/firebase/data";
import { CompanyLogo } from "./CompanyLogo";
import { ThemeToggle } from "./ThemeProvider";

const DEFAULT_COMPANY_ID = process.env.NEXT_PUBLIC_DEFAULT_COMPANY_ID || "hb-avalia";

export function AccountSetup({ user, onDone }: { user: User; onDone: () => void }) {
  const [name, setName] = useState(user.displayName ?? "");
  const [companyName, setCompanyName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!user.email) throw new Error("Sua conta precisa ter um e-mail para continuar.");
      try {
        await selfEnrollInCompany({
          companyId: DEFAULT_COMPANY_ID,
          uid: user.uid,
          email: user.email,
          name,
        });
      } catch {
        if (!companyName.trim()) {
          throw new Error("Não foi possível entrar na empresa. Se esta é a primeira conta, informe o nome da empresa para configurá-la.");
        }
        await createCompanyForAdmin({
          companyId: DEFAULT_COMPANY_ID,
          uid: user.uid,
          email: user.email,
          name,
          companyName,
        });
      }
      onDone();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível concluir o acesso.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <ThemeToggle/>
      <section className="auth-card setup-card">
        <div className="auth-company-brand">
          <CompanyLogo className="auth-company-logo"/>
          <span><b>HB AVALIA</b><small>DESEMPENHO E LIDERANÇA</small></span>
        </div>
        <p className="eyebrow">ACESSO À EMPRESA</p>
        <h1>Vamos configurar seu acesso</h1>
        <p className="auth-intro">Conta: <b>{user.email}</b></p>
        <form className="auth-form" onSubmit={submit}>
          <label>Seu nome
            <input required minLength={2} value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome e sobrenome" />
          </label>
          <label>Nome da empresa <small>(preencha somente na primeira configuração)</small>
            <input value={companyName} minLength={2} maxLength={100} onChange={(event) => setCompanyName(event.target.value)} placeholder="Nome real da empresa" />
          </label>
          <p className="auth-footnote">A primeira conta que configurar a empresa será administradora. As próximas entrarão como colaboradoras; uma administradora poderá alterar suas funções, equipes e cargo. Todo colaborador inicia com cargo <b>Atendente de Açougue Junior</b>.</p>
          {error && <p className="form-alert error" role="alert">{error}</p>}
          <button className="button button-primary auth-submit" type="submit" disabled={busy}>
            {busy ? "Configurando…" : "Entrar na empresa"}
          </button>
        </form>
        <button className="auth-link" type="button" onClick={() => void signOutCurrentUser()}>Sair desta conta</button>
      </section>
    </main>
  );
}
