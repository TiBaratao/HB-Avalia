"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowsClockwise, Buildings, ChartBar, CheckCircle, House, List, LockKey, SignOut, UsersThree } from "@phosphor-icons/react";
import dynamic from "next/dynamic";
import { CompanyLogo } from "./CompanyLogo";
import type { DirectorChartEvent } from "./DirectorBIChart";
import { ThemeToggle } from "./ThemeProvider";
import type { EChartsOption } from "echarts";
import {
  cancelInvitation,
  createStoreAdminInvitation,
  fetchInvitations,
  fetchOrganizationManagement,
  resendInvitation,
  transferOrganizationMember,
  type DirectorAccess,
  type DirectorStoreAccess,
  type InvitationSummary,
  type OrganizationManagement,
} from "../lib/invitations-client";

const DirectorBIChart = dynamic(
  () => import("./DirectorBIChart").then((module) => module.DirectorBIChart),
  { ssr: false, loading: () => <div className="director-chart-loading" aria-label="Carregando gráfico" /> },
);

function storeAvailabilityLabel(store: DirectorStoreAccess) {
  if (store.status !== "ACTIVE") return "Unidade inativa";
  if (store.companyMappingStatus !== "CONFIRMED") return "Vínculo de dados pendente";
  if (!store.operationalAccessReady) return "Empresa da unidade não provisionada";
  return "Unidade disponível";
}

function formatInvitationDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(date);
}

function roleLabel(role: InvitationSummary["role"]) {
  return role === "ADMIN" ? "Administradora" : role === "LEADER" ? "Liderança" : "Colaboradora";
}

function statusLabel(status: InvitationSummary["status"]) {
  return status === "PENDING" ? "Pendente" : status === "ACCEPTED" ? "Aceito" : status === "CANCELED" ? "Cancelado" : "Expirado";
}

function formatMetric(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function formatScore(value: number | null) {
  return value == null ? "—" : value.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function isWithinPeriod(value: string | null, start: string, end: string) {
  if (!start && !end) return true;
  if (!value) return false;
  const month = value.slice(0, 7);
  return (!start || month >= start) && (!end || month <= end);
}

function average(values: number[]) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function classifyScore(score: number) {
  const percent = score * 20;
  if (percent >= 90) return "Excelente";
  if (percent >= 80) return "Bom";
  if (percent >= 70) return "Regular";
  return "Insuficiente";
}

function formatMonth(month: string) {
  const date = new Date(`${month}-01T12:00:00`);
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" }).format(date);
}

function chartScore(value: unknown) {
  return typeof value === "number" ? `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} / 5` : String(value ?? "—");
}

function chartTooltipDetails(params: unknown) {
  const entries = Array.isArray(params) ? params : [params];
  return entries.map((entry) => {
    if (!entry || typeof entry !== "object") return "";
    const item = entry as Record<string, unknown>;
    const data = item.data && typeof item.data === "object" ? item.data as Record<string, unknown> : null;
    const count = data && typeof data.count === "number" ? ` · ${formatMetric(data.count)} respostas` : "";
    const marker = typeof item.marker === "string" ? item.marker : "";
    const seriesName = typeof item.seriesName === "string" ? item.seriesName : "Valor";
    const name = typeof item.name === "string" ? `${item.name}: ` : "";
    return `${marker}${seriesName} · ${name}${chartScore(item.value)}${count}`;
  }).filter(Boolean).join("\n");
}

function emptyChartGraphic(text: string) {
  return {
    type: "text" as const,
    left: "center" as const,
    top: "middle" as const,
    silent: true,
    style: { text, fill: "#7b8580", fontSize: 13 },
  };
}

const chartColors = ["#1e674b", "#8271d1", "#d8923b", "#5182a6", "#b65d52", "#69a69a"];

function exportCsv(filename: string, headers: string[], rows: string[][]) {
  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const csv = [headers, ...rows].map((row) => row.map(escape).join(";")).join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function DirectorStoreSelector({
  access,
  accountEmail,
  onSignOut,
}: {
  access: DirectorAccess;
  accountEmail: string;
  onSignOut: () => void;
}) {
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [management, setManagement] = useState<OrganizationManagement | null>(null);
  const [managementLoading, setManagementLoading] = useState(true);
  const [managementError, setManagementError] = useState("");
  const [invitations, setInvitations] = useState<InvitationSummary[]>([]);
  const [invitationEmail, setInvitationEmail] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [transferMemberUid, setTransferMemberUid] = useState("");
  const [targetStoreId, setTargetStoreId] = useState("");
  const [targetTeamIds, setTargetTeamIds] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("dashboard");
  const [activeLabel, setActiveLabel] = useState("Dashboard");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [comparisonStart, setComparisonStart] = useState("");
  const [comparisonEnd, setComparisonEnd] = useState("");
  const [departmentFilterId, setDepartmentFilterId] = useState("");
  const [teamFilterId, setTeamFilterId] = useState("");
  const [personFilterId, setPersonFilterId] = useState("");
  const [classificationFilter, setClassificationFilter] = useState("");
  const [chartMonthFilter, setChartMonthFilter] = useState("");
  const [competencyFilterId, setCompetencyFilterId] = useState("");
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    if (window.matchMedia("(max-width: 900px)").matches) menuButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
        return;
      }
      if (event.key === "Tab") {
        const focusableElements = drawerRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (!focusableElements?.length) return;
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];
        if (event.shiftKey && document.activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
        } else if (!event.shiftKey && document.activeElement === lastElement) {
          event.preventDefault();
          firstElement.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("menu-open");
    drawerRef.current?.querySelector<HTMLElement>("nav button")?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("menu-open");
    };
  }, [closeMenu, menuOpen]);

  function navigateToSection(section: string, label: string) {
    setActiveSection(section);
    setActiveLabel(label);
    closeMenu();
    document.getElementById("director-overview")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const refreshManagement = useCallback(async () => {
    setManagementLoading(true);
    try {
      setManagement(await fetchOrganizationManagement());
      setManagementError("");
    } catch (reason) {
      setManagementError(reason instanceof Error ? reason.message : "Não foi possível carregar as lojas.");
    } finally {
      setManagementLoading(false);
    }
  }, []);

  useEffect(() => { void refreshManagement(); }, [refreshManagement]);

  const selectedStore = access.stores.find((store) => store.storeId === selectedStoreId);
  const operationalStores = useMemo(() =>
    management?.stores.filter((store) => store.status === "ACTIVE" && store.operationalAccessReady) ?? [],
  [management]);
  const selectedStoreManagement = useMemo(
    () => management?.stores.find((store) => store.storeId === selectedStoreId),
    [management, selectedStoreId],
  );
  const transferableMembers = useMemo(
    () => selectedStoreManagement?.members ?? [],
    [selectedStoreManagement],
  );
  const transferMember = transferableMembers.find((member) => member.uid === transferMemberUid);
  const targetStore = operationalStores.find((store) => store.storeId === targetStoreId);

  useEffect(() => {
    let active = true;
    setInvitations([]);
    if (!selectedStoreManagement || !selectedStoreManagement.operationalAccessReady) return () => { active = false; };
    fetchInvitations(selectedStoreManagement.companyId, selectedStoreManagement.storeId)
      .then((result) => { if (active) setInvitations(result); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Não foi possível carregar os convites."); });
    return () => { active = false; };
  }, [selectedStoreManagement]);

  useEffect(() => {
    if (!transferMemberUid) return;
    if (!transferableMembers.some((member) => member.uid === transferMemberUid)) {
      setTransferMemberUid("");
      setTargetStoreId("");
      setTargetTeamIds([]);
    }
  }, [transferMemberUid, transferableMembers]);

  const availableTargets = useMemo(
    () => operationalStores.filter((store) => store.storeId !== selectedStoreId),
    [operationalStores, selectedStoreId],
  );

  const reportStores = useMemo(
    () => operationalStores.filter((store) => !selectedStoreId || store.storeId === selectedStoreId),
    [operationalStores, selectedStoreId],
  );
  const departmentOptions = useMemo(() => reportStores.flatMap((store) =>
    store.departments.map((department) => ({
      id: `${store.storeId}:${department.departmentId}`,
      name: `${store.name} · ${department.name}`,
    }))),
  [reportStores]);
  const teamOptions = useMemo(() => reportStores.flatMap((store) =>
    store.teams.map((team) => ({
      id: `${store.storeId}:${team.teamId}`,
      name: `${store.name} · ${team.name}`,
    }))),
  [reportStores]);
  const filteredEvaluationRecords = useMemo(() => reportStores.flatMap((store) =>
    store.analytics.evaluationRecords
      .filter((record) => isWithinPeriod(record.submittedAt, periodStart, periodEnd))
      .filter((record) => !chartMonthFilter || record.submittedAt?.slice(0, 7) === chartMonthFilter)
      .filter((record) => !teamFilterId || (store.storeId === teamFilterId.split(":")[0]
        && record.teamIds.includes(teamFilterId.split(":").slice(1).join(":"))))
      .filter((record) => !departmentFilterId || (store.storeId === departmentFilterId.split(":")[0]
        && record.departmentIds.includes(departmentFilterId.split(":").slice(1).join(":"))))
      .filter((record) => !personFilterId || record.evaluatedUserId === personFilterId)
      .filter((record) => !classificationFilter || classifyScore(record.score) === classificationFilter)
      .filter((record) => !competencyFilterId || record.competencies.some((competency) => competency.criterionId === competencyFilterId))
      .map((record) => ({ ...record, storeId: store.storeId, storeName: store.name })),
  ), [chartMonthFilter, classificationFilter, competencyFilterId, departmentFilterId, periodEnd, periodStart, personFilterId, reportStores, teamFilterId]);
  const filteredFeedbackRecords = useMemo(() => reportStores.flatMap((store) =>
    store.analytics.feedbackRecords
      .filter((record) => isWithinPeriod(record.submittedAt, periodStart, periodEnd))
      .filter((record) => !chartMonthFilter || record.submittedAt?.slice(0, 7) === chartMonthFilter)
      .map((record) => ({ ...record, storeId: store.storeId, storeName: store.name })),
  ), [chartMonthFilter, periodEnd, periodStart, reportStores]);
  const filteredMembers = useMemo(() => reportStores.flatMap((store) =>
    store.members
      .filter((member) => !teamFilterId || store.storeId === teamFilterId.split(":")[0]
        && member.teamIds.includes(teamFilterId.split(":").slice(1).join(":")))
      .filter((member) => !departmentFilterId || store.storeId === departmentFilterId.split(":")[0]
        && member.teamIds.some((teamId) => store.teams.some((team) =>
          team.teamId === teamId && team.departmentId === departmentFilterId.split(":").slice(1).join(":"))))
      .filter((member) => !personFilterId || member.uid === personFilterId)
      .map((member) => ({ ...member, storeId: store.storeId, storeName: store.name })),
  ), [departmentFilterId, personFilterId, reportStores, teamFilterId]);
  const filteredPdis = useMemo(() => reportStores.flatMap((store) =>
    store.analytics.pdiRecords
      .filter((pdi) => !teamFilterId || store.storeId === teamFilterId.split(":")[0]
        && pdi.teamIds.includes(teamFilterId.split(":").slice(1).join(":")))
      .filter((pdi) => !departmentFilterId || store.storeId === departmentFilterId.split(":")[0]
        && pdi.departmentIds.includes(departmentFilterId.split(":").slice(1).join(":")))
      .filter((pdi) => !personFilterId || pdi.employeeId === personFilterId)
      .map((pdi) => ({ ...pdi, storeId: store.storeId, storeName: store.name })),
  ), [departmentFilterId, personFilterId, reportStores, teamFilterId]);
  const classificationCounts = useMemo(() => {
    const counts: Record<string, number> = { Excelente: 0, Bom: 0, Regular: 0, Insuficiente: 0 };
    for (const record of filteredEvaluationRecords) counts[classifyScore(record.score)] += 1;
    return counts;
  }, [filteredEvaluationRecords]);
  const evaluationAverage = useMemo(() => average(filteredEvaluationRecords.map((record) => record.score)), [filteredEvaluationRecords]);
  const customerAverage = useMemo(() => average(filteredFeedbackRecords.map((record) => record.overallRating)), [filteredFeedbackRecords]);
  const monthlyTrend = useMemo(() => {
    const groups = new Map<string, number[]>();
    filteredEvaluationRecords.forEach((record) => {
      if (!record.submittedAt) return;
      const month = record.submittedAt.slice(0, 7);
      groups.set(month, [...(groups.get(month) ?? []), record.score]);
    });
    return [...groups].sort(([first], [second]) => first.localeCompare(second))
      .map(([month, values]) => ({ month, average: average(values) ?? 0, count: values.length }));
  }, [filteredEvaluationRecords]);
  const comparisonEvaluationRecords = useMemo(() => {
    if (!comparisonStart && !comparisonEnd) return [];
    return reportStores.flatMap((store) =>
    store.analytics.evaluationRecords
      .filter((record) => isWithinPeriod(record.submittedAt, comparisonStart, comparisonEnd))
      .filter((record) => !teamFilterId || (store.storeId === teamFilterId.split(":")[0]
        && record.teamIds.includes(teamFilterId.split(":").slice(1).join(":"))))
      .filter((record) => !departmentFilterId || (store.storeId === departmentFilterId.split(":")[0]
        && record.departmentIds.includes(departmentFilterId.split(":").slice(1).join(":"))))
      .filter((record) => !personFilterId || record.evaluatedUserId === personFilterId)
      .filter((record) => !classificationFilter || classifyScore(record.score) === classificationFilter)
      .filter((record) => !competencyFilterId || record.competencies.some((competency) => competency.criterionId === competencyFilterId))
      .map((record) => ({ ...record, storeId: store.storeId, storeName: store.name })),
    );
  }, [classificationFilter, comparisonEnd, comparisonStart, competencyFilterId, departmentFilterId, personFilterId, reportStores, teamFilterId]);
  const departmentAverages = useMemo(() => {
    const groups = new Map<string, { id: string; name: string; scores: number[] }>();
    filteredEvaluationRecords.forEach((record) => record.departmentIds.forEach((departmentId) => {
      const groupKey = `${record.storeId}:${departmentId}`;
      const name = departmentOptions.find((item) => item.id === groupKey)?.name ?? departmentId;
      groups.set(groupKey, { id: groupKey, name, scores: [...(groups.get(groupKey)?.scores ?? []), record.score] });
    }));
    return [...groups.values()].map(({ id, name, scores }) => ({ id, name, average: average(scores) ?? 0, count: scores.length }))
      .sort((first, second) => second.average - first.average);
  }, [departmentOptions, filteredEvaluationRecords]);
  const comparisonRows = useMemo(() => reportStores.map((store) => {
    const records = filteredEvaluationRecords.filter((record) => record.storeId === store.storeId);
    const feedback = filteredFeedbackRecords.filter((record) => record.storeId === store.storeId);
    const staff = filteredMembers.filter((member) => member.storeId === store.storeId);
    return {
      store,
      records,
      feedback,
      staff,
      average: average(records.map((record) => record.score)),
      evaluatedPeople: new Set(records.map((record) => record.evaluatedUserId)).size,
    };
  }), [filteredEvaluationRecords, filteredFeedbackRecords, filteredMembers, reportStores]);
  const reportRows = useMemo(() => {
    const groups = new Map<string, {
      uid: string;
      storeName: string;
      name: string;
      role: string;
      teamLabels: string;
      scores: number[];
    }>();
    filteredEvaluationRecords.forEach((record) => {
      const key = `${record.storeId}:${record.evaluatedUserId}`;
      const store = management?.stores.find((item) => item.storeId === record.storeId);
      const teamLabels = record.teamIds.map((id) => store?.teams.find((team) => team.teamId === id)?.name)
        .filter((name): name is string => Boolean(name)).join(", ");
      const group = groups.get(key) ?? {
        uid: record.evaluatedUserId,
        storeName: record.storeName,
        name: record.evaluatedUserName,
        role: record.evaluatedUserRole ? roleLabel(record.evaluatedUserRole) : "—",
        teamLabels,
        scores: [],
      };
      group.scores.push(record.score);
      groups.set(key, group);
    });
    return [...groups.values()].map((group) => ({
      ...group,
      averageScore: average(group.scores) ?? 0,
      evaluations: group.scores.length,
    })).sort((first, second) => first.name.localeCompare(second.name, "pt-BR"));
  }, [filteredEvaluationRecords, management?.stores]);
  const feedbackTrend = useMemo(() => {
    const groups = new Map<string, number[]>();
    filteredFeedbackRecords.forEach((record) => {
      if (!record.submittedAt) return;
      const month = record.submittedAt.slice(0, 7);
      groups.set(month, [...(groups.get(month) ?? []), record.overallRating]);
    });
    return [...groups].sort(([first], [second]) => first.localeCompare(second))
      .map(([month, values]) => ({ month, average: average(values) ?? 0, count: values.length }));
  }, [filteredFeedbackRecords]);
  const filteredTeamAverages = useMemo(() => {
    const groups = new Map<string, { id: string; name: string; scores: number[] }>();
    filteredEvaluationRecords.forEach((record) => record.teamIds.forEach((teamId) => {
      const groupKey = `${record.storeId}:${teamId}`;
      const name = teamOptions.find((item) => item.id === groupKey)?.name ?? teamId;
      groups.set(groupKey, { id: groupKey, name, scores: [...(groups.get(groupKey)?.scores ?? []), record.score] });
    }));
    return [...groups.values()].map(({ id, name, scores }) => ({ id, name, average: average(scores) ?? 0, count: scores.length }))
      .sort((first, second) => second.average - first.average);
  }, [filteredEvaluationRecords, teamOptions]);
  const competencyAverages = useMemo(() => {
    const groups = new Map<string, { name: string; scores: number[] }>();
    filteredEvaluationRecords.forEach((record) => record.competencies.forEach((competency) => {
      const current = groups.get(competency.criterionId) ?? { name: competency.criterionName, scores: [] };
      current.scores.push(competency.score);
      groups.set(competency.criterionId, current);
    }));
    return [...groups].map(([id, group]) => ({ id, name: group.name, average: average(group.scores) ?? 0, count: group.scores.length }))
      .sort((first, second) => second.average - first.average);
  }, [filteredEvaluationRecords]);
  const peopleRanking = useMemo(() => reportRows.map((row) => ({
    id: row.uid,
    name: `${row.name} · ${row.storeName}`,
    average: row.averageScore,
    count: row.evaluations,
  })).sort((first, second) => second.average - first.average), [reportRows]);
  const heatmapData = useMemo(() => {
    const months = [...new Set(filteredEvaluationRecords.map((record) => record.submittedAt?.slice(0, 7)).filter((month): month is string => Boolean(month)))].sort();
    const departments = new Map<string, string>(filteredEvaluationRecords.flatMap((record) => record.departmentIds.map((id) => {
      const store = management?.stores.find((item) => item.storeId === record.storeId);
      const department = store?.departments.find((item) => item.departmentId === id);
      return [`${record.storeId}:${id}`, `${store?.name ?? ""} · ${department?.name ?? id}`] as [string, string];
    })));
    const departmentKeys = [...departments.keys()];
    const labels = [...departments.values()];
    const departmentIndexes = new Map<string, number>(departmentKeys.map((key, index) => [key, index]));
    const cells = new Map<string, { total: number; count: number }>();
    filteredEvaluationRecords.forEach((record) => {
      const submittedAt = record.submittedAt;
      if (!submittedAt) return;
      record.departmentIds.forEach((departmentId) => {
        const key = `${submittedAt.slice(0, 7)}|${record.storeId}:${departmentId}`;
        const cell = cells.get(key) ?? { total: 0, count: 0 };
        cell.total += record.score;
        cell.count += 1;
        cells.set(key, cell);
      });
    });
    const values = [...cells].flatMap(([key, cell]) => {
      const [month, departmentId] = key.split("|");
      const monthIndex = months.indexOf(month);
      const departmentIndex = departmentIndexes.get(departmentId) ?? -1;
      return monthIndex >= 0 && departmentIndex >= 0
        ? [[monthIndex, departmentIndex, Number((cell.total / cell.count).toFixed(2)), cell.count] as [number, number, number, number]]
        : [];
    });
    return { months, departmentKeys, labels, values };
  }, [filteredEvaluationRecords, management?.stores]);
  const performanceComparisonRows = useMemo(() => reportStores.map((store) => {
    const current = filteredEvaluationRecords.filter((record) => record.storeId === store.storeId);
    const comparison = comparisonEvaluationRecords.filter((record) => record.storeId === store.storeId);
    return {
      store,
      currentAverage: average(current.map((record) => record.score)),
      comparisonAverage: average(comparison.map((record) => record.score)),
      currentCount: current.length,
      comparisonCount: comparison.length,
    };
  }), [comparisonEvaluationRecords, filteredEvaluationRecords, reportStores]);
  const monthlyStoreCounts = useMemo(() => {
    const months = [...new Set(filteredEvaluationRecords.map((record) => record.submittedAt?.slice(0, 7))
      .filter((month): month is string => Boolean(month)))].sort();
    const stores = reportStores.map((store) => ({
      store,
      counts: months.map((month) => filteredEvaluationRecords.filter((record) =>
        record.storeId === store.storeId && record.submittedAt?.slice(0, 7) === month).length),
    }));
    return { months, stores };
  }, [filteredEvaluationRecords, reportStores]);
  const performanceTrendOption = useMemo<EChartsOption>(() => ({
    animationDuration: 350,
    graphic: monthlyTrend.length ? undefined : emptyChartGraphic("Sem avaliações no período"),
    color: chartColors,
    tooltip: { trigger: "axis", renderMode: "richText", formatter: chartTooltipDetails, axisPointer: { type: "cross" } },
    legend: { top: 0, selectedMode: true },
    grid: { left: 44, right: 20, top: 42, bottom: 76, containLabel: true },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: monthlyTrend.map((point) => point.month),
      axisLabel: { color: "#7b8580", formatter: (value: string) => formatMonth(value), hideOverlap: true },
      axisLine: { lineStyle: { color: "#d9e2dc" } },
    },
    yAxis: { type: "value", min: 0, max: 5, interval: 1, name: "Nota (1–5)", nameTextStyle: { color: "#7b8580" }, splitLine: { lineStyle: { color: "#e9efeb" } } },
    dataZoom: [{ type: "inside", filterMode: "none" }, { type: "slider", height: 18, bottom: 14, borderColor: "transparent", backgroundColor: "#e9efeb", fillerColor: "rgba(30,103,75,.18)", handleStyle: { color: "#1e674b" } }],
    series: [{
      name: "Média de desempenho",
      type: "line",
      smooth: 0.25,
      showSymbol: true,
      symbolSize: 8,
      connectNulls: false,
      data: monthlyTrend.map((point) => ({ value: Number(point.average.toFixed(2)), count: point.count })),
      lineStyle: { width: 3 },
      areaStyle: { opacity: 0.08 },
      emphasis: { focus: "series" },
    }],
  }), [monthlyTrend]);
  const comparisonOption = useMemo<EChartsOption>(() => ({
    animationDuration: 350,
    graphic: comparisonStart || comparisonEnd ? undefined : emptyChartGraphic("Selecione o período de comparação nos filtros"),
    color: chartColors,
    tooltip: { trigger: "axis", renderMode: "richText", formatter: chartTooltipDetails, axisPointer: { type: "shadow" } },
    legend: { top: 0, selectedMode: true },
    grid: { left: 42, right: 18, top: 40, bottom: 30, containLabel: true },
    xAxis: { type: "category", data: performanceComparisonRows.map((row) => row.store.name), axisLabel: { color: "#66736c", interval: 0, rotate: performanceComparisonRows.length > 3 ? 18 : 0 }, axisLine: { lineStyle: { color: "#d9e2dc" } } },
    yAxis: { type: "value", min: 0, max: 5, interval: 1, name: "Nota (1–5)", splitLine: { lineStyle: { color: "#e9efeb" } } },
    series: [
      { name: "Período atual", type: "bar", barMaxWidth: 42, data: performanceComparisonRows.map((row) => row.currentAverage == null ? null : { value: Number(row.currentAverage.toFixed(2)), count: row.currentCount }) },
      { name: "Período comparado", type: "bar", barMaxWidth: 42, data: performanceComparisonRows.map((row) => row.comparisonAverage == null ? null : { value: Number(row.comparisonAverage.toFixed(2)), count: row.comparisonCount }) },
    ],
  }), [comparisonEnd, comparisonStart, performanceComparisonRows]);
  const storeComparisonOption = useMemo<EChartsOption>(() => ({
    animationDuration: 350,
    graphic: comparisonRows.length ? undefined : emptyChartGraphic("Sem unidades disponíveis"),
    color: [chartColors[0], chartColors[2]],
    tooltip: { trigger: "axis", renderMode: "richText", formatter: chartTooltipDetails, axisPointer: { type: "shadow" } },
    legend: { top: 0, selectedMode: true },
    grid: { left: 42, right: 18, top: 40, bottom: 30, containLabel: true },
    xAxis: { type: "category", data: comparisonRows.map((row) => row.store.name), axisLabel: { color: "#66736c", interval: 0, rotate: comparisonRows.length > 3 ? 18 : 0 }, axisLine: { lineStyle: { color: "#d9e2dc" } } },
    yAxis: { type: "value", min: 0, max: 5, interval: 1, name: "Nota (1–5)", splitLine: { lineStyle: { color: "#e9efeb" } } },
    series: [
      { name: "Desempenho médio", type: "bar", barMaxWidth: 42, data: comparisonRows.map((row) => row.average == null ? null : { value: Number(row.average.toFixed(2)), count: row.records.length }) },
      { name: "Satisfação média", type: "bar", barMaxWidth: 42, data: comparisonRows.map((row) => ({ value: average(row.feedback.map((record) => record.overallRating)), count: row.feedback.length })) },
    ],
  }), [comparisonRows]);
  const classificationOption = useMemo<EChartsOption>(() => ({
    animationDuration: 350,
    graphic: filteredEvaluationRecords.length ? undefined : emptyChartGraphic("Sem avaliações classificadas"),
    color: [chartColors[0]],
    tooltip: { trigger: "axis", renderMode: "richText", formatter: chartTooltipDetails, axisPointer: { type: "shadow" } },
    grid: { left: 12, right: 34, top: 12, bottom: 12, containLabel: true },
    xAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: "#e9efeb" } } },
    yAxis: { type: "category", inverse: true, data: Object.keys(classificationCounts), axisLabel: { color: "#66736c" }, axisLine: { show: false } },
    series: [{
      name: "Avaliações",
      type: "bar",
      barMaxWidth: 24,
      showBackground: true,
      backgroundStyle: { color: "#edf2ee", borderRadius: 4 },
      itemStyle: { borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: "right" },
      data: Object.entries(classificationCounts).map(([name, value]) => ({ name, value })),
    }],
  }), [classificationCounts, filteredEvaluationRecords.length]);
  const departmentRankingOption = useMemo<EChartsOption>(() => ({
    animationDuration: 350,
    graphic: departmentAverages.length ? undefined : emptyChartGraphic("Sem avaliações por setor"),
    color: [chartColors[0]],
    tooltip: { trigger: "axis", renderMode: "richText", formatter: chartTooltipDetails, axisPointer: { type: "shadow" } },
    grid: { left: 12, right: 44, top: 12, bottom: 12, containLabel: true },
    xAxis: { type: "value", min: 0, max: 5, interval: 1, splitLine: { lineStyle: { color: "#e9efeb" } } },
    yAxis: { type: "category", inverse: true, data: departmentAverages.map((item) => item.name), axisLabel: { color: "#66736c", width: 180, overflow: "truncate" }, axisLine: { show: false } },
    series: [{ name: "Média", type: "bar", barMaxWidth: 22, showBackground: true, backgroundStyle: { color: "#edf2ee", borderRadius: 4 }, itemStyle: { borderRadius: [0, 4, 4, 0] }, label: { show: true, position: "right", formatter: (params) => formatScore(typeof params.value === "number" ? params.value : null) }, data: departmentAverages.map((item) => ({ name: item.name, value: Number(item.average.toFixed(2)), count: item.count })) }],
  }), [departmentAverages]);
  const teamRankingOption = useMemo<EChartsOption>(() => ({
    animationDuration: 350,
    graphic: filteredTeamAverages.length ? undefined : emptyChartGraphic("Sem avaliações por equipe"),
    color: [chartColors[1]],
    tooltip: { trigger: "axis", renderMode: "richText", formatter: chartTooltipDetails, axisPointer: { type: "shadow" } },
    grid: { left: 12, right: 44, top: 12, bottom: 12, containLabel: true },
    xAxis: { type: "value", min: 0, max: 5, interval: 1, splitLine: { lineStyle: { color: "#e9efeb" } } },
    yAxis: { type: "category", inverse: true, data: filteredTeamAverages.map((item) => item.name), axisLabel: { color: "#66736c", width: 180, overflow: "truncate" }, axisLine: { show: false } },
    series: [{ name: "Média", type: "bar", barMaxWidth: 22, showBackground: true, backgroundStyle: { color: "#edf2ee", borderRadius: 4 }, itemStyle: { borderRadius: [0, 4, 4, 0] }, label: { show: true, position: "right", formatter: (params) => formatScore(typeof params.value === "number" ? params.value : null) }, data: filteredTeamAverages.map((item) => ({ name: item.name, value: Number(item.average.toFixed(2)), count: item.count })) }],
  }), [filteredTeamAverages]);
  const personRankingOption = useMemo<EChartsOption>(() => ({
    animationDuration: 350,
    graphic: peopleRanking.length ? undefined : emptyChartGraphic("Sem colaboradores avaliados"),
    color: [chartColors[2]],
    tooltip: { trigger: "axis", renderMode: "richText", formatter: chartTooltipDetails, axisPointer: { type: "shadow" } },
    grid: { left: 12, right: 44, top: 12, bottom: 12, containLabel: true },
    xAxis: { type: "value", min: 0, max: 5, interval: 1, splitLine: { lineStyle: { color: "#e9efeb" } } },
    yAxis: { type: "category", inverse: true, data: peopleRanking.slice(0, 12).map((person) => person.name), axisLabel: { color: "#66736c", width: 180, overflow: "truncate" }, axisLine: { show: false } },
    series: [{ name: "Média", type: "bar", barMaxWidth: 20, showBackground: true, backgroundStyle: { color: "#edf2ee", borderRadius: 4 }, itemStyle: { borderRadius: [0, 4, 4, 0] }, data: peopleRanking.slice(0, 12).map((person) => ({ name: person.name, value: Number(person.average.toFixed(2)), count: person.count })) }],
  }), [peopleRanking]);
  const competencyOption = useMemo<EChartsOption>(() => ({
    animationDuration: 350,
    graphic: competencyAverages.length ? undefined : emptyChartGraphic("Respostas por competência não disponíveis"),
    color: [chartColors[3]],
    tooltip: {
      trigger: "item",
      renderMode: "richText",
      formatter: (params) => {
        const item = Array.isArray(params) ? params[0] : params;
        if (!item || typeof item !== "object" || !("value" in item)) return "Sem dados";
        const values = item.value;
        if (!Array.isArray(values)) return "Sem dados";
        return competencyAverages.map((competency, index) =>
          `${competency.name}: ${chartScore(values[index])} · ${competency.count} respostas`,
        ).join("\n");
      },
    },
    legend: { top: 0, selectedMode: true },
    radar: {
      indicator: competencyAverages.map((item) => ({ name: item.name, max: 5, min: 0 })),
      shape: "polygon",
      splitNumber: 5,
      axisName: { color: "#66736c", fontSize: 11 },
      splitLine: { lineStyle: { color: ["#e9efeb", "#dfe8e2", "#d4e0d8", "#c9d9cf", "#bdd2c4"] } },
      splitArea: { areaStyle: { color: ["rgba(30,103,75,.015)", "rgba(30,103,75,.045)"] } },
    },
    series: [{ name: "Nota média por competência", type: "radar", data: [{ name: "Média (1–5)", value: competencyAverages.map((item) => Number(item.average.toFixed(2))), areaStyle: { opacity: 0.16 }, lineStyle: { width: 2 }, symbolSize: 5 }] }],
  }), [competencyAverages]);
  const heatmapOption = useMemo<EChartsOption>(() => ({
    animationDuration: 350,
    graphic: heatmapData.values.length ? undefined : emptyChartGraphic("Sem dados suficientes para este cruzamento"),
    tooltip: {
      position: "top",
      renderMode: "richText",
      formatter: (params) => {
        const item = Array.isArray(params) ? params[0] : params;
        if (!item || typeof item !== "object" || !("value" in item) || !Array.isArray(item.value)) return "Sem dados";
        const [monthIndex, departmentIndex, score, count] = item.value;
        if (typeof monthIndex !== "number" || typeof departmentIndex !== "number") return "Sem dados";
        return `${heatmapData.labels[departmentIndex] ?? ""}\n${formatMonth(heatmapData.months[monthIndex] ?? "")}\nMédia: ${chartScore(score)} · ${count} avaliações`;
      },
    },
    grid: { left: 10, right: 18, top: 10, bottom: 46, containLabel: true },
    xAxis: { type: "category", data: heatmapData.months, splitArea: { show: true }, axisLabel: { color: "#66736c", formatter: (value: string) => formatMonth(value), rotate: 24 } },
    yAxis: { type: "category", data: heatmapData.labels, splitArea: { show: true }, axisLabel: { color: "#66736c", width: 140, overflow: "truncate" } },
    visualMap: { min: 1, max: 5, calculable: true, orient: "horizontal", left: "center", bottom: 0, inRange: { color: ["#f2eee1", "#c9ddce", "#1e674b"] }, textStyle: { color: "#66736c" } },
    series: [{ name: "Média de desempenho", type: "heatmap", data: heatmapData.values, label: { show: true, formatter: (params) => Array.isArray(params.value) && typeof params.value[2] === "number" ? params.value[2].toFixed(1) : "", color: "#24362c" }, emphasis: { itemStyle: { shadowBlur: 8, shadowColor: "rgba(0,0,0,.2)" } } }],
  }), [heatmapData]);
  const volumeAreaOption = useMemo<EChartsOption>(() => ({
    animationDuration: 350,
    graphic: monthlyStoreCounts.months.length ? undefined : emptyChartGraphic("Sem avaliações no período"),
    color: chartColors,
    tooltip: { trigger: "axis", renderMode: "richText", formatter: chartTooltipDetails, axisPointer: { type: "cross" } },
    legend: { top: 0, selectedMode: true },
    grid: { left: 42, right: 18, top: 42, bottom: 76, containLabel: true },
    xAxis: { type: "category", boundaryGap: false, data: monthlyStoreCounts.months, axisLabel: { color: "#66736c", formatter: (value: string) => formatMonth(value), hideOverlap: true } },
    yAxis: { type: "value", name: "Avaliações", minInterval: 1, splitLine: { lineStyle: { color: "#e9efeb" } } },
    dataZoom: [{ type: "inside", filterMode: "none" }, { type: "slider", height: 18, bottom: 14, borderColor: "transparent", backgroundColor: "#e9efeb", fillerColor: "rgba(30,103,75,.18)" }],
    series: monthlyStoreCounts.stores.map(({ store, counts }) => ({
      name: store.name,
      type: "line",
      stack: "total",
      smooth: 0.25,
      showSymbol: false,
      areaStyle: { opacity: 0.25 },
      emphasis: { focus: "series" },
      data: counts,
    })),
  }), [monthlyStoreCounts]);
  const customerTrendOption = useMemo<EChartsOption>(() => ({
    animationDuration: 350,
    graphic: feedbackTrend.length ? undefined : emptyChartGraphic("Sem respostas de clientes no período"),
    color: [chartColors[2]],
    tooltip: { trigger: "axis", renderMode: "richText", formatter: chartTooltipDetails, axisPointer: { type: "cross" } },
    grid: { left: 42, right: 18, top: 18, bottom: 42, containLabel: true },
    xAxis: { type: "category", data: feedbackTrend.map((point) => point.month), axisLabel: { color: "#66736c", formatter: (value: string) => formatMonth(value), hideOverlap: true } },
    yAxis: { type: "value", min: 0, max: 5, interval: 1, name: "Satisfação (1–5)", splitLine: { lineStyle: { color: "#e9efeb" } } },
    series: [{ name: "Satisfação média", type: "line", smooth: 0.25, symbolSize: 7, data: feedbackTrend.map((point) => ({ value: Number(point.average.toFixed(2)), count: point.count })), lineStyle: { width: 3 }, areaStyle: { opacity: 0.12 } }],
  }), [feedbackTrend]);
  const pendingEvaluationCount = teamFilterId || departmentFilterId || personFilterId
    || classificationFilter || chartMonthFilter || competencyFilterId
    ? null
    : reportStores.reduce((total, store) => total + store.analytics.indicators.evaluationsPending, 0);
  const pendingDevelopmentGoals = filteredPdis.reduce((total, pdi) => total + pdi.pendingGoals, 0);
  const activeFilterLabels = [
    selectedStoreId ? operationalStores.find((store) => store.storeId === selectedStoreId)?.name : "",
    periodStart || periodEnd ? `${periodStart || "início"} – ${periodEnd || "atual"}` : "",
    comparisonStart || comparisonEnd ? `Comparação: ${comparisonStart || "início"} – ${comparisonEnd || "atual"}` : "",
    departmentFilterId ? departmentOptions.find((item) => item.id === departmentFilterId)?.name : "",
    teamFilterId ? teamOptions.find((item) => item.id === teamFilterId)?.name : "",
    personFilterId ? reportRows.find((row) => row.uid === personFilterId)?.name : "",
    classificationFilter,
    chartMonthFilter ? formatMonth(chartMonthFilter) : "",
    competencyFilterId ? competencyAverages.find((item) => item.id === competencyFilterId)?.name : "",
  ].filter((label): label is string => Boolean(label));
  function clearAnalyticsFilters() {
    setSelectedStoreId("");
    setPeriodStart("");
    setPeriodEnd("");
    setComparisonStart("");
    setComparisonEnd("");
    setDepartmentFilterId("");
    setTeamFilterId("");
    setPersonFilterId("");
    setClassificationFilter("");
    setChartMonthFilter("");
    setCompetencyFilterId("");
  }
  function selectMonth(month: string) {
    setChartMonthFilter((current) => current === month ? "" : month);
  }
  function applyZoomRange(event: DirectorChartEvent, months: string[]) {
    if (!months.length) return;
    const zoom = event.batch?.[0] ?? event;
    const toIndex = (value: number | string | undefined, percentage: number | undefined, fallback: number) => {
      if (typeof value === "number") return Math.max(0, Math.min(months.length - 1, Math.round(value)));
      if (typeof value === "string") {
        const index = months.indexOf(value);
        if (index >= 0) return index;
      }
      if (typeof percentage === "number") return Math.max(0, Math.min(months.length - 1, Math.round((percentage / 100) * (months.length - 1))));
      return fallback;
    };
    const startIndex = toIndex(zoom.startValue, zoom.start, 0);
    const endIndex = toIndex(zoom.endValue, zoom.end, months.length - 1);
    if (startIndex > endIndex) return;
    setChartMonthFilter("");
    setPeriodStart(months[startIndex]);
    setPeriodEnd(months[endIndex]);
  }
  function toggleDepartmentFilter(id: string) {
    setDepartmentFilterId((current) => current === id ? "" : id);
    setTeamFilterId("");
    setPersonFilterId("");
  }
  function toggleTeamFilter(id: string) {
    setTeamFilterId((current) => current === id ? "" : id);
    setDepartmentFilterId("");
    setPersonFilterId("");
  }
  function toggleStoreFilter(name: string) {
    const store = operationalStores.find((item) => item.name === name);
    if (store) setSelectedStoreId((current) => current === store.storeId ? "" : store.storeId);
  }
  const performanceTrendEvents = {
    click: (event: DirectorChartEvent) => { if (event.name) selectMonth(event.name); },
    datazoom: (event: DirectorChartEvent) => applyZoomRange(event, monthlyTrend.map((point) => point.month)),
  };
  const volumeAreaEvents = {
    click: (event: DirectorChartEvent) => {
      if (event.seriesName) toggleStoreFilter(event.seriesName);
      else if (event.name) selectMonth(event.name);
    },
    datazoom: (event: DirectorChartEvent) => applyZoomRange(event, monthlyStoreCounts.months),
  };
  const customerTrendEvents = { click: (event: DirectorChartEvent) => { if (event.name) selectMonth(event.name); } };
  const classificationEvents = {
    click: (event: DirectorChartEvent) => {
      if (event.name) setClassificationFilter((current) => current === event.name ? "" : event.name ?? "");
    },
  };
  const departmentRankingEvents = {
    click: (event: DirectorChartEvent) => {
      const item = typeof event.dataIndex === "number" ? departmentAverages[event.dataIndex] : null;
      if (item) toggleDepartmentFilter(item.id);
    },
  };
  const teamRankingEvents = {
    click: (event: DirectorChartEvent) => {
      const item = typeof event.dataIndex === "number" ? filteredTeamAverages[event.dataIndex] : null;
      if (item) toggleTeamFilter(item.id);
    },
  };
  const personRankingEvents = {
    click: (event: DirectorChartEvent) => {
      const person = typeof event.dataIndex === "number" ? peopleRanking.slice(0, 12)[event.dataIndex] : null;
      if (person?.id) setPersonFilterId((current) => current === person.id ? "" : person.id);
    },
  };
  const comparisonEvents = { click: (event: DirectorChartEvent) => { if (event.name) toggleStoreFilter(event.name); } };
  const competencyEvents = {
    click: (event: DirectorChartEvent) => {
      const item = typeof event.dataIndex === "number" ? competencyAverages[event.dataIndex] : null;
      const competency = item ?? competencyAverages.find((candidate) => candidate.name === event.name);
      if (competency) setCompetencyFilterId((current) => current === competency.id ? "" : competency.id);
    },
  };
  const heatmapEvents = {
    click: (event: DirectorChartEvent) => {
      const value = event.value;
      if (!Array.isArray(value) || typeof value[0] !== "number" || typeof value[1] !== "number") return;
      const month = heatmapData.months[value[0]];
      const departmentId = heatmapData.departmentKeys[value[1]];
      if (month) selectMonth(month);
      if (departmentId) toggleDepartmentFilter(departmentId);
    },
  };
  const reportFilterBar = <div className="director-filter-shell">
    <div className="director-filter-bar">
    <label>Unidade
      <select value={selectedStoreId} onChange={(event) => {
        setSelectedStoreId(event.target.value);
        setDepartmentFilterId("");
        setTeamFilterId("");
        setPersonFilterId("");
      }}>
        <option value="">Todas as unidades</option>
        {operationalStores.map((store) => <option key={store.storeId} value={store.storeId}>{store.name}</option>)}
      </select>
    </label>
    <label>De
      <input type="month" max={periodEnd || undefined} value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />
    </label>
    <label>Até
      <input type="month" min={periodStart || undefined} value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
    </label>
    <label>Setor
      <select value={departmentFilterId} onChange={(event) => {
        setDepartmentFilterId(event.target.value);
        setTeamFilterId("");
        setPersonFilterId("");
      }}>
        <option value="">Todos os setores</option>
        {departmentOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>
    {activeFilterLabels.length > 0 && <button type="button" className="button button-outline button-small" onClick={clearAnalyticsFilters}>Limpar filtros</button>}
    </div>
    <details className="director-filter-advanced">
      <summary>Filtros adicionais <span>Equipe e período para comparação</span></summary>
      <div className="director-filter-extra">
        <label>Equipe
          <select value={teamFilterId} onChange={(event) => {
            setTeamFilterId(event.target.value);
            setDepartmentFilterId("");
            setPersonFilterId("");
          }}>
            <option value="">Todas as equipes</option>
            {teamOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>Comparar desde
          <input type="month" max={comparisonEnd || undefined} value={comparisonStart} onChange={(event) => setComparisonStart(event.target.value)} />
        </label>
        <label>Comparar até
          <input type="month" min={comparisonStart || undefined} value={comparisonEnd} onChange={(event) => setComparisonEnd(event.target.value)} />
        </label>
      </div>
    </details>
    {activeFilterLabels.length > 0 && <div className="director-filter-chips" aria-label="Filtros ativos">
      {activeFilterLabels.map((label, index) => <span className="director-filter-chip" key={`${label}-${index}`}>{label}</span>)}
      <p>Seleções nos gráficos filtram as demais visualizações. Clique novamente ou use “Limpar filtros” para desfazer.</p>
    </div>}
  </div>;
  function downloadReport() {
    exportCsv("hb-avalia-relatorio-desempenho.csv",
      ["Unidade", "Colaborador", "Perfil", "Setor/equipe", "Avaliações", "Média (1 a 5)"],
      reportRows.map((row) => [
        row.storeName,
        row.name,
        row.role,
        row.teamLabels || "Sem equipe",
        String(row.evaluations),
        formatScore(row.averageScore),
      ]));
  }

  async function submitInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedStoreManagement) return;
    setBusy(true);
    setError("");
    setNotice("");
    setInviteLink("");
    try {
      const result = await createStoreAdminInvitation(selectedStoreManagement.storeId, invitationEmail);
      setInviteLink(result.inviteUrl);
      setNotice(result.emailSent ? "Convite enviado por e-mail. O link também está disponível para cópia." : result.emailWarning);
      setInvitationEmail("");
      setInvitations(await fetchInvitations(selectedStoreManagement.companyId, selectedStoreManagement.storeId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível criar o convite.");
    } finally {
      setBusy(false);
    }
  }

  async function updateInvitation(invitationId: string, action: "resend" | "cancel") {
    setBusy(true);
    setError("");
    setNotice("");
    setInviteLink("");
    try {
      if (action === "resend") {
        const result = await resendInvitation(invitationId);
        setInviteLink(result.inviteUrl);
        setNotice(result.emailSent ? "Convite reenviado. O link anterior foi invalidado." : result.emailWarning);
      } else {
        if (!window.confirm("Cancelar este convite? O link deixará de funcionar imediatamente.")) return;
        await cancelInvitation(invitationId);
        setNotice("Convite cancelado.");
      }
      if (selectedStoreManagement) {
        setInvitations(await fetchInvitations(selectedStoreManagement.companyId, selectedStoreManagement.storeId));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível atualizar o convite.");
    } finally {
      setBusy(false);
    }
  }

  async function submitTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!transferMember || !selectedStoreManagement || !targetStore) return;
    if (!window.confirm(
      `Transferir ${transferMember.name} de ${selectedStoreManagement.name} para ${targetStore.name}? Avaliações, PDIs e demais históricos permanecerão na loja de origem.`,
    )) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await transferOrganizationMember({
        memberUid: transferMember.uid,
        sourceStoreId: selectedStoreManagement.storeId,
        targetStoreId,
        targetTeamIds: transferMember.role === "ADMIN" ? [] : targetTeamIds,
      });
      setNotice("Transferência concluída. O histórico anterior foi mantido na loja de origem.");
      setTransferMemberUid("");
      setTargetStoreId("");
      setTargetTeamIds([]);
      await refreshManagement();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível transferir o usuário.");
    } finally {
      setBusy(false);
    }
  }

  async function copyInviteLink() {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setNotice("Link copiado. Envie-o somente para o e-mail convidado.");
    } catch {
      setError("Não foi possível copiar o link automaticamente. Selecione e copie o endereço exibido.");
    }
  }

  function toggleTargetTeam(teamId: string) {
    setTargetTeamIds((current) => current.includes(teamId)
      ? current.filter((id) => id !== teamId)
      : [...current, teamId]);
  }

  return (
    <div className="shell">
      {menuOpen && <button type="button" className="shell-overlay" aria-label="Fechar menu" onClick={closeMenu} />}
      <aside className={`shell-sidebar${menuOpen ? " is-open" : ""}`} id="director-sidebar" ref={drawerRef} aria-label="Menu">
        <div className="shell-company">
          <CompanyLogo className="company-logo-sidebar" />
          <span><b>{access.organizationName}</b><small>Perfil DIRETOR</small></span>
        </div>
        <nav className="shell-nav" aria-label="Navegação principal">
          <div className="shell-nav-group">
            <p className="shell-nav-label">Estratégia</p>
            <button type="button" aria-current={activeSection === "dashboard" ? "page" : undefined} className="shell-nav-item" onClick={() => navigateToSection("dashboard", "Dashboard")}>
              <span className="shell-nav-icon" aria-hidden="true"><House size={18} /></span><span className="shell-nav-text">Dashboard</span>
            </button>
            <button type="button" aria-current={activeSection === "comparison" ? "page" : undefined} className="shell-nav-item" onClick={() => navigateToSection("comparison", "Comparativo entre lojas")}>
              <span className="shell-nav-icon" aria-hidden="true"><ChartBar size={18} /></span><span className="shell-nav-text">Comparar lojas</span>
            </button>
            <button type="button" aria-current={activeSection === "reports" ? "page" : undefined} className="shell-nav-item" onClick={() => navigateToSection("reports", "Relatórios")}>
              <span className="shell-nav-icon" aria-hidden="true"><ChartBar size={18} /></span><span className="shell-nav-text">Relatórios</span>
            </button>
            <button type="button" aria-current={activeSection === "organization" ? "page" : undefined} className="shell-nav-item" onClick={() => navigateToSection("organization", "Gestão organizacional")}>
              <span className="shell-nav-icon" aria-hidden="true"><UsersThree size={18} /></span><span className="shell-nav-text">Organização</span>
            </button>
          </div>
        </nav>
        <div className="shell-account">
          <div className="shell-account-info">
            <span className="live-avatar" aria-hidden="true">D</span>
            <span><b>Diretor</b><small>{accountEmail}</small></span>
          </div>
          <div className="shell-account-actions">
            <ThemeToggle />
            <button type="button" className="button button-outline button-small" onClick={onSignOut}>
              <SignOut size={15} aria-hidden="true" /><span>Sair</span>
            </button>
          </div>
        </div>
      </aside>
      <main className="shell-main">
        <header className="shell-topbar">
          <button type="button" ref={menuButtonRef} className="shell-menu-button" aria-label="Abrir menu" aria-expanded={menuOpen} aria-controls="director-sidebar" onClick={() => setMenuOpen(true)}>
            <List size={22} aria-hidden="true" />
          </button>
          <span className="shell-topbar-title">{activeLabel}</span>
          <button type="button" className="button button-outline button-small shell-refresh" disabled={managementLoading} onClick={() => void refreshManagement()}>
            <ArrowsClockwise size={15} aria-hidden="true" /><span>{managementLoading ? "Atualizando…" : "Atualizar"}</span>
          </button>
        </header>
        <div className="live-content director-content">
          <section className="live-page-heading">
            <span className="eyebrow">ADMINISTRAÇÃO ORGANIZACIONAL</span>
            <h1>{access.organizationName}</h1>
            <p>Painel geral das unidades, administração de convites e transferências de usuários.</p>
          </section>

          <section id="director-overview" className="live-panel director-management-panel" aria-label={activeLabel}>
            {managementError && <p className="form-alert error" role="alert">{managementError}</p>}
            <nav className="director-view-tabs" aria-label="Áreas do painel">
              {[
                ["dashboard", "Dashboard"],
                ["comparison", "Comparativo"],
                ["reports", "Relatórios"],
                ["organization", "Organização"],
              ].map(([section, label]) => <button key={section} type="button"
                aria-current={activeSection === section ? "page" : undefined}
                className={activeSection === section ? "is-active" : ""}
                onClick={() => { setActiveSection(section); setActiveLabel(label); }}>
                {label}
              </button>)}
            </nav>
            {!management && managementLoading && <p className="subtle-note">Carregando dados autorizados da organização…</p>}
            {management && <div className="director-view-content">
              {activeSection === "dashboard" && <>
                <div className="live-panel-heading">
                  <div><span className="eyebrow">Visão consolidada</span><h2>Indicadores estratégicos</h2>
                    <p>Dados das unidades autorizadas. Clique nos gráficos para filtrar; análises adicionais ficam recolhidas.</p></div>
                </div>
                {reportFilterBar}
                <div className="director-kpi-strip" aria-label="Resumo dos indicadores">
                  <div><small>Pessoas ativas</small><b>{formatMetric(filteredMembers.length)}</b><span>{formatMetric(filteredMembers.filter((member) => member.role === "LEADER").length)} líderes · {formatMetric(filteredMembers.filter((member) => member.role === "ADMIN").length)} admins</span></div>
                  <div><small>Avaliações concluídas</small><b>{formatMetric(filteredEvaluationRecords.length)}</b><span>{pendingEvaluationCount == null ? "Pendências: —" : `${formatMetric(pendingEvaluationCount)} pendentes no ciclo aberto`}</span></div>
                  <div><small>Desempenho médio</small><b>{formatScore(evaluationAverage)} <small>/ 5</small></b><span>{comparisonEvaluationRecords.length ? `${formatScore(average(comparisonEvaluationRecords.map((record) => record.score)))} no período comparado` : "Selecione período comparado"}</span></div>
                  <div><small>Satisfação dos clientes</small><b>{formatScore(customerAverage)} <small>/ 5</small></b><span>{formatMetric(filteredFeedbackRecords.length)} respostas no período</span></div>
                  <div><small>PDIs ativos</small><b>{formatMetric(filteredPdis.length)}</b><span>{formatMetric(pendingDevelopmentGoals)} metas pendentes</span></div>
                </div>
                <div className="director-chart-grid">
                  <DirectorBIChart title="Evolução do desempenho" option={performanceTrendOption} onEvents={performanceTrendEvents} height={300} />
                  <DirectorBIChart title="Desempenho e satisfação por unidade" option={storeComparisonOption} onEvents={comparisonEvents} height={300} />
                  <DirectorBIChart
                    title={departmentFilterId
                      ? `Equipes · ${departmentOptions.find((item) => item.id === departmentFilterId)?.name ?? "setor"}`
                      : "Média por setor"}
                    option={departmentFilterId ? teamRankingOption : departmentRankingOption}
                    onEvents={departmentFilterId ? teamRankingEvents : departmentRankingEvents}
                    height={300}
                  />
                  <DirectorBIChart title="Avaliações por classificação" option={classificationOption} onEvents={classificationEvents} height={300} />
                </div>
                {departmentFilterId && <button type="button" className="button button-outline button-small director-drill-back" onClick={() => {
                  setDepartmentFilterId("");
                  setTeamFilterId("");
                }}>← Voltar aos setores</button>}
                <details className="director-advanced">
                  <summary>Análises detalhadas <span>Competências, satisfação, volume e padrões por período</span></summary>
                  <div className="director-chart-grid director-advanced-grid">
                    {(comparisonStart || comparisonEnd) && <DirectorBIChart title="Comparar períodos por unidade" option={comparisonOption} onEvents={comparisonEvents} height={300} />}
                    <DirectorBIChart title="Volume mensal de avaliações" option={volumeAreaOption} onEvents={volumeAreaEvents} height={300} />
                    <DirectorBIChart title="Satisfação dos clientes ao longo do tempo" option={customerTrendOption} onEvents={customerTrendEvents} height={300} />
                    <DirectorBIChart title="Competências avaliadas" option={competencyOption} onEvents={competencyEvents} height={320} />
                    <DirectorBIChart title="Desempenho por setor e mês" option={heatmapOption} onEvents={heatmapEvents} height={340} />
                    <DirectorBIChart title="Colaboradores por média" option={personRankingOption} onEvents={personRankingEvents} height={320} />
                  </div>
                </details>
              </>}
              {activeSection === "comparison" && <>
                <div className="live-panel-heading">
                  <div><span className="eyebrow">Análise comparativa</span><h2>Comparativo entre lojas</h2>
                    <p>Desempenho, conclusão do ciclo aberto, satisfação e PDIs no período selecionado.</p></div>
                </div>
                {reportFilterBar}
                <div className="director-chart-grid">
                  <DirectorBIChart title="Desempenho médio por unidade" option={storeComparisonOption} onEvents={comparisonEvents} height={300} />
                  {(comparisonStart || comparisonEnd) && <DirectorBIChart title="Desempenho atual × período comparado" option={comparisonOption} onEvents={comparisonEvents} height={300} />}
                </div>
                {!comparisonStart && !comparisonEnd && <p className="subtle-note">Para comparar períodos, abra “Filtros adicionais” e selecione o intervalo de comparação.</p>}
                <div className="live-table-wrap director-table-wrap">
                  <table className="live-table">
                    <thead><tr><th>Unidade</th><th>Média</th><th>Avaliados</th><th>Avaliações</th><th>Conclusão do ciclo aberto</th><th>Satisfação</th><th>PDIs ativos</th><th>Metas pendentes</th></tr></thead>
                    <tbody>{comparisonRows.map(({ store, records, feedback, evaluatedPeople }) => {
                      const { expectedEvaluations, openCycleEvaluationsSubmitted } = store.analytics.indicators;
                      const pdis = store.analytics.pdiRecords.filter((pdi) =>
                        (!teamFilterId || (store.storeId === teamFilterId.split(":")[0] && pdi.teamIds.includes(teamFilterId.split(":").slice(1).join(":"))))
                        && (!departmentFilterId || (store.storeId === departmentFilterId.split(":")[0] && pdi.departmentIds.includes(departmentFilterId.split(":").slice(1).join(":")))));
                      return <tr key={store.storeId}>
                        <td>{store.name}</td><td>{formatScore(average(records.map((record) => record.score)))}</td>
                        <td>{formatMetric(evaluatedPeople)}</td><td>{formatMetric(records.length)}</td>
                        <td>{expectedEvaluations && !teamFilterId && !departmentFilterId && !personFilterId
                          && !classificationFilter && !chartMonthFilter && !competencyFilterId
                          ? `${formatScore(openCycleEvaluationsSubmitted / expectedEvaluations * 100)}%` : "—"}</td>
                        <td>{formatScore(average(feedback.map((item) => item.overallRating)))}</td>
                        <td>{formatMetric(pdis.length)}</td><td>{formatMetric(pdis.reduce((sum, pdi) => sum + pdi.pendingGoals, 0))}</td>
                      </tr>;
                    })}</tbody>
                  </table>
                </div>
              </>}
              {activeSection === "reports" && <>
                <div className="live-panel-heading director-report-heading">
                  <div><span className="eyebrow">Histórico e exportação</span><h2>Relatório de desempenho</h2>
                    <p>Histórico somente para consulta. Exportações não incluem comentários de clientes.</p></div>
                  <div className="director-report-actions">
                    <button type="button" className="button button-outline button-small" onClick={downloadReport}>Exportar Excel (CSV)</button>
                    <button type="button" className="button button-primary button-small" onClick={() => window.print()}>Salvar como PDF</button>
                  </div>
                </div>
                {reportFilterBar}
                <p className="director-report-summary">{formatMetric(filteredEvaluationRecords.length)} avaliações · {formatMetric(reportRows.length)} colaboradores · média geral {formatScore(evaluationAverage)}</p>
                <DirectorBIChart title="Histórico mensal de desempenho" option={performanceTrendOption} onEvents={performanceTrendEvents} height={330} />
                <div className="live-table-wrap director-table-wrap director-report-table">
                  <table className="live-table">
                    <thead><tr><th>Unidade</th><th>Colaborador</th><th>Perfil</th><th>Equipe</th><th>Avaliações</th><th>Média (1–5)</th></tr></thead>
                    <tbody>{reportRows.map((row) => <tr key={`${row.storeName}-${row.name}`}>
                      <td>{row.storeName}</td><td>{row.name}</td><td>{row.role}</td><td>{row.teamLabels || "Sem equipe"}</td>
                      <td>{formatMetric(row.evaluations)}</td><td>{formatScore(row.averageScore)}</td>
                    </tr>)}
                    {!reportRows.length && <tr><td colSpan={6}>Não há resultados para os filtros selecionados.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </>}
            </div>}
            {activeSection === "organization" && <>
            <div className="director-unit-selector">
              <div className="director-subsection-heading">
                <h3>Unidades</h3>
                <p>Selecione uma unidade para consultar os indicadores e administrar acessos.</p>
              </div>
            <div className="director-store-list" role="group" aria-label="Lojas da organização">
              {access.stores.map((store) => {
                const selected = store.storeId === selectedStoreId;
                const storeIndicators = management?.stores.find((item) => item.storeId === store.storeId)?.indicators;
                return (
                  <button
                    type="button"
                    key={store.storeId}
                    className={`director-store-option${selected ? " is-selected" : ""}`}
                    aria-pressed={selected}
                    disabled={store.status !== "ACTIVE"}
                    onClick={() => {
                      setSelectedStoreId(store.storeId);
                      setTargetStoreId("");
                      setTargetTeamIds([]);
                      setError("");
                      setNotice("");
                      setInviteLink("");
                      setActiveSection("organization");
                      setActiveLabel("Organização");
                      closeMenu();
                    }}
                  >
                    <span className="director-store-icon" aria-hidden="true"><Buildings size={20} /></span>
                    <span className="director-store-copy">
                      <b>{store.name}</b>
                      <small>{storeAvailabilityLabel(store)}</small>
                      {storeIndicators && <small>{formatMetric(storeIndicators.activeMembers)} pessoas · {formatMetric(storeIndicators.evaluations)} avaliações</small>}
                    </span>
                    {selected && <CheckCircle className="director-store-check" size={20} weight="fill" aria-label="Selecionada" />}
                  </button>
                );
              })}
              {!access.stores.length && <p className="form-alert error" role="alert">Nenhuma loja ativa foi cadastrada para esta organização.</p>}
            </div>
            </div>

            {selectedStore && <div className="director-unit-management">
              <div className="director-subsection-heading">
                <h3><LockKey size={16} aria-hidden="true" /> Gestão de {selectedStore.name}</h3>
                <p>Convites e transferências disponíveis para esta unidade.</p>
              </div>
              {!selectedStore.operationalAccessReady
                ? <p className="subtle-note">O vínculo operacional desta unidade ainda não está confirmado. Não é possível convidar administradores nem transferir usuários.</p>
                : managementLoading ? <p className="subtle-note">Carregando dados autorizados da organização…</p>
                : managementError ? <p className="form-alert error" role="alert">{managementError}</p>
                  : selectedStoreManagement && <>
                    <div className="director-management-grid">
                      <section className="director-action-panel">
                        <div className="live-panel-heading">
                          <div><span className="eyebrow">Acesso</span><h3>Convidar administrador</h3></div>
                        </div>
                        <p>O convite será enviado ao e-mail informado.</p>
                        <form className="stack-form invitation-form" onSubmit={(event) => void submitInvitation(event)}>
                          <label>E-mail do administrador
                            <input type="email" autoComplete="email" required maxLength={254} value={invitationEmail} onChange={(event) => setInvitationEmail(event.target.value)} placeholder="administrador@empresa.com" />
                          </label>
                          <button className="button button-primary" type="submit" disabled={busy}>
                            {busy ? "Processando…" : "Enviar convite"}
                          </button>
                        </form>
                        {inviteLink && <div className="invitation-link-box">
                          <label htmlFor="director-invite-link">Link do convite</label>
                          <div><input id="director-invite-link" readOnly value={inviteLink} onFocus={(event) => event.currentTarget.select()} /><button className="button button-outline button-small" type="button" onClick={() => void copyInviteLink()}>Copiar</button></div>
                        </div>}
                        <div className="invitation-list-heading"><h4>Convites de administrador</h4></div>
                        {invitations.length
                          ? <ul className="invitation-list">{invitations.map((invitation) => <li key={invitation.id}>
                            <div className="invitation-record-copy">
                              <b>{invitation.email}</b>
                              <span>{roleLabel(invitation.role)} · {statusLabel(invitation.status)}</span>
                              <small>Expira em {formatInvitationDate(invitation.expiresAt)}</small>
                            </div>
                            <div className="invitation-record-actions">
                              {(invitation.status === "PENDING" || invitation.status === "EXPIRED") && <button className="button button-outline button-small" type="button" disabled={busy} onClick={() => void updateInvitation(invitation.id, "resend")}>Reenviar</button>}
                              {invitation.status === "PENDING" && <button className="button button-outline button-small" type="button" disabled={busy} onClick={() => void updateInvitation(invitation.id, "cancel")}>Cancelar</button>}
                            </div>
                          </li>)}</ul>
                          : <p className="subtle-note">Não há convites de administrador para esta unidade.</p>}
                      </section>

                      <section className="director-action-panel">
                        <div className="live-panel-heading">
                          <div><span className="eyebrow">Movimentação</span><h3>Transferir usuário</h3></div>
                        </div>
                        <p>O vínculo ativo será alterado; avaliações, PDIs e históricos anteriores permanecem na loja de origem.</p>
                        <form className="stack-form invitation-form" onSubmit={(event) => void submitTransfer(event)}>
                          <label>Usuário da loja de origem
                            <select required value={transferMemberUid} onChange={(event) => {
                              setTransferMemberUid(event.target.value);
                              setTargetStoreId("");
                              setTargetTeamIds([]);
                            }}>
                              <option value="">Selecione um usuário</option>
                              {transferableMembers.map((member) => <option key={member.uid} value={member.uid}>{member.name} · {roleLabel(member.role)}</option>)}
                            </select>
                          </label>
                          <label>Loja de destino
                            <select required value={targetStoreId} onChange={(event) => { setTargetStoreId(event.target.value); setTargetTeamIds([]); }}>
                              <option value="">Selecione uma loja</option>
                              {availableTargets.map((store) => <option key={store.storeId} value={store.storeId}>{store.name}</option>)}
                            </select>
                          </label>
                          {targetStore && transferMember?.role !== "ADMIN" && <fieldset className="invitation-teams">
                            <legend>Equipes na loja de destino (opcional)</legend>
                            {targetStore.teams.length
                              ? targetStore.teams.map((team) => <label key={team.teamId}>
                                <input type="checkbox" checked={targetTeamIds.includes(team.teamId)} onChange={() => toggleTargetTeam(team.teamId)} />
                                <span>{team.name}</span>
                              </label>)
                              : <p className="subtle-note">Não há equipes ativas para selecionar.</p>}
                          </fieldset>}
                          <button className="button button-primary" type="submit" disabled={busy || managementLoading || !transferMember || !targetStore}>
                            {busy ? "Processando…" : "Confirmar transferência"}
                          </button>
                        </form>
                      </section>
                    </div>
                  </>}
            {error && <p className="form-alert error" role="alert">{error}</p>}
            {notice && <p className="form-alert success" role="status">{notice}</p>}
            </div>}
            {!selectedStore && <p className="subtle-note director-selection-hint">Selecione uma unidade para consultar a estrutura, administrar convites e transferir usuários.</p>}
            </>}
          </section>
        </div>
      </main>
    </div>
  );
}
