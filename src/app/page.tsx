"use client";

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { AccessPending } from "../components/AccessPending";
import { AuthPanel } from "../components/AuthPanel";
import { CompanyLogo } from "../components/CompanyLogo";
import { EmailVerificationPanel } from "../components/EmailVerificationPanel";
import { Workspace } from "../components/Workspace";
import { DirectorStoreSelector } from "../components/DirectorStoreSelector";
import { ThemeToggle } from "../components/ThemeProvider";
import { signOutCurrentUser, watchAuthState } from "../lib/firebase/auth";
import { fetchCurrentAccess, type CurrentAccess } from "../lib/invitations-client";

export default function HomePage() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState("");
  const [profileStatus, setProfileStatus] = useState<"loading" | "missing" | "ready" | "error">("loading");
  const [profileError, setProfileError] = useState("");
  const [access, setAccess] = useState<CurrentAccess | null>(null);
  const [profileVersion, setProfileVersion] = useState(0);

  useEffect(() => {
    try {
      return watchAuthState((nextUser) => {
        setUser(nextUser);
        setAuthReady(true);
        setAuthError("");
      });
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Firebase não está configurado.");
      setAuthReady(true);
      return undefined;
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setProfileStatus("missing");
      setAccess(null);
      return;
    }
    if (!user.emailVerified) {
      setProfileStatus("loading");
      setAccess(null);
      return;
    }
    let active = true;
    setProfileStatus("loading");
    fetchCurrentAccess()
      .then((access) => {
        if (!active) return;
        setAccess(access);
        setProfileError("");
        setProfileStatus("ready");
      })
      .catch((error) => {
        if (!active) return;
        if (error && typeof error === "object" && "status" in error && error.status === 403) {
          setProfileStatus("missing");
          return;
        }
        setProfileError(error instanceof Error ? error.message : "Não foi possível validar seu acesso.");
        setProfileStatus("error");
      });
    return () => { active = false; };
  }, [user, profileVersion]);

  if (!authReady) return <LoadingScreen label="Conectando ao Firebase…" />;
  if (authError && !user) return <MessageScreen title="Não foi possível conectar" message={authError} action="Recarregar" onAction={() => window.location.reload()} />;
  if (!user) return <AuthPanel />;
  if (!user.emailVerified) return <EmailVerificationPanel user={user} onVerified={() => setProfileVersion((value) => value + 1)} />;
  if (profileStatus === "loading") return <LoadingScreen label="Carregando sua conta…" />;
  if (profileStatus === "error") return <MessageScreen title="Falha ao carregar seu acesso" message={profileError} action="Sair" onAction={() => void signOutCurrentUser()} />;
  if (profileStatus === "missing") return <AccessPending user={user} />;
  if (!access) return <MessageScreen title="Acesso indisponível" message="Não foi possível identificar seu perfil de acesso." action="Sair" onAction={() => void signOutCurrentUser()} />;
  if (access.accessType === "DIRECTOR") {
    return <DirectorStoreSelector access={access} accountEmail={user.email ?? ""} onSignOut={() => void signOutCurrentUser()} />;
  }
  return <Workspace key={`${user.uid}:${access.companyId}`} user={user} companyId={access.companyId} onSignOut={() => void signOutCurrentUser()} />;
}

function LoadingScreen({ label }: { label: string }) {
  return <main className="auth-shell"><ThemeToggle/><section className="auth-card loading-card"><CompanyLogo className="auth-company-logo"/><p>{label}</p></section></main>;
}

function MessageScreen({ title, message, action, onAction }: { title: string; message: string; action: string; onAction: () => void }) {
  return <main className="auth-shell"><ThemeToggle/><section className="auth-card"><div className="auth-company-brand"><CompanyLogo className="auth-company-logo"/><span><b>HB AVALIA</b><small>DESEMPENHO E LIDERANÇA</small></span></div><h1>{title}</h1><p className="auth-intro">{message}</p><button className="button button-primary auth-submit" onClick={onAction}>{action}</button></section></main>;
}
