"use client";

import { useState, type FormEvent } from "react";
import { resetPassword, signIn, signUp } from "../lib/firebase/auth";
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
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
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
      if (mode === "login") {
        await signIn(email, password);
      } else {
        await signUp(email, password, name);
        window.location.reload();
      }
    } catch (reason) {
      const code = typeof reason === "object" && reason && "code" in reason ? String(reason.code) : "";
      if (mode === "register" && code.includes("email-already-in-use")) {
        setMode("login");
        setError(`A conta ${email.trim()} já existe. Entre com sua senha ou use “Esqueci minha senha”.`);
      } else {
        setError(authMessage(reason));
      }
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
          <span><b>HB AVALIA</b><small>DESEMPENHO E LIDERANÇA</small></span>
        </div>
        <h1>{mode === "login" ? "Entre na sua conta" : "Crie seu acesso"}</h1>
        <p className="auth-intro">Avaliações e rotinas da sua equipe, em um só lugar.</p>

        <div className="auth-tabs" role="tablist" aria-label="Acesso">
          <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "selected" : ""} onClick={() => { setMode("login"); setError(""); setMessage(""); }}>Entrar</button>
          <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "selected" : ""} onClick={() => { setMode("register"); setError(""); setMessage(""); }}>Criar conta</button>
        </div>

        <form className="auth-form" onSubmit={submit}>
          {mode === "register" && <label>Seu nome
            <input type="text" autoComplete="name" minLength={2} required value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome e sobrenome" />
          </label>}
          <label>E-mail
            <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@empresa.com" />
          </label>
          <label>Senha
            <input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo de 6 caracteres" />
          </label>
          {error && <p className="form-alert error" role="alert">{error}</p>}
          {message && <p className="form-alert success" role="status">{message}</p>}
          <button className="button button-primary auth-submit" type="submit" disabled={busy}>
            {busy ? "Aguarde…" : mode === "login" ? "Entrar" : "Continuar"}
          </button>
        </form>
        {mode === "login" && <button className="auth-link" type="button" onClick={forgotPassword} disabled={busy}>Esqueci minha senha</button>}
        <p className="auth-footnote">{mode === "register" ? "Depois de criar a conta, você entrará na empresa configurada para este sistema como colaborador." : "O acesso aos dados depende do seu perfil na empresa."}</p>
      </section>
    </main>
  );
}
