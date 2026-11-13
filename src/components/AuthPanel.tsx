"use client";

import { useState, type FormEvent } from "react";
import { resetPassword, signIn } from "../lib/firebase/auth";
import { CompanyLogo } from "./CompanyLogo";
import { ThemeToggle } from "./ThemeProvider";

function authMessage(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code.includes("invalid-credential")) return "E-mail ou senha incorretos.";
  if (code.includes("email-already-in-use")) return "Já existe uma conta com este e-mail. Entre com sua senha.";
  if (code.includes("weak-password")) return "Escolha uma senha com pelo menos 6 caracteres.";
  if (code.includes("invalid-email")) return "Digite um e-mail válido.";
  if (code.includes("too-many-requests")) return "Muitas tentativas. Aguarde um pouco e tente novamente.";
  return error instanceof Error ? error.message : "Não foi possível concluir. Tente novamente.";
}

export function AuthPanel() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await signIn(email, password);
    } catch (reason) {
      setError(authMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function forgotPassword() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      if (!email.trim()) throw new Error("Digite seu e-mail no campo acima primeiro.");
      await resetPassword(email);
      setMessage("Enviamos um link para redefinir sua senha.");
    } catch (reason) {
      setError(authMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <ThemeToggle/>
      <section className="auth-card">
        <div className="auth-company-brand">
          <CompanyLogo className="auth-company-logo"/>
          <span><b>HB Avalia</b><small>Desempenho e liderança</small></span>
        </div>
        <h1>Entre na sua conta</h1>
        <p className="auth-intro">Avaliações e rotinas da sua equipe, em um só lugar.</p>

        <form className="auth-form" onSubmit={submit}>
          <label>E-mail
            <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@empresa.com" />
          </label>
          <label>Senha
            <input type="password" autoComplete="current-password" minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Sua senha" />
          </label>
          {error && <p className="form-alert error" role="alert">{error}</p>}
          {message && <p className="form-alert success" role="status">{message}</p>}
          <button className="button button-primary auth-submit" type="submit" disabled={busy}>
            {busy ? "Aguarde…" : "Entrar"}
          </button>
        </form>
        <button className="auth-link" type="button" onClick={forgotPassword} disabled={busy}>Esqueci minha senha</button>
        <p className="auth-footnote">O acesso ao painel é somente por convite da administração. Se você recebeu um convite, abra o link para criar ou acessar sua conta.</p>
      </section>
    </main>
  );
}
