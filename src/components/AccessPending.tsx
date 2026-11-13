"use client";

import type { User } from "firebase/auth";
import { signOutCurrentUser } from "../lib/firebase/auth";
import { CompanyLogo } from "./CompanyLogo";
import { ThemeToggle } from "./ThemeProvider";

export function AccessPending({ user }: { user: User }) {
  return (
    <main className="auth-shell">
      <ThemeToggle />
      <section className="auth-card">
        <div className="auth-company-brand">
          <CompanyLogo className="auth-company-logo" />
          <span><b>HB Avalia</b><small>Desempenho e liderança</small></span>
        </div>
        <p className="eyebrow">ACESSO RESTRITO</p>
        <h1>Este painel é somente por convite</h1>
        <p className="auth-intro">A conta <b>{user.email}</b> ainda não está vinculada a uma empresa ativa. Peça à administração para enviar um convite ao mesmo endereço de e-mail.</p>
        <button className="button button-primary auth-submit" type="button" onClick={() => void signOutCurrentUser()}>Sair desta conta</button>
      </section>
    </main>
  );
}
