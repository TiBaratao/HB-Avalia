"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { AccountSetup } from "../components/AccountSetup";
import { AuthPanel } from "../components/AuthPanel";
import { CompanyLogo } from "../components/CompanyLogo";
import { Workspace } from "../components/Workspace";
import { ThemeToggle } from "../components/ThemeProvider";
import { signOutCurrentUser, watchAuthState } from "../lib/firebase/auth";
import { readUserProfile, selfEnrollInCompany } from "../lib/firebase/data";

const DEFAULT_COMPANY_ID = process.env.NEXT_PUBLIC_DEFAULT_COMPANY_ID || "hb-avalia";

export default function HomePage() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState("");
  const [profileStatus, setProfileStatus] = useState<"loading" | "missing" | "ready" | "error">("loading");
  const [companyId, setCompanyId] = useState("");
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
      setCompanyId("");
      return;
    }
    let active = true;
    setProfileStatus("loading");
    readUserProfile(user.uid)
      .then(async (profile) => {
        if (!active) return;
        if (!profile && user.email && user.displayName?.trim()) {
          try {
            await selfEnrollInCompany({
              companyId: DEFAULT_COMPANY_ID,
              uid: user.uid,
              email: user.email,
              name: user.displayName,
            });
            const createdProfile = await readUserProfile(user.uid);
            if (!active) return;
            setCompanyId(createdProfile?.companyId ?? "");
            setProfileStatus(createdProfile ? "ready" : "missing");
            return;
          } catch {
            // The company may not exist yet; show the one-time first-company setup.
          }
        }
        setCompanyId(profile?.companyId ?? "");
        setProfileStatus(profile ? "ready" : "missing");
      })
      .catch((error) => {
        if (!active) return;
        setAuthError(error instanceof Error ? error.message : "Não foi possível ler seu perfil.");
        setProfileStatus("error");
      });
    return () => { active = false; };
  }, [user, profileVersion]);

  const reloadProfile = useCallback(() => setProfileVersion((value) => value + 1), []);

  if (!authReady) return <LoadingScreen label="Conectando ao Firebase…" />;
  if (authError && !user) return <MessageScreen title="Não foi possível conectar" message={authError} action="Recarregar" onAction={() => window.location.reload()} />;
  if (!user) return <AuthPanel />;
  if (profileStatus === "loading") return <LoadingScreen label="Carregando sua conta…" />;
  if (profileStatus === "error") return <MessageScreen title="Falha ao carregar seu acesso" message={authError} action="Sair" onAction={() => void signOutCurrentUser()} />;
  if (profileStatus === "missing") return <AccountSetup user={user} onDone={reloadProfile} />;
  return <Workspace key={`${user.uid}:${companyId}`} user={user} companyId={companyId} onSignOut={() => void signOutCurrentUser()} />;
}

function LoadingScreen({ label }: { label: string }) {
  return <main className="auth-shell"><ThemeToggle/><section className="auth-card loading-card"><CompanyLogo className="auth-company-logo"/><p>{label}</p></section></main>;
}

function MessageScreen({ title, message, action, onAction }: { title: string; message: string; action: string; onAction: () => void }) {
  return <main className="auth-shell"><ThemeToggle/><section className="auth-card"><div className="auth-company-brand"><CompanyLogo className="auth-company-logo"/><span><b>HB AVALIA</b><small>DESEMPENHO E LIDERANÇA</small></span></div><h1>{title}</h1><p className="auth-intro">{message}</p><button className="button button-primary auth-submit" onClick={onAction}>{action}</button></section></main>;
}
