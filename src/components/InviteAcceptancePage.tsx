"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { useRouter } from "next/navigation";
import {
  createInvitedAccount,
  refreshEmailVerification,
  resendVerificationEmail,
  signIn,
  signOutCurrentUser,
  watchAuthState,
} from "../lib/firebase/auth";
import { acceptInvitation, lookupInvitation, type PublicInvitation } from "../lib/invitations-client";
import { CompanyLogo } from "./CompanyLogo";
import { ThemeToggle } from "./ThemeProvider";

function roleName(role: PublicInvitation["role"]) {
  return role === "ADMIN" ? "Administradora" : role === "LEADER" ? "Liderança" : "Colaboradora";
}

function authErrorMessage(reason: unknown) {
  const code = typeof reason === "object" && reason && "code" in reason ? String(reason.code) : "";
  if (code.includes("invalid-credential")) return "E-mail ou senha incorretos.";
  if (code.includes("email-already-in-use")) return "Já existe uma conta com este e-mail. Entre com sua senha.";
  if (code.includes("weak-password")) return "Escolha uma senha com pelo menos 6 caracteres.";
  if (code.includes("too-many-requests")) return "Muitas tentativas. Aguarde um pouco e tente novamente.";
  return reason instanceof Error ? reason.message : "Não foi possível concluir. Tente novamente.";
}

export function InviteAcceptancePage({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [tokenReady, setTokenReady] = useState(false);
  const [invitation, setInvitation] = useState<PublicInvitation | null>(null);
  const [inviteError, setInviteError] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [mode, setMode] = useState<"register" | "login">("register");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setToken(window.location.hash.slice(1));
    setTokenReady(true);
    try {
      return watchAuthState((nextUser) => {
        setUser(nextUser);
        setAuthReady(true);
        if (nextUser?.displayName) setName(nextUser.displayName);
      });
    } catch (reason) {
      setInviteError(reason instanceof Error ? reason.message : "Firebase não está configurado.");
      setAuthReady(true);
      return undefined;
    }
  }, []);

  useEffect(() => {
    if (!tokenReady) return;
    if (!token) {
      setInviteError("O link está incompleto. Abra o convite original ou peça à administração para reenviá-lo.");
      return;
    }
    let active = true;
    lookupInvitation(invitationId, token)
      .then((result) => {
        if (active) {
          setInvitation(result);
          setInviteError("");
        }
      })
      .catch((reason) => {
        if (active) setInviteError(reason instanceof Error ? reason.message : "Não foi possível validar o convite.");
      });
    return () => { active = false; };
  }, [invitationId, token, tokenReady]);

  async function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invitation) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (mode === "register") {
        if (name.trim().length < 2) throw new Error("Informe seu nome.");
        const credentials = await createInvitedAccount(invitation.email, password, name);
        setUser(credentials.user);
        setMessage("Conta criada. Verifique o e-mail enviado antes de aceitar o convite.");
      } else {
        const credentials = await signIn(invitation.email, password);
        setUser(credentials.user);
      }
    } catch (reason) {
      setError(authErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    if (!invitation || !user) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if ((user.email ?? "").trim().toLowerCase() !== invitation.email.trim().toLowerCase()) {
        throw new Error("Entre com a conta do e-mail que recebeu este convite.");
      }
      if (!await refreshEmailVerification(user)) {
        setMessage("Verifique seu e-mail pelo link recebido e tente novamente.");
        return;
      }
      await acceptInvitation({
        invitationId,
        token,
        name: name.trim() || user.displayName || "",
      });
      router.replace("/");
    } catch (reason) {
      setError(authErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    if (!user) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await resendVerificationEmail(user);
      setMessage("Enviamos um novo link de verificação. Confira sua caixa de entrada e o spam.");
    } catch (reason) {
      setError(authErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  const matchingAccount = Boolean(user && invitation
    && (user.email ?? "").trim().toLowerCase() === invitation.email.trim().toLowerCase());

  return (
    <main className="auth-shell">
      <ThemeToggle />
      <section className="auth-card invite-card">
        <div className="auth-company-brand">
          <CompanyLogo className="auth-company-logo" />
          <span><b>HB Avalia</b><small>Desempenho e liderança</small></span>
        </div>
        {!tokenReady || !authReady || (!invitation && !inviteError)
          ? <p className="auth-intro">Validando o convite…</p>
          : inviteError
            ? <><p className="eyebrow">CONVITE</p><h1>Não foi possível abrir o convite</h1><p className="auth-intro" role="alert">{inviteError}</p></>
            : invitation && <>
              <p className="eyebrow">CONVITE PARA O PAINEL</p>
              <h1>Acesse {invitation.companyName}</h1>
              <p className="auth-intro">Convite para <b>{invitation.email}</b> como <b>{roleName(invitation.role)}</b>.</p>
              {invitation.teamNames.length > 0 && <p className="auth-footnote">Equipes: {invitation.teamNames.join(", ")}</p>}
              {user && !matchingAccount
                ? <><p className="form-alert error">A conta conectada ({user.email}) não corresponde ao e-mail convidado.</p><button className="button button-outline auth-submit" type="button" onClick={() => void signOutCurrentUser()}>Sair e usar outra conta</button></>
                : user
                  ? <>
                    {!user.emailVerified && <p className="form-alert">Verifique o endereço <b>{invitation.email}</b> pelo link enviado para poder aceitar.</p>}
                    {error && <p className="form-alert error" role="alert">{error}</p>}
                    {message && <p className="form-alert success" role="status">{message}</p>}
                    <label className="invite-name-field">Seu nome
                      <input autoComplete="name" minLength={2} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome e sobrenome" />
                    </label>
                    <button className="button button-primary auth-submit" type="button" disabled={busy} onClick={() => void accept()}>
                      {busy ? "Verificando…" : "Verificar e aceitar convite"}
                    </button>
                    {!user.emailVerified && <button className="auth-link" type="button" disabled={busy} onClick={() => void resendVerification()}>Reenviar e-mail de verificação</button>}
                    <button className="auth-link" type="button" onClick={() => void signOutCurrentUser()}>Sair desta conta</button>
                  </>
                  : <>
                    <div className="auth-tabs" role="tablist" aria-label="Conta para o convite">
                      <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "selected" : ""} onClick={() => { setMode("register"); setError(""); setMessage(""); }}>Criar conta</button>
                      <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "selected" : ""} onClick={() => { setMode("login"); setError(""); setMessage(""); }}>Já tenho conta</button>
                    </div>
                    <form className="auth-form" onSubmit={(event) => void submitCredentials(event)}>
                      {mode === "register" && <label>Seu nome
                        <input autoComplete="name" minLength={2} maxLength={100} required value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome e sobrenome" />
                      </label>}
                      <label>E-mail
                        <input type="email" autoComplete="email" value={invitation.email} readOnly />
                      </label>
                      <label>Senha
                        <input type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo de 6 caracteres" />
                      </label>
                      {error && <p className="form-alert error" role="alert">{error}</p>}
                      {message && <p className="form-alert success" role="status">{message}</p>}
                      <button className="button button-primary auth-submit" type="submit" disabled={busy}>
                        {busy ? "Aguarde…" : mode === "register" ? "Criar conta e continuar" : "Entrar"}
                      </button>
                    </form>
                  </>}
            </>}
      </section>
    </main>
  );
}
