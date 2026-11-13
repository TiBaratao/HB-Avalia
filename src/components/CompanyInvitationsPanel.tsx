"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  cancelInvitation,
  createInvitation,
  fetchInvitations,
  resendInvitation,
  type InvitationRole,
  type InvitationSummary,
} from "../lib/invitations-client";
import type { WorkspaceData } from "../lib/firebase/data";

function roleLabel(role: InvitationRole) {
  return role === "ADMIN" ? "Administradora" : role === "LEADER" ? "Liderança" : "Colaboradora";
}

function formatInvitationDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(date);
}

function statusLabel(status: InvitationSummary["status"]) {
  return status === "PENDING" ? "Pendente" : status === "ACCEPTED" ? "Aceito" : status === "CANCELED" ? "Cancelado" : "Expirado";
}

export function CompanyInvitationsPanel({
  companyId,
  teams,
  departments,
}: {
  companyId: string;
  teams: WorkspaceData["teams"];
  departments: WorkspaceData["departments"];
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitationRole>("EMPLOYEE");
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [invitations, setInvitations] = useState<InvitationSummary[]>([]);
  const [latestInviteLink, setLatestInviteLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadInvitations = useCallback(async () => {
    setLoading(true);
    try {
      setInvitations(await fetchInvitations(companyId));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível carregar os convites.");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { void loadInvitations(); }, [loadInvitations]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    setLatestInviteLink("");
    try {
      const result = await createInvitation({
        companyId,
        email,
        role,
        teamIds: role === "ADMIN" ? [] : teamIds,
      });
      setLatestInviteLink(result.inviteUrl);
      setMessage(result.emailSent ? "Convite enviado por e-mail. Você também pode copiar o link abaixo." : result.emailWarning);
      setEmail("");
      await loadInvitations();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível criar o convite.");
    } finally {
      setBusy(false);
    }
  }

  async function resend(invitationId: string) {
    setBusy(true);
    setError("");
    setMessage("");
    setLatestInviteLink("");
    try {
      const result = await resendInvitation(invitationId);
      setLatestInviteLink(result.inviteUrl);
      setMessage(result.emailSent ? "Convite reenviado por e-mail. O link anterior foi invalidado." : `${result.emailWarning} O link anterior foi invalidado.`);
      await loadInvitations();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível reenviar o convite.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(invitationId: string) {
    if (!window.confirm("Cancelar este convite? O link deixará de funcionar imediatamente.")) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await cancelInvitation(invitationId);
      setMessage("Convite cancelado.");
      await loadInvitations();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível cancelar o convite.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(latestInviteLink);
      setMessage("Link copiado. Envie-o somente para o e-mail convidado.");
    } catch {
      setError("Não foi possível copiar o link automaticamente. Selecione e copie o endereço exibido.");
    }
  }

  function toggleTeam(teamId: string) {
    setTeamIds((current) => current.includes(teamId)
      ? current.filter((id) => id !== teamId)
      : [...current, teamId]);
  }

  const activeTeams = teams.filter((team) => team.active);
  const groupedTeams = departments.map((department) => ({
    department,
    teams: activeTeams.filter((team) => team.departmentId === department.id),
  })).filter((group) => group.teams.length > 0);

  return (
    <section className="live-panel settings-card invitation-panel">
      <div className="live-panel-heading">
        <div><h2>Convites de acesso</h2><p>Somente pessoas convidadas e com e-mail verificado podem acessar o painel.</p></div>
      </div>
      <form className="stack-form invitation-form" onSubmit={(event) => void submit(event)}>
        <label>E-mail da pessoa
          <input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="pessoa@empresa.com" />
        </label>
        <label>Perfil
          <select value={role} onChange={(event) => { setRole(event.target.value as InvitationRole); }}>
            <option value="EMPLOYEE">Colaboradora</option>
            <option value="LEADER">Liderança</option>
          </select>
        </label>
        <fieldset className="invitation-teams">
          <legend>Equipes (opcional)</legend>
          {groupedTeams.length ? groupedTeams.map(({ department, teams: departmentTeams }) => (
            <div className="invitation-team-group" key={department.id}>
              <b>{department.name}</b>
              {departmentTeams.map((team) => <label key={team.id}>
                <input type="checkbox" checked={teamIds.includes(team.id)} onChange={() => toggleTeam(team.id)} />
                <span>{team.name}</span>
              </label>)}
            </div>
          )) : <p className="subtle-note">Não há equipes ativas para selecionar.</p>}
        </fieldset>
        {error && <p className="form-alert error" role="alert">{error}</p>}
        {message && <p className="form-alert success" role="status">{message}</p>}
        <button className="button button-primary" type="submit" disabled={busy}>
          {busy ? "Processando…" : "Criar convite"}
        </button>
      </form>
      {latestInviteLink && <div className="invitation-link-box">
        <label htmlFor="latest-invite-link">Link do convite</label>
        <div><input id="latest-invite-link" readOnly value={latestInviteLink} onFocus={(event) => event.currentTarget.select()} /><button className="button button-outline button-small" type="button" onClick={() => void copyLink()}>Copiar</button></div>
      </div>}
      <div className="invitation-list-heading"><h3>Convites enviados</h3><button className="button button-outline button-small" type="button" disabled={loading || busy} onClick={() => void loadInvitations()}>Atualizar</button></div>
      {loading ? <p className="subtle-note">Carregando convites…</p>
        : invitations.length === 0 ? <p className="subtle-note">Ainda não há convites registrados.</p>
          : <ul className="invitation-list">{invitations.map((invitation) => <li key={invitation.id}>
            <div className="invitation-record-copy">
              <b>{invitation.email}</b>
              <span>{roleLabel(invitation.role)} · {statusLabel(invitation.status)}</span>
              <small>Expira em {formatInvitationDate(invitation.expiresAt)}</small>
            </div>
            <div className="invitation-record-actions">
              {(invitation.status === "PENDING" || invitation.status === "EXPIRED") && <button className="button button-outline button-small" type="button" disabled={busy} onClick={() => void resend(invitation.id)}>Reenviar</button>}
              {invitation.status === "PENDING" && <button className="button button-outline button-small" type="button" disabled={busy} onClick={() => void cancel(invitation.id)}>Cancelar</button>}
            </div>
          </li>)}</ul>}
    </section>
  );
}
