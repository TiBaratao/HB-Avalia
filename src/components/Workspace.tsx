"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type SetStateAction } from "react";
import type { ReactNode } from "react";
import type { User } from "firebase/auth";
import {
  calculatePromotionEvaluationPreview,
  PROMOTION_COMPETENCIES,
  PROMOTION_INDICATORS,
  PROMOTION_INDICATOR_PERCENTAGE_MAX,
  restorePromotionEvaluationInputs,
  type PromotionCompetencyInput,
  type PromotionEvaluationPreview,
  type PromotionIndicatorInput,
} from "../../functions/promotion-scoring";
import { CompanyLogo } from "./CompanyLogo";
import { ThemeToggle } from "./ThemeProvider";
import {
  ArrowLeft,
  Buildings,
  CheckCircle,
  Clock,
  Target,
  UserCircle,
  XCircle,
  CaretDown,
  CalendarBlank,
  ChartBar,
  ClipboardText,
  ChatCircleText,
  GearSix,
  House,
  SlidersHorizontal,
  SignOut,
  Trophy,
  UsersThree,
} from "@phosphor-icons/react";
import ExpandingTabs from "./ui/expanding-tabs";
import { ConfirmButton, Modal } from "./ui/modal";
import type {
  ChecklistAssignmentDocument,
  ChecklistTemplateDocument,
  CompanyMember,
  DocumentWithId,
  EvaluationWithId,
  FirebaseEvaluationType,
  FirebaseRole,
  PromotionRequestDocument,
  SurveyDocument,
  SurveyQuestion,
  SurveyResponseDocument,
} from "../lib/firebase/models";
import {
  createChecklistAssignments,
  decidePromotionRequest,
  submitPromotionRequest,
  createChecklistTemplate,
  deleteChecklistTemplate,
  createCriterion,
  createCycle,
  createSurvey,
  createDepartment,
  createTeam,
  deleteChecklistAssignment,
  deleteCriterion,
  deleteCycle,
  deleteDepartment,
  deleteSurvey,
  deleteTeam,
  removeMember,
  calculateChecklistDueDate,
  loadEvaluationAnswers,
  loadSurveyResponsePage,
  MIN_SURVEY_RESPONSES_FOR_RESULTS,
  loadWorkspaceData,
  saveEvaluationDraft,
  saveChecklistResult,
  saveChecklistTemplate,
  submitSurveyResponse,
  submitEvaluation,
  updateAssignmentStatus,
  updateChecklistTemplate,
  updateCycle,
  updateSurveyStatus,
  updateCriterion,
  updateDepartment,
  updateMember,
  updateTeam,
  updateCompanyName,
  type SurveyResponseCursor,
  type WorkspaceData,
} from "../lib/firebase/data";

type Section = "overview" | "team" | "evaluations" | "ranking" | "cycles" | "surveys" | "checklists" | "settings" | "development" | "promotions";
type Notice = { kind: "error" | "success"; text: string } | null;

const roleNames: Record<FirebaseRole, string> = {
  ADMIN: "Administradora",
  LEADER: "Líder",
  EMPLOYEE: "Colaborador",
};

type PromotionIndicatorEntry = PromotionIndicatorInput["percentage"] | "";
type PromotionCompetencyEntry = PromotionCompetencyInput["score"] | "";

function promotionResultPreview(
  indicators: Array<{ id: string; percentage: PromotionIndicatorEntry }>,
  competencies: Array<{ id: string; score: PromotionCompetencyEntry }>,
): PromotionEvaluationPreview | null {
  const invalidIndicator = indicators.some((item) => item.percentage !== ""
    && (!Number.isFinite(item.percentage) || item.percentage < 0 || item.percentage > PROMOTION_INDICATOR_PERCENTAGE_MAX));
  const invalidCompetence = competencies.some((item) => item.score !== ""
    && (!Number.isInteger(item.score) || item.score < 1 || item.score > 5));
  if (invalidIndicator || invalidCompetence) return null;

  return calculatePromotionEvaluationPreview(
    indicators.filter((item) => item.percentage !== "").map((item) => ({ id: item.id, percentage: Number(item.percentage) })),
    competencies.filter((item) => item.score !== "").map((item) => ({ id: item.id, score: Number(item.score) })),
  );
}

export function Workspace({ user, companyId, onSignOut }: { user: User; companyId: string; onSignOut: () => void }) {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [section, setSection] = useState<Section>("overview");
  const [selectedMemberId, setSelectedMemberId] = useState("");

  const refresh = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const next = await loadWorkspaceData(companyId, user.uid);
      setData(next);
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Não foi possível carregar os dados.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [companyId, user.uid]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const nextRefresh = new Date();
    nextRefresh.setHours(24, 0, 5, 0);
    const timeout = window.setTimeout(() => void refresh(true), nextRefresh.getTime() - Date.now());
    return () => window.clearTimeout(timeout);
  }, [refresh, data]);

  async function execute(operation: () => Promise<unknown>, successMessage: string) {
    setNotice(null);
    try {
      await operation();
      await refresh(true);
      setNotice({ kind: "success", text: successMessage });
      return true;
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Não foi possível salvar." });
      return false;
    }
  }

  if (loading || !data) {
    return <main className="auth-shell"><section className="auth-card loading-card"><CompanyLogo className="auth-company-logo"/><h1>{loading ? "Carregando seus dados…" : "Não foi possível abrir a empresa"}</h1>{loadError && <p className="form-alert error">{loadError}</p>}{!loading && <button className="button button-outline" onClick={() => void refresh()}>Tentar novamente</button>}<button className="button button-outline auth-submit" onClick={onSignOut}>← Voltar ao login</button></section></main>;
  }

  const role = data.member.role;
  const pendingEvaluationCount = getPendingEvaluationCount(data);
  const pendingChecklistCount = getPendingChecklistCount(data, user.uid);
  const nav: Array<{ id: Section; label: string }> = role === "ADMIN"
    ? [
      { id: "overview", label: "Visão geral" }, { id: "team", label: "Pessoas e equipes" },
      { id: "evaluations", label: "Avaliações" }, { id: "ranking", label: "Ranking" },
      { id: "cycles", label: "Configuração" },
      { id: "surveys", label: "Pesquisas" }, { id: "checklists", label: "Checklists" }, { id: "promotions", label: "Promoções" }, { id: "settings", label: "Empresa" },
    ]
    : [
      { id: "overview", label: "Início" }, { id: "team", label: "Minha equipe" },
      { id: "evaluations", label: role === "EMPLOYEE" ? "Avaliar liderança" : "Avaliações" },
      { id: "surveys", label: "Pesquisas" }, { id: "checklists", label: "Checklists" }, { id: "development", label: role === "LEADER" ? "PDI da equipe" : "Meu PDI" },
    ];

  const content = section === "overview"
    ? <Overview data={data} user={user} execute={execute} onNavigate={setSection} />
    : section === "team"
      ? (role === "LEADER" && selectedMemberId ? <DevelopmentProfilePage key={selectedMemberId} data={data} employee={data.members.find((person) => person.uid === selectedMemberId)} execute={execute} onBack={() => setSelectedMemberId("")} /> : <TeamPage data={data} user={user} execute={execute} onOpenProfile={(employeeId) => setSelectedMemberId(employeeId)} />)
      : section === "evaluations"
        ? <EvaluationsPage data={data} user={user} refresh={refresh} execute={execute} />
        : section === "ranking"
          ? role === "ADMIN" ? <RankingPage data={data}/> : <Overview data={data} user={user} execute={execute} onNavigate={setSection}/>
        : section === "cycles"
          ? role === "ADMIN" ? <ConfigurationPage data={data} execute={execute} /> : <Overview data={data} user={user} execute={execute} onNavigate={setSection} />
        : section === "surveys"
          ? <SurveysPage data={data} execute={execute}/>
        : section === "checklists"
            ? <ChecklistsPage data={data} user={user} execute={execute} />
            : section === "development"
              ? role === "LEADER"
                ? (selectedMemberId
                  ? <DevelopmentProfilePage key={selectedMemberId} data={data} employee={data.members.find((person) => person.uid === selectedMemberId)} execute={execute} onBack={() => setSelectedMemberId("")} />
                  : <LeaderDevelopmentPage data={data} onOpenProfile={(employeeId) => setSelectedMemberId(employeeId)} />)
                : role === "EMPLOYEE"
                  ? <MyDevelopmentPage data={data} user={user} />
                  : <PromotionRequestsPage data={data} execute={execute}/>
              : section === "promotions"
                ? role === "ADMIN" ? <PromotionRequestsPage data={data} execute={execute}/> : <Overview data={data} user={user} execute={execute} onNavigate={setSection} />
                : <CompanyPage data={data} execute={execute} />;

  return (
    <div className="live-app">
      <aside className="live-sidebar">
        <div className="live-company"><CompanyLogo className="company-logo-sidebar"/><span><b>{data.company.name}</b><small>{roleNames[role]}</small></span></div>
        <p className="live-nav-label">MENU</p>
        <nav className="live-nav" aria-label="Navegação principal">
          {nav.map((item) => {
            const pendingCount = item.id === "evaluations" ? pendingEvaluationCount : item.id === "checklists" ? pendingChecklistCount : 0;
            return <button key={item.id} type="button" aria-current={section === item.id ? "page" : undefined} className={section === item.id ? "active" : ""} onClick={() => { setSection(item.id); setSelectedMemberId(""); setNotice(null); }}><span aria-hidden="true">{sectionIcons[item.id]}</span>{item.label}{pendingCount > 0 && <span className="live-nav-badge" aria-label={`${pendingCount} pendente${pendingCount === 1 ? "" : "s"}`}>{pendingCount}</span>}</button>;
          })}
        </nav>
        <div className="live-sidebar-bottom">
          <div className="live-account">
            <span className="live-avatar" aria-hidden="true">{initials(data.member.name)}</span>
            <span className="live-account-details">
              <b>{data.member.name}</b>
              <small>{user.email}</small>
              <small className="live-account-role">{data.company.name} · {roleNames[role]}</small>
            </span>
          </div>
          <button className="auth-link signout-button" onClick={onSignOut}>Sair da conta</button>
        </div>
      </aside>
      <main className="live-main">
        <header className="live-topbar"><div><span className="live-status-dot"/> Dados conectados ao Firestore</div><div className="live-topbar-actions"><ThemeToggle/><button type="button" className="button button-outline button-small topbar-signout" aria-label="Sair da conta" title="Sair da conta" onClick={onSignOut}><SignOut size={15} weight="regular"/><span>Sair</span></button><button type="button" className="button button-outline button-small" onClick={() => void refresh(true)} disabled={refreshing}>{refreshing ? "Atualizando…" : "Atualizar"}</button></div></header>
        <div className="live-content">
          {notice && <div className={`live-notice ${notice.kind}`} role="status">{notice.text}</div>}
          {loadError && <div className="live-notice error" role="alert">{loadError}</div>}
          {content}
        </div>
      </main>
    </div>
  );
}

const sectionIcons: Record<Section, ReactNode> = {
  overview: <House size={18} weight="regular"/>,
  development: <Target size={18} weight="regular"/>,
  promotions: <Trophy size={18} weight="regular"/> ,
  team: <UsersThree size={18} weight="regular"/>,
  evaluations: <ChartBar size={18} weight="regular"/>,
  ranking: <Trophy size={18} weight="regular"/>,
  cycles: <GearSix size={18} weight="regular"/>,
  surveys: <ChatCircleText size={18} weight="regular"/>,
  checklists: <ClipboardText size={18} weight="regular"/>,
  settings: <Buildings size={18} weight="regular"/>,
};

function Overview({ data, user, execute, onNavigate }: { data: WorkspaceData; user: User; execute: (operation: () => Promise<unknown>, message: string) => Promise<boolean>; onNavigate: (section: Section) => void }) {
  const completed = data.evaluations.filter((item) => item.status === "SUBMITTED");
  const [visibleEvaluationCount, setVisibleEvaluationCount] = useState(6);
  const visibleEvaluations = completed.slice(0, visibleEvaluationCount);
  const pendingEvaluationCount = getPendingEvaluationCount(data);
  const pendingChecklistCount = getPendingChecklistCount(data, user.uid);
  const openCycle = data.cycles.find(isCycleAvailable);
  const isAdmin = data.member.role === "ADMIN";
  const isLeader = data.member.role === "LEADER";
  return <>
    <PageHeading eyebrow={isAdmin ? "PAINEL DA EMPRESA" : isLeader ? "PAINEL DA LIDERANÇA" : "SEU ESPAÇO"} title={`Olá, ${data.member.name.split(" ")[0]}`} subtitle={isAdmin ? "Acompanhe a configuração e os resultados da empresa." : "Seus dados e suas ações, atualizados do banco da empresa."}/>
    {isAdmin && <div className="live-stats">
      <Stat label="Pessoas ativas" value={String(data.members.filter((member) => member.status === "ACTIVE").length)} hint="Membros cadastrados"/>
      <Stat label="Avaliações enviadas" value={String(completed.length)} hint="Respostas recebidas"/>
      <Stat label="Checklists pendentes" value={String(data.assignments.filter((assignment) => !isChecklistCompleted(assignment, data.results[assignment.id] ?? [])).length)} hint="Atribuições abertas"/>
      <Stat label="Ciclo" value={openCycle?.name ?? "—"} hint={openCycle ? "Recebendo avaliações" : "Nenhum ciclo aberto"}/>
    </div>}
    {!isAdmin && <div className="live-stats">
      <Stat label={isLeader ? "Pessoas na equipe" : "Lideranças da equipe"} value={String(data.members.length)} hint="Conforme suas equipes"/>
      <Stat label="Avaliações pendentes" value={String(pendingEvaluationCount)} hint={pendingEvaluationCount ? "Aguardando sua resposta" : "Nenhuma resposta pendente"}/>
      <Stat label="Checklists pendentes" value={String(pendingChecklistCount)} hint={pendingChecklistCount ? "Atribuídos a você" : "Tudo em dia"}/>
      <Stat label="Ciclo aberto" value={openCycle?.name ?? "—"} hint={openCycle ? "Avaliações disponíveis" : "Aguarde a administração"}/>
    </div>}
    {!isAdmin && <ChecklistHomeSection data={data} user={user} execute={execute} onNavigate={onNavigate}/>}
    <div className="live-two-column">
      <section className="live-panel">
        <div className="live-panel-heading"><div><span className="eyebrow">DADOS REAIS</span><h2>{isAdmin ? "Estrutura da empresa" : "Ações da equipe"}</h2></div></div>
        {isAdmin ? <div className="quick-links">
          <button onClick={() => onNavigate("team")}><span>01</span><b>Convide sua equipe</b><small>Cadastre e-mails e envie o código da empresa.</small></button>
          <button onClick={() => onNavigate("cycles")}><span>02</span><b>Configure setores e critérios</b><small>Adapte o sistema à organização.</small></button>
          <button onClick={() => onNavigate("checklists")}><span>03</span><b>Crie e atribua checklists</b><small>As tarefas ficam salvas para cada pessoa.</small></button>
        </div> : <div className="quick-links">
          <button onClick={() => onNavigate("evaluations")}><span>01</span><b>{data.member.role === "EMPLOYEE" ? "Avaliar minha liderança" : "Avaliar minha equipe"}{pendingEvaluationCount > 0 && <em className="quick-link-pending">{pendingEvaluationCount} pendente{pendingEvaluationCount === 1 ? "" : "s"}</em>}</b><small>{pendingEvaluationCount ? "Responda às avaliações do ciclo aberto." : "Não há avaliações aguardando resposta."}</small></button>
          <button onClick={() => onNavigate("checklists")}><span>02</span><b>Abrir checklists{pendingChecklistCount > 0 && <em className="quick-link-pending">{pendingChecklistCount} pendente{pendingChecklistCount === 1 ? "" : "s"}</em>}</b><small>{pendingChecklistCount ? "Atualize as tarefas atribuídas a você." : "Você concluiu todas as tarefas atribuídas."}</small></button>
          {data.member.role === "LEADER" && <button onClick={() => onNavigate("team")}><span>03</span><b>Ver minha equipe</b><small>Acompanhe quem está na sua equipe.</small></button>}
        </div>}
      </section>
      <section className="live-panel">
        <div className="live-panel-heading"><div><span className="eyebrow">ACOMPANHAMENTO</span><h2>{isAdmin ? "Avaliações recentes" : isLeader ? "Notas que você deu à equipe" : "Suas avaliações"}</h2></div><button className="text-link" onClick={() => onNavigate("evaluations")}>Abrir <span>↗</span></button></div>
        {completed.length ? <>
          <div className="live-list">{visibleEvaluations.map((item) => <EvaluationListItem key={item.id} item={item} data={data}/>)}</div>
          {completed.length > 6 && <button type="button" className="text-link evaluation-more" onClick={() => setVisibleEvaluationCount((current) => current >= completed.length ? 6 : Math.min(current + 6, completed.length))}>
            {visibleEvaluationCount >= completed.length ? "Mostrar menos" : "Mostrar mais " + Math.min(6, completed.length - visibleEvaluationCount) + " avaliações"}
          </button>}
        </> : <EmptyState title="Ainda não há avaliações" text="Quando o ciclo e os membros estiverem configurados, os resultados aparecerão aqui."/>}
      </section>
    </div>
  </>;
}

function ChecklistHomeSection({ data, user, execute, onNavigate }: { data: WorkspaceData; user: User; execute: (operation: () => Promise<unknown>, message: string) => Promise<boolean>; onNavigate: (section: Section) => void }) {
  const myAssignments = data.assignments.filter((assignment) => assignment.assignedToId === user.uid);
  const completed = myAssignments.filter((assignment) => isChecklistCompleted(assignment, data.results[assignment.id] ?? []));
  const expired = myAssignments
    .filter((assignment) => isChecklistExpired(assignment, data.results[assignment.id] ?? []))
    .sort((a, b) => (a.dueAt || "").localeCompare(b.dueAt || ""));
  const pending = myAssignments
    .filter((assignment) => !isChecklistCompleted(assignment, data.results[assignment.id] ?? []) && !isChecklistExpired(assignment, data.results[assignment.id] ?? []))
    .sort((a, b) => (a.dueAt || "9999-12-31").localeCompare(b.dueAt || "9999-12-31"));
  const visibleAssignments = pending.slice(0, 3);

  return <section className="live-panel checklist-home-panel">
    <div className="live-panel-heading">
      <div><span className="eyebrow">PARA FAZER</span><h2>Meus checklists</h2></div>
      <div className="checklist-home-heading-actions">
        <span className="checklist-home-count">{pending.length} pendentes · {expired.length} expirados</span>
        <button type="button" className="text-link" onClick={() => onNavigate("checklists")}>Ver todos <span>↗</span></button>
      </div>
    </div>
    {visibleAssignments.length
      ? <div className="checklist-home-list">
        {visibleAssignments.map((assignment) => <AssignmentCard
          key={assignment.id}
          assignment={assignment}
          data={data}
          user={user}
          execute={execute}
          admin={false}
          compact
        />)}
        {pending.length > visibleAssignments.length && <button type="button" className="checklist-home-more" onClick={() => onNavigate("checklists")}>
          Ver mais {pending.length - visibleAssignments.length} {pending.length - visibleAssignments.length === 1 ? "checklist" : "checklists"}
        </button>}
      </div>
      : myAssignments.length
        ? expired.length
          ? <p className="checklist-assignment-section-empty">Não há checklists dentro do prazo aguardando preenchimento.</p>
          : <div className="checklist-home-empty"><span className="checklist-home-complete-mark">✓</span><div><b>Tudo em dia!</b><p>Você concluiu todos os checklists atribuídos.</p></div></div>
        : <EmptyState title="Nenhum checklist pendente" text="Quando receber uma atribuição, ela aparecerá aqui para você preencher."/>}
    {expired.length > 0 && <div className="checklist-home-expired">
      <div className="checklist-assignment-section-heading"><h2>Expirados</h2><span>{expired.length}</span></div>
      <div className="checklist-home-list">{expired.slice(0, 3).map((assignment) => <AssignmentCard key={assignment.id} assignment={assignment} data={data} user={user} execute={execute} admin={false} compact/>)}</div>
      {expired.length > 3 && <button type="button" className="checklist-home-more" onClick={() => onNavigate("checklists")}>Ver mais {expired.length - 3} expirados</button>}
    </div>}
    {completed.length > 0 && <p className="checklist-home-completed">{completed.length} {completed.length === 1 ? "checklist concluído" : "checklists concluídos"}</p>}
  </section>;
}

function ChecklistScheduleControls({
  frequency,
  enabled,
  weekday,
  dayOfMonth,
  onEnabledChange,
  onWeekdayChange,
  onDayOfMonthChange,
}: {
  frequency: ChecklistTemplateDocument["frequency"];
  enabled: boolean;
  weekday: number;
  dayOfMonth: number;
  onEnabledChange: (enabled: boolean) => void;
  onWeekdayChange: (weekday: number) => void;
  onDayOfMonthChange: (day: number) => void;
}) {
  const weekdays = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
  return <fieldset className="checklist-schedule-controls">
    <legend>Publicação programada</legend>
    <label className="checklist-schedule-toggle">
      <input type="checkbox" checked={enabled} disabled={frequency === "CUSTOM"} onChange={(event) => onEnabledChange(event.target.checked)}/>
      <span><b>Publicar automaticamente</b><small>{frequency === "DAILY" ? "Uma nova cópia será publicada todos os dias." : frequency === "WEEKLY" ? "Uma nova cópia será publicada toda semana." : frequency === "MONTHLY" ? "Uma nova cópia será publicada todo mês." : "Selecione uma frequência diária, semanal ou mensal para programar."}</small></span>
    </label>
    {enabled && frequency === "WEEKLY" && <label>Dia de publicação<select value={weekday} onChange={(event) => onWeekdayChange(Number(event.target.value))}>{weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>}
    {enabled && frequency === "MONTHLY" && <label>Dia do mês<select value={dayOfMonth} onChange={(event) => onDayOfMonthChange(Number(event.target.value))}>{Array.from({ length: 31 }, (_, index) => index + 1).map((day) => <option key={day} value={day}>{day}</option>)}</select><small>Nos meses mais curtos, será publicado no último dia do mês.</small></label>}
    {enabled && frequency === "DAILY" && <p className="checklist-schedule-note">A publicação ocorre diariamente às 00h05 (horário de Brasília).</p>}
    {frequency === "CUSTOM" && <p className="checklist-schedule-note">Checklists personalizados usam prazo manual e não têm publicação recorrente.</p>}
  </fieldset>;
}

function ChecklistPublicationControls({
  value,
  onChange,
}: {
  value: "TODAY" | "TOMORROW";
  onChange: (value: "TODAY" | "TOMORROW") => void;
}) {
  const publicationDate = getChecklistPublicationDate(value);
  return <div className="checklist-publication-controls">
    <label>Quando publicar?
      <select value={value} onChange={(event) => onChange(event.target.value as "TODAY" | "TOMORROW")}>
        <option value="TODAY">Publicar agora</option>
        <option value="TOMORROW">Publicar no dia seguinte</option>
      </select>
    </label>
    <p>{value === "TODAY" ? "O checklist ficará disponível imediatamente." : `O checklist ficará disponível em ${formatDate(publicationDate)}.`}</p>
  </div>;
}

function getScheduleLabel(template: ChecklistTemplateDocument) {
  if (template.frequency === "DAILY") return "diária";
  if (template.frequency === "WEEKLY") {
    const weekday = template.publishWeekday;
    return Number.isInteger(weekday) && weekday! >= 0 && weekday! <= 6
      ? `toda ${["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"][weekday!]}`
      : "semanal";
  }
  if (template.frequency === "MONTHLY") return `no dia ${template.publishDayOfMonth ?? 1} de cada mês`;
  return "não programada";
}

function TeamAssignmentPicker({ teams, departments, selectedTeamIds, onChange }: { teams: WorkspaceData["teams"]; departments: WorkspaceData["departments"]; selectedTeamIds: string[]; onChange: (ids: string[]) => void }) {
  const groups = departments.map((department) => ({ department, teams: teams.filter((team) => team.departmentId === department.id) }));
  const assignedCount = teams.filter((team) => selectedTeamIds.includes(team.id)).length;
  const toggleTeam = (teamId: string, checked: boolean) => onChange(checked ? [...new Set([...selectedTeamIds, teamId])] : selectedTeamIds.filter((id) => id !== teamId));
  const toggleDepartment = (teamIds: string[], checked: boolean) => onChange(checked ? [...new Set([...selectedTeamIds, ...teamIds])] : selectedTeamIds.filter((id) => !teamIds.includes(id)));
  return <details className="team-assignment-picker"><summary>{assignedCount ? assignedCount + (assignedCount === 1 ? " equipe selecionada" : " equipes selecionadas") : "Selecionar equipes por setor"}</summary><div className="team-assignment-options"><p className="team-assignment-help">Marque um setor para selecionar todas as equipes dele ou abra as opções e escolha equipes individuais.</p>{groups.map(({ department, teams: departmentTeams }) => { const ids = departmentTeams.map((team) => team.id); const allSelected = ids.length > 0 && ids.every((id) => selectedTeamIds.includes(id)); return <fieldset key={department.id}><legend><label><input type="checkbox" checked={allSelected} disabled={!ids.length} onChange={(event) => toggleDepartment(ids, event.target.checked)}/><b>{department.name}</b><small>{ids.length ? " Todas as equipes do setor" : " Ainda sem equipes"}</small></label></legend>{departmentTeams.map((team) => <label className="team-assignment-option" key={team.id}><input type="checkbox" checked={selectedTeamIds.includes(team.id)} onChange={(event) => toggleTeam(team.id, event.target.checked)}/><span>{team.name}</span></label>)}</fieldset>; })}{!groups.length && <p className="empty-inline">Cadastre setores e equipes antes de fazer associações.</p>}</div></details>;
}

function TeamPage({ data, user, execute, onOpenProfile }: { data: WorkspaceData; user: User; execute: (operation: () => Promise<unknown>, message: string) => Promise<boolean>; onOpenProfile: (employeeId: string) => void }) {
  const admin = data.member.role === "ADMIN";
  const allPeople = admin ? data.members : data.members.filter((member) => member.status === "ACTIVE");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"" | FirebaseRole>("");
  const [statusFilter, setStatusFilter] = useState<"" | "ACTIVE" | "INACTIVE">("");
  const jobTitles = [...new Set(allPeople.map((member) => member.positionTitle?.trim()).filter((title): title is string => Boolean(title)))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const term = search.trim().toLocaleLowerCase("pt-BR");
  const people = allPeople.filter((member) => {
    if (roleFilter && member.role !== roleFilter) return false;
    if (statusFilter && member.status !== statusFilter) return false;
    if (!term) return true;
    return member.name.toLocaleLowerCase("pt-BR").includes(term)
      || member.email.toLocaleLowerCase("pt-BR").includes(term)
      || (member.positionTitle ?? "").toLocaleLowerCase("pt-BR").includes(term);
  });
  const hasFilters = Boolean(term || roleFilter || statusFilter);
  return <>
    <PageHeading eyebrow={admin ? "ADMINISTRAÇÃO" : "PESSOAS"} title={admin ? "Pessoas e equipes" : "Minha equipe"} subtitle={admin ? "Ajuste funções, equipes e acesso das pessoas." : "Pessoas das equipes que você compartilha."}/>
    <section className="live-panel">
      <div className="live-panel-heading"><div><span className="eyebrow">MEMBROS</span><h2>{hasFilters ? `${people.length} de ${allPeople.length} pessoa(s)` : `${allPeople.length} pessoa(s)`}</h2></div></div>
      <div className="filter-bar" role="search">
        <label className="filter-field filter-field-grow">Buscar<input type="search" className="filter-input" value={search} placeholder="Nome, e-mail ou cargo" onChange={(event) => setSearch(event.target.value)}/></label>
        <label className="filter-field">Perfil<select className="filter-input" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as "" | FirebaseRole)}><option value="">Todos os perfis</option><option value="ADMIN">Administradora</option><option value="LEADER">Líder</option><option value="EMPLOYEE">Colaborador</option></select></label>
        {admin && <label className="filter-field">Status<select className="filter-input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "" | "ACTIVE" | "INACTIVE")}><option value="">Todos os status</option><option value="ACTIVE">Ativa</option><option value="INACTIVE">Inativa</option></select></label>}
        {hasFilters && <button type="button" className="ranking-filter-reset" onClick={() => { setSearch(""); setRoleFilter(""); setStatusFilter(""); }}>Limpar filtros</button>}
      </div>
      {people.length ? <div className="live-table-wrap"><table className="live-table"><thead><tr><th>Pessoa</th><th>Cargo atual</th><th>Perfil</th><th>Setor / equipe(s)</th><th>Status</th>{admin && <th>Ação</th>}{!admin && data.member.role === "LEADER" && <th>PDI</th>}</tr></thead><tbody>{people.map((member) => <MemberRow key={member.uid} member={member} teams={data.teams} departments={data.departments} jobTitles={jobTitles} editable={admin && member.uid !== user.uid} onOpenProfile={(admin || (data.member.role === "LEADER" && member.role === "EMPLOYEE")) ? () => onOpenProfile(member.uid) : undefined} onSave={(changes) => execute(() => updateMember(data.company.id ?? "", member, changes), "Perfil atualizado.")} onRemove={admin && member.uid !== user.uid ? () => execute(() => removeMember(data.company.id ?? "", member.uid, member.teamIds), "Pessoa removida da empresa.") : undefined}/>)}</tbody></table></div> : hasFilters ? <EmptyState title="Nenhuma pessoa encontrada" text="Ajuste a busca ou os filtros para ver outras pessoas."/> : <EmptyState title="A equipe ainda está vazia" text={admin ? "As pessoas que se cadastrarem na empresa aparecerão aqui para você definir função e equipes." : "A administração ainda não adicionou pessoas às suas equipes."}/>}
    </section>
  </>;
}

function MemberRow({ member, teams, departments, jobTitles, editable, onOpenProfile, onSave, onRemove }: { member: DocumentWithId<CompanyMember>; teams: WorkspaceData["teams"]; departments: WorkspaceData["departments"]; jobTitles: string[]; editable: boolean; onOpenProfile?: () => void; onSave: (changes: Partial<Pick<CompanyMember, "role" | "status" | "teamIds" | "positionTitle">>) => Promise<boolean>; onRemove?: () => Promise<boolean> }) {
  const [role, setRole] = useState(member.role);
  const [status, setStatus] = useState(member.status);
  const [teamIds, setTeamIds] = useState(member.teamIds);
  const [positionTitle, setPositionTitle] = useState(member.positionTitle ?? "");
  const [busy, setBusy] = useState(false);
  const changed = role !== member.role || status !== member.status || teamIds.join("|") !== member.teamIds.join("|") || positionTitle.trim() !== (member.positionTitle ?? "");
  return <tr>
    <td><b>{member.name}</b><small className="table-subline">{member.email}</small></td>
    <td>{editable ? <><input className="table-select current-position-input" list={"position-title-options-" + member.uid} aria-label={"Cargo atual de " + member.name} maxLength={100} placeholder="Ex.: Analista" value={positionTitle} onChange={(event) => setPositionTitle(event.target.value)}/><datalist id={"position-title-options-" + member.uid}>{jobTitles.map((title) => <option key={title} value={title}/>)}</datalist></> : member.positionTitle || "Não informado"}</td>
    <td>{editable ? <select className="table-select" value={role} onChange={(event) => setRole(event.target.value as FirebaseRole)}><option value="ADMIN">Administradora</option><option value="LEADER">Líder</option><option value="EMPLOYEE">Colaborador</option></select> : roleNames[member.role]}</td>
    <td>{editable ? <TeamAssignmentPicker teams={teams} departments={departments} selectedTeamIds={teamIds} onChange={setTeamIds}/> : member.teamIds.map((id) => { const team = teams.find((item) => item.id === id); const department = team && departments.find((item) => item.id === team.departmentId); return team ? `${department?.name ?? "Setor"} / ${team.name}` : id; }).join(", ") || "Sem equipe"}</td>
    <td>{editable ? <select className="table-select" value={status} onChange={(event) => setStatus(event.target.value as "ACTIVE" | "INACTIVE")}><option value="ACTIVE">Ativa</option><option value="INACTIVE">Inativa</option></select> : <span className={`status-chip ${member.status === "ACTIVE" ? "done" : "pending"}`}>{member.status === "ACTIVE" ? "Ativo" : "Inativo"}</span>}</td>
    {onOpenProfile && <td><button className="button button-outline button-small" onClick={onOpenProfile}><UserCircle size={15}/> Ver perfil</button></td>}
    {editable && <td><div className="row-actions"><button className="button button-outline button-small" aria-label={"Salvar alterações de " + member.name} disabled={!changed || busy} onClick={async () => { setBusy(true); await onSave({ role, status, teamIds, positionTitle: positionTitle.trim() }); setBusy(false); }}>{busy ? "Salvando…" : "Salvar"}</button>{onRemove && <ConfirmButton dialogTitle="Remover pessoa da empresa" description={<>Remover <b>{member.name}</b> da empresa? A pessoa perde o acesso aos dados da empresa. Avaliações, PDIs e históricos já registrados são mantidos, e o acesso pode ser solicitado novamente.</>} className="button button-danger button-small" confirmLabel="Remover" busyLabel="Removendo…" onConfirm={onRemove}>Remover</ConfirmButton>}</div></td>}
  </tr>;
}

function LeaderDevelopmentPage({ data, onOpenProfile }: { data: WorkspaceData; onOpenProfile: (employeeId: string) => void }) {
  const employees = data.members.filter((person) => person.role === "EMPLOYEE" && person.status === "ACTIVE");
  return <>
    <PageHeading eyebrow="DESENVOLVIMENTO DA EQUIPE" title="Avaliações de Promoção/PDI" subtitle="Avalie os indicadores e as competências dos colaboradores para recomendar uma promoção." />
    {data.developmentAccessAvailable === false && <div className="live-notice error" role="alert">O Firestore recusou a leitura dos dados de PDI para este perfil. Recarregue a pagina; se persistir, confira as permissoes da conta nas regras do projeto.</div>}
    {data.restrictedPromotionHistory && <div className="live-notice" role="status">Registros antigos que incluem evidências de avaliações convencionais estão restritos à administração. As avaliações originais permanecem preservadas.</div>}
    <section className="live-panel development-panel">
      <div className="live-panel-heading"><div><span className="eyebrow">SUA EQUIPE</span><h2>{employees.length} colaborador(es)</h2></div></div>
      {employees.length ? <div className="development-member-list">{employees.map((employee) => {
        const plan = data.developmentPlans.find((item) => item.employeeId === employee.uid);
        const latestRequest = data.promotionRequests.filter((request) => request.employeeId === employee.uid).sort((a, b) => timestampMillis(b.submittedAt) - timestampMillis(a.submittedAt))[0];
        return <article className="development-member-card" key={employee.uid}>
          <div className="development-member-identity"><span className="live-avatar" aria-hidden="true">{initials(employee.name)}</span><div><h3>{employee.name}</h3><p>{employee.positionTitle || "Cargo atual não informado"}{plan ? ` · Próximo cargo: ${plan.targetPosition}` : " · Sem avaliação enviada"}</p></div></div>
          <div className="development-member-status">{latestRequest?.status === "PENDING" ? <span className="status-chip pending"><Clock size={14}/> Indicação em análise</span> : latestRequest?.status === "REJECTED" ? <span className="status-chip pending"><XCircle size={14}/> Indicação reprovada</span> : latestRequest?.status === "APPROVED" || plan?.status === "PROMOTED" ? <span className="status-chip done"><CheckCircle size={14}/> Promoção aprovada</span> : <span className="status-chip">Avaliação não enviada</span>}</div>
          <button type="button" className="button button-outline button-small" onClick={() => onOpenProfile(employee.uid)}>{plan?.status === "PROMOTED" ? "Criar outro PDI" : plan ? "Gerenciar PDI" : "Criar PDI"} <ArrowLeft className="development-open-arrow" size={15}/></button>
        </article>;
      })}</div> : <EmptyState title="Nenhum colaborador na equipe" text="Quando houver colaboradores ativos vinculados às suas equipes, você poderá criar os PDIs por aqui."/>}
    </section>
  </>;
}

function MyDevelopmentPage({ data, user }: { data: WorkspaceData; user: User }) {
  const plan = data.developmentPlans.find((item) => item.employeeId === user.uid);
  return <>
    <PageHeading eyebrow="SEU DESENVOLVIMENTO" title="Meu PDI" subtitle="Acompanhe o andamento da sua avaliação para promoção." />
    {data.developmentAccessAvailable === false && <div className="live-notice error" role="alert">O Firestore recusou a leitura dos dados de PDI para este perfil. Recarregue a pagina; se persistir, confira as permissoes da conta nas regras do projeto.</div>}
    {plan ? <section className="live-panel development-panel">
      <div className="development-plan-summary"><div><span className="eyebrow">CARGO AVALIADO</span><h2>{plan.targetPosition}</h2><p>Cargo atual: {data.member.positionTitle || "Não informado"}</p></div>{plan.status === "PROMOTED" ? <span className="status-chip done"><CheckCircle size={15}/> Promoção aprovada</span> : <span className="status-chip pending">Avaliação enviada para análise</span>}</div>
      <p className="development-inline-note">A avaliação considera indicadores de desempenho e competências preenchidos pela liderança. Para dúvidas sobre o resultado, procure sua liderança.</p>
    </section> : <section className="live-panel"><EmptyState title="Sua avaliação ainda não foi enviada" text="Quando sua liderança iniciar uma avaliação de Promoção/PDI, o cargo desejado e o andamento aparecerão nesta página."/></section>}
  </>;
}

function DevelopmentProfilePage({ data, employee, execute, onBack }: { data: WorkspaceData; employee?: DocumentWithId<CompanyMember>; execute: (operation: () => Promise<unknown>, message: string) => Promise<boolean>; onBack: () => void }) {
  const plan = employee ? data.developmentPlans.find((item) => item.employeeId === employee.uid) : undefined;
  const latestSavedPromotion = employee
    ? data.promotionRequests
      .filter((request) => request.employeeId === employee.uid)
      .sort((a, b) => timestampMillis(b.submittedAt) - timestampMillis(a.submittedAt))[0]
    : undefined;
  const [targetPosition, setTargetPosition] = useState(plan?.status === "PROMOTED" ? "" : plan?.targetPosition ?? "");
  const [justification, setJustification] = useState("");
  const [promotionIndicators, setPromotionIndicators] = useState(() => restorePromotionEvaluationInputs().indicators);
  const [promotionCompetencies, setPromotionCompetencies] = useState(() => restorePromotionEvaluationInputs().competencies);
  const [requesting, setRequesting] = useState(false);
  useEffect(() => {
    const savedInputs = restorePromotionEvaluationInputs(latestSavedPromotion);
    setPromotionIndicators(savedInputs.indicators);
    setPromotionCompetencies(savedInputs.competencies);
  }, [latestSavedPromotion]);
  if (!employee) return <><button type="button" className="text-link" onClick={onBack}><ArrowLeft size={16}/> Voltar para equipe</button><EmptyState title="Colaborador não encontrado" text="Volte à equipe e selecione uma pessoa ativa."/></>;
  const profileEmployee = employee;

  const sharedTeamIds = profileEmployee.teamIds.filter((teamId) => data.member.teamIds.includes(teamId));
  const isOwner = sharedTeamIds.length > 0;
  const canManagePdi = isOwner && data.developmentAccessAvailable;
  const ownRequests = data.promotionRequests.filter((request) => request.employeeId === profileEmployee.uid).sort((a, b) => timestampMillis(b.submittedAt) - timestampMillis(a.submittedAt));
  const pendingRequest = ownRequests.find((request) => request.status === "PENDING");
  const evaluationSnapshots = data.evaluations
    .filter((evaluation) => evaluation.type === "EMPLOYEE" && evaluation.evaluatedUserId === employee.uid && evaluation.status === "SUBMITTED" && typeof evaluation.averageScore === "number")
    .sort((a, b) => timestampMillis(b.submittedAt) - timestampMillis(a.submittedAt))
    .slice(0, 30)
    .map((evaluation) => ({
      evaluationId: evaluation.id,
      cycleName: data.cycles.find((cycle) => cycle.id === evaluation.cycleId)?.name ?? "Ciclo sem nome",
      score: evaluation.averageScore ?? 0,
      comment: evaluation.comment ?? "",
      submittedAt: evaluation.submittedAt,
    }));
  const promotionPreview = promotionResultPreview(promotionIndicators, promotionCompetencies);

  async function submitRequest() {
    if (!promotionPreview?.complete || targetPosition.trim().length < 2 || justification.trim().length < 20) return;
    setRequesting(true);
    await execute(() => submitPromotionRequest({
      companyId: data.company.id ?? "",
      employeeId: profileEmployee.uid,
      targetPosition,
      justification,
      indicators: promotionIndicators.map(({ id, percentage }) => ({ id, percentage: Number(percentage) })),
      competencies: promotionCompetencies.map(({ id, score }) => ({ id, score: Number(score) })),
    }), "Indicação enviada para análise administrativa.");
    setRequesting(false);
  }

  return <>
    <div className="development-back-row"><button type="button" className="text-link" onClick={onBack}><ArrowLeft size={16}/> Voltar para equipe</button></div>
    <PageHeading eyebrow="PERFIL DO COLABORADOR" title={employee.name} subtitle={`${employee.email} · Cargo atual: ${employee.positionTitle || "Não informado"}`} />
    {data.developmentAccessAvailable === false && <div className="live-notice error" role="alert">O Firestore recusou a leitura dos dados de PDI para este perfil. Recarregue a página; se persistir, confira as permissões da conta nas regras do projeto.</div>}
    {data.restrictedPromotionHistory && <div className="live-notice" role="status">Registros antigos que incluem evidências de avaliações convencionais estão restritos à administração. As avaliações originais permanecem preservadas.</div>}
    {!sharedTeamIds.length && <div className="form-alert error">Este colaborador não está mais em uma equipe compartilhada com você. O PDI fica disponível somente para liderança da equipe.</div>}
    {plan?.status === "PROMOTED" && <div className="development-approved-banner"><CheckCircle size={20}/><span><b>Promoção aprovada</b><small>O cargo do colaborador foi atualizado para {employee.positionTitle || plan.targetPosition}.</small></span></div>}
    {plan && !isOwner && <div className="form-alert">Este PDI é gerenciado por outra liderança. Você pode acompanhar a avaliação, mas não enviar uma nova indicação.</div>}
    <section className="live-panel development-panel">
      <div className="live-panel-heading"><div><span className="eyebrow">AVALIAÇÃO DE PROMOÇÃO/PDI</span><h2>Indicadores e competências</h2></div></div>
      {pendingRequest && <div className="promotion-status-banner"><Clock size={18}/><span><b>Indicação em análise</b><small>Enviada em {formatDateLike(pendingRequest.submittedAt)}. O andamento é restrito à liderança e à administração.</small></span></div>}
      {ownRequests.filter((request) => request.status !== "PENDING").slice(0, 2).map((request) => <div className={`promotion-status-banner ${request.status === "APPROVED" ? "is-approved" : "is-rejected"}`} key={request.id}>{request.status === "APPROVED" ? <CheckCircle size={18}/> : <XCircle size={18}/>}<span><b>{request.status === "APPROVED" ? "Indicação aprovada" : "Indicação reprovada"}</b><small>{request.adminNote || "Sem observação da administração."}</small></span></div>)}
      {plan?.status === "PROMOTED" && !pendingRequest && canManagePdi && <div className="form-alert"><b>Nova indicação para promoção</b><p>Este colaborador já foi promovido anteriormente. Para indicar uma nova promoção (para um cargo ainda mais alto), preencha o novo cargo desejado (diferente do cargo atual), a justificativa e a avaliação abaixo.</p></div>}
      {latestSavedPromotion && <PromotionScoringSnapshot request={latestSavedPromotion}/>}
      {!pendingRequest && canManagePdi && <PromotionRequestForm
          targetPosition={targetPosition}
          onTargetPositionChange={setTargetPosition}
          justification={justification}
          onJustificationChange={setJustification}
          indicators={promotionIndicators}
          onIndicatorsChange={setPromotionIndicators}
          competencies={promotionCompetencies}
          onCompetenciesChange={setPromotionCompetencies}
          preview={promotionPreview}
          evaluationCount={evaluationSnapshots.length}
          averageEvaluationScore={evaluationSnapshots.length
            ? evaluationSnapshots.reduce((sum, item) => sum + item.score, 0) / evaluationSnapshots.length
            : null}
          requesting={requesting}
          onSubmit={() => void submitRequest()}
        />}
      {!pendingRequest && !canManagePdi && isOwner && <p className="development-inline-note">A avaliação não está disponível enquanto os dados de Promoção/PDI não puderem ser carregados.</p>}
    </section>
  </>;
}

function PromotionRequestForm({
  targetPosition,
  onTargetPositionChange,
  justification,
  onJustificationChange,
  indicators,
  onIndicatorsChange,
  competencies,
  onCompetenciesChange,
  preview,
  evaluationCount,
  averageEvaluationScore,
  requesting,
  onSubmit,
}: {
  targetPosition: string;
  onTargetPositionChange: (value: string) => void;
  justification: string;
  onJustificationChange: (value: string) => void;
  indicators: Array<{ id: string; percentage: PromotionIndicatorEntry }>;
  onIndicatorsChange: Dispatch<SetStateAction<Array<{ id: string; percentage: PromotionIndicatorEntry }>>>;
  competencies: Array<{ id: string; score: PromotionCompetencyEntry }>;
  onCompetenciesChange: Dispatch<SetStateAction<Array<{ id: string; score: PromotionCompetencyEntry }>>>;
  preview: PromotionEvaluationPreview | null;
  evaluationCount: number;
  averageEvaluationScore: number | null;
  requesting: boolean;
  onSubmit: () => void;
}) {
  const readyToSubmit = Boolean(preview?.complete)
    && targetPosition.trim().length >= 2
    && targetPosition.trim().length <= 100
    && justification.trim().length >= 20
    && !requesting;
  const formatPoints = (points?: number) => points === undefined
    ? "—"
    : `${points.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} p.p.`;

  return <div className="promotion-request-form">
    <p>Preencha a avaliação de Promoção/PDI. O percentual representa o atingimento da meta, não o valor bruto do indicador.</p>
    <label>Cargo desejado
      <input value={targetPosition} onChange={(event) => onTargetPositionChange(event.target.value)} maxLength={100} minLength={2} placeholder="Ex.: Analista Sênior"/>
      <small>Informe o cargo para o qual o colaborador está sendo avaliado.</small>
    </label>
    <label>Por que este colaborador está apto a progredir de cargo?
      <textarea value={justification} onChange={(event) => onJustificationChange(event.target.value)} maxLength={1500} minLength={20} rows={4} placeholder="Descreva resultados, responsabilidades assumidas e sinais de prontidão para o próximo cargo."/>
      <small>{justification.trim().length}/1.500 caracteres (mínimo 20)</small>
    </label>
    <div className="promotion-score-form">
      <section className="promotion-review-panel promotion-scoring-section">
        <div className="promotion-scoring-heading"><h4>Seção A — Indicadores</h4><span>Peso total: 80%</span></div>
        <div className="promotion-indicator-list">
          {PROMOTION_INDICATORS.map((definition) => {
            const entry = indicators.find((item) => item.id === definition.id);
            const points = preview?.indicators.find((item) => item.id === definition.id)?.points;
            return <div className="promotion-indicator-row" key={definition.id}>
              <div className="promotion-indicator-name"><b>{definition.name}</b><span>Peso {definition.weight}%</span></div>
              <label className="promotion-score-input">Atingimento (%)
                <input
                  aria-label={`Percentual de atingimento: ${definition.name}`}
                  type="number"
                  min={0}
                  max={PROMOTION_INDICATOR_PERCENTAGE_MAX}
                  step="any"
                  inputMode="decimal"
                  value={entry?.percentage ?? ""}
                  aria-invalid={entry?.percentage !== "" && entry?.percentage !== undefined && (entry.percentage < 0 || entry.percentage > PROMOTION_INDICATOR_PERCENTAGE_MAX)}
                  onChange={(event) => {
                    const rawValue = event.target.value;
                    if (rawValue !== "" && Number(rawValue) > PROMOTION_INDICATOR_PERCENTAGE_MAX) return;
                    const value = rawValue === "" ? "" : Number(rawValue);
                    onIndicatorsChange((current) => current.map((item) => item.id === definition.id ? { ...item, percentage: value } : item));
                  }}
                />
                {definition.id === "sector-loss" && <small style={{color: 'var(--muted)', fontSize: '10px'}}>Quanto maior, menor o aproveitamento</small>}
              </label>
              <div className="promotion-item-points"><small>Pontos obtidos</small><b>{formatPoints(points)}</b></div>
            </div>;
          })}
        </div>
        <div className="promotion-subtotal"><span>Subtotal Indicadores (80%)</span><b>{formatPoints(preview?.indicatorTotal)}</b></div>
      </section>
      <section className="promotion-review-panel promotion-scoring-section">
        <div className="promotion-scoring-heading"><h4>Seção B — Competências</h4><span>Peso total: 40%</span></div>
        <div className="promotion-competency-list">
          {PROMOTION_COMPETENCIES.map((definition) => {
            const entry = competencies.find((item) => item.id === definition.id);
            const points = preview?.competencies.find((item) => item.id === definition.id)?.points;
            const currentScore = entry?.score;
            return <div className="promotion-indicator-row" key={definition.id}>
              <div className="promotion-indicator-name"><b>{definition.name}</b><span>Peso individual: {definition.weight}%</span></div>
              <div className="promotion-competency-scale">
                <span className="promotion-competency-scale-label">Nota</span>
                <div className="promotion-competency-options" role="radiogroup" aria-label={`Nota da competência: ${definition.name}`}>
                  {[1, 2, 3, 4, 5].map((scoreValue) => (
                    <button
                      key={scoreValue}
                      type="button"
                      role="radio"
                      aria-checked={currentScore === scoreValue}
                      className={"promotion-competency-option" + (currentScore === scoreValue ? " is-selected" : "")}
                      onClick={() => {
                        onCompetenciesChange((current) => current.map((item) => item.id === definition.id ? { ...item, score: scoreValue } : item));
                      }}
                    >
                      {scoreValue}
                    </button>
                  ))}
                </div>
              </div>
              <div className="promotion-item-points"><small>Pontos obtidos</small><b>{formatPoints(points)}</b></div>
            </div>;
          })}
        </div>
        <div className="promotion-pending-competency"><span>Nova competência (preencher)</span><small>Pendente de definição; não integra o cálculo.</small></div>
        <div className="promotion-subtotal"><span>Subtotal Competências (40%)</span><b>{formatPoints(preview?.competenceTotal)}</b></div>
      </section>
      <section className="promotion-result-panel" aria-live="polite">
        <h4>Resultado da avaliação</h4>
        <div className="promotion-result-grid">
          <div><span>Subtotal dos indicadores — Seção A</span><b>{formatPoints(preview?.indicatorTotal)}</b></div>
          <div><span>Base dos indicadores (limite 60 p.p.)</span><b>{formatPoints(preview?.indicatorBase)}</b></div>
          <div><span>Extra por superação</span><b>{formatPoints(preview?.extraScore)}</b></div>
          <div><span>Subtotal das competências — Seção B</span><b>{formatPoints(preview?.competenceTotal)}</b></div>
          <div><span>Resultado-base</span><b>{formatPoints(preview?.baseScore)}</b></div>
          <div className="promotion-final-result"><span>Resultado final</span><b>{formatPoints(preview?.finalScore)}</b></div>
          <div><span>Classificação final</span><b>{preview?.classification ?? "—"}</b></div>
        </div>
        {!preview?.complete && <p className="promotion-validation-note">Preencha os oito percentuais entre 0 e 100 e as cinco notas inteiras entre 1 e 5 para concluir a avaliação. Os subtotais e pontos preenchidos são atualizados automaticamente.</p>}
      </section>
    </div>
    <div className="promotion-evidence-summary">
      <b>{evaluationCount} avaliação(ões) convencionais serão anexadas como histórico</b>
      {averageEvaluationScore === null
        ? <small>Não há avaliações convencionais concluídas para anexar no momento.</small>
        : <small>Média histórica das notas: {averageEvaluationScore.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / 5. Esta média não participa do cálculo de promoção.</small>}
    </div>
    <button type="button" className="button button-primary" disabled={!readyToSubmit} onClick={onSubmit}>
      {requesting ? "Enviando…" : "Enviar indicação para análise"}
    </button>
  </div>;
}

function PromotionScoringSnapshot({ request }: { request: PromotionRequestDocument }) {
  const result = request.promotionResult;
  if (!result) {
    return <p className="promotion-legacy-score-note">Registro anterior à avaliação ponderada; não há respostas do modelo novo salvas.</p>;
  }
  const formatPoints = (points?: number) => points === undefined
    ? "—"
    : `${points.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} p.p.`;

  return <section className="promotion-saved-scoring" aria-label="Resultados salvos da avaliação de promoção">
    <div className="promotion-score-summary">
      <div><span>Subtotal dos indicadores</span><b>{formatPoints(result.indicatorTotal)}</b></div>
      <div><span>Base dos indicadores</span><b>{formatPoints(result.indicatorBase)}</b></div>
      <div><span>Extra por superação</span><b>{formatPoints(result.extraScore)}</b></div>
      <div><span>Subtotal Competências (40%)</span><b>{formatPoints(result.competenceTotal)}</b></div>
      <div><span>Resultado-base</span><b>{formatPoints(result.baseScore)}</b></div>
      <div><span>Resultado final</span><b>{formatPoints(result.finalScore)}</b></div>
      <div><span>Classificação</span><b>{result.classification ?? "Sem classificação"}</b></div>
    </div>
    <div className="promotion-saved-sections">
      <section className="promotion-review-panel">
        <h4>Seção A — Indicadores</h4>
        {request.indicators?.length
          ? <ul>{request.indicators.map((item) => <li key={item.id}><span><b>{item.name}</b><small>Peso {item.weight}% · Atingimento {item.percentage}% · {formatPoints(item.points)}</small></span></li>)}</ul>
          : <p className="promotion-legacy-score-note">Respostas de indicadores não disponíveis neste registro.</p>}
      </section>
      <section className="promotion-review-panel">
        <h4>Seção B — Competências</h4>
        {request.competencies?.length
          ? <ul>{request.competencies.map((item) => <li key={item.id}><span><b>{item.name}</b><small>Peso {item.weight}% · Nota {item.score}/5 · {formatPoints(item.points)}</small></span></li>)}</ul>
          : <p className="promotion-legacy-score-note">Respostas de competências não disponíveis neste registro.</p>}
      </section>
    </div>
  </section>;
}

function PromotionRequestsPage({ data, execute }: { data: WorkspaceData; execute: (operation: () => Promise<unknown>, message: string) => Promise<boolean> }) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [expandedRequests, setExpandedRequests] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "PENDING" | "APPROVED" | "REJECTED">("");
  const allRequests = [...data.promotionRequests].sort((a, b) => {
    if (a.status === "PENDING" && b.status !== "PENDING") return -1;
    if (a.status !== "PENDING" && b.status === "PENDING") return 1;
    return timestampMillis(b.submittedAt) - timestampMillis(a.submittedAt);
  });
  const pendingCount = allRequests.filter((request) => request.status === "PENDING").length;
  const term = search.trim().toLocaleLowerCase("pt-BR");
  const requests = allRequests.filter((request) => {
    if (statusFilter && request.status !== statusFilter) return false;
    if (!term) return true;
    const employeeName = data.members.find((person) => person.uid === request.employeeId)?.name ?? "";
    return employeeName.toLocaleLowerCase("pt-BR").includes(term) || request.targetPosition.toLocaleLowerCase("pt-BR").includes(term);
  });
  const hasFilters = Boolean(term || statusFilter);
  return <>
    <PageHeading eyebrow="ADMINISTRAÇÃO" title="Indicações de promoção" subtitle="Analise a avaliação por indicadores e competências antes de decidir." />
    {data.developmentAccessAvailable === false && <div className="live-notice error" role="alert">O Firestore recusou a leitura dos dados de PDI para este perfil. Recarregue a pagina; se persistir, confira as permissoes da conta nas regras do projeto.</div>}
    <section className="live-panel development-panel">
      <div className="live-panel-heading"><div><span className="eyebrow">FILA DE ANÁLISE</span><h2>{pendingCount} pendente(s) · {allRequests.length} no histórico</h2></div></div>
      <div className="filter-bar" role="search">
        <label className="filter-field filter-field-grow">Buscar<input type="search" className="filter-input" value={search} placeholder="Colaborador ou cargo desejado" onChange={(event) => setSearch(event.target.value)}/></label>
        <label className="filter-field">Situação<select className="filter-input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "" | "PENDING" | "APPROVED" | "REJECTED")}><option value="">Todas as situações</option><option value="PENDING">Pendentes</option><option value="APPROVED">Aprovadas</option><option value="REJECTED">Reprovadas</option></select></label>
        {hasFilters && <button type="button" className="ranking-filter-reset" onClick={() => { setSearch(""); setStatusFilter(""); }}>Limpar filtros</button>}
      </div>
      {requests.length ? <div className="promotion-request-list">{requests.map((request) => {
        const employee = data.members.find((person) => person.uid === request.employeeId);
        const leader = data.members.find((person) => person.uid === request.leaderId);
        const expanded = expandedRequests[request.id] ?? false;
        return <article className={"promotion-request-card" + (expanded ? " is-expanded" : "")} key={request.id}>
          <header className="promotion-request-summary">
            <div className="promotion-request-title"><h3>{employee?.name ?? "Colaborador"} <span>→ {request.targetPosition}</span></h3></div>
            <div className="promotion-request-summary-actions">
              <span className={"status-chip " + (request.status === "PENDING" ? "pending" : request.status === "APPROVED" ? "done" : "pending")}>{request.status === "PENDING" ? "Pendente" : request.status === "APPROVED" ? "Aprovada" : "Reprovada"}</span>
              <button type="button" className="button button-outline button-small" aria-expanded={expanded} aria-controls={"promotion-details-" + request.id} onClick={() => setExpandedRequests((current) => ({ ...current, [request.id]: !expanded }))}>{expanded ? "Mostrar menos" : "Mostrar tudo"}</button>
            </div>
          </header>
          {expanded && <div className="promotion-request-expanded" id={"promotion-details-" + request.id}>
            <p className="promotion-request-context">Indicado por {leader?.name ?? "Liderança"} · Enviado em {formatDateLike(request.submittedAt)}</p>
            <div className="promotion-request-details"><div><span>Cargo atual</span><b>{employee?.positionTitle || "Não informado"}</b></div><div><span>Nota média anexada</span><b>{request.averageScore === null ? "Sem avaliações" : request.averageScore.toFixed(2) + " / 5"}</b></div><div><span>Resultado de promoção</span><b>{request.promotionResult ? `${request.promotionResult.finalScore?.toFixed(2) ?? "0.00"} · ${request.promotionResult.classification ?? "Sem classificação"}` : "Sem cálculo"}</b></div></div>
            <PromotionScoringSnapshot request={request}/>
            <div className="promotion-review-content">
              <section className="promotion-review-panel promotion-justification"><h4>Justificativa da liderança</h4><p>{request.justification}</p></section>
              <div className="promotion-evidence-grid">
                <section className="promotion-review-panel promotion-evidence promotion-evaluation-evidence"><h4>Avaliações convencionais <span>{request.evaluations.length}</span></h4>{request.evaluations.length ? <ul>{request.evaluations.map((evaluation) => <li key={evaluation.evaluationId}><ChartBar size={16}/><span><b>{evaluation.cycleName} · {evaluation.score.toFixed(2)} / 5</b>{evaluation.comment && <small>{evaluation.comment}</small>}</span></li>)}</ul> : <p className="development-inline-note">As avaliações convencionais permanecem nos respectivos registros e não são copiadas para esta indicação.</p>}</section>
              </div>
            </div>
            {request.status === "PENDING" ? <div className="promotion-review-actions"><label>Observação para a decisão<textarea value={notes[request.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [request.id]: event.target.value }))} maxLength={1000} rows={2} placeholder="Opcional; até 1.000 caracteres"/></label><div><button type="button" className="button button-outline" disabled={!data.developmentAccessAvailable} onClick={() => void execute(() => decidePromotionRequest({ companyId: data.company.id ?? "", requestId: request.id, decision: "REJECTED", adminNote: notes[request.id] ?? "" }), "Indicação reprovada.")}>Reprovar</button><button type="button" className="button button-primary" disabled={!data.developmentAccessAvailable} onClick={() => void execute(() => decidePromotionRequest({ companyId: data.company.id ?? "", requestId: request.id, decision: "APPROVED", adminNote: notes[request.id] ?? "" }), "Indicação aprovada e cargo atualizado.")}>Aprovar promoção</button></div></div> : <div className="promotion-decision-note"><b>{request.status === "APPROVED" ? "Aprovada" : "Reprovada"} em {formatDateLike(request.decidedAt)}</b><p>{request.adminNote || "Sem observação registrada."}</p></div>}
          </div>}
        </article>;
      })}</div> : hasFilters ? <EmptyState title="Nenhuma indicação encontrada" text="Ajuste a busca ou a situação para ver outras indicações."/> : <EmptyState title="Nenhuma indicação recebida" text="Quando a liderança enviar uma avaliação de Promoção/PDI, ela será exibida aqui com os resultados para análise."/>}
    </section>
  </>;
}

function timestampMillis(value: unknown): number {
  if (value && typeof value === "object" && "toMillis" in value && typeof (value as { toMillis?: unknown }).toMillis === "function") return (value as { toMillis: () => number }).toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" || typeof value === "number") return new Date(value).getTime() || 0;
  return 0;
}

function formatDateLike(value: unknown): string {
  const time = timestampMillis(value);
  return time ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(time)) : "—";
}
function EvaluationsPage({ data, user, refresh, execute }: { data: WorkspaceData; user: User; refresh: (quiet?: boolean) => Promise<void>; execute: (operation: () => Promise<unknown>, message: string) => Promise<boolean> }) {
  if (data.member.role === "ADMIN") return <AdminEvaluationDrilldown data={data}/>;
  return <PersonalEvaluations data={data} user={user} refresh={refresh} execute={execute}/>;
}

type RankedMember = {
  member: DocumentWithId<CompanyMember>;
  average: number;
  evaluationCount: number;
};

function RankingPage({ data }: { data: WorkspaceData }) {
  const [cycleId, setCycleId] = useState("");
  const [organizationScope, setOrganizationScope] = useState("");
  const submitted = data.evaluations.filter((evaluation) =>
    evaluation.status === "SUBMITTED" &&
    typeof evaluation.averageScore === "number" &&
    Number.isFinite(evaluation.averageScore) &&
    evaluation.averageScore >= 1 &&
    evaluation.averageScore <= 5,
  );
  const [scopeType, scopeId] = organizationScope.split(":");
  const scopedTeamIds = scopeType === "department"
    ? data.teams.filter((team) => team.departmentId === scopeId).map((team) => team.id)
    : scopeType === "team"
      ? [scopeId]
      : null;
  const selectedCycleName = data.cycles.find((cycle) => cycle.id === cycleId)?.name;
  const selectedScopeName = scopeType === "department"
    ? data.departments.find((department) => department.id === scopeId)?.name
    : scopeType === "team"
      ? data.teams.find((team) => team.id === scopeId)?.name
      : undefined;
  const filteredEvaluations = submitted.filter((evaluation) =>
    !cycleId || evaluation.cycleId === cycleId,
  );

  function getRanking(role: "EMPLOYEE" | "LEADER"): RankedMember[] {
    return data.members
      .filter((member) => member.status === "ACTIVE" && member.role === role)
      .filter((member) => !scopedTeamIds || member.teamIds.some((teamId) => scopedTeamIds.includes(teamId)))
      .flatMap((member) => {
        const scores = filteredEvaluations
          .filter((evaluation) =>
            evaluation.evaluatedUserId === member.uid &&
            evaluation.type === role,
          )
          .map((evaluation) => evaluation.averageScore as number);
        if (!scores.length) return [];
        return [{
          member,
          average: Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2)),
          evaluationCount: scores.length,
        }];
      })
      .sort((a, b) => b.average - a.average || b.evaluationCount - a.evaluationCount || a.member.name.localeCompare(b.member.name, "pt-BR"));
  }

  const employees = getRanking("EMPLOYEE");
  const leaders = getRanking("LEADER");
  const totalEvaluations = employees.reduce((total, entry) => total + entry.evaluationCount, 0) +
    leaders.reduce((total, entry) => total + entry.evaluationCount, 0);

  return <>
    <PageHeading eyebrow="RESULTADOS DA EMPRESA" title="Ranking de avaliações" subtitle="Compare as médias por pessoa e explore os resultados por ciclo, setor ou equipe."/>
    <section className="ranking-filters" aria-label="Filtros do ranking">
      <label>
        <span>Ciclo de avaliação</span>
        <span className="ranking-select-wrap">
          <select value={cycleId} onChange={(event) => setCycleId(event.target.value)}>
            <option value="">Todos os ciclos</option>
            {data.cycles.slice().sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map((cycle) =>
              <option key={cycle.id} value={cycle.id}>{cycle.name}</option>,
            )}
          </select>
          <CaretDown size={15} weight="bold" aria-hidden="true"/>
        </span>
      </label>
      <label>
        <span>Setor ou equipe</span>
        <span className="ranking-select-wrap">
          <select value={organizationScope} onChange={(event) => setOrganizationScope(event.target.value)}>
            <option value="">Toda a empresa</option>
            {data.departments.slice().sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map((department) =>
              <optgroup key={department.id} label={department.name}>
                <option value={`department:${department.id}`}>Todo o setor</option>
                {data.teams
                  .filter((team) => team.departmentId === department.id)
                  .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
                  .map((team) => <option key={team.id} value={`team:${team.id}`}>{team.name}</option>)}
              </optgroup>,
            )}
          </select>
          <CaretDown size={15} weight="bold" aria-hidden="true"/>
        </span>
      </label>
      {(cycleId || organizationScope) && <button type="button" className="ranking-filter-reset" onClick={() => {
        setCycleId("");
        setOrganizationScope("");
      }}>Limpar filtros</button>}
    </section>
    <div className="ranking-summary" aria-label="Resumo dos rankings">
      <article><span className="ranking-summary-icon"><Trophy size={18}/></span><div><small>AVALIAÇÕES CONSIDERADAS</small><b>{totalEvaluations}</b></div></article>
      <article><span className="ranking-summary-icon"><UsersThree size={18}/></span><div><small>COLABORADORES RANQUEADOS</small><b>{employees.length}</b></div></article>
      <article><span className="ranking-summary-icon"><ChartBar size={18}/></span><div><small>LÍDERES RANQUEADOS</small><b>{leaders.length}</b></div></article>
    </div>
    <p className="ranking-method-note" id="ranking-method-note">A classificação usa a média das avaliações enviadas {cycleId ? `no ciclo selecionado (${selectedCycleName ?? "ciclo"})` : "em todos os ciclos"} {organizationScope ? `para pessoas ${scopeType === "department" ? "do setor" : "da equipe"} ${selectedScopeName ?? "selecionada"}` : "na empresa inteira"}. Empates na média compartilham a mesma posição; médias com menos de 3 avaliações são sinalizadas como “Poucas avaliações” e devem ser interpretadas com cautela.</p>
    <div className="ranking-groups">
      <RankingGroup key={`employees-${cycleId}-${organizationScope}`} title="Colaboradores" description="Desempenho médio recebido" entries={employees} teams={data.teams} departments={data.departments} emptyText="Ainda não há avaliações de desempenho enviadas para colaboradores ativos."/>
      <RankingGroup key={`leaders-${cycleId}-${organizationScope}`} title="Líderes" description="Média dos feedbacks recebidos" entries={leaders} teams={data.teams} departments={data.departments} emptyText="Ainda não há feedbacks enviados para líderes ativos."/>
    </div>
  </>;
}

function RankingGroup({ title, description, entries, teams, departments, emptyText }: { title: string; description: string; entries: RankedMember[]; teams: WorkspaceData["teams"]; departments: WorkspaceData["departments"]; emptyText: string }) {
  const [showAll, setShowAll] = useState(false);
  const visibleEntries = showAll ? entries : entries.slice(0, 5);

  return <section className="live-panel ranking-group">
    <div className="live-panel-heading"><div><span className="eyebrow">RANKING</span><h2>{title}</h2><p>{description}</p></div><span className="ranking-group-total">{entries.length} {entries.length === 1 ? "pessoa ranqueada" : "pessoas ranqueadas"}</span></div>
    {entries.length ? <ol className="ranking-list" aria-label={`Ranking de ${title.toLocaleLowerCase("pt-BR")}`} aria-describedby="ranking-method-note">
      {visibleEntries.map((entry) => {
        const rank = entries.findIndex((candidate) => Math.round(candidate.average * 100) === Math.round(entry.average * 100)) + 1;
        const isTied = entries.filter((candidate) => Math.round(candidate.average * 100) === Math.round(entry.average * 100)).length > 1;
        const teamLabels = entry.member.teamIds.flatMap((teamId) => {
          const team = teams.find((item) => item.id === teamId);
          if (!team) return [];
          const department = departments.find((item) => item.id === team.departmentId);
          return [department ? `${department.name} / ${team.name}` : team.name];
        });
        return <li className={`ranking-row${rank <= 3 ? ` ranking-row-top-${rank}` : ""}`} key={entry.member.uid}>
          <span className="ranking-place" aria-label={`${rank}º lugar${isTied ? ", empatado" : ""}`}>{rank === 1 && !isTied ? <Trophy size={17} weight="fill"/> : `${rank}º`}</span>
          <span className="ranking-person"><b>{entry.member.name}</b><small>{teamLabels.length ? teamLabels.join(" · ") : "Sem equipe associada"}</small></span>
          <span className="ranking-evaluation-meta">
            <span className="ranking-count">{entry.evaluationCount} avaliaç{entry.evaluationCount === 1 ? "ão" : "ões"}</span>
            {entry.evaluationCount < 3 && <span className="ranking-low-sample" title="A média é baseada em menos de 3 avaliações">Poucas avaliações</span>}
          </span>
          <strong className="ranking-score">{entry.average.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<small>/ 5</small></strong>
        </li>;
      })}
    </ol> : <EmptyState title="Ranking ainda indisponível" text={emptyText}/>}
    {entries.length > 5 && <button type="button" className="ranking-toggle" onClick={() => setShowAll((current) => !current)}>
      {showAll ? "Mostrar menos" : `Ver todos os ${entries.length}`}
    </button>}
  </section>;
}

function AdminEvaluationDrilldown({ data }: { data: WorkspaceData }) {
  const [departmentId, setDepartmentId] = useState("");
  const [leaderId, setLeaderId] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState<DocumentWithId<CompanyMember> | null>(null);
  const [selectedEvaluation, setSelectedEvaluation] = useState<EvaluationWithId | null>(null);
  const [search, setSearch] = useState("");
  const submitted = data.evaluations.filter((evaluation) => evaluation.status === "SUBMITTED");
  const term = search.trim().toLocaleLowerCase("pt-BR");
  const teamsForDepartment = data.teams.filter((team) => !departmentId || team.departmentId === departmentId);
  const departmentTeamIds = teamsForDepartment.map((team) => team.id);
  const leaders = data.members
    .filter((member) => member.role === "LEADER" && member.teamIds.some((teamId) => departmentTeamIds.includes(teamId)))
    .filter((member) => !term || member.name.toLocaleLowerCase("pt-BR").includes(term) || member.email.toLocaleLowerCase("pt-BR").includes(term));
  const selectedLeader = data.members.find((member) => member.uid === leaderId);
  const employees = selectedLeader
    ? data.members.filter((member) => member.role === "EMPLOYEE" && member.teamIds.some((teamId) => selectedLeader.teamIds.includes(teamId) && departmentTeamIds.includes(teamId)))
    : [];
  const visibleEmployees = term
    ? employees.filter((member) => member.name.toLocaleLowerCase("pt-BR").includes(term) || member.email.toLocaleLowerCase("pt-BR").includes(term))
    : employees;
  const departmentEmployeeIds = data.members.filter((member) => member.role === "EMPLOYEE" && member.teamIds.some((id) => departmentTeamIds.includes(id))).map((member) => member.uid);
  const sectorScores = submitted.filter((item) => item.type === "EMPLOYEE" && departmentEmployeeIds.includes(item.evaluatedUserId)).map((item) => item.averageScore ?? 0);
  const leaderFeedback = submitted.filter((item) => item.type === "LEADER" && item.evaluatedUserId === leaderId);
  const leaderScores = leaderFeedback.map((item) => item.averageScore ?? 0);
  const teamScores = submitted.filter((item) => item.type === "EMPLOYEE" && item.evaluatorId === leaderId && employees.some((person) => person.uid === item.evaluatedUserId)).map((item) => item.averageScore ?? 0);
  const employeeEvaluations = selectedEmployee ? submitted.filter((item) => item.type === "EMPLOYEE" && item.evaluatedUserId === selectedEmployee.uid) : [];

  if (selectedEmployee) return <>
    <PageHeading eyebrow="DETALHES DO COLABORADOR" title={selectedEmployee.name} subtitle={selectedEmployee.email}/>
    <button className="text-link back-link" onClick={() => { setSelectedEmployee(null); setSelectedEvaluation(null); }}>← Voltar à equipe</button>
    <section className="live-panel"><div className="live-panel-heading"><div><span className="eyebrow">AVALIAÇÕES DE DESEMPENHO</span><h2>{employeeEvaluations.length} avaliação(ões)</h2></div></div>
      {employeeEvaluations.length ? employeeEvaluations.map((item) => <EvaluationListItem key={item.id} item={item} data={data} detailed onOpen={() => setSelectedEvaluation(item)}/>) : <EmptyState title="Sem avaliação registrada" text="Quando a liderança concluir uma avaliação, o resultado e os critérios aparecerão aqui."/>}
    </section>
    {selectedEvaluation && <EvaluationDetailsDialog item={selectedEvaluation} data={data} onClose={() => setSelectedEvaluation(null)}/>}
  </>;

  return <>
    <PageHeading eyebrow="RESULTADOS DA EMPRESA" title="Avaliações" subtitle="Explore os resultados por setor, liderança e colaborador."/>
    <section className="live-panel">
      <div className="live-panel-heading"><div><span className="eyebrow">1 · SETOR</span><h2>Panorama geral do setor</h2></div><select className="live-select" value={departmentId} onChange={(event) => { setDepartmentId(event.target.value); setLeaderId(""); }}><option value="">Todos os setores</option>{data.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></div>
      {!departmentId ? <div className="drill-cards">{data.departments.map((department) => { const ids = data.teams.filter((team) => team.departmentId === department.id).map((team) => team.id); const personIds = data.members.filter((person) => person.role === "EMPLOYEE" && person.teamIds.some((id) => ids.includes(id))).map((person) => person.uid); const scores = submitted.filter((item) => item.type === "EMPLOYEE" && personIds.includes(item.evaluatedUserId)).map((item) => item.averageScore ?? 0); return <button className="drill-card" key={department.id} onClick={() => setDepartmentId(department.id)}><span className="eyebrow">SETOR</span><b>{department.name}</b><small>{personIds.length} colaboradores · {scores.length} avaliações</small><strong>{mean(scores)}</strong></button>; })}{!data.departments.length && <EmptyState title="Cadastre os setores" text="Os setores configurados aparecerão aqui."/>}</div> : <>
        <div className="drill-summary"><b>{data.departments.find((item) => item.id === departmentId)?.name}</b><span>Média de desempenho dos colaboradores: <strong>{mean(sectorScores)}</strong> / 5 · {sectorScores.length} avaliação(ões)</span></div>
        <div className="filter-bar" role="search">
          <label className="filter-field filter-field-grow">Buscar liderança ou colaborador<input type="search" className="filter-input" value={search} placeholder="Nome ou e-mail" onChange={(event) => setSearch(event.target.value)}/></label>
          {search && <button type="button" className="ranking-filter-reset" onClick={() => setSearch("")}>Limpar busca</button>}
        </div>
        <div className="drill-grid">{leaders.map((leader) => <button key={leader.uid} className={`drill-card ${leader.uid === leaderId ? "selected" : ""}`} onClick={() => setLeaderId(leader.uid)}><span className="eyebrow">2 · LIDERANÇA</span><b>{leader.name}</b><small>{leader.teamIds.map((id) => data.teams.find((team) => team.id === id)?.name ?? id).join(", ")}</small><strong>{mean(submitted.filter((item) => item.type === "LEADER" && item.evaluatedUserId === leader.uid).map((item) => item.averageScore ?? 0))} <small>/ 5 feedback da equipe</small></strong></button>)}{!leaders.length && <EmptyState title="Nenhuma liderança encontrada" text={term ? "Nenhuma liderança corresponde à busca neste setor." : "Associe pessoas líderes às equipes na tela Pessoas e equipes."}/>}</div>
        {leaderId && <><div className="drill-summary leader-summary"><b>{selectedLeader?.name}</b><span>Panorama da liderança: {leaderScores.length} feedback(s), média {mean(leaderScores)} / 5. Desempenho avaliado pela liderança: média {mean(teamScores)} / 5.</span></div><div className="live-table-wrap"><table className="live-table"><thead><tr><th>3 · Colaborador</th><th>Notas da liderança</th><th>Média</th><th></th></tr></thead><tbody>{visibleEmployees.map((employee) => { const rows = submitted.filter((item) => item.type === "EMPLOYEE" && item.evaluatorId === leaderId && item.evaluatedUserId === employee.uid); return <tr key={employee.uid}><td><b>{employee.name}</b><small className="table-subline">{employee.email}</small></td><td>{rows.length}</td><td>{mean(rows.map((item) => item.averageScore ?? 0))} / 5</td><td><button className="text-link" onClick={() => setSelectedEmployee(employee)}>Ver detalhes ↗</button></td></tr>; })}{!visibleEmployees.length && <tr><td colSpan={4}>{employees.length ? "Nenhum colaborador corresponde à busca." : "Não há colaboradores ativos associados a esta liderança."}</td></tr>}</tbody></table></div></>}
      </>}
    </section>
  </>;
}

function PersonalEvaluations({ data, user, refresh, execute }: { data: WorkspaceData; user: User; refresh: (quiet?: boolean) => Promise<void>; execute: (operation: () => Promise<unknown>, message: string) => Promise<boolean> }) {
  const [target, setTarget] = useState<DocumentWithId<CompanyMember> | null>(null);
  const currentCycle = data.cycles.find(isCycleAvailable);
  const targetRole: FirebaseRole = data.member.role === "LEADER" ? "EMPLOYEE" : "LEADER";
  const targets = data.members.filter((member) => member.role === targetRole && member.status === "ACTIVE");
  const complete = new Set(data.evaluations.filter((item) => item.status === "SUBMITTED" && item.cycleId === currentCycle?.id).map((item) => item.evaluatedUserId));
  const criteriaType: FirebaseEvaluationType = data.member.role === "LEADER" ? "EMPLOYEE" : "LEADER";
  const criteria = data.criteria.filter((item) => item.active && item.evaluationType === criteriaType).sort((a, b) => a.position - b.position);

  if (target) return <>
    <PageHeading eyebrow={data.member.role === "LEADER" ? "AVALIAÇÃO DE DESEMPENHO" : "FEEDBACK DE LIDERANÇA"} title={target.name} subtitle={data.member.role === "LEADER" ? "Avalie o desempenho da pessoa neste ciclo." : "Compartilhe sua experiência com esta liderança."}/>
    <AssessmentForm
      key={`${target.uid}-${currentCycle?.id ?? ""}`}
      target={target}
      cycleId={currentCycle?.id ?? ""}
      criteria={criteria}
      companyId={data.company.id ?? ""}
      evaluatorId={user.uid}
      type={criteriaType}
      draft={data.evaluations.find((item) =>
        item.status === "DRAFT" &&
        item.cycleId === currentCycle?.id &&
        item.evaluatedUserId === target.uid,
      )}
      onCancel={() => setTarget(null)}
      onSaveDraft={async (form, evaluationId) => {
        let savedId = evaluationId;
        const saved = await execute(async () => {
          savedId = await saveEvaluationDraft(form, evaluationId);
        }, "Rascunho salvo. Você pode continuar depois.");
        return saved ? savedId : undefined;
      }}
      onSubmit={async (form, evaluationId) => {
        const ok = await execute(() => submitEvaluation(form, evaluationId), "Avaliação enviada com sucesso.");
        if (ok) { await refresh(true); setTarget(null); }
      }}
    />
  </>;

  return <>
    <PageHeading eyebrow="CICLO DE AVALIAÇÃO" title={data.member.role === "EMPLOYEE" ? "Avaliar minha liderança" : "Avaliar minha equipe"} subtitle={currentCycle ? currentCycle.name : "Não há um ciclo aberto no momento."}/>
    {!currentCycle ? <EmptyState title="Aguarde um ciclo aberto" text="A administração precisa abrir um ciclo para receber avaliações."/> : !targets.length ? <EmptyState title={data.member.role === "LEADER" ? "Nenhum colaborador na equipe" : "Nenhuma liderança associada"} text="Peça à administração para revisar as equipes associadas ao seu perfil."/> : <div className="live-panel"><div className="live-panel-heading"><div><span className="eyebrow">PESSOAS</span><h2>{targets.length} pessoa(s)</h2></div></div><div className="task-list-live">{targets.map((person) => { const previous = data.evaluations.find((item) => item.status === "SUBMITTED" && item.cycleId === currentCycle.id && item.evaluatedUserId === person.uid); const draft = data.evaluations.find((item) => item.status === "DRAFT" && item.cycleId === currentCycle.id && item.evaluatedUserId === person.uid); return <div className="task-live" key={person.uid}><span className="live-avatar">{initials(person.name)}</span><span className="task-live-copy"><b>{person.name}</b><small>{roleNames[person.role]} · {person.teamIds.map((id) => data.teams.find((team) => team.id === id)?.name ?? id).join(", ") || "Sem equipe"}</small></span>{complete.has(person.uid) ? <span className="status-chip done">Concluída · {previous?.averageScore?.toFixed(1) ?? "—"}</span> : <button className="button button-primary button-small" onClick={() => setTarget(person)}>{draft ? "Continuar rascunho" : "Avaliar"}</button>}</div>; })}</div></div>}
    <p className="privacy-note">{data.member.role === "EMPLOYEE" ? "Seu feedback sobre a liderança fica visível apenas para a administração." : "Você verá apenas as avaliações de desempenho que enviou. O feedback sobre sua liderança é privado."}</p>
  </>;
}

function AssessmentForm({ target, cycleId, criteria, companyId, evaluatorId, type, draft, onCancel, onSaveDraft, onSubmit }: { target: CompanyMember; cycleId: string; criteria: WorkspaceData["criteria"]; companyId: string; evaluatorId: string; type: FirebaseEvaluationType; draft?: EvaluationWithId; onCancel: () => void; onSaveDraft: (input: Parameters<typeof submitEvaluation>[0], evaluationId?: string) => Promise<string | undefined>; onSubmit: (input: Parameters<typeof submitEvaluation>[0], evaluationId: string) => Promise<void> }) {
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comment, setComment] = useState(draft?.comment ?? "");
  const [draftId, setDraftId] = useState(draft?.id);
  const [busy, setBusy] = useState(Boolean(draft));
  const [loadError, setLoadError] = useState("");
  const ratingRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const average = criteria.length ? Object.values(scores).reduce((sum, score) => sum + score, 0) / criteria.length : 0;
  const complete = criteria.length > 0 && criteria.every((criterion) => scores[criterion.id]);
  useEffect(() => {
    if (!draft) return;
    let active = true;
    loadEvaluationAnswers(companyId, draft.id)
      .then((answers) => {
        if (!active) return;
        setScores(Object.fromEntries(answers.map((answer) => [answer.criterionId, answer.score])));
        setBusy(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : "Não foi possível carregar o rascunho.");
        setBusy(false);
      });
    return () => { active = false; };
  }, [companyId, draft]);

  function handleRatingKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, criterionId: string, value: number) {
    const nextValue = event.key === "ArrowRight" || event.key === "ArrowDown" ? Math.min(5, value + 1)
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? Math.max(1, value - 1)
        : event.key === "Home" ? 1
          : event.key === "End" ? 5
            : null;
    if (nextValue === null) return;
    event.preventDefault();
    setScores((current) => ({ ...current, [criterionId]: nextValue }));
    ratingRefs.current[`${criterionId}-${nextValue}`]?.focus();
  }

  function formInput() {
    return {
      companyId,
      cycleId,
      evaluatorId,
      evaluatedUserId: target.uid,
      type,
      comment,
      answers: criteria.filter((criterion) => scores[criterion.id]).map((criterion) => ({
        criterionId: criterion.id,
        score: scores[criterion.id],
      })),
    };
  }

  async function saveDraft() {
    setBusy(true);
    const savedId = await onSaveDraft(formInput(), draftId);
    setBusy(false);
    if (savedId) {
      setDraftId(savedId);
      onCancel();
    }
  }

  async function submit() {
    setBusy(true);
    const input = formInput();
    const savedId = await onSaveDraft(input, draftId);
    if (!savedId) {
      setBusy(false);
      return;
    }
    setDraftId(savedId);
    await onSubmit(input, savedId);
    setBusy(false);
  }

  return <section className="live-panel assessment-panel"><div className="rating-guide"><b>{type === "EMPLOYEE" ? "Como foi o desempenho neste ciclo?" : "Como tem sido sua experiência com esta liderança?"}</b><span>Selecione uma nota de 1 a 5 para cada critério.</span><div className="scale-legend"><span>1 · Precisa melhorar</span><span>5 · Excelente</span></div></div>
    {draft && <p className="subtle-note">Você está retomando um rascunho. Suas respostas salvas estão preenchidas.</p>}
    {loadError && <p className="form-alert error" role="alert">{loadError}</p>}
    {criteria.map((criterion) => <div className="rating-row" key={criterion.id}><div className="rating-name" id={`rating-name-${criterion.id}`}><b>{criterion.name}</b><span>{scores[criterion.id] ? `${scores[criterion.id]} de 5` : "Selecione uma nota"}</span></div><div className="rating-buttons" role="radiogroup" aria-label={criterion.name}>{[1, 2, 3, 4, 5].map((value) => { const selected = scores[criterion.id] === value; return <button type="button" key={value} ref={(node) => { if (node) ratingRefs.current[`${criterion.id}-${value}`] = node; }} tabIndex={selected || (!scores[criterion.id] && value === 1) ? 0 : -1} className={selected ? "selected" : ""} role="radio" aria-checked={selected} aria-label={`${value} de 5`} onClick={() => setScores((current) => ({ ...current, [criterion.id]: value }))} onKeyDown={(event) => handleRatingKeyDown(event, criterion.id, value)}>{value}</button>; })}</div></div>)}
    {!criteria.length && <EmptyState title="Critérios não configurados" text="Peça à administração para cadastrar os critérios de avaliação."/>}
    <label className="comment-label">Comentário <span>Opcional</span><textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={4} placeholder="Escreva um comentário construtivo…"/></label>
    <div className="form-footer"><span>Média atual <b>{complete ? average.toFixed(2) : "—"}</b> / 5</span><div className="form-buttons"><button type="button" className="button button-outline" onClick={onCancel}>Voltar</button><button type="button" className="button button-outline" disabled={busy || (!Object.keys(scores).length && !comment.trim())} onClick={() => void saveDraft()}>{busy ? "Salvando…" : "Salvar rascunho e sair"}</button><button type="button" className="button button-primary" disabled={!complete || busy || Boolean(loadError)} onClick={() => void submit()}>{busy ? "Salvando…" : "Enviar avaliação"}</button></div></div>
  </section>;
}

function ConfigurationPage({ data, execute }: { data: WorkspaceData; execute: (operation: () => Promise<unknown>, message: string) => Promise<boolean> }) {
  const [activeTab, setActiveTab] = useState<"structure" | "criteria" | "cycles">("structure");
  const tabs = [
    { id: "structure" as const, label: "Estrutura", description: "Setores e equipes", count: `${data.departments.length} setor${data.departments.length === 1 ? "" : "es"} · ${data.teams.length} equipe${data.teams.length === 1 ? "" : "s"}`, icon: <Buildings size={19} weight="regular"/> },
    { id: "criteria" as const, label: "Critérios", description: "O que será avaliado", count: `${data.criteria.length} critério${data.criteria.length === 1 ? "" : "s"}`, icon: <SlidersHorizontal size={19} weight="regular"/> },
    { id: "cycles" as const, label: "Ciclos", description: "Períodos de avaliação", count: `${data.cycles.length} ciclo${data.cycles.length === 1 ? "" : "s"}`, icon: <CalendarBlank size={19} weight="regular"/> },
  ];

  return <>
    <PageHeading eyebrow="CONFIGURAÇÃO DA EMPRESA" title="Configurações" subtitle="Organize a estrutura da empresa e prepare as avaliações em etapas."/>
    <section className="configuration-workspace" aria-label="Configurações da empresa">
      <div className="configuration-navigation"><ExpandingTabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} ariaLabel="Etapas de configuração"/></div>
      <div className="configuration-panel" id="configuration-panel" role="tabpanel" aria-labelledby={`expanding-tab-${activeTab}`}>
        {activeTab === "structure" && <>
          <div className="configuration-intro"><span className="eyebrow">ETAPA 1 · ORGANIZAÇÃO</span><h2>Monte a estrutura da empresa</h2><p>Cadastre primeiro os setores e depois as equipes que pertencem a cada um.</p></div>
          <div className="configuration-structure-note"><b>Setor → Equipe</b><span>Exemplo: Vendas → Loja Centro. Cada equipe pertence a um único setor.</span></div>
          <div className="configuration-structure-grid"><DepartmentManager data={data} execute={execute}/><TeamManager data={data} execute={execute}/></div>
        </>}
        {activeTab === "criteria" && <>
          <div className="configuration-intro"><span className="eyebrow">ETAPA 2 · AVALIAÇÕES</span><h2>Defina os critérios</h2><p>Os critérios ativos aparecem nos formulários de avaliação do tipo selecionado.</p></div>
          <div className="configuration-single-manager"><CriterionManager data={data} execute={execute}/></div>
        </>}
        {activeTab === "cycles" && <>
          <div className="configuration-intro"><span className="eyebrow">ETAPA 3 · PERÍODOS</span><h2>Programe os ciclos de avaliação</h2><p>Defina o período e abra o ciclo quando estiver pronto para receber avaliações.</p></div>
          <div className="configuration-single-manager"><CycleManager data={data} execute={execute}/></div>
        </>}
      </div>
    </section>
  </>;
}

function DepartmentManager({ data, execute }: { data: WorkspaceData; execute: (operation: () => Promise<unknown>, message: string) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editName, setEditName] = useState("");
  return <section className="live-panel configuration-stage configuration-stage-departments">
    <div className="live-panel-heading">
      <div><span className="eyebrow">ETAPA 01 · SETORES</span><h2>Cadastre as áreas da empresa</h2></div>
      <span className="configuration-stage-total">{data.departments.length} setor{data.departments.length === 1 ? "" : "es"}</span>
    </div>
    <p className="org-manager-help">Crie as áreas principais, como Vendas, Operações ou Atendimento. Depois, associe equipes a cada setor.</p>
    <SimpleAddForm value={name} setValue={setName} placeholder="Ex.: Vendas" button="Adicionar setor" onSubmit={() => execute(() => createDepartment(data.company.id ?? "", name), "Setor cadastrado.").then((ok) => { if (ok) setName(""); })}/>
    <div className="config-list" aria-label="Setores cadastrados">
      {data.departments.map((item) => {
        const teamCount = data.teams.filter((team) => team.departmentId === item.id).length;
        return <div className="configuration-entity-row" key={item.id}>
          <span className="configuration-entity-icon" aria-hidden="true"><Buildings size={17}/></span>
          {editingId === item.id
            ? <form className="configuration-entity-edit" onSubmit={async (event) => {
              event.preventDefault();
              const saved = await execute(() => updateDepartment(data.company.id ?? "", item.id, editName), "Setor atualizado.");
              if (saved) setEditingId("");
            }}>
              <input aria-label="Nome do setor" required minLength={2} maxLength={100} value={editName} onChange={(event) => setEditName(event.target.value)}/>
              <button className="button button-primary button-small">Salvar</button>
              <button type="button" className="button button-outline button-small" onClick={() => setEditingId("")}>Cancelar</button>
            </form>
            : <>
              <span className="configuration-entity-name"><b>{item.name}</b></span>
              <small className="configuration-entity-count">{teamCount} equipe{teamCount === 1 ? "" : "s"}</small>
              <button type="button" className="button button-outline button-small" onClick={() => { setEditingId(item.id); setEditName(item.name); }}>Editar</button>
              <ConfirmButton dialogTitle="Excluir setor" description={<>Excluir o setor <b>{item.name}</b>? Só é possível excluir setores que não tenham equipes.</>} disabled={teamCount > 0} title={teamCount > 0 ? "Remova ou mova as equipes deste setor antes de excluir." : undefined} onConfirm={() => execute(() => deleteDepartment(data.company.id ?? "", item.id), "Setor excluído.")}>Excluir</ConfirmButton>
            </>}
        </div>;
      })}
      {!data.departments.length && <p className="empty-inline">Nenhum setor cadastrado.</p>}
    </div>
  </section>;
}

function TeamManager({ data, execute }: { data: WorkspaceData; execute: (operation: () => Promise<unknown>, message: string) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editName, setEditName] = useState("");
  return <section className="live-panel configuration-stage configuration-stage-teams">
    <div className="live-panel-heading">
      <div><span className="eyebrow">ETAPA 02 · EQUIPES</span><h2>Organize as equipes por setor</h2></div>
      <span className="configuration-stage-total">{data.teams.length} equipe{data.teams.length === 1 ? "" : "s"}</span>
    </div>
    <p className="org-manager-help">Escolha um setor para cada equipe. As pessoas podem ser associadas às equipes na área Pessoas e equipes.</p>
    <form className="stack-form configuration-team-form" onSubmit={async (event) => { event.preventDefault(); const ok = await execute(() => createTeam(data.company.id ?? "", name, departmentId), "Equipe cadastrada."); if (ok) setName(""); }}>
      <label>Nome da equipe<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Loja Centro"/></label>
      <label>Setor<select required value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}><option value="">Selecione um setor</option>{data.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <button className="button button-primary" disabled={!data.departments.length}>Adicionar equipe</button>
    </form>
    <div className="config-list configuration-team-list" aria-label="Equipes cadastradas">
      {data.teams.map((team) => {
        const memberCount = data.members.filter((member) => member.teamIds.includes(team.id)).length;
        return <div className="configuration-entity-row" key={team.id}>
        <span className="configuration-entity-icon" aria-hidden="true"><UsersThree size={17}/></span>
        {editingId === team.id
          ? <form className="configuration-entity-edit" onSubmit={async (event) => {
            event.preventDefault();
            const saved = await execute(() => updateTeam(data.company.id ?? "", team.id, editName), "Equipe atualizada.");
            if (saved) setEditingId("");
          }}>
            <input aria-label="Nome da equipe" required minLength={2} maxLength={100} value={editName} onChange={(event) => setEditName(event.target.value)}/>
            <button className="button button-primary button-small">Salvar</button>
            <button type="button" className="button button-outline button-small" onClick={() => setEditingId("")}>Cancelar</button>
          </form>
          : <>
            <span className="configuration-entity-name"><b>{team.name}</b></span>
            <small className="configuration-entity-count">{data.departments.find((item) => item.id === team.departmentId)?.name ?? "Setor não encontrado"}{memberCount ? ` · ${memberCount} pessoa${memberCount === 1 ? "" : "s"}` : ""}</small>
            <button type="button" className="button button-outline button-small" onClick={() => { setEditingId(team.id); setEditName(team.name); }}>Editar</button>
            <ConfirmButton dialogTitle="Excluir equipe" description={<>Excluir a equipe <b>{team.name}</b>? Só é possível excluir equipes sem pessoas associadas.</>} disabled={memberCount > 0} title={memberCount > 0 ? "Mova as pessoas para outra equipe antes de excluir." : undefined} onConfirm={() => execute(() => deleteTeam(data.company.id ?? "", team.id), "Equipe excluída.")}>Excluir</ConfirmButton>
          </>}
      </div>;
      })}
      {!data.teams.length && <p className="empty-inline">Nenhuma equipe cadastrada.</p>}
    </div>
  </section>;
}

function CriterionManager({ data, execute }: { data: WorkspaceData; execute: (operation: () => Promise<unknown>, message: string) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<FirebaseEvaluationType>("EMPLOYEE");
  const [editingId, setEditingId] = useState("");
  const [editName, setEditName] = useState("");
  return <section className="live-panel">
    <div className="live-panel-heading"><div><span className="eyebrow">AVALIAÇÕES</span><h2>Critérios</h2></div></div>
    <form className="stack-form" onSubmit={async (event) => {
      event.preventDefault();
      const order = data.criteria.filter((item) => item.evaluationType === type).length;
      const ok = await execute(() => createCriterion(data.company.id ?? "", name, type, order), "Critério cadastrado.");
      if (ok) setName("");
    }}>
      <label>Critério<input required minLength={2} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Comunicação"/></label>
      <label>Aplicado em<select value={type} onChange={(event) => setType(event.target.value as FirebaseEvaluationType)}><option value="EMPLOYEE">Avaliação de colaborador</option><option value="LEADER">Feedback sobre liderança</option></select></label>
      <button className="button button-primary">Adicionar critério</button>
    </form>
    <div className="config-list">{data.criteria.slice().sort((a, b) => a.evaluationType.localeCompare(b.evaluationType) || a.position - b.position).map((item) =>
      <div className="configuration-entity-row" key={item.id}>
        {editingId === item.id
          ? <form className="configuration-entity-edit" onSubmit={async (event) => {
            event.preventDefault();
            const saved = await execute(() => updateCriterion(data.company.id ?? "", item.id, { name: editName.trim() }), "Critério atualizado.");
            if (saved) setEditingId("");
          }}>
            <input aria-label="Nome do critério" required minLength={2} maxLength={100} value={editName} onChange={(event) => setEditName(event.target.value)}/>
            <button className="button button-primary button-small">Salvar</button>
            <button type="button" className="button button-outline button-small" onClick={() => setEditingId("")}>Cancelar</button>
          </form>
          : <>
            <span className="configuration-entity-name"><b>{item.name}</b><small>{item.evaluationType === "LEADER" ? "Feedback sobre liderança" : "Desempenho de colaborador"}</small></span>
            <button type="button" className="button button-outline button-small" onClick={() => { setEditingId(item.id); setEditName(item.name); }}>Editar</button>
            <button type="button" aria-pressed={item.active} className={`status-chip ${item.active ? "done" : "pending"}`} onClick={() => execute(() => updateCriterion(data.company.id ?? "", item.id, { active: !item.active }), item.active ? "Critério desativado." : "Critério ativado.")}>{item.active ? "Ativo" : "Inativo"}</button>
            <ConfirmButton dialogTitle="Excluir critério" description={<>Excluir o critério <b>{item.name}</b>? As avaliações já respondidas são mantidas, mas o critério deixa de aparecer nos formulários de avaliação.</>} onConfirm={() => execute(() => deleteCriterion(data.company.id ?? "", item.id), "Critério excluído.")}>Excluir</ConfirmButton>
          </>}
      </div>,
    )}{!data.criteria.length && <p className="empty-inline">Nenhum critério cadastrado.</p>}</div>
  </section>;
}

function CycleManager({ data, execute }: { data: WorkspaceData; execute: (operation: () => Promise<unknown>, message: string) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [status, setStatus] = useState<"DRAFT" | "OPEN">("DRAFT");
  const [editingId, setEditingId] = useState("");
  const [editName, setEditName] = useState("");
  const [editStartsAt, setEditStartsAt] = useState("");
  const [editEndsAt, setEditEndsAt] = useState("");

  async function submitNewCycle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await execute(
      () => createCycle(data.company.id ?? "", { name, startsAt, endsAt, status }, data.cycles),
      status === "OPEN" ? "Ciclo criado e aberto. Os demais ciclos foram fechados." : "Ciclo criado como rascunho.",
    );
    if (saved) {
      setName("");
      setStartsAt("");
      setEndsAt("");
      setStatus("DRAFT");
    }
  }

  function startEditing(cycle: WorkspaceData["cycles"][number]) {
    setEditingId(cycle.id);
    setEditName(cycle.name);
    setEditStartsAt(cycle.startsAt ?? "");
    setEditEndsAt(cycle.endsAt ?? "");
  }

  async function saveCycle(cycle: WorkspaceData["cycles"][number]) {
    const changes = {
      name: editName,
      startsAt: editStartsAt,
      endsAt: editEndsAt,
      status: cycle.status,
    };
    const saved = await execute(
      () => updateCycle(data.company.id ?? "", cycle.id, changes, data.cycles),
      "Ciclo atualizado.",
    );
    if (saved) setEditingId("");
  }

  async function changeCycleStatus(cycle: WorkspaceData["cycles"][number]) {
    const status = cycle.status === "OPEN" ? "CLOSED" : "OPEN";
    const saved = await execute(
      () => updateCycle(data.company.id ?? "", cycle.id, {
        name: cycle.name,
        startsAt: cycle.startsAt ?? "",
        endsAt: cycle.endsAt ?? "",
        status,
      }, data.cycles),
      status === "OPEN" ? "Ciclo aberto. Os demais ciclos foram fechados." : "Ciclo fechado.",
    );
    if (saved && editingId === cycle.id) setEditingId("");
  }

  return <section className="live-panel">
    <div className="live-panel-heading"><div><span className="eyebrow">PERÍODOS</span><h2>Ciclos de avaliação</h2></div></div>
    <p className="org-manager-help">Crie uma avaliação pontual com critérios existentes e datas específicas. Somente um ciclo pode ficar aberto por vez.</p>
    <form className="stack-form" onSubmit={submitNewCycle}>
      <label>Nome<input required minLength={2} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Ciclo anual"/></label>
      <div className="two-inputs">
        <label>Início<input required type="date" value={startsAt} onChange={(event) => setStartsAt(event.target.value)}/></label>
        <label>Fim<input required type="date" min={startsAt || undefined} value={endsAt} onChange={(event) => setEndsAt(event.target.value)}/></label>
      </div>
      <label>Status<select value={status} onChange={(event) => setStatus(event.target.value as "DRAFT" | "OPEN")}><option value="DRAFT">Rascunho</option><option value="OPEN">Aberto para avaliações</option></select></label>
      <button className="button button-primary">Criar ciclo</button>
    </form>
    <div className="config-list">
      {data.cycles.map((cycle) => <div key={cycle.id} className="cycle-config-row">
        {editingId === cycle.id ? <div className="cycle-config-edit">
          <label>Nome<input required minLength={2} maxLength={100} value={editName} onChange={(event) => setEditName(event.target.value)}/></label>
          <div className="two-inputs">
            <label>Início<input required type="date" value={editStartsAt} onChange={(event) => setEditStartsAt(event.target.value)}/></label>
            <label>Fim<input required type="date" min={editStartsAt || undefined} value={editEndsAt} onChange={(event) => setEditEndsAt(event.target.value)}/></label>
          </div>
          <div className="cycle-config-actions">
            <button type="button" className="button button-outline button-small" onClick={() => setEditingId("")}>Cancelar</button>
            <button type="button" className="button button-primary button-small" disabled={!editStartsAt || !editEndsAt || editStartsAt > editEndsAt} onClick={() => void saveCycle(cycle)}>Salvar</button>
          </div>
        </div> : <>
          <span><b>{cycle.name}</b><small>{cycle.startsAt || "Sem data"} – {cycle.endsAt || "Sem data"}</small></span>
          <div className="cycle-config-actions">
            <button type="button" className="button button-outline button-small" onClick={() => startEditing(cycle)}>Editar</button>
            <button type="button" aria-pressed={isCycleAvailable(cycle)} className={`status-chip ${isCycleAvailable(cycle) ? "done" : "pending"}`} onClick={() => void changeCycleStatus(cycle)}>{cycleStatusLabel(cycle)}</button>
            {cycle.status !== "OPEN" && <ConfirmButton dialogTitle="Excluir ciclo" description={<>Excluir o ciclo <b>{cycle.name}</b>? As avaliações já enviadas neste ciclo continuam registradas no histórico.</>} onConfirm={() => execute(() => deleteCycle(data.company.id ?? "", cycle.id), "Ciclo excluído.")}>Excluir</ConfirmButton>}
          </div>
        </>}
      </div>)}
      {!data.cycles.length && <p className="empty-inline">Nenhum ciclo cadastrado.</p>}
    </div>
  </section>;
}

function SurveysPage({ data, execute }: { data: WorkspaceData; execute: (operation: () => Promise<unknown>, message: string) => Promise<boolean> }) {
  const isAdmin = data.member.role === "ADMIN";
  const availableSurveys = data.surveys.filter((survey) =>
    survey.active &&
    survey.audience.includes(data.member.role as Exclude<FirebaseRole, "ADMIN">) &&
    survey.startsAt <= localDateString() &&
    survey.endsAt >= localDateString(),
  );
  const [surveySearch, setSurveySearch] = useState("");
  const [surveyStatusFilter, setSurveyStatusFilter] = useState<"" | "OPEN" | "SCHEDULED" | "CLOSED">("");
  const todayString = localDateString();
  const surveyTerm = surveySearch.trim().toLocaleLowerCase("pt-BR");
  const surveysByCategory = data.surveys.map((survey) => {
    const open = survey.active && survey.startsAt <= todayString && survey.endsAt >= todayString;
    const category: "OPEN" | "SCHEDULED" | "CLOSED" = !survey.active ? "CLOSED" : open ? "OPEN" : survey.startsAt > todayString ? "SCHEDULED" : "CLOSED";
    return { survey, open, category };
  });
  const visibleSurveys = surveysByCategory.filter((entry) => (!surveyStatusFilter || entry.category === surveyStatusFilter) && (!surveyTerm || entry.survey.name.toLocaleLowerCase("pt-BR").includes(surveyTerm)));
  const hasSurveyFilters = Boolean(surveyTerm || surveyStatusFilter);

  return <>
    <PageHeading eyebrow="FEEDBACK DA EMPRESA" title="Pesquisas" subtitle={isAdmin
      ? "Crie pesquisas e consulte resultados sem identificação direta; os resultados só aparecem após 5 respostas."
      : "Responda às pesquisas da empresa. O conteúdo não mostra seu nome. Evite incluir nomes ou detalhes que revelem sua identidade."}/>
    {isAdmin ? <>
      <SurveyCreator data={data} execute={execute}/>
      <section className="live-panel">
        <div className="live-panel-heading"><div><span className="eyebrow">PESQUISAS CRIADAS</span><h2>{hasSurveyFilters ? `${visibleSurveys.length} de ${data.surveys.length}` : "Pesquisas avulsas"}</h2></div></div>
        <div className="filter-bar" role="search">
          <label className="filter-field filter-field-grow">Buscar<input type="search" className="filter-input" value={surveySearch} placeholder="Nome da pesquisa" onChange={(event) => setSurveySearch(event.target.value)}/></label>
          <label className="filter-field">Situação<select className="filter-input" value={surveyStatusFilter} onChange={(event) => setSurveyStatusFilter(event.target.value as "" | "OPEN" | "SCHEDULED" | "CLOSED")}><option value="">Todas as situações</option><option value="OPEN">Recebendo respostas</option><option value="SCHEDULED">Agendadas</option><option value="CLOSED">Encerradas</option></select></label>
          {hasSurveyFilters && <button type="button" className="ranking-filter-reset" onClick={() => { setSurveySearch(""); setSurveyStatusFilter(""); }}>Limpar filtros</button>}
        </div>
        <div className="config-list">
          {visibleSurveys.map(({ survey, open }) => {
            return <article className="survey-admin-card" key={survey.id}>
              <SurveyAdminCard
                survey={survey}
                companyId={data.company.id ?? ""}
                isOpen={open}
                onClose={() => execute(
                  () => updateSurveyStatus(data.company.id ?? "", survey.id, false),
                  "Pesquisa encerrada.",
                )}
                onDelete={() => execute(
                  () => deleteSurvey(data.company.id ?? "", survey.id),
                  "Pesquisa excluída com as respostas.",
                )}
              />
            </article>;
          })}
          {!data.surveys.length && <p className="empty-inline">Nenhuma pesquisa criada ainda.</p>}
          {data.surveys.length > 0 && !visibleSurveys.length && <EmptyState title="Nenhuma pesquisa encontrada" text="Ajuste a busca ou a situação para ver outras pesquisas."/>}
        </div>
      </section>
    </> : <section className="live-panel">
      <div className="live-panel-heading"><div><span className="eyebrow">PESQUISAS ABERTAS</span><h2>Sua opinião importa</h2></div></div>
      <div className="config-list">
        {availableSurveys.map((survey) => <article className="survey-admin-card" key={survey.id}>
          <div className="live-panel-heading"><div><h3>{survey.name}</h3><p>Disponível até {formatDate(survey.endsAt)}</p></div></div>
          {data.completedSurveyIds.includes(survey.id)
            ? <span className="status-chip done">Resposta enviada</span>
            : <SurveyResponseForm
              survey={survey}
              companyId={data.company.id ?? ""}
              execute={execute}
            />}
        </article>)}
        {!availableSurveys.length && <EmptyState title="Nenhuma pesquisa aberta" text="Quando houver uma pesquisa disponível para seu perfil, ela aparecerá aqui."/>}
      </div>
    </section>}
  </>;
}

function SurveyAdminCard({ survey, companyId, isOpen, onClose, onDelete }: {
  survey: DocumentWithId<SurveyDocument>;
  companyId: string;
  isOpen: boolean;
  onClose: () => Promise<boolean>;
  onDelete?: () => Promise<boolean>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [responses, setResponses] = useState<Array<DocumentWithId<SurveyResponseDocument>>>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [cursor, setCursor] = useState<SurveyResponseCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [closing, setClosing] = useState(false);

  async function loadNextPage() {
    setLoading(true);
    setLoadError("");
    try {
      const page = await loadSurveyResponsePage(companyId, survey.id, cursor);
      setResponses((current) => [...current, ...page.responses]);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
      setTotalCount(page.totalCount);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Não foi possível carregar as respostas.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleResults() {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded && (totalCount === null || totalCount < MIN_SURVEY_RESPONSES_FOR_RESULTS)) await loadNextPage();
  }

  async function closeSurvey() {
    setClosing(true);
    const closed = await onClose();
    setClosing(false);
    if (closed) setExpanded(false);
  }

  return <>
    <div className="survey-card-heading">
      <div className="survey-card-title">
        <span className={`status-chip ${isOpen ? "done" : "pending"}`}>
          {!survey.active ? "Encerrada" : isOpen ? "Recebendo respostas" : survey.startsAt > localDateString() ? "Agendada" : "Período encerrado"}
        </span>
        <h3>{survey.name}</h3>
        <p>{formatDate(survey.startsAt)} – {formatDate(survey.endsAt)} <span aria-hidden="true">·</span> {survey.audience.map((role) => roleNames[role]).join(" e ")}</p>
      </div>
      <div className="survey-card-actions">
        <button type="button" className="button button-outline button-small" aria-expanded={expanded} disabled={loading} onClick={() => void toggleResults()}>
          {loading ? "Carregando…" : expanded ? "Ocultar resultados" : "Ver resultados"}
        </button>
        {survey.active && <button type="button" className="button button-outline button-small" disabled={closing} onClick={() => void closeSurvey()}>
          {closing ? "Encerrando…" : "Encerrar pesquisa"}
        </button>}
        {onDelete && <ConfirmButton dialogTitle="Excluir pesquisa" description={<>Excluir a pesquisa <b>{survey.name}</b>? Todas as respostas registradas serão apagadas permanentemente.</>} onConfirm={onDelete}>Excluir</ConfirmButton>}
      </div>
    </div>
    <div className="survey-card-metrics">
      <span><b>{totalCount === null ? "—" : totalCount < MIN_SURVEY_RESPONSES_FOR_RESULTS ? "Menos de 5" : totalCount}</b> respostas</span>
      <span><b>{survey.questions.length}</b> perguntas</span>
      {totalCount !== null && <small>Respostas sem identificador de conta · mínimo de 5 para exibição</small>}
    </div>
    {expanded && <div className="survey-results-panel">
      {loadError && <p className="form-alert error" role="alert">{loadError}</p>}
      {loading && !responses.length
        ? <p className="survey-results-loading">Carregando respostas…</p>
        : !totalCount
          ? <p className="survey-results-empty">Esta pesquisa ainda não recebeu respostas.</p>
          : totalCount < MIN_SURVEY_RESPONSES_FOR_RESULTS
            ? <p className="survey-results-empty">Os resultados serão liberados quando houver pelo menos 5 respostas. Até lá, o conteúdo permanece oculto.</p>
            : <>
            <div className="survey-results-heading">
              <div><span className="eyebrow">RESULTADOS</span><h4>Respostas por pergunta</h4></div>
              <small>{responses.length} de {totalCount} carregadas</small>
            </div>
            {survey.questions.map((question, index) => <SurveyQuestionResults
              key={question.id}
              question={question}
              questionNumber={index + 1}
              responses={responses}
              totalCount={totalCount}
            />)}
            {hasMore && <button type="button" className="button button-outline survey-load-more" disabled={loading} onClick={() => void loadNextPage()}>
              {loading ? "Carregando…" : `Carregar mais respostas (${responses.length} de ${totalCount})`}
            </button>}
          </>}
    </div>}
  </>;
}

function SurveyQuestionResults({ question, questionNumber, responses, totalCount }: {
  question: SurveyQuestion;
  questionNumber: number;
  responses: Array<DocumentWithId<SurveyResponseDocument>>;
  totalCount: number;
}) {
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(8);
  const answers = responses.flatMap((response) => {
    const answer = response.answers.find((item) => item.questionId === question.id);
    return answer ? [answer.value] : [];
  });
  const ratingCounts = [1, 2, 3, 4, 5].map((score) =>
    answers.filter((answer) => answer === score).length,
  );
  const ratingTotal = ratingCounts.reduce((sum, count) => sum + count, 0);
  const ratingAverage = ratingTotal
    ? ratingCounts.reduce((sum, count, index) => sum + count * (index + 1), 0) / ratingTotal
    : 0;
  const textAnswers = answers.filter((answer): answer is string => typeof answer === "string");
  const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");
  const filteredAnswers = normalizedSearch
    ? textAnswers.filter((answer) => answer.toLocaleLowerCase("pt-BR").includes(normalizedSearch))
    : textAnswers;
  const shownAnswers = filteredAnswers.slice(0, visibleCount);

  return <section className="survey-question-result">
    <div className="survey-question-result-heading">
      <span className="survey-question-number">{String(questionNumber).padStart(2, "0")}</span>
      <div><h5>{question.prompt}</h5><small>{question.type === "RATING" ? "Escala de 1 a 5" : "Respostas abertas"}</small></div>
    </div>
    {question.type === "RATING" ? ratingTotal
      ? <div className="survey-rating-results">
        <div className="survey-rating-average"><b>{ratingAverage.toFixed(1)}</b><span>/ 5 média</span></div>
        <div className="survey-rating-distribution">
          {ratingCounts.map((count, index) => <div className="survey-rating-row" key={index + 1}>
            <span>{index + 1}</span>
            <span className="survey-rating-track"><span style={{ width: `${(count / Math.max(...ratingCounts, 1)) * 100}%` }}/></span>
            <b>{count}</b>
          </div>)}
          {responses.length < totalCount && <small className="survey-partial-note">Resumo parcial: carregadas {responses.length} de {totalCount} respostas. Carregue mais para atualizar.</small>}
        </div>
      </div>
      : <p className="survey-question-empty">Ainda não há notas nesta pergunta.</p>
      : <div className="survey-text-results">
        <label className="survey-answer-search">Buscar nas respostas carregadas<input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setVisibleCount(8); }} placeholder="Digite uma palavra ou frase"/></label>
        {shownAnswers.length
          ? <div className="survey-answer-list">{shownAnswers.map((answer, index) => <article className="survey-answer-card" key={`${index}-${answer}`}>{answer}</article>)}</div>
          : <p className="survey-question-empty">{normalizedSearch ? "Nenhuma resposta corresponde à busca." : "Ainda não há respostas nesta pergunta."}</p>}
        {filteredAnswers.length > shownAnswers.length && <button type="button" className="survey-show-more" onClick={() => setVisibleCount((count) => count + 8)}>
          Mostrar mais respostas ({shownAnswers.length} de {filteredAnswers.length} carregadas)
        </button>}
        {responses.length < totalCount && <small className="survey-partial-note">Carregadas {responses.length} de {totalCount} respostas da pesquisa.</small>}
      </div>}
  </section>;
}

function SurveyCreator({ data, execute }: { data: WorkspaceData; execute: (operation: () => Promise<unknown>, message: string) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [startsAt, setStartsAt] = useState(localDateString());
  const [endsAt, setEndsAt] = useState(localDateString());
  const [audience, setAudience] = useState<Array<Exclude<FirebaseRole, "ADMIN">>>(["EMPLOYEE", "LEADER"]);
  const [questions, setQuestions] = useState<Array<{ prompt: string; type: SurveyQuestion["type"] }>>([{ prompt: "", type: "TEXT" }]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await execute(() => createSurvey(data.company.id ?? "", {
      name, startsAt, endsAt, audience, questions,
    }), "Pesquisa criada. As respostas serão anônimas para a administração.");
    if (saved) {
      setName("");
      setStartsAt(localDateString());
      setEndsAt(localDateString());
      setAudience(["EMPLOYEE", "LEADER"]);
      setQuestions([{ prompt: "", type: "TEXT" }]);
    }
  }

  function toggleAudience(role: Exclude<FirebaseRole, "ADMIN">, checked: boolean) {
    setAudience((current) => checked ? [...new Set([...current, role])] : current.filter((item) => item !== role));
  }

  return <section className="live-panel">
    <div className="live-panel-heading"><div><span className="eyebrow">PESQUISA AVULSA</span><h2>Pergunte algo específico</h2></div></div>
    <p className="org-manager-help">As respostas não incluem nome, e-mail ou perfil de quem respondeu. Cada pessoa pode responder uma vez.</p>
    <form className="stack-form" onSubmit={submit}>
      <label>Nome da pesquisa<input required minLength={2} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Como podemos melhorar o atendimento?"/></label>
      <fieldset className="survey-audience">
        <legend>Quem pode responder?</legend>
        {(["EMPLOYEE", "LEADER"] as const).map((role) => <label key={role}><input type="checkbox" checked={audience.includes(role)} onChange={(event) => toggleAudience(role, event.target.checked)}/>{roleNames[role]}</label>)}
      </fieldset>
      <div className="two-inputs">
        <label>Início<input type="date" required value={startsAt} onChange={(event) => setStartsAt(event.target.value)}/></label>
        <label>Fim<input type="date" min={startsAt} required value={endsAt} onChange={(event) => setEndsAt(event.target.value)}/></label>
      </div>
      <div className="survey-question-editor">
        <div className="checklist-task-heading"><b>Perguntas</b><small>{questions.length} / 20</small></div>
        {questions.map((question, index) => <div className="survey-question-row" key={index}>
          <label>Pergunta {index + 1}<input required minLength={2} maxLength={500} value={question.prompt} onChange={(event) => setQuestions((current) => current.map((item, questionIndex) => questionIndex === index ? { ...item, prompt: event.target.value } : item))}/></label>
          <label>Tipo<select value={question.type} onChange={(event) => setQuestions((current) => current.map((item, questionIndex) => questionIndex === index ? { ...item, type: event.target.value as SurveyQuestion["type"] } : item))}><option value="TEXT">Texto livre</option><option value="RATING">Nota de 1 a 5</option></select></label>
          <button type="button" className="button button-outline button-small" disabled={questions.length === 1} onClick={() => setQuestions((current) => current.filter((_, questionIndex) => questionIndex !== index))}>Remover</button>
        </div>)}
        <button type="button" className="button button-outline button-small" disabled={questions.length >= 20} onClick={() => setQuestions((current) => [...current, { prompt: "", type: "TEXT" }])}>Adicionar pergunta</button>
      </div>
      <button className="button button-primary" disabled={!audience.length || !questions.some((question) => question.prompt.trim())}>Criar pesquisa</button>
    </form>
  </section>;
}

function SurveyResponseForm({ survey, companyId, execute }: {
  survey: DocumentWithId<SurveyDocument>;
  companyId: string;
  execute: (operation: () => Promise<unknown>, message: string) => Promise<boolean>;
}) {
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [submitting, setSubmitting] = useState(false);
  const complete = survey.questions.every((question) => question.type === "TEXT"
    ? typeof answers[question.id] === "string" && Boolean((answers[question.id] as string).trim())
    : typeof answers[question.id] === "number");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    await execute(() => submitSurveyResponse({
      companyId,
      surveyId: survey.id,
      answers: survey.questions.map((question) => ({ questionId: question.id, value: answers[question.id] })),
    }), "Resposta enviada. O conteúdo não mostra seu nome.");
    setSubmitting(false);
  }

  return <form className="stack-form survey-response-form" onSubmit={submit}>
    {survey.questions.map((question, index) => <label key={question.id}>{index + 1}. {question.prompt}
      {question.type === "TEXT"
        ? <textarea required maxLength={2000} rows={3} value={typeof answers[question.id] === "string" ? answers[question.id] as string : ""} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}/>
        : <select required value={answers[question.id] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: Number(event.target.value) }))}><option value="">Selecione uma nota</option>{[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score}</option>)}</select>}
    </label>)}
    <p className="privacy-note">O conteúdo não mostra seu nome. Em respostas abertas, evite citar nomes ou detalhes que identifiquem você ou outra pessoa.</p>
    <button className="button button-primary" disabled={!complete || submitting}>{submitting ? "Enviando…" : "Enviar resposta"}</button>
  </form>;
}

function SimpleAddForm({ value, setValue, placeholder, button, onSubmit }: { value: string; setValue: (value: string) => void; placeholder: string; button: string; onSubmit: () => void }) {
  return <form className="inline-form simple-add-form" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}><input required value={value} onChange={(event) => setValue(event.target.value)} placeholder={placeholder}/><button className="button button-primary">{button}</button></form>;
}

function ChecklistsPage({ data, user, execute }: { data: WorkspaceData; user: User; execute: (operation: () => Promise<unknown>, message: string) => Promise<boolean> }) {
  if (data.member.role === "ADMIN") return <ChecklistAdmin data={data} user={user} execute={execute}/>;
  if (data.member.role === "LEADER") return <ChecklistLeader data={data} user={user} execute={execute}/>;
  return <ChecklistAssignments data={data} user={user} execute={execute}/>;
}

function ChecklistLeader({ data, user, execute }: { data: WorkspaceData; user: User; execute: (operation: () => Promise<unknown>, message: string) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [frequency, setFrequency] = useState<ChecklistTemplateDocument["frequency"]>("WEEKLY");
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [publishWeekday, setPublishWeekday] = useState(1);
  const [publishDayOfMonth, setPublishDayOfMonth] = useState(1);
  const [items, setItems] = useState([""]);
  const [templateId, setTemplateId] = useState("");
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [modelMode, setModelMode] = useState<"EXISTING" | "NEW">("EXISTING");
  const [assignmentScope, setAssignmentScope] = useState<"DEPARTMENT" | "PEOPLE">("DEPARTMENT");
  const [selectedPersonIds, setSelectedPersonIds] = useState<string[]>([]);
  const [dueAt, setDueAt] = useState("");
  const [publishOn, setPublishOn] = useState<"TODAY" | "TOMORROW">("TODAY");
  const [modelSearch, setModelSearch] = useState("");
  const activeTemplates = data.templates.filter((item) => item.active);
  const leaderTeamIds = data.member.teamIds ?? [];
  const leaderTeams = data.teams.filter((team) => team.active && leaderTeamIds.includes(team.id));
  const membersForAssignment = data.members.filter((member) => member.status === "ACTIVE" && member.role === "EMPLOYEE");
  const selectedTemplate = activeTemplates.find((item) => item.id === templateId);
  const templateTeamIds = selectedTemplate
    ? new Set(selectedTemplate.teamIds?.length
      ? selectedTemplate.teamIds.filter((teamId) => leaderTeamIds.includes(teamId))
      : data.teams.filter((team) => team.active && team.departmentId === selectedTemplate.departmentId && leaderTeamIds.includes(team.id)).map((team) => team.id))
    : new Set<string>();
  const eligibleMembers = selectedTemplate
    ? membersForAssignment.filter((member) =>
      member.teamIds.some((teamId) => templateTeamIds.has(teamId)))
    : [];
  const assignedMemberIds = assignmentScope === "DEPARTMENT"
    ? eligibleMembers.map((member) => member.uid)
    : selectedPersonIds.filter((uid) => eligibleMembers.some((member) => member.uid === uid));
  const frequencyNames: Record<ChecklistTemplateDocument["frequency"], string> = {
    DAILY: "Diária", WEEKLY: "Semanal", MONTHLY: "Mensal", CUSTOM: "Personalizada",
  };
  const responsibleNames: Record<ChecklistTemplateDocument["responsible"], string> = {
    EMPLOYEE: "Colaborador", LEADER: "Líder", UNASSIGNED: "Qualquer pessoa",
  };
  const changeTemplate = (nextTemplateId: string) => {
    setTemplateId(nextTemplateId);
    setSelectedPersonIds([]);
    setAssignmentScope("DEPARTMENT");
    setDueAt("");
  };
  const stepLabels = ["Escolher modelo", "Definir público", "Revisar e atribuir"];
  const modelTerm = modelSearch.trim().toLocaleLowerCase("pt-BR");
  const visibleModels = data.templates.filter((item) => !modelTerm || item.name.toLocaleLowerCase("pt-BR").includes(modelTerm));
  const selectedPeople = eligibleMembers.filter((member) => assignedMemberIds.includes(member.uid));
  const publicationDate = getChecklistPublicationDate(publishOn);
  const assignmentDueAt = selectedTemplate
    ? selectedTemplate.frequency === "CUSTOM"
      ? dueAt
      : calculateChecklistDueDate(selectedTemplate.frequency, publicationDate)
    : "";

  async function saveNewTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanItems = items.map((item) => item.trim()).filter(Boolean);
    if (!cleanItems.length) return;

    let savedTemplateId = "";
    const ok = await execute(async () => {
      const created = await createChecklistTemplate(data.company.id ?? "", {
        name: name.trim(),
        departmentId,
        frequency,
        scheduleEnabled,
        publishWeekday,
        publishDayOfMonth,
        responsible: "EMPLOYEE",
        items: cleanItems,
        createdById: user.uid,
        teamIds: selectedTeamIds,
      });
      savedTemplateId = created.id;
    }, "Modelo salvo. Agora escolha quem receberá o checklist.");

    if (ok) {
      setName("");
      setDepartmentId("");
      setItems([""]);
      setSelectedTeamIds([]);
      setScheduleEnabled(false);
      changeTemplate(savedTemplateId);
      setStep(2);
    }
  }

  async function assignChecklist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTemplate || !assignedMemberIds.length) return;
    const ok = await execute(() => createChecklistAssignments({
      companyId: data.company.id ?? "",
      templateId,
      template: selectedTemplate,
      assignedToIds: assignedMemberIds,
      assignedById: user.uid,
      assignedByRole: data.member.role,
      dueAt,
      publishOn,
    }), publishOn === "TOMORROW"
      ? `Checklist agendado para publicação em ${formatDate(publicationDate)} para ${assignedMemberIds.length} pessoa(s).`
      : `Checklist publicado e atribuído a ${assignedMemberIds.length} pessoa(s).`);

    if (ok) {
      setTemplateId("");
      setSelectedPersonIds([]);
      setAssignmentScope("DEPARTMENT");
      setDueAt("");
      setPublishOn("TODAY");
      setStep(1);
    }
  }
  return <>
    <PageHeading eyebrow="GESTÃO DA EQUIPE" title="Checklists da equipe" subtitle="Crie checklists para as equipes que você lidera e acompanhe suas próprias tarefas."/>
    <section className="live-panel admin-checklist-flow">
      <ol className="admin-checklist-stepper" aria-label="Etapas para atribuir um checklist">
        {stepLabels.map((label, index) => {
          const stepNumber = (index + 1) as 1 | 2 | 3;
          return <li key={label} className={step === stepNumber ? "current" : step > stepNumber ? "complete" : ""}>
            <button type="button" disabled={stepNumber >= step} aria-current={step === stepNumber ? "step" : undefined} onClick={() => setStep(stepNumber)}>
              <span>{step > stepNumber ? "✓" : stepNumber}</span>{label}
            </button>
          </li>;
        })}
      </ol>

      {step === 1 && <div className="admin-checklist-step">
        <div className="live-panel-heading"><div><span className="eyebrow">ETAPA 1 DE 3</span><h2>Escolha um modelo</h2></div></div>
        <p className="checklist-step-copy"><span>Use um dos seus modelos ou crie um novo para uma equipe vinculada ao seu perfil.</span></p>
        <div className="admin-checklist-mode" role="group" aria-label="Como selecionar o modelo">
          <button type="button" className={modelMode === "EXISTING" ? "selected" : ""} aria-pressed={modelMode === "EXISTING"} onClick={() => setModelMode("EXISTING")}>Usar modelo existente</button>
          <button type="button" className={modelMode === "NEW" ? "selected" : ""} aria-pressed={modelMode === "NEW"} onClick={() => setModelMode("NEW")}>Criar novo modelo</button>
        </div>

        {modelMode === "EXISTING" ? <div className="admin-checklist-step-body">
          {activeTemplates.length ? <>
            <label>Modelo ativo
              <select value={templateId} onChange={(event) => changeTemplate(event.target.value)}>
                <option value="">Selecione um modelo</option>
                {activeTemplates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            {selectedTemplate && <div className="checklist-selected-summary">
              <b>{selectedTemplate.items.length} tarefas</b>
              <span>{(selectedTemplate.teamIds ?? []).map((teamId) => data.teams.find((team) => team.id === teamId)?.name).filter(Boolean).join(", ") || data.departments.find((department) => department.id === selectedTemplate.departmentId)?.name || "Equipe"} · {frequencyNames[selectedTemplate.frequency]}</span>
            </div>}
            <button type="button" className="button button-primary" disabled={!selectedTemplate} onClick={() => setStep(2)}>Continuar para o público</button>
          </> : <p className="subtle-note">Ainda não há modelos ativos. Crie um modelo para continuar.</p>}
        </div> : <form className="stack-form admin-checklist-step-body" onSubmit={saveNewTemplate}>
          <label>Nome do checklist<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Abertura da loja"/></label>
          <label>Setor<select required value={departmentId} onChange={(event) => { setDepartmentId(event.target.value); setSelectedTeamIds([]); }}><option value="">Selecione um setor</option>{data.departments.filter((department) => leaderTeams.some((team) => team.departmentId === department.id)).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
          <fieldset className="checklist-leader-team-picker" disabled={!departmentId}>
            <legend>Equipes que usarão este checklist</legend>
            {leaderTeams.filter((team) => team.departmentId === departmentId).map((team) => <label key={team.id}>
              <input type="checkbox" checked={selectedTeamIds.includes(team.id)} onChange={(event) => setSelectedTeamIds((current) => event.target.checked ? [...current, team.id] : current.filter((id) => id !== team.id))}/>
              <span>{team.name}</span>
            </label>)}
            {!leaderTeams.some((team) => team.departmentId === departmentId) && <small>Você não tem equipes ativas vinculadas a este setor.</small>}
          </fieldset>
          <div className="two-inputs">
            <label>Frequência<select value={frequency} onChange={(event) => {
              const nextFrequency = event.target.value as ChecklistTemplateDocument["frequency"];
              setFrequency(nextFrequency);
              if (nextFrequency === "CUSTOM") setScheduleEnabled(false);
            }}><option value="DAILY">Diária</option><option value="WEEKLY">Semanal</option><option value="MONTHLY">Mensal</option><option value="CUSTOM">Personalizada</option></select></label>
            <p className="checklist-leader-audience">Destinatários: colaboradores ativos das equipes selecionadas.</p>
          </div>
          <ChecklistScheduleControls
            frequency={frequency}
            enabled={scheduleEnabled}
            weekday={publishWeekday}
            dayOfMonth={publishDayOfMonth}
            onEnabledChange={setScheduleEnabled}
            onWeekdayChange={setPublishWeekday}
            onDayOfMonthChange={setPublishDayOfMonth}
          />
          <div className="checklist-task-editor">
            <div className="checklist-task-heading"><label>Tarefas</label><small>{items.filter((item) => item.trim()).length} adicionada(s)</small></div>
            {items.map((item, index) => <div className="checklist-task-row" key={index}>
              <span>{index + 1}</span>
              <input aria-label={`Tarefa ${index + 1}`} required value={item} onChange={(event) => setItems((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} placeholder={index === 0 ? "Ex.: Conferir equipamentos" : "Descreva uma tarefa"}/>
              <button type="button" className="checklist-remove-task" aria-label={`Remover tarefa ${index + 1}`} disabled={items.length === 1} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button>
            </div>)}
            <button type="button" className="checklist-add-task" onClick={() => setItems((current) => [...current, ""])}>＋ Adicionar tarefa</button>
          </div>
          {!leaderTeams.length && <p className="subtle-note">Peça à administradora para associar seu perfil a uma equipe antes de criar checklists.</p>}
          <button className="button button-primary" disabled={!selectedTeamIds.length || !items.some((item) => item.trim())}>Salvar modelo e continuar</button>
        </form>}
      </div>}

      {step === 2 && selectedTemplate && <div className="admin-checklist-step">
        <div className="live-panel-heading"><div><span className="eyebrow">ETAPA 2 DE 3</span><h2>Quem receberá?</h2></div></div>
        <div className="checklist-selected-summary"><b>{selectedTemplate.name}</b><span>{selectedTemplate.items.length} tarefas · {(selectedTemplate.teamIds ?? []).map((teamId) => data.teams.find((team) => team.id === teamId)?.name).filter(Boolean).join(", ") || data.departments.find((department) => department.id === selectedTemplate.departmentId)?.name || "Equipe"}</span></div>
        <fieldset className="checklist-assignment-scope">
          <legend>Escolha o público</legend>
          <label className={`checklist-scope-option ${assignmentScope === "DEPARTMENT" ? "selected" : ""}`}>
            <input type="radio" name="checklist-scope" value="DEPARTMENT" checked={assignmentScope === "DEPARTMENT"} onChange={() => setAssignmentScope("DEPARTMENT")}/>
            <span><b>Todas as pessoas das equipes</b><small>{(selectedTemplate.teamIds ?? []).map((teamId) => data.teams.find((team) => team.id === teamId)?.name).filter(Boolean).join(", ") || "Equipes vinculadas ao modelo"} · {eligibleMembers.length} pessoa(s) elegível(is)</small></span>
          </label>
          <label className={`checklist-scope-option ${assignmentScope === "PEOPLE" ? "selected" : ""}`}>
            <input type="radio" name="checklist-scope" value="PEOPLE" checked={assignmentScope === "PEOPLE"} onChange={() => setAssignmentScope("PEOPLE")}/>
            <span><b>Escolher pessoas</b><small>Selecione uma ou mais pessoas elegíveis</small></span>
          </label>
        </fieldset>
        {assignmentScope === "PEOPLE" && <div className="checklist-recipient-list" aria-label="Pessoas que receberão o checklist">
          {eligibleMembers.map((member) => <label key={member.uid} className="checklist-recipient">
            <input type="checkbox" checked={selectedPersonIds.includes(member.uid)} onChange={(event) => setSelectedPersonIds((current) => event.target.checked ? [...current, member.uid] : current.filter((uid) => uid !== member.uid))}/>
            <span><b>{member.name}</b><small>{roleNames[member.role]}</small></span>
          </label>)}
          {!eligibleMembers.length && <p className="empty-inline">Não há pessoas elegíveis neste setor.</p>}
        </div>}
        {eligibleMembers.length === 0 && <p className="subtle-note">Não há colaboradores ativos nas equipes deste modelo. Peça à administradora para atualizar as associações em Pessoas e equipes.</p>}
        <ChecklistPublicationControls value={publishOn} onChange={setPublishOn}/>
        {selectedTemplate.frequency === "CUSTOM"
          ? <label className="admin-checklist-deadline">Prazo de conclusão<input required type="date" min={publicationDate} value={dueAt} onChange={(event) => setDueAt(event.target.value)}/></label>
          : <p className="checklist-deadline-hint">Prazo calculado pela frequência {frequencyNames[selectedTemplate.frequency].toLowerCase()}: {formatDate(assignmentDueAt ?? "")}.</p>}
        <div className="admin-checklist-actions">
          <button type="button" className="button button-outline" onClick={() => setStep(1)}>Voltar ao modelo</button>
          <button type="button" className="button button-primary" disabled={!assignedMemberIds.length || (selectedTemplate.frequency === "CUSTOM" && (!dueAt || dueAt < publicationDate))} onClick={() => setStep(3)}>Revisar atribuição</button>
        </div>
      </div>}

      {step === 3 && selectedTemplate && <form className="admin-checklist-step" onSubmit={assignChecklist}>
        <div className="live-panel-heading"><div><span className="eyebrow">ETAPA 3 DE 3</span><h2>Revise antes de atribuir</h2></div></div>
        <div className="admin-checklist-review">
          <div><small>CHECKLIST</small><b>{selectedTemplate.name}</b><span>{selectedTemplate.items.length} tarefas · {frequencyNames[selectedTemplate.frequency]}</span></div>
          <div><small>DESTINATÁRIOS</small><b>{assignedMemberIds.length} pessoa(s)</b><span>{assignmentScope === "DEPARTMENT" ? "Todas as pessoas elegíveis das equipes" : "Pessoas selecionadas"}</span></div>
          <div><small>PUBLICAÇÃO E PRAZO</small><b>{formatDate(publicationDate)}</b><span>{selectedTemplate.frequency === "CUSTOM" ? `Prazo ${assignmentDueAt ? formatDate(assignmentDueAt) : "não informado"}` : `Vence ${assignmentDueAt ? formatDate(assignmentDueAt) : "—"}`}</span></div>
        </div>
        <div className="admin-checklist-review-people">
          <b>Quem receberá</b>
          {selectedPeople.length <= 5
            ? <p>{selectedPeople.map((member) => member.name).join(", ")}</p>
            : <p>{selectedPeople.slice(0, 5).map((member) => member.name).join(", ")} e mais {selectedPeople.length - 5} pessoa(s)</p>}
        </div>
        <div className="admin-checklist-actions">
          <button type="button" className="button button-outline" onClick={() => setStep(2)}>Editar público e prazo</button>
          <button type="submit" className="button button-primary" disabled={!assignedMemberIds.length || !assignmentDueAt}>{publishOn === "TOMORROW" ? "Agendar publicação" : "Publicar e atribuir agora"}</button>
        </div>
      </form>}
    </section>

    <LeaderChecklistProgress data={data} user={user}/>

    <section className="live-panel checklist-models-panel">
      <div className="checklist-models-heading">
        <span><span className="eyebrow">GERENCIAR</span><b>Modelos de checklist</b></span>
        <span className="checklist-models-count">{modelTerm ? `${visibleModels.length} de ${data.templates.length}` : `${data.templates.length} ${data.templates.length === 1 ? "modelo" : "modelos"}`}</span>
      </div>
      <div className="checklist-models-content">
        <p className="subtle-note">Alterações em um modelo não modificam checklists que já foram atribuídos.</p>
        <div className="filter-bar" role="search">
          <label className="filter-field filter-field-grow">Buscar modelo<input type="search" className="filter-input" value={modelSearch} placeholder="Nome do modelo" onChange={(event) => setModelSearch(event.target.value)}/></label>
          {modelSearch && <button type="button" className="ranking-filter-reset" onClick={() => setModelSearch("")}>Limpar busca</button>}
        </div>
        <div className="config-list checklist-template-list">{visibleModels.map((item) =>
        <ChecklistTemplateRow
          key={item.id}
          template={item}
          departments={data.departments}
          teams={data.teams}
          allowedTeamIds={leaderTeamIds}
          canEditResponsibility={false}
          departmentName={data.departments.find((department) => department.id === item.departmentId)?.name ?? "Setor removido"}
          companyId={data.company.id ?? ""}
          createdByName={data.member.name}
          frequencyNames={frequencyNames}
          responsibleNames={responsibleNames}
          execute={execute}
          onDeleted={(deletedId) => {
            if (templateId === deletedId) {
              setTemplateId("");
              setSelectedPersonIds([]);
              setDueAt("");
              setStep(1);
            }
          }}
        />,
        )}{!data.templates.length && <p className="empty-inline">Seus modelos salvos aparecerão aqui.</p>}{data.templates.length > 0 && !visibleModels.length && <p className="empty-inline">Nenhum modelo corresponde à busca.</p>}</div>
      </div>
    </section>
    <section className="live-panel"><div className="live-panel-heading"><div><span className="eyebrow">MINHAS TAREFAS</span><h2>Checklists atribuídos a você</h2></div></div><AssignmentList data={{ ...data, assignments: data.assignments.filter((assignment) => assignment.assignedToId === user.uid) }} user={user} execute={execute}/></section>
  </>;
}

function LeaderChecklistProgress({ data, user }: { data: WorkspaceData; user: User }) {
  const teamAssignments = data.assignments.filter((assignment) => assignment.assignedToId !== user.uid);
  if (!teamAssignments.length) return <section className="live-panel"><div className="live-panel-heading"><div><span className="eyebrow">ACOMPANHAMENTO</span><h2>Progresso da equipe</h2></div></div><EmptyState title="Ainda não há checklists para a equipe" text="As atribuições feitas para colaboradores das suas equipes aparecerão aqui."/></section>;

  const grouped = new Map<string, {
    name: string;
    dueAt?: string;
    people: Map<string, { name: string; assignments: Array<{ completed: boolean; overdue: boolean }> }>;
  }>();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  for (const assignment of teamAssignments) {
    const groupKey = `${assignment.templateId}:${assignment.dueAt ?? ""}:${assignment.name}`;
    const group = grouped.get(groupKey) ?? { name: assignment.name, dueAt: assignment.dueAt, people: new Map() };
    const person = data.members.find((member) => member.uid === assignment.assignedToId);
    const progress = data.results[assignment.id] ?? [];
    const completed = isChecklistCompleted(assignment, progress);
    const personState = group.people.get(assignment.assignedToId) ?? {
      name: person?.name ?? "Pessoa",
      assignments: [],
    };
    personState.assignments.push({ completed, overdue: !completed && Boolean(assignment.dueAt && assignment.dueAt < todayString) });
    group.people.set(assignment.assignedToId, personState);
    grouped.set(groupKey, group);
  }

  return <section className="live-panel admin-checklist-progress">
    <div className="live-panel-heading"><div><span className="eyebrow">ACOMPANHAMENTO</span><h2>Progresso da equipe</h2></div></div>
    <div className="admin-progress-groups">{[...grouped.entries()].map(([key, group]) => {
      const people = [...group.people.values()];
      const completed = people.filter((person) => person.assignments.every((assignment) => assignment.completed));
      const pending = people.filter((person) => person.assignments.some((assignment) => !assignment.completed));
      const overdueCount = pending.filter((person) => person.assignments.some((assignment) => assignment.overdue)).length;
      const percent = people.length ? Math.round(completed.length / people.length * 100) : 0;
      return <article className="admin-progress-group" key={key}>
        <div className="admin-progress-group-heading"><div><h3>{group.name}</h3><small>{group.dueAt ? `Prazo ${formatDate(group.dueAt)}` : "Sem prazo"}</small></div><b>{completed.length} de {people.length} pessoas</b></div>
        <div className="assignment-progress-track" role="progressbar" aria-label={`Conclusão da equipe no checklist ${group.name}`} aria-valuemin={0} aria-valuemax={people.length} aria-valuenow={completed.length}><span style={{ width: `${percent}%` }}/></div>
        <div className="admin-progress-group-footer">
          <span>{pending.length} {pending.length === 1 ? "pendente" : "pendentes"}{overdueCount ? ` · ${overdueCount} expirados` : ""}</span>
          {pending.length > 0 && <details className="admin-progress-pending">
            <summary>Ver pendências ({pending.length})</summary>
            <ul>{pending.map((person) => <li key={person.name}><b>{person.name}</b>{person.assignments.some((assignment) => assignment.overdue) && <small>Expirado</small>}</li>)}</ul>
          </details>}
        </div>
      </article>;
    })}</div>
  </section>;
}

function AdminChecklistAssignmentForm({ data, user, execute }: { data: WorkspaceData; user: User; execute: (operation: () => Promise<unknown>, message: string) => Promise<boolean> }) {
  const [templateId, setTemplateId] = useState("");
  const [targetRole, setTargetRole] = useState<"LEADER" | "EMPLOYEE">("LEADER");
  const [assignToAll, setAssignToAll] = useState(true);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [dueAt, setDueAt] = useState("");
  const [publishOn, setPublishOn] = useState<"TODAY" | "TOMORROW">("TODAY");
  const publicationDate = getChecklistPublicationDate(publishOn);
  const templates = data.templates.filter((template) => template.active);
  const recipients = data.members.filter((member) => member.status === "ACTIVE" && member.role === targetRole);
  const recipientIds = assignToAll
    ? recipients.map((member) => member.uid)
    : selectedMemberIds.filter((uid) => recipients.some((member) => member.uid === uid));
  const selectedTemplate = templates.find((template) => template.id === templateId);

  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTemplate || !recipientIds.length || (selectedTemplate.frequency === "CUSTOM" && !dueAt)) return;
    const saved = await execute(() => createChecklistAssignments({
      companyId: data.company.id ?? "",
      templateId,
      template: selectedTemplate,
      assignedToIds: recipientIds,
      assignedById: user.uid,
      assignedByRole: data.member.role,
      dueAt,
      publishOn,
    }), publishOn === "TOMORROW"
      ? `Checklist agendado para publicação em ${formatDate(publicationDate)} para ${recipientIds.length} ${targetRole === "LEADER" ? "líder" : "colaborador"}${recipientIds.length === 1 ? "" : "es"}.`
      : `Checklist publicado e atribuído a ${recipientIds.length} ${targetRole === "LEADER" ? "líder" : "colaborador"}${recipientIds.length === 1 ? "" : "es"}.`);
    if (saved) {
      setTemplateId("");
      setAssignToAll(true);
      setSelectedMemberIds([]);
      setDueAt("");
      setPublishOn("TODAY");
    }
  }

  return <section className="live-panel admin-checklist-assign">
    <div className="live-panel-heading"><div><span className="eyebrow">NOVA ATRIBUIÇÃO</span><h2>Atribuir checklist à equipe</h2></div></div>
    <p className="org-manager-help">Escolha um modelo e atribua-o aos líderes ou colaboradores ativos. Cada pessoa receberá sua própria cópia para preencher.</p>
    <form className="stack-form" onSubmit={assign}>
      <label>Modelo ativo<select required value={templateId} onChange={(event) => { setTemplateId(event.target.value); setDueAt(""); }}><option value="">Selecione um modelo</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
      {!templates.length && <p className="empty-inline">Ative ou crie um modelo antes de atribuir checklists.</p>}
      <div className="two-inputs">
        <label>Destinatários<select value={targetRole} onChange={(event) => {
          setTargetRole(event.target.value as "LEADER" | "EMPLOYEE");
          setAssignToAll(true);
          setSelectedMemberIds([]);
        }}><option value="LEADER">Líderes</option><option value="EMPLOYEE">Colaboradores</option></select></label>
        {selectedTemplate?.frequency === "CUSTOM"
          ? <label>Prazo<input required type="date" min={publicationDate} value={dueAt} onChange={(event) => setDueAt(event.target.value)}/></label>
          : <p className="checklist-deadline-hint">{selectedTemplate ? `Prazo calculado pela frequência ${selectedTemplate.frequency.toLowerCase()}: ${formatDate(calculateChecklistDueDate(selectedTemplate.frequency, publicationDate) ?? "")}.` : "O prazo será definido pelo modelo selecionado."}</p>}
      </div>
      <ChecklistPublicationControls value={publishOn} onChange={setPublishOn}/>
      <label className="admin-checklist-all-toggle"><input type="checkbox" checked={assignToAll} onChange={(event) => {
        setAssignToAll(event.target.checked);
        setSelectedMemberIds([]);
      }}/><span><b>Atribuir a todas as pessoas ativas</b><small>{recipients.length} {targetRole === "LEADER" ? "líderes" : "colaboradores"} disponíveis</small></span></label>
      {!assignToAll && <fieldset className="admin-checklist-member-picker">
        <legend>Escolha quem receberá</legend>
        {recipients.map((member) => <label key={member.uid}><input type="checkbox" checked={selectedMemberIds.includes(member.uid)} onChange={(event) => setSelectedMemberIds((current) => event.target.checked ? [...current, member.uid] : current.filter((id) => id !== member.uid))}/><span><b>{member.name.trim() || "Pessoa sem nome cadastrado"}</b><small>{member.email}</small></span></label>)}
        {!recipients.length && <p className="empty-inline">Não há pessoas ativas com este perfil.</p>}
      </fieldset>}
      <button className="button button-primary" disabled={!selectedTemplate || !recipientIds.length || (selectedTemplate.frequency === "CUSTOM" && (!dueAt || dueAt < publicationDate))}>{publishOn === "TOMORROW" ? "Agendar publicação" : "Publicar e atribuir agora"}</button>
    </form>
  </section>;
}

function AdminAssignmentsManager({ data, execute }: { data: WorkspaceData; execute: (operation: () => Promise<unknown>, message: string) => Promise<boolean> }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "PENDING" | "OVERDUE" | "COMPLETED">("");
  const todayString = localDateString();
  const term = search.trim().toLocaleLowerCase("pt-BR");
  const rows = data.assignments.map((assignment) => {
    const person = data.members.find((member) => member.uid === assignment.assignedToId);
    const results = data.results[assignment.id] ?? [];
    const completedItems = results.filter((result) => result.status === "COMPLETED").length;
    const isCompleted = assignment.status === "COMPLETED" || (assignment.items.length > 0 && completedItems >= assignment.items.length);
    const isOverdue = !isCompleted && Boolean(assignment.dueAt && assignment.dueAt < todayString);
    const status: "COMPLETED" | "OVERDUE" | "PENDING" = isCompleted ? "COMPLETED" : isOverdue ? "OVERDUE" : "PENDING";
    return { assignment, personName: person?.name ?? "Pessoa", status, completedItems, totalItems: assignment.items.length };
  }).sort((a, b) => (b.assignment.scheduledFor ?? b.assignment.dueAt ?? "").localeCompare(a.assignment.scheduledFor ?? a.assignment.dueAt ?? ""));
  const filteredRows = rows.filter((row) => {
    if (statusFilter && row.status !== statusFilter) return false;
    if (!term) return true;
    return row.assignment.name.toLocaleLowerCase("pt-BR").includes(term) || row.personName.toLocaleLowerCase("pt-BR").includes(term);
  });
  const hasFilters = Boolean(term || statusFilter);
  const statusLabels: Record<"COMPLETED" | "OVERDUE" | "PENDING", string> = { COMPLETED: "Concluído", OVERDUE: "Expirado", PENDING: "Pendente" };
  return <section className="live-panel">
    <div className="live-panel-heading"><div><span className="eyebrow">CANCELAMENTO</span><h2>Atribuições individuais</h2></div><span className="admin-progress-rate">{hasFilters ? `${filteredRows.length} de ${rows.length}` : `${rows.length} atribuição(ões)`}</span></div>
    <p className="subtle-note">Cancele uma atribuição para removê-la da pessoa, incluindo as tarefas já registradas. Útil para encerrar checklists publicados por engano.</p>
    <div className="filter-bar" role="search">
      <label className="filter-field filter-field-grow">Buscar<input type="search" className="filter-input" value={search} placeholder="Checklist ou pessoa" onChange={(event) => setSearch(event.target.value)}/></label>
      <label className="filter-field">Situação<select className="filter-input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "" | "PENDING" | "OVERDUE" | "COMPLETED")}><option value="">Todas as situações</option><option value="PENDING">Pendentes</option><option value="OVERDUE">Expiradas</option><option value="COMPLETED">Concluídas</option></select></label>
      {hasFilters && <button type="button" className="ranking-filter-reset" onClick={() => { setSearch(""); setStatusFilter(""); }}>Limpar filtros</button>}
    </div>
    {rows.length
      ? filteredRows.length
        ? <div className="live-table-wrap"><table className="live-table"><thead><tr><th>Checklist</th><th>Pessoa</th><th>Prazo</th><th>Situação</th><th>Ação</th></tr></thead><tbody>{filteredRows.slice(0, 300).map((row) => <tr key={row.assignment.id}><td><b>{row.assignment.name}</b><small className="table-subline">{row.completedItems}/{row.totalItems} tarefas concluídas</small></td><td>{row.personName}</td><td>{row.assignment.dueAt ? formatDate(row.assignment.dueAt) : "Sem prazo"}</td><td><span className={`status-chip ${row.status === "COMPLETED" ? "done" : row.status === "OVERDUE" ? "overdue" : "pending"}`}>{statusLabels[row.status]}</span></td><td><ConfirmButton dialogTitle="Cancelar atribuição" description={<>Cancelar o checklist <b>{row.assignment.name}</b> de <b>{row.personName}</b>? As tarefas e observações já registradas nessa atribuição serão removidas.</>} confirmLabel="Cancelar atribuição" busyLabel="Cancelando…" onConfirm={() => execute(() => deleteChecklistAssignment(data.company.id ?? "", row.assignment.id), "Atribuição cancelada.")}>Cancelar</ConfirmButton></td></tr>)}{filteredRows.length > 300 && <tr><td colSpan={5}>Mostrando as 300 primeiras de {filteredRows.length} atribuições. Use a busca para refinar.</td></tr>}</tbody></table></div>
        : <EmptyState title="Nenhuma atribuição encontrada" text="Ajuste a busca ou a situação para ver outras atribuições."/>
      : <EmptyState title="Nenhum checklist atribuído" text="As atribuições feitas pela administração aparecerão aqui."/>}
  </section>;
}

function ChecklistAdmin({ data, user, execute }: { data: WorkspaceData; user: User; execute: (operation: () => Promise<unknown>, message: string) => Promise<boolean> }) {
  const frequencyNames: Record<ChecklistTemplateDocument["frequency"], string> = {
    DAILY: "Diária", WEEKLY: "Semanal", MONTHLY: "Mensal", CUSTOM: "Personalizada",
  };
  const responsibleNames: Record<ChecklistTemplateDocument["responsible"], string> = {
    EMPLOYEE: "Colaborador", LEADER: "Líder", UNASSIGNED: "Qualquer pessoa",
  };
  const [templateSearch, setTemplateSearch] = useState("");
  const templateTerm = templateSearch.trim().toLocaleLowerCase("pt-BR");
  const visibleTemplates = data.templates.filter((item) => !templateTerm || item.name.toLocaleLowerCase("pt-BR").includes(templateTerm));

  return <>
    <PageHeading eyebrow="VISÃO DA EMPRESA" title="Checklists" subtitle="Acompanhe as atribuições e veja quais checklists cada líder definiu para sua equipe."/>
    <AdminChecklistAssignmentForm data={data} user={user} execute={execute}/>
    <section className="live-panel">
      <AssignmentList data={data} user={user} execute={execute} admin/>
    </section>
    <AdminAssignmentsManager data={data} execute={execute}/>
    <section className="live-panel checklist-models-panel">
      <div className="checklist-models-heading">
        <span><span className="eyebrow">MODELOS DA EMPRESA</span><b>Checklists definidos pelos líderes</b></span>
        <span className="checklist-models-count">{templateTerm ? `${visibleTemplates.length} de ${data.templates.length}` : `${data.templates.length} ${data.templates.length === 1 ? "modelo" : "modelos"}`}</span>
      </div>
      <p className="subtle-note">Você pode editar, ativar, desativar ou excluir qualquer modelo da empresa.</p>
      <div className="filter-bar" role="search">
        <label className="filter-field filter-field-grow">Buscar modelo<input type="search" className="filter-input" value={templateSearch} placeholder="Nome do modelo" onChange={(event) => setTemplateSearch(event.target.value)}/></label>
        {templateSearch && <button type="button" className="ranking-filter-reset" onClick={() => setTemplateSearch("")}>Limpar busca</button>}
      </div>
      <div className="config-list checklist-template-list">{visibleTemplates.map((item) => {
        const creator = item.createdById
          ? data.members.find((member) => member.uid === item.createdById)?.name ?? "Líder"
          : "Administração";
        return <ChecklistTemplateRow
          key={item.id}
          template={item}
          departments={data.departments}
          teams={data.teams}
          allowedTeamIds={data.teams.map((team) => team.id)}
          canEditResponsibility
          departmentName={data.departments.find((department) => department.id === item.departmentId)?.name ?? "Setor removido"}
          companyId={data.company.id ?? ""}
          createdByName={creator}
          frequencyNames={frequencyNames}
          responsibleNames={responsibleNames}
          execute={execute}
          onDeleted={() => undefined}
        />;
      })}{!data.templates.length && <p className="empty-inline">Os modelos criados pelos líderes aparecerão aqui.</p>}{data.templates.length > 0 && !visibleTemplates.length && <p className="empty-inline">Nenhum modelo corresponde à busca.</p>}</div>
    </section>
  </>;
}

function ChecklistTemplateRow({
  template,
  departments,
  teams,
  allowedTeamIds,
  canEditResponsibility,
  departmentName,
  companyId,
  createdByName,
  frequencyNames,
  responsibleNames,
  execute,
  onDeleted,
}: {
  template: DocumentWithId<ChecklistTemplateDocument>;
  departments: WorkspaceData["departments"];
  teams: WorkspaceData["teams"];
  allowedTeamIds: string[];
  canEditResponsibility: boolean;
  departmentName: string;
  companyId: string;
  createdByName: string;
  frequencyNames: Record<ChecklistTemplateDocument["frequency"], string>;
  responsibleNames: Record<ChecklistTemplateDocument["responsible"], string>;
  execute: (operation: () => Promise<unknown>, message: string) => Promise<boolean>;
  onDeleted: (templateId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(template.name);
  const [departmentId, setDepartmentId] = useState(template.departmentId);
  const [frequency, setFrequency] = useState(template.frequency);
  const [scheduleEnabled, setScheduleEnabled] = useState(template.scheduleEnabled ?? false);
  const [publishWeekday, setPublishWeekday] = useState(template.publishWeekday ?? 1);
  const [publishDayOfMonth, setPublishDayOfMonth] = useState(template.publishDayOfMonth ?? 1);
  const [responsible, setResponsible] = useState(template.responsible);
  const [items, setItems] = useState(template.items.map((item) => item.description));
  const [teamIds, setTeamIds] = useState(template.teamIds ?? []);
  const templateTeamNames = (template.teamIds ?? [])
    .map((teamId) => teams.find((team) => team.id === teamId)?.name)
    .filter((teamName): teamName is string => Boolean(teamName));
  const editableTeams = teams.filter((team) => team.active
    && team.departmentId === departmentId
    && allowedTeamIds.includes(team.id));

  function startEditing() {
    setName(template.name);
    setDepartmentId(template.departmentId);
    setFrequency(template.frequency);
    setScheduleEnabled(template.scheduleEnabled ?? false);
    setPublishWeekday(template.publishWeekday ?? 1);
    setPublishDayOfMonth(template.publishDayOfMonth ?? 1);
    setResponsible(template.responsible);
    setItems(template.items.map((item) => item.description));
    setTeamIds(template.teamIds ?? teams.filter((team) => team.departmentId === template.departmentId).map((team) => team.id));
    setEditing(true);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanItems = items.map((item) => item.trim()).filter(Boolean);
    if (!cleanItems.length) return;
    const saved = await execute(() => saveChecklistTemplate(companyId, template.id, {
      name,
      departmentId,
      frequency,
      scheduleEnabled,
      publishWeekday,
      publishDayOfMonth,
      responsible,
      items: cleanItems,
      teamIds,
    }), "Modelo de checklist atualizado.");
    if (saved) setEditing(false);
  }

  return <div className="checklist-template-entry">
    <div className="checklist-template-summary">
      <span><b>{template.name}</b><small>{departmentName}{templateTeamNames.length ? ` · ${templateTeamNames.join(", ")}` : ""} · {template.items.length} tarefas · {frequencyNames[template.frequency]}{template.scheduleEnabled ? ` · Publicação automática ${getScheduleLabel(template)}` : ""} · {responsibleNames[template.responsible]} · Criado por {createdByName}</small></span>
      <div className="checklist-template-actions">
        <span className={`status-chip ${template.active ? "done" : "pending"}`}>{template.active ? "Ativo" : "Inativo"}</span>
        <button type="button" className="button button-outline button-small" onClick={startEditing}>Editar</button>
        <ConfirmButton dialogTitle="Excluir modelo" description={<>Excluir o modelo <b>{template.name}</b>? Checklists já atribuídos a partir dele continuam disponíveis para as pessoas.</>} onConfirm={async () => {
          const deleted = await execute(
            () => deleteChecklistTemplate(companyId, template.id),
            "Modelo de checklist excluído.",
          );
          if (deleted) onDeleted(template.id);
        }}>Excluir</ConfirmButton>
        <button type="button" className="button button-outline button-small" onClick={() => execute(() => updateChecklistTemplate(companyId, template.id, !template.active), template.active ? "Modelo desativado." : "Modelo ativado.")}>{template.active ? "Desativar" : "Ativar"}</button>
      </div>
    </div>
    {editing && <div className="checklist-template-management">
      <form className="stack-form checklist-template-edit" onSubmit={save}>
      <label>Nome do checklist<input required value={name} onChange={(event) => setName(event.target.value)}/></label>
      <label>Setor<select required value={departmentId} onChange={(event) => { setDepartmentId(event.target.value); setTeamIds(teams.filter((team) => team.active && team.departmentId === event.target.value && allowedTeamIds.includes(team.id)).map((team) => team.id)); }}><option value="">Selecione um setor</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
      <fieldset className="checklist-leader-team-picker">
        <legend>Equipes associadas</legend>
        {editableTeams.map((team) => <label key={team.id}><input type="checkbox" checked={teamIds.includes(team.id)} onChange={(event) => setTeamIds((current) => event.target.checked ? [...current, team.id] : current.filter((id) => id !== team.id))}/><span>{team.name}</span></label>)}
        {!editableTeams.length && <small>Não há equipes ativas disponíveis neste setor.</small>}
      </fieldset>
      <div className="two-inputs">
        <label>Frequência<select value={frequency} onChange={(event) => {
          const nextFrequency = event.target.value as ChecklistTemplateDocument["frequency"];
          setFrequency(nextFrequency);
          if (nextFrequency === "CUSTOM") setScheduleEnabled(false);
        }}><option value="DAILY">Diária</option><option value="WEEKLY">Semanal</option><option value="MONTHLY">Mensal</option><option value="CUSTOM">Personalizada</option></select></label>
        {canEditResponsibility
          ? <label>Quem pode receber<select value={responsible} onChange={(event) => setResponsible(event.target.value as ChecklistTemplateDocument["responsible"])}><option value="EMPLOYEE">Colaborador</option><option value="LEADER">Líder</option><option value="UNASSIGNED">Qualquer pessoa</option></select></label>
          : <p className="checklist-leader-audience">Destinatários: colaboradores ativos das equipes vinculadas.</p>}
      </div>
      <ChecklistScheduleControls
        frequency={frequency}
        enabled={scheduleEnabled}
        weekday={publishWeekday}
        dayOfMonth={publishDayOfMonth}
        onEnabledChange={setScheduleEnabled}
        onWeekdayChange={setPublishWeekday}
        onDayOfMonthChange={setPublishDayOfMonth}
      />
      <div className="checklist-task-editor">
        <div className="checklist-task-heading"><label>Tarefas</label><small>{items.filter((item) => item.trim()).length} adicionada(s)</small></div>
        {items.map((item, index) => <div className="checklist-task-row" key={index}>
          <span>{index + 1}</span>
          <input aria-label={`Tarefa ${index + 1}`} required value={item} onChange={(event) => setItems((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))}/>
          <button type="button" className="checklist-remove-task" aria-label={`Remover tarefa ${index + 1}`} disabled={items.length === 1} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button>
        </div>)}
        <button type="button" className="checklist-add-task" onClick={() => setItems((current) => [...current, ""])}>＋ Adicionar tarefa</button>
      </div>
      <div className="checklist-template-actions">
        <button type="button" className="button button-outline button-small" onClick={() => setEditing(false)}>Cancelar</button>
        <button type="submit" className="button button-primary button-small" disabled={!items.some((item) => item.trim()) || !teamIds.length}>Salvar alterações</button>
      </div>
      </form>
    </div>}
  </div>;
}

function ChecklistAssignments({ data, user, execute }: { data: WorkspaceData; user: User; execute: (operation: () => Promise<unknown>, message: string) => Promise<boolean> }) {
  return <><PageHeading eyebrow="ROTINA DA EQUIPE" title="Checklists" subtitle="Consulte tarefas e atualize seu progresso."/><section className="live-panel"><AssignmentList data={data} user={user} execute={execute}/></section></>;
}

function formatDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const parsedDate = new Date(year, month - 1, day);
  if (
    !Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) ||
    parsedDate.getFullYear() !== year || parsedDate.getMonth() !== month - 1 || parsedDate.getDate() !== day
  ) return date;
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", year: "numeric" }).format(parsedDate);
}

function formatChecklistDueDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const dueDate = new Date(year, month - 1, day);
  if (
    !Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) ||
    dueDate.getFullYear() !== year || dueDate.getMonth() !== month - 1 || dueDate.getDate() !== day
  ) return `Prazo ${date}`;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysUntilDue = Math.round((dueDate.getTime() - today.getTime()) / 86_400_000);
  if (daysUntilDue === 0) return "Vence hoje";
  if (daysUntilDue === 1) return "Vence amanhã";
  return `Prazo ${formatDate(date)}`;
}

function AssignmentList({ data, user, execute, admin = false }: { data: WorkspaceData; user: User; execute: (operation: () => Promise<unknown>, message: string) => Promise<boolean>; admin?: boolean }) {
  const assignments = data.assignments.slice().sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""));
  if (admin) {
    const today = new Date();
    const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const progress = assignments.map((assignment) => {
      const completedItems = (data.results[assignment.id] ?? []).filter((result) => result.status === "COMPLETED").length;
      const isCompleted = assignment.status === "COMPLETED"
        || (assignment.items.length > 0 && completedItems >= assignment.items.length);
      const isOverdue = !isCompleted && Boolean(assignment.dueAt && assignment.dueAt < todayString);
      const person = data.members.find((member) => member.uid === assignment.assignedToId);
      return {
        assignment,
        isCompleted,
        isOverdue,
        personName: person?.name ?? "Pessoa",
        checklistCreatorName: data.templates.find((template) => template.id === assignment.templateId)?.createdById
          ? data.members.find((member) => member.uid === data.templates.find((template) => template.id === assignment.templateId)?.createdById)?.name ?? "Líder"
          : "Administração",
        teamNames: (person?.teamIds ?? [])
          .map((teamId) => data.teams.find((team) => team.id === teamId)?.name)
          .filter((teamName): teamName is string => Boolean(teamName)),
      };
    });
    type AssignmentGroup = {
      key: string;
      name: string;
      dueAt?: string;
      creatorName: string;
      completed: number;
      overdue: number;
      pending: Array<{ name: string; teams: string[]; expired: boolean }>;
      total: number;
      people: Map<string, {
        name: string;
        teams: string[];
        assignments: Array<{ completed: boolean; overdue: boolean }>;
      }>;
    };
    const groupedAssignments = new Map<string, AssignmentGroup>();
    for (const item of progress) {
      const { assignment } = item;
      const key = `${assignment.templateId}:${assignment.dueAt ?? ""}:${assignment.name}`;
      const group = groupedAssignments.get(key) ?? {
        key,
        name: assignment.name,
        dueAt: assignment.dueAt,
        creatorName: item.checklistCreatorName,
        completed: 0,
        overdue: 0,
        pending: [],
        total: 0,
        people: new Map(),
      };
      const person = group.people.get(assignment.assignedToId) ?? {
        name: item.personName,
        teams: item.teamNames,
        assignments: [],
      };
      person.assignments.push({ completed: item.isCompleted, overdue: item.isOverdue });
      group.people.set(assignment.assignedToId, person);
      groupedAssignments.set(key, group);
    }
    const groups = [...groupedAssignments.values()];
    for (const group of groups) {
      const people = [...group.people.values()];
      group.total = people.length;
      group.completed = people.filter((person) => person.assignments.every((assignment) => assignment.completed)).length;
      group.pending = people
        .filter((person) => person.assignments.some((assignment) => !assignment.completed))
        .map(({ name, teams, assignments: personAssignments }) => ({
          name,
          teams,
          expired: personAssignments.some((assignment) => !assignment.completed && assignment.overdue),
        }));
      group.overdue = people.filter((person) =>
        person.assignments.some((assignment) => !assignment.completed && assignment.overdue),
      ).length;
    }
    const completedCount = progress.filter((item) => item.isCompleted).length;
    const overdueCount = progress.filter((item) => item.isOverdue).length;
    const pendingCount = progress.length - completedCount;
    const completionRate = progress.length ? Math.round(completedCount / progress.length * 100) : 0;
    return <div className="admin-checklist-progress">
      <div className="live-panel-heading">
        <div><span className="eyebrow">ACOMPANHAMENTO</span><h2>Panorama dos checklists</h2></div>
        <span className="admin-progress-rate">{completionRate}% das atribuições concluídas</span>
      </div>
      <div className="admin-progress-stats">
        <div><span>Atribuições</span><b>{progress.length}</b><small>Em {groups.length} checklist{groups.length === 1 ? "" : "s"}</small></div>
        <div><span>Concluídas</span><b>{completedCount}</b><small>Checklist preenchido</small></div>
        <div><span>Pendentes</span><b>{pendingCount}</b><small>Ainda faltam preencher</small></div>
        <div className={overdueCount ? "has-overdue" : ""}><span>Expirados</span><b>{overdueCount}</b><small>Atribuições pendentes vencidas</small></div>
      </div>
      {overdueCount > 0 && <p className="admin-progress-alert">{overdueCount} atribuição(ões) passaram do prazo. Confira as pendências abaixo.</p>}
      {progress.length > 0 && pendingCount === 0 && <p className="admin-progress-success">Todos os checklists atribuídos foram preenchidos.</p>}
      {progress.length > 0
        ? <div className="admin-progress-groups">{groups.map((group) => {
          const percentage = group.total ? Math.round(group.completed / group.total * 100) : 0;
          return <article className="admin-progress-group" key={group.key}>
            <div className="admin-progress-group-heading">
              <div><h3>{group.name}</h3><small>Criado por {group.creatorName} · {group.dueAt ? `Prazo ${formatDate(group.dueAt)}` : "Sem prazo"}</small></div>
              <b>{group.completed} de {group.total} pessoas</b>
            </div>
            <div className="assignment-progress-track" role="progressbar" aria-label={`Conclusão do checklist ${group.name}`} aria-valuemin={0} aria-valuemax={group.total} aria-valuenow={group.completed}>
              <span style={{ width: `${percentage}%` }}/>
            </div>
            <div className="admin-progress-group-footer">
              <span>{group.pending.filter((person) => !person.expired).length} pendentes · {group.pending.filter((person) => person.expired).length} expirados</span>
              {group.pending.filter((person) => !person.expired).length > 0 && <details className="admin-progress-pending">
                <summary>Ver pendentes ({group.pending.filter((person) => !person.expired).length})</summary>
                <ul>{group.pending.filter((person) => !person.expired).map((person, index) => <li key={`${person.name}-${index}`}><b>{person.name}</b>{person.teams.length > 0 && <small>{person.teams.join(", ")}</small>}</li>)}</ul>
              </details>}
              {group.pending.filter((person) => person.expired).length > 0 && <details className="admin-progress-pending admin-progress-expired">
                <summary>Ver expirados ({group.pending.filter((person) => person.expired).length})</summary>
                <ul>{group.pending.filter((person) => person.expired).map((person, index) => <li key={`${person.name}-${index}`}><b>{person.name}</b>{person.teams.length > 0 && <small>{person.teams.join(", ")}</small>}</li>)}</ul>
              </details>}
            </div>
          </article>;
        })}</div>
        : <EmptyState title="Nenhum checklist atribuído" text="As atribuições feitas pela administração aparecerão aqui."/>}
    </div>;
  }
  if (!assignments.length) return <EmptyState title="Nenhum checklist atribuído" text="As tarefas atribuídas a você aparecerão aqui."/>;
  const active = assignments.filter((assignment) => !isChecklistCompleted(assignment, data.results[assignment.id] ?? []) && !isChecklistExpired(assignment, data.results[assignment.id] ?? []));
  const expired = assignments.filter((assignment) => isChecklistExpired(assignment, data.results[assignment.id] ?? []));
  const completed = assignments.filter((assignment) => isChecklistCompleted(assignment, data.results[assignment.id] ?? []));
  const renderSection = (title: string, items: typeof assignments, emptyText: string, expiredSection = false) => <section className={`checklist-assignment-section${expiredSection ? " checklist-assignment-section-expired" : ""}`}>
    <div className="checklist-assignment-section-heading"><h2>{title}</h2><span>{items.length}</span></div>
    {items.length
      ? <div className="assignment-grid">{items.map((assignment) => <AssignmentCard key={assignment.id} assignment={assignment} data={data} user={user} execute={execute} admin={admin}/>)}</div>
      : <p className="checklist-assignment-section-empty">{emptyText}</p>}
  </section>;
  return <div className="checklist-assignment-sections">
    {renderSection("Pendentes", active, "Nenhum checklist aguardando preenchimento.")}
    {renderSection("Expirados", expired, "Nenhum checklist expirado.", true)}
    {renderSection("Concluídos", completed, "Os checklists concluídos aparecerão aqui.")}
  </div>;
}

function isChecklistCompleted(assignment: DocumentWithId<ChecklistAssignmentDocument>, results: WorkspaceData["results"][string]) {
  return assignment.status === "COMPLETED"
    || (assignment.items.length > 0 && results.filter((result) => result.status === "COMPLETED").length >= assignment.items.length);
}

function isChecklistExpired(assignment: DocumentWithId<ChecklistAssignmentDocument>, results: WorkspaceData["results"][string]) {
  return !isChecklistCompleted(assignment, results)
    && Boolean(assignment.dueAt && assignment.dueAt < localDateString());
}

function AssignmentCard({ assignment, data, user, execute, admin, compact = false }: { assignment: DocumentWithId<ChecklistAssignmentDocument>; data: WorkspaceData; user: User; execute: (operation: () => Promise<unknown>, message: string) => Promise<boolean>; admin: boolean; compact?: boolean }) {
  const results = data.results[assignment.id] ?? [];
  const itemResults = new Map(results.map((result) => [result.id, result]));
  const own = assignment.assignedToId === user.uid;
  const person = data.members.find((member) => member.uid === assignment.assignedToId);
  const completed = results.filter((result) => result.status === "COMPLETED").length;
  const isCompleted = assignment.status === "COMPLETED" || (assignment.items.length > 0 && completed >= assignment.items.length);
  const isOverdue = !isCompleted && Boolean(assignment.dueAt && assignment.dueAt < localDateString());
  const progressPercent = assignment.items.length ? Math.round(completed / assignment.items.length * 100) : 0;
  return <article className={`assignment-card${compact ? " assignment-card-compact" : ""}${isOverdue ? " assignment-card-expired" : ""}`}><div className="assignment-heading"><div><span className={`status-chip ${isCompleted ? "done" : isOverdue ? "overdue" : "pending"}`}>{isCompleted ? "Concluído" : isOverdue ? "Expirado" : "Em andamento"}</span><h3>{assignment.name}</h3><small>{compact ? "" : `${person?.name ?? "Pessoa"} · `}{assignment.dueAt ? formatChecklistDueDate(assignment.dueAt) : "Sem prazo"}</small></div><b className="assignment-count">{completed}/{assignment.items.length}</b></div>
    <div className="assignment-progress-track" role="progressbar" aria-label={`Progresso de ${assignment.name}`} aria-valuemin={0} aria-valuemax={assignment.items.length} aria-valuenow={completed}><span style={{ width: `${progressPercent}%` }}/></div>
    <div className="assignment-items">{assignment.items.map((item) => { const result = itemResults.get(item.id); const checked = result?.status === "COMPLETED"; return <label className="check-item" key={item.id}><input type="checkbox" checked={checked} disabled={!own && !admin} onChange={(event) => { const next = event.target.checked; const nextCompleted = completed + (next ? 1 : -1); void execute(async () => { await saveChecklistResult({ companyId: data.company.id ?? "", assignmentId: assignment.id, itemId: item.id, complete: next, observation: result?.observation }); await updateAssignmentStatus(data.company.id ?? "", assignment.id, nextCompleted >= assignment.items.length ? "COMPLETED" : "PENDING"); }, "Progresso salvo."); }}/><span>{item.description}</span></label>; })}</div>
  </article>;
}

function CompanyPage({ data, execute }: { data: WorkspaceData; execute: (operation: () => Promise<unknown>, message: string) => Promise<boolean> }) {
  const [name, setName] = useState(data.company.name);
  const [copied, setCopied] = useState(false);
  return <><PageHeading eyebrow="DADOS DA EMPRESA" title="Empresa" subtitle="Identificação usada para associar as contas e os registros."/><div className="live-panel settings-card"><div className="live-panel-heading"><div><span className="eyebrow">IDENTIFICAÇÃO</span><h2>Dados da empresa</h2></div></div><form className="stack-form" onSubmit={async (event) => { event.preventDefault(); await execute(() => updateCompanyName(data.company.id ?? "", name), "Nome da empresa atualizado."); }}><label>Nome<input required minLength={2} maxLength={100} value={name} onChange={(event) => setName(event.target.value)}/></label><button className="button button-primary">Salvar nome</button></form><div className="company-id-box"><span><small>ID DA EMPRESA</small><code>{data.company.id}</code></span><button className="button button-outline button-small" onClick={async () => { await navigator.clipboard.writeText(data.company.id ?? ""); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }}>{copied ? "Copiado" : "Copiar ID"}</button></div><p className="subtle-note">Este ID identifica a empresa e é usado para vincular novos cadastros a ela.</p></div></>;
}

function EvaluationDetailsDialog({ item, data, onClose }: { item: EvaluationWithId; data: WorkspaceData; onClose: () => void }) {
  const [answers, setAnswers] = useState<Array<{ id: string; criterionId: string; score: number }> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    loadEvaluationAnswers(data.company.id ?? "", item.id)
      .then((loaded) => { if (active) setAnswers(loaded); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Falha ao carregar respostas."); });
    return () => { active = false; };
  }, [data.company.id, item.id]);
  const evaluator = data.members.find((member) => member.uid === item.evaluatorId);
  const evaluatee = data.members.find((member) => member.uid === item.evaluatedUserId);
  return <Modal title="Detalhes da avaliação" onClose={onClose} actions={<button type="button" className="button button-outline" onClick={onClose}>Fechar</button>}>
    <div className="evaluation-detail-heading"><span>{item.type === "LEADER" ? "Feedback sobre liderança" : "Desempenho de colaborador"}</span><b>{evaluator?.name ?? "Pessoa"} → {evaluatee?.name ?? "Pessoa"}</b><small>Média: {item.averageScore?.toFixed(2) ?? "—"} / 5</small></div>
    {error && <p className="form-alert error" role="alert">{error}</p>}
    {answers ? <div className="evaluation-detail-list">{answers.map((answer) => <div key={answer.id}><span>{data.criteria.find((criterion) => criterion.id === answer.criterionId)?.name ?? "Critério"}</span><b>{answer.score} / 5</b></div>)}</div> : <p>Carregando respostas…</p>}
    {item.comment && <div className="evaluation-detail-comment"><b>Comentário</b><p>{item.comment}</p></div>}
  </Modal>;
}

function EvaluationListItem({ item, data, detailed = false, onOpen }: { item: EvaluationWithId; data: WorkspaceData; detailed?: boolean; onOpen?: () => void }) {
  const evaluator = data.members.find((member) => member.uid === item.evaluatorId);
  const evaluatee = data.members.find((member) => member.uid === item.evaluatedUserId);
  return <div className="evaluation-row"><span className="evaluation-row-type">{item.type === "LEADER" ? "Liderança" : "Desempenho"}</span><span className="evaluation-row-copy"><b>{evaluator?.name ?? "Pessoa"} → {evaluatee?.name ?? "Pessoa"}</b><small>{data.cycles.find((cycle) => cycle.id === item.cycleId)?.name ?? "Ciclo"}</small></span><strong>{item.averageScore?.toFixed(2) ?? "—"}</strong>{detailed && <button className="text-link" onClick={onOpen}>Detalhes ↗</button>}</div>;
}

function PageHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return <div className="live-page-heading"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div>;
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <article className="live-stat"><small>{label}</small><b>{value}</b><span>{hint}</span></article>;
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="live-empty"><span>○</span><b>{title}</b><p>{text}</p></div>;
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase();
}

function isCycleAvailable(cycle: WorkspaceData["cycles"][number]) {
  if (cycle.status !== "OPEN") return false;
  const todayString = localDateString();
  return (!cycle.startsAt || cycle.startsAt <= todayString) &&
    (!cycle.endsAt || cycle.endsAt >= todayString);
}

function getPendingEvaluationCount(data: WorkspaceData) {
  if (data.member.role === "ADMIN") return 0;
  const cycle = data.cycles.find(isCycleAvailable);
  if (!cycle) return 0;
  const targetRole: FirebaseRole = data.member.role === "LEADER" ? "EMPLOYEE" : "LEADER";
  const evaluationType: FirebaseEvaluationType = data.member.role === "LEADER" ? "EMPLOYEE" : "LEADER";
  const submittedTargets = new Set(data.evaluations
    .filter((item) => item.status === "SUBMITTED" && item.cycleId === cycle.id && item.type === evaluationType)
    .map((item) => item.evaluatedUserId));
  return data.members.filter((person) =>
    person.status === "ACTIVE" &&
    person.role === targetRole &&
    !submittedTargets.has(person.uid),
  ).length;
}

function getPendingChecklistCount(data: WorkspaceData, uid: string) {
  return data.assignments.filter((assignment) =>
    assignment.assignedToId === uid &&
    !isChecklistCompleted(assignment, data.results[assignment.id] ?? []),
  ).length;
}

function cycleStatusLabel(cycle: WorkspaceData["cycles"][number]) {
  if (cycle.status === "CLOSED") return "Fechado";
  if (cycle.status === "DRAFT") return "Rascunho";
  const today = localDateString();
  if (cycle.startsAt && cycle.startsAt > today) return "Agendado";
  if (cycle.endsAt && cycle.endsAt < today) return "Período encerrado";
  return "Aberto";
}

function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getChecklistPublicationDate(publishOn: "TODAY" | "TOMORROW") {
  const date = new Date();
  if (publishOn === "TOMORROW") date.setDate(date.getDate() + 1);
  return localDateString(date);
}

function mean(values: number[]) {
  return values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2) : "—";
}
