"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { addHours, differenceInHours, isBefore, parseISO } from "date-fns";
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  Camera,
  CheckCircle2,
  ClipboardList,
  Home,
  LayoutGrid,
  List,
  LogOut,
  MapPinned,
  Menu,
  MessageCircle,
  Moon,
  Plus,
  Share2,
  Search,
  ShieldCheck,
  Sun,
  UserRoundCog,
  Wrench,
} from "lucide-react";
import Papa from "papaparse";
import Image from "next/image";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";

import {
  createTaskAction,
  createTicketAction,
  createUnitAction,
  createEvidenceAction,
  uploadEvidencePhotoAction,
  uploadGuestPhotoAction,
  createOperationalNotificationAction,
  importReservationsAction,
  createReservationAction,
  updateReservationAction,
  deleteReservationAction,
  createOperationalClosureAction,
  getEvidenceSignedUrlAction,
  syncOfflineOpsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  logAgentSuggestionAction,
  deleteUnitAction,
  updateTaskStatusAction,
  updateTicketStatusAction,
  updateUnitAction,
  updateUnitStatusAction,
  bulkDispatchCriticalTicketsAction,
  listRecentBulkRiskActionsAction,
  createAppUserAction,
  updateAppUserAccessAction,
  updateAppUserPasswordAction,
} from "@/app/actions";
import type { AppData } from "@/lib/app-data";
import {
  formatShortDate,
  isCheckInAtRisk,
  priorities,
  priorityLabel,
  ticketStatuses,
  Ticket,
  Unit,
  unitStatuses,
  unitStatusLabel,
  Task,
  Reservation,
  EvidenceItem,
  NotificationItem,
  OperationalClosure,
  AgentActionLogItem,
  User,
  Role,
  createFakeApartmentImage,
} from "@/lib/domain";
import { buildLocalEvidence, compressImage } from "@/lib/evidence";
import { normalizePlatform, reservationCsvSchema } from "@/lib/csv";
import { evaluateSla } from "@/lib/sla";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ensureOfflineOp, getOfflineSyncSkippedInfo, type OfflineOp } from "@/components/operations-dashboard.offline";

const statusTone: Record<Unit["status"], string> = {
  pendiente_limpieza: "bg-amber-100 text-amber-950 border-amber-200",
  en_limpieza: "bg-sky-100 text-sky-950 border-sky-200",
  mantenimiento: "bg-rose-100 text-rose-950 border-rose-200",
  inspeccion: "bg-violet-100 text-violet-950 border-violet-200",
  lista: "bg-emerald-100 text-emerald-950 border-emerald-200",
  bloqueada: "bg-zinc-200 text-zinc-950 border-zinc-300",
};

const priorityTone: Record<Ticket["priority"], string> = {
  critico: "bg-red-600 text-white",
  alto: "bg-orange-500 text-white",
  normal: "bg-emerald-700 text-white",
  bajo: "bg-zinc-700 text-white",
};
const OFFLINE_OPS_KEY = "mra_offline_ops_v1";
function getOperationalNow() {
  return new Date();
}

function getTodayInputValue() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
type CsvImportError = { row: number; reason: string };

function useOnlineStatus() {
  return useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener("online", onStoreChange);
      window.addEventListener("offline", onStoreChange);
      return () => {
        window.removeEventListener("online", onStoreChange);
        window.removeEventListener("offline", onStoreChange);
      };
    },
    () => window.navigator.onLine,
    () => null,
  );
}

export function OperationsDashboard({
  initialData,
  sessionUser,
}: {
  initialData: AppData;
  sessionUser: { id: string; name: string; role: string };
}) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    const saved = window.localStorage.getItem("mra_theme");
    return saved === "dark" ? "dark" : "light";
  });
  const canManage = sessionUser.role === "admin" || sessionUser.role === "supervisor";
  const isWorker = sessionUser.role === "limpieza" || sessionUser.role === "mantenimiento";
  const [activeTab, setActiveTab] = useState("operacion");
  const [query, setQuery] = useState("");
  const [departmentQuery, setDepartmentQuery] = useState("");
  const [departmentStatusFilter, setDepartmentStatusFilter] = useState<"all" | Unit["status"]>("all");
  const [departmentZoneFilter, setDepartmentZoneFilter] = useState("all");
  const [departmentPage, setDepartmentPage] = useState(1);
  const [departmentPageSize, setDepartmentPageSize] = useState("25");
  const [departmentSort, setDepartmentSort] = useState<"score" | "code" | "zone" | "checkin">("checkin");
  const [departmentViewMode, setDepartmentViewMode] = useState<"list" | "cards">("cards");
  const [departmentEditorUnit, setDepartmentEditorUnit] = useState<Unit | null>(null);
  const [selectedDepartmentIds, setSelectedDepartmentIds] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState<"none" | Unit["status"]>("none");
  const [bulkZone, setBulkZone] = useState("");
  const [bulkOwner, setBulkOwner] = useState("");
  const [localUnits, setLocalUnits] = useState(initialData.units);
  const [selectedUnitId, setSelectedUnitId] = useState(initialData.units[0]?.id ?? "");
  const [localTickets, setLocalTickets] = useState(initialData.tickets);
  const [localTasks, setLocalTasks] = useState(initialData.tasks);
  const [localReservations, setLocalReservations] = useState(initialData.reservations);
  const [localEvidence, setLocalEvidence] = useState(initialData.evidence);
  const [localClosures, setLocalClosures] = useState(initialData.closures);
  const [localNotifications, setLocalNotifications] = useState(initialData.notifications);
  const [localAgentLogs, setLocalAgentLogs] = useState(initialData.agentLogs);
  const [localUsers, setLocalUsers] = useState(initialData.users);
  const [actionError, setActionError] = useState<string | null>(null);
  const [offlineOps, setOfflineOps] = useState<OfflineOp[]>([]);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [csvResult, setCsvResult] = useState("CSV pendiente: unidad,direccion,plataforma,huesped,check_in,check_out,observaciones");
  const [csvPreview, setCsvPreview] = useState<Reservation[]>([]);
  const [csvErrors, setCsvErrors] = useState<CsvImportError[]>([]);
  const [csvImporting, setCsvImporting] = useState(false);
  const [editingReservationId, setEditingReservationId] = useState<string | null>(null);
  const [riskZoneFilter, setRiskZoneFilter] = useState("all");
  const [riskStatusFilter, setRiskStatusFilter] = useState("all");
  const [riskPriorityFilter, setRiskPriorityFilter] = useState("all");
  const [riskHorizonHours, setRiskHorizonHours] = useState("24");
  const [isNavOpen, setIsNavOpen] = useState(false);
  const isOnline = useOnlineStatus();
  const visibleUsers = canManage ? initialData.users : initialData.users.filter((user) => user.id === sessionUser.id);
  const visibleTasks = isWorker ? localTasks.filter((task) => task.assigneeId === sessionUser.id) : localTasks;
  const visibleTaskUnitIds = new Set(visibleTasks.map((task) => task.unitId));
  const visibleTickets = isWorker
    ? localTickets.filter((ticket) => ticket.assigneeId === sessionUser.id || visibleTaskUnitIds.has(ticket.unitId))
    : localTickets;
  const visibleUnits = isWorker ? localUnits.filter((unit) => visibleTaskUnitIds.has(unit.id)) : localUnits;
  const selectedVisibleUnit = visibleUnits.find((unit) => unit.id === selectedUnitId) ?? visibleUnits[0] ?? null;

  const filteredUnits = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return visibleUnits;

    return visibleUnits.filter((unit) =>
      [unit.code, unit.address, unit.zone, unit.owner].some((value) => value.toLowerCase().includes(normalizedQuery)),
    );
  }, [visibleUnits, query]);
  const zoneOptions = useMemo(
    () =>
      Array.from(new Set(visibleUnits.map((unit) => unit.zone.trim()).filter((zone) => zone.length > 0))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [visibleUnits],
  );
  const departmentFilteredUnits = useMemo(() => {
    const normalizedQuery = departmentQuery.trim().toLowerCase();
    const filtered = visibleUnits.filter((unit) => {
      if (departmentStatusFilter !== "all" && unit.status !== departmentStatusFilter) return false;
      if (departmentZoneFilter !== "all" && unit.zone !== departmentZoneFilter) return false;
      if (!normalizedQuery) return true;
      return [unit.code, unit.zone, unit.owner, unit.address].some((value) => value.toLowerCase().includes(normalizedQuery));
    });

    return filtered.sort((a, b) => {
      if (departmentSort === "code") return a.code.localeCompare(b.code);
      if (departmentSort === "zone") return a.zone.localeCompare(b.zone);
      if (departmentSort === "checkin") return new Date(a.nextCheckIn).getTime() - new Date(b.nextCheckIn).getTime();
      const aTickets = visibleTickets.filter((ticket) => ticket.unitId === a.id && !["resuelto", "cerrado"].includes(ticket.status)).length;
      const bTickets = visibleTickets.filter((ticket) => ticket.unitId === b.id && !["resuelto", "cerrado"].includes(ticket.status)).length;
      return bTickets - aTickets;
    });
  }, [departmentQuery, departmentStatusFilter, departmentZoneFilter, departmentSort, visibleUnits, visibleTickets]);
  const parsedDepartmentPageSize = Number.parseInt(departmentPageSize, 10) || 25;
  const totalDepartmentPages = Math.max(1, Math.ceil(departmentFilteredUnits.length / parsedDepartmentPageSize));
  const safeDepartmentPage = Math.min(departmentPage, totalDepartmentPages);
  const pagedDepartmentUnits = useMemo(() => {
    const start = (safeDepartmentPage - 1) * parsedDepartmentPageSize;
    return departmentFilteredUnits.slice(start, start + parsedDepartmentPageSize);
  }, [departmentFilteredUnits, safeDepartmentPage, parsedDepartmentPageSize]);
  const selectedDepartmentSet = useMemo(() => new Set(selectedDepartmentIds), [selectedDepartmentIds]);

  const atRiskUnits = visibleUnits.filter((unit) =>
    isCheckInAtRisk(
      unit,
      visibleTickets.filter((ticket) => ticket.unitId === unit.id),
    ),
  );
  const openTickets = visibleTickets.filter((ticket) => !["resuelto", "cerrado"].includes(ticket.status));
  const unreadNotifications = localNotifications.filter((notification) => !notification.read);
  const unitZones = useMemo(() => Array.from(new Set(visibleUnits.map((unit) => unit.zone))).sort(), [visibleUnits]);
  const checksInNext24h = useMemo(
    () =>
      visibleUnits.filter((unit) => {
        const hudNowMs = getOperationalNow().getTime();
        const checkInMs = new Date(unit.nextCheckIn).getTime();
        const deltaHours = (checkInMs - hudNowMs) / (1000 * 60 * 60);
        return deltaHours >= 0 && deltaHours <= 24;
      }).length,
    [visibleUnits],
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem("mra_theme", theme);
  }, [theme]);

  useEffect(() => {
    async function hydrateOfflineQueue() {
      await Promise.resolve();
      try {
        const raw = window.localStorage.getItem(OFFLINE_OPS_KEY);
        const parsed = raw ? (JSON.parse(raw) as Array<Record<string, unknown>>) : [];
        setOfflineOps(parsed.map((op) => ensureOfflineOp(op)));
      } catch {
        setOfflineOps([]);
      }
    }
    void hydrateOfflineQueue();
  }, []);

  function persistOfflineOps(next: OfflineOp[]) {
    setOfflineOps(next);
    try {
      localStorage.setItem(OFFLINE_OPS_KEY, JSON.stringify(next));
    } catch {
      setActionError("No se pudo persistir cache offline en este navegador.");
    }
  }

  function enqueueOfflineOp(op: Record<string, unknown>) {
    const next = [...offlineOps, ensureOfflineOp(op)];
    persistOfflineOps(next);
  }

  async function syncOfflineOps() {
    if (offlineOps.length === 0) return;
    setActionError(null);
    setActionInfo(null);
    const result = await syncOfflineOpsAction(offlineOps as never);
    if (result.applied > 0) {
      startRefresh(() => router.refresh());
    }
    if (result.failed > 0) {
      setActionError(`No se pudieron sincronizar ${result.failed} cambios offline.`);
    } else if (result.applied > 0 || result.skipped > 0) {
      persistOfflineOps([]);
    }
    if (result.skipped > 0) {
      setActionInfo(getOfflineSyncSkippedInfo(result.skipped));
    }
  }

  function handleActionError(error: unknown, fallback: string) {
    if (error instanceof Error) {
      if (error.message.includes("Not authenticated")) {
        setActionError("Tu sesion vencio. Volve a iniciar sesion.");
        return;
      }
      if (error.message.includes("not allowed") || error.message.includes("Role")) {
        setActionError("No tenes permisos para esta accion.");
        return;
      }
    }
    setActionError(fallback);
  }

  function pushNotification(input: {
    type: NotificationItem["type"];
    title: string;
    targetRole?: Role;
    entityType: string;
    entityId: string;
    body?: string;
  }) {
    const notification: NotificationItem = {
      id: `nt-${Date.now()}`,
      type: input.type,
      title: input.title,
      targetRole: input.targetRole ?? "supervisor",
      createdAt: new Date().toISOString(),
      read: false,
    };

    setLocalNotifications((current) => [notification, ...current]);
    if (initialData.source === "mock") {
      return;
    }
    createOperationalNotificationAction({
      type: input.type,
      title: input.title,
      role: notification.targetRole,
      entityType: input.entityType,
      entityId: input.entityId,
      body: input.body,
    }).catch((error) => handleActionError(error, "No se pudo registrar la notificacion."));
  }

  function evaluateOperationalSla() {
    const existing = new Set(localNotifications.map((notification) => `${notification.type}:${notification.title}`));
    const alerts = evaluateSla({
      units: visibleUnits,
      tickets: visibleTickets,
      tasks: visibleTasks,
      now: getOperationalNow(),
      horizonHours: 8,
    });

    for (const alert of alerts) {
      const key = `${alert.type}:${alert.title}`;
      if (existing.has(key)) continue;
      existing.add(key);
      pushNotification({
        type: alert.type,
        title: alert.title,
        targetRole: "supervisor",
        entityType: alert.entityType,
        entityId: alert.entityId,
        body: alert.body,
      });
    }
  }

  function escalateSlaItem(input: { title: string; entityType: "ticket" | "task" | "unit"; entityId: string; body?: string }) {
    pushNotification({
      type: "ticket_overdue",
      title: `Escalado: ${input.title}`,
      targetRole: "supervisor",
      entityType: input.entityType,
      entityId: input.entityId,
      body: input.body,
    });
    setActionInfo(`Escalamiento enviado: ${input.title}`);
  }

  function addUnit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const code = String(form.get("code") ?? "").trim().toUpperCase();
    const address = String(form.get("address") ?? "").trim();
    const zone = String(form.get("zone") ?? "").trim();
    if (!code || !address || !zone) return;

    const unit: Unit = {
      id: `unit-${Date.now()}`,
      code,
      address: `${address}, CABA`,
      zone,
      status: "pendiente_limpieza",
      nextCheckIn: "2026-05-08T15:00:00-03:00",
      owner: String(form.get("owner") ?? "Owner demo"),
      imageUrl: createFakeApartmentImage(code, "#d5dec8"),
      bedrooms: Number(form.get("bedrooms") ?? 1),
      floor: String(form.get("floor") ?? "1A"),
    };

    setLocalUnits((current) => [unit, ...current]);
    setSelectedUnitId(unit.id);
    createUnitAction(withImageUrl(form, unit.imageUrl)).catch((error) => handleActionError(error, "No se pudo crear la unidad."));
    if (initialData.source === "mock") {
      enqueueOfflineOp({
        type: "create_unit",
        payload: {
          code: unit.code,
          address: unit.address,
          zone: unit.zone,
          owner: unit.owner,
          floor: unit.floor,
          bedrooms: unit.bedrooms,
          imageUrl: unit.imageUrl,
        },
      });
    }
    pushNotification({
      type: "ticket_created",
      title: `${unit.code} creada y pendiente de limpieza`,
      targetRole: "supervisor",
      entityType: "unit",
      entityId: unit.id,
      body: unit.address,
    });
    event.currentTarget.reset();
  }

  function addTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedVisibleUnit) return;
    const form = new FormData(event.currentTarget);
    const unitId = String(form.get("unitId") ?? selectedVisibleUnit?.id);
    const priority = String(form.get("priority") ?? "normal") as Ticket["priority"];

    const ticket: Ticket = {
      id: `tk-${Date.now()}`,
      unitId,
      title: String(form.get("title") ?? "Nueva incidencia"),
      category: String(form.get("category") ?? "mantenimiento"),
      priority,
      status: "nuevo",
      assigneeId: String(form.get("assigneeId") ?? "u-super"),
      dueAt: new Date(Date.now() + 1000 * 60 * 60 * (priority === "critico" ? 1 : 8)).toISOString(),
      source: "supervisor",
      evidenceCount: 0,
    };

    setLocalTickets((current) => [ticket, ...current]);
    createTicketAction(form).catch((error) => handleActionError(error, "No se pudo crear el ticket."));
    if (initialData.source === "mock") {
      enqueueOfflineOp({
        type: "create_ticket",
        payload: {
          unitCode: localUnits.find((unit) => unit.id === unitId)?.code ?? "",
          title: ticket.title,
          category: ticket.category,
          priority: ticket.priority,
          assigneeId: ticket.assigneeId,
        },
      });
    }
    pushNotification({
      type: "ticket_created",
      title: `${ticket.title} · ${visibleUnits.find((unit) => unit.id === unitId)?.code ?? "Unidad"}`,
      targetRole: ticket.priority === "critico" ? "supervisor" : "mantenimiento",
      entityType: "ticket",
      entityId: ticket.id,
      body: `Prioridad ${ticket.priority}`,
    });
    event.currentTarget.reset();
  }

  function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedVisibleUnit) return;
    const form = new FormData(event.currentTarget);
    const task: Task = {
      id: `task-${Date.now()}`,
      unitId: String(form.get("unitId") ?? selectedVisibleUnit?.id),
      title: String(form.get("title") ?? "Nueva tarea"),
      role: String(form.get("role") ?? "mantenimiento") as Task["role"],
      assigneeId: String(form.get("assigneeId") ?? "u-tech"),
      status: "nuevo",
      dueAt: new Date(Date.now() + 1000 * 60 * 60 * 6).toISOString(),
    };

    setLocalTasks((current) => [task, ...current]);
    createTaskAction(form).catch((error) => handleActionError(error, "No se pudo crear la tarea."));
    if (initialData.source === "mock") {
      enqueueOfflineOp({
        type: "create_task",
        payload: {
          unitCode: localUnits.find((unit) => unit.id === task.unitId)?.code ?? "",
          title: task.title,
          role: task.role,
          assigneeId: task.assigneeId,
        },
      });
    }
    pushNotification({
      type: "ticket_assigned",
      title: `${task.title} asignada`,
      targetRole: task.role,
      entityType: "task",
      entityId: task.id,
      body: visibleUnits.find((unit) => unit.id === task.unitId)?.code,
    });
    event.currentTarget.reset();
  }

  function updateUnitStatus(unitId: string, status: Unit["status"]) {
    if (!canManage) {
      setActionError("No tenes permisos para cambiar estado de unidad.");
      return;
    }
    setLocalUnits((current) => current.map((unit) => (unit.id === unitId ? { ...unit, status } : unit)));
    updateUnitStatusAction(unitId, status).catch((error) => handleActionError(error, "No se pudo actualizar la unidad."));
    if (initialData.source === "mock") {
      const code = localUnits.find((unit) => unit.id === unitId)?.code ?? "";
      enqueueOfflineOp({ type: "update_unit_status", payload: { code, status } });
    }
    if (status === "lista") {
      const unit = localUnits.find((currentUnit) => currentUnit.id === unitId);
      pushNotification({
        type: "unit_ready",
        title: `${unit?.code ?? "Unidad"} marcada como lista`,
        targetRole: "supervisor",
        entityType: "unit",
        entityId: unitId,
        body: unit?.address,
      });
    }
  }

  async function removeUnit(unitId: string) {
    const removed = localUnits.find((unit) => unit.id === unitId);
    if (!removed) return;
    if (!window.confirm(`Eliminar ${removed.code}? Esta accion no se puede deshacer.`)) return;
    setLocalUnits((current) => current.filter((unit) => unit.id !== unitId));
    if (selectedUnitId === unitId) {
      const next = localUnits.find((unit) => unit.id !== unitId);
      setSelectedUnitId(next?.id ?? "");
    }
    try {
      await deleteUnitAction(unitId);
      pushNotification({
        type: "ticket_created",
        title: `${removed.code} eliminada`,
        targetRole: "supervisor",
        entityType: "unit",
        entityId: unitId,
      });
    } catch (error) {
      handleActionError(error, "No se pudo eliminar la unidad.");
      startRefresh(() => router.refresh());
    }
  }

  function toggleDepartmentSelection(unitId: string) {
    setSelectedDepartmentIds((current) =>
      current.includes(unitId) ? current.filter((id) => id !== unitId) : [...current, unitId],
    );
  }

  function toggleSelectAllVisibleDepartments() {
    const pageIds = pagedDepartmentUnits.map((unit) => unit.id);
    const allSelected = pageIds.every((id) => selectedDepartmentSet.has(id));
    if (allSelected) {
      setSelectedDepartmentIds((current) => current.filter((id) => !pageIds.includes(id)));
      return;
    }
    setSelectedDepartmentIds((current) => Array.from(new Set([...current, ...pageIds])));
  }

  async function applyDepartmentBulkUpdate() {
    if (!canManage) {
      setActionError("No tenes permisos para acciones masivas.");
      return;
    }
    if (selectedDepartmentIds.length === 0) {
      setActionError("Selecciona al menos un departamento.");
      return;
    }
    if (bulkStatus === "none" && !bulkZone.trim() && !bulkOwner.trim()) {
      setActionError("Define al menos un cambio masivo.");
      return;
    }

    const targets = localUnits.filter((unit) => selectedDepartmentSet.has(unit.id));
    const nextZone = bulkZone.trim();
    const nextOwner = bulkOwner.trim();

    const optimistic = localUnits.map((unit) => {
      if (!selectedDepartmentSet.has(unit.id)) return unit;
      return {
        ...unit,
        status: bulkStatus === "none" ? unit.status : bulkStatus,
        zone: nextZone || unit.zone,
        owner: nextOwner || unit.owner,
      };
    });
    setLocalUnits(optimistic);

    try {
      await Promise.all(
        targets.map((unit) =>
          updateUnitAction({
            unitId: unit.id,
            code: unit.code,
            address: unit.address,
            zone: nextZone || unit.zone,
            owner: nextOwner || unit.owner,
            floor: unit.floor,
            bedrooms: unit.bedrooms,
            status: bulkStatus === "none" ? unit.status : bulkStatus,
            imageUrl: unit.imageUrl,
          }),
        ),
      );
      setActionInfo(`Actualizacion masiva aplicada a ${targets.length} departamentos.`);
      setSelectedDepartmentIds([]);
      setBulkStatus("none");
      setBulkZone("");
      setBulkOwner("");
    } catch (error) {
      handleActionError(error, "No se pudo aplicar la actualizacion masiva.");
      startRefresh(() => router.refresh());
    }
  }

  async function saveDepartmentEdit(formData: FormData) {
    if (!departmentEditorUnit || !canManage) return;
    const next: Unit = {
      ...departmentEditorUnit,
      code: String(formData.get("code") ?? departmentEditorUnit.code).trim(),
      zone: String(formData.get("zone") ?? departmentEditorUnit.zone).trim(),
      address: String(formData.get("address") ?? departmentEditorUnit.address).trim(),
      owner: String(formData.get("owner") ?? departmentEditorUnit.owner).trim(),
      floor: String(formData.get("floor") ?? departmentEditorUnit.floor).trim(),
      bedrooms: Math.max(0, Number.parseInt(String(formData.get("bedrooms") ?? departmentEditorUnit.bedrooms), 10) || 0),
      status: String(formData.get("status") ?? departmentEditorUnit.status) as Unit["status"],
      imageUrl: String(formData.get("imageUrl") ?? departmentEditorUnit.imageUrl).trim() || departmentEditorUnit.imageUrl,
    };

    setLocalUnits((current) => current.map((unit) => (unit.id === next.id ? next : unit)));
    try {
      await updateUnitAction({
        unitId: next.id,
        code: next.code,
        address: next.address,
        zone: next.zone,
        owner: next.owner,
        floor: next.floor,
        bedrooms: next.bedrooms,
        status: next.status,
        imageUrl: next.imageUrl,
      });
      setDepartmentEditorUnit(null);
    } catch (error) {
      handleActionError(error, "No se pudo guardar el departamento.");
      startRefresh(() => router.refresh());
    }
  }

  function markTicketResolved(ticketId: string) {
    setLocalTickets((currentTickets) =>
      currentTickets.map((ticket) =>
        ticket.id === ticketId ? { ...ticket, status: "resuelto", evidenceCount: Math.max(ticket.evidenceCount, 1) } : ticket,
      ),
    );
    updateTicketStatusAction(ticketId, "resuelto").catch((error) => handleActionError(error, "No se pudo resolver el ticket."));
    const ticket = localTickets.find((currentTicket) => currentTicket.id === ticketId);
    if (ticket) {
      pushNotification({
        type: "ticket_resolved",
        title: `${ticket.title} resuelto`,
        targetRole: "supervisor",
        entityType: "ticket",
        entityId: ticket.id,
      });
    }
  }

  function updateTaskStatus(taskId: string, status: Task["status"]) {
    setLocalTasks((current) => current.map((task) => (task.id === taskId ? { ...task, status } : task)));
    updateTaskStatusAction(taskId, status).catch((error) => handleActionError(error, "No se pudo actualizar la tarea."));
  }

  async function addEvidence(input: { unitId: string; ticketId?: string; file: File; note?: string }) {
    const compressed = await compressImage(input.file);
    let evidenceUrl = compressed.dataUrl;
    let storagePath = "";

    try {
      storagePath = await uploadEvidencePhotoAction(
        {
          path: `${input.unitId}/${Date.now()}-${input.file.name.replace(/[^a-zA-Z0-9.]/g, "-")}`,
          dataUrl: compressed.dataUrl,
          contentType: "image/jpeg",
        },
      );
      evidenceUrl =
        (await getEvidenceSignedUrlAction(storagePath)) ??
        compressed.dataUrl;
    } catch {
      evidenceUrl = compressed.dataUrl;
      storagePath = "";
    }

    const item = buildLocalEvidence({
      unitId: input.unitId,
      ticketId: input.ticketId,
      url: evidenceUrl,
      note: input.note,
      sizeKb: compressed.sizeKb,
    });

    setLocalEvidence((current) => [item, ...current]);
    if (input.ticketId) {
      setLocalTickets((current) =>
        current.map((ticket) => (ticket.id === input.ticketId ? { ...ticket, evidenceCount: ticket.evidenceCount + 1 } : ticket)),
      );
    }

    const form = new FormData();
    if (input.ticketId) form.set("ticketId", input.ticketId);
    form.set("kind", item.kind);
    form.set("url", item.url);
    if (storagePath) form.set("storagePath", storagePath);
    form.set("sizeKb", String(item.sizeKb ?? 0));
    createEvidenceAction(form).catch((error) => handleActionError(error, "No se pudo guardar la evidencia."));
    if (initialData.source === "mock") {
      enqueueOfflineOp({
        type: "create_evidence",
        payload: {
          unitCode: localUnits.find((unit) => unit.id === input.unitId)?.code ?? "",
          ticketTitle: localTickets.find((ticket) => ticket.id === input.ticketId)?.title,
          kind: item.kind,
          url: item.url,
          sizeKb: item.sizeKb,
        },
      });
    }
    pushNotification({
      type: "ticket_assigned",
      title: `Nueva evidencia cargada en ${visibleUnits.find((unit) => unit.id === input.unitId)?.code ?? "unidad"}`,
      targetRole: "supervisor",
      entityType: "evidence",
      entityId: item.id,
      body: input.note,
    });
  }

  function handleCsv(file: File | null) {
    if (!file) return;

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const seen = new Set(localReservations.map((reservation) => `${reservation.unitId}:${reservation.checkIn}`));
        const imported: Reservation[] = [];
        const errors: CsvImportError[] = [];

        result.data.forEach((row, index) => {
          const parsed = reservationCsvSchema.safeParse(row);
          if (!parsed.success) {
            errors.push({ row: index + 2, reason: "campos requeridos incompletos" });
            return;
          }

          const unit = visibleUnits.find((currentUnit) => currentUnit.code.toLowerCase() === parsed.data.unidad.trim().toLowerCase());
          if (!unit) {
            errors.push({ row: index + 2, reason: `unidad ${parsed.data.unidad} no existe` });
            return;
          }

          const checkIn = new Date(parsed.data.check_in);
          const checkOut = new Date(parsed.data.check_out);
          if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime())) {
            errors.push({ row: index + 2, reason: "fecha invalida" });
            return;
          }

          const duplicateKey = `${unit.id}:${checkIn.toISOString()}`;
          if (seen.has(duplicateKey)) {
            errors.push({ row: index + 2, reason: `reserva duplicada para ${unit.code}` });
            return;
          }

          seen.add(duplicateKey);
          imported.push({
            id: `r-${Date.now()}-${index}`,
            unitId: unit.id,
            platform: normalizePlatform(parsed.data.plataforma),
            guest: parsed.data.huesped.trim(),
            checkOut: checkOut.toISOString(),
            checkIn: checkIn.toISOString(),
            notes: parsed.data.observaciones?.trim() || undefined,
          });
        });

        setCsvPreview(imported);
        setCsvErrors(errors);

        setCsvResult(
          errors.length > 0
            ? `${imported.length} listas para importar, ${errors.length} con error`
            : `${imported.length} listas para importar`,
        );
      },
    });
  }

  async function confirmCsvImport() {
    if (csvPreview.length === 0) return;
    setCsvImporting(true);
    try {
      const rows = csvPreview.map((reservation) => ({
        id: reservation.id,
        unitId: reservation.unitId,
        platform: reservation.platform,
        guest: reservation.guest,
        checkIn: reservation.checkIn,
        checkOut: reservation.checkOut,
        notes: reservation.notes,
      }));
      await importReservationsAction(rows);
      setLocalReservations((current) => [...csvPreview, ...current]);
      if (initialData.source === "mock") {
        for (const reservation of csvPreview) {
          enqueueOfflineOp({
            type: "import_reservation",
            payload: {
              unitCode: localUnits.find((unit) => unit.id === reservation.unitId)?.code ?? "",
              platform: reservation.platform,
              guest: reservation.guest,
              checkIn: reservation.checkIn,
              checkOut: reservation.checkOut,
              notes: reservation.notes,
            },
          });
        }
      }
      setCsvPreview([]);
      setCsvResult("Importacion confirmada");
    } catch (error) {
      handleActionError(error, "Importacion cancelada por conflicto en DB.");
    } finally {
      setCsvImporting(false);
    }
  }

  async function saveManualReservation(input: {
    reservationId?: string;
    unitId: string;
    platform: Reservation["platform"];
    guest: string;
    checkIn: string;
    checkOut: string;
    notes?: string;
    guestData?: Reservation["guestData"];
  }) {
    try {
      if (input.reservationId) {
        await updateReservationAction({
          reservationId: input.reservationId,
          unitId: input.unitId,
          platform: input.platform,
          guest: input.guest,
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          notes: input.notes,
          guestData: input.guestData,
        });
        setLocalReservations((current) =>
          current.map((reservation) =>
            reservation.id === input.reservationId
              ? { ...reservation, ...input, id: reservation.id, notes: input.notes || undefined, guestData: input.guestData }
              : reservation,
          ),
        );
        setEditingReservationId(null);
        return;
      }

      await createReservationAction({
        unitId: input.unitId,
        platform: input.platform,
        guest: input.guest,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        notes: input.notes,
        guestData: input.guestData,
      });
      setLocalReservations((current) => [
        {
          id: `r-manual-${Date.now()}`,
          unitId: input.unitId,
          platform: input.platform,
          guest: input.guest,
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          notes: input.notes || undefined,
          guestData: input.guestData,
        },
        ...current,
      ]);
    } catch (error) {
      handleActionError(error, "No se pudo guardar la reserva manual.");
    }
  }

  async function removeManualReservation(reservationId: string) {
    try {
      await deleteReservationAction(reservationId);
      setLocalReservations((current) => current.filter((reservation) => reservation.id !== reservationId));
      if (editingReservationId === reservationId) setEditingReservationId(null);
    } catch (error) {
      handleActionError(error, "No se pudo eliminar la reserva.");
    }
  }

  async function closeOperationalFlow(input: {
    unitId: string;
    ticketId?: string;
    checklist: Record<string, boolean>;
    evidenceRequired: boolean;
    evidenceCount: number;
    notes?: string;
  }) {
    try {
      await createOperationalClosureAction(input);
      setLocalClosures((current) => [
        {
          id: `cl-${Date.now()}`,
          unitId: input.unitId,
          ticketId: input.ticketId,
          actorUserId: sessionUser.id,
          checklist: input.checklist,
          evidenceRequired: input.evidenceRequired,
          evidenceCount: input.evidenceCount,
          notes: input.notes || undefined,
          closedAt: new Date().toISOString(),
        },
        ...current,
      ]);
    } catch (error) {
      handleActionError(error, "No se pudo registrar el cierre operativo.");
    }
  }

  function downloadCsvErrors() {
    if (csvErrors.length === 0) return;
    const header = "row,reason";
    const lines = csvErrors.map((item) => `${item.row},\"${item.reason.replaceAll("\"", "\"\"")}\"`);
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "csv-import-errors.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportFilteredDepartmentsCsv() {
    if (departmentFilteredUnits.length === 0) return;

    const escapeCsv = (value: string | number | null | undefined) => {
      const normalized = String(value ?? "");
      return `"${normalized.replaceAll("\"", "\"\"")}"`;
    };

    const header = "code,address,zone,status,owner,bedrooms,floor,next_check_in";
    const lines = departmentFilteredUnits.map((unit) =>
      [
        escapeCsv(unit.code),
        escapeCsv(unit.address),
        escapeCsv(unit.zone),
        escapeCsv(unit.status),
        escapeCsv(unit.owner),
        escapeCsv(unit.bedrooms),
        escapeCsv(unit.floor),
        escapeCsv(unit.nextCheckIn),
      ].join(","),
    );

    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(
      now.getMinutes(),
    )}`;
    const filename = `departamentos-filtrados-${stamp}.csv`;

    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#f6f7f4] text-[#1d2722] dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto flex min-h-screen w-full max-w-[1600px] min-w-0 flex-col lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="hidden border-r border-[#d8ded6] bg-[#eef1ea] p-5 dark:border-zinc-800 dark:bg-zinc-900 lg:block">
          <Navigation activeTab={activeTab} onNavigate={setActiveTab} />
        </aside>

        <section className="flex min-w-0 flex-col overflow-x-hidden">
          <Dialog open={Boolean(departmentEditorUnit)} onOpenChange={(open) => !open && setDepartmentEditorUnit(null)}>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Editar departamento</DialogTitle>
              </DialogHeader>
              {departmentEditorUnit ? (
                <form action={saveDepartmentEdit} className="grid gap-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Input name="code" defaultValue={departmentEditorUnit.code} placeholder="Codigo" />
                    <Input name="zone" defaultValue={departmentEditorUnit.zone} placeholder="Zona" />
                  </div>
                  <Input name="address" defaultValue={departmentEditorUnit.address} placeholder="Direccion" />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Input name="owner" defaultValue={departmentEditorUnit.owner} placeholder="Owner" />
                    <Input name="floor" defaultValue={departmentEditorUnit.floor} placeholder="Piso" />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Input name="bedrooms" type="number" min={0} defaultValue={String(departmentEditorUnit.bedrooms)} placeholder="Ambientes" />
                    <select name="status" defaultValue={departmentEditorUnit.status} className="h-10 rounded-lg border border-[#d8ded6] bg-white px-3 text-sm">
                      {unitStatuses.map((status) => (
                        <option key={status} value={status}>{unitStatusLabel(status)}</option>
                      ))}
                    </select>
                  </div>
                  <Input name="imageUrl" defaultValue={departmentEditorUnit.imageUrl} placeholder="URL de imagen (opcional)" />
                  <div className="flex gap-2">
                    <Button type="submit">Guardar cambios</Button>
                    <Button type="button" variant="outline" onClick={() => setDepartmentEditorUnit(null)}>
                      Cancelar
                    </Button>
                  </div>
                </form>
              ) : null}
            </DialogContent>
          </Dialog>
          <header className="sticky top-0 z-20 border-b border-[#d8ded6] bg-[#f6f7f4]/95 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95 md:px-6">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-normal text-[#66736c]">Panel operativo interno</p>
                <h1 className="truncate text-xl font-semibold md:text-2xl">Control diario CABA</h1>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <div className="hidden max-w-[220px] truncate rounded-lg border border-[#d8ded6] bg-white px-3 py-2 text-sm text-[#33423b] xl:block">
                  {sessionUser.name} ({sessionUser.role})
                </div>
                <Button
                  variant="outline"
                  className="h-11"
                  onClick={() => signOut({ callbackUrl: "/" })}
                >
                  <LogOut className="size-4" />
                  <span className="hidden sm:inline">Salir</span>
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-11 w-11"
                  aria-label={theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
                  onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
                >
                  {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
                </Button>
                {canManage ? (
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button className="h-11 bg-[#26352f] text-white hover:bg-[#31473e]" aria-label="Crear alta rapida">
                        <Plus className="size-4" />
                        <span className="hidden sm:inline">Crear</span>
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-h-[90vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>Alta rapida</DialogTitle>
                      </DialogHeader>
                      <QuickCreateForms
                        addUnit={addUnit}
                        addTicket={addTicket}
                      addTask={addTask}
                      units={visibleUnits}
                      users={visibleUsers}
                    />
                    </DialogContent>
                  </Dialog>
                ) : (
                  <div className="hidden rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 sm:block">
                    Modo restringido: sin permisos para crear
                  </div>
                )}
                <Sheet open={isNavOpen} onOpenChange={setIsNavOpen}>
                  <SheetTrigger asChild>
                    <Button variant="outline" size="icon" className="h-11 w-11 lg:hidden" aria-label="Abrir menu">
                      <Menu className="size-5" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="w-[300px] bg-[#eef1ea]">
                    <SheetHeader>
                      <SheetTitle>Operaciones</SheetTitle>
                    </SheetHeader>
                    <Navigation
                      activeTab={activeTab}
                      onNavigate={(tab) => {
                        setActiveTab(tab);
                        setIsNavOpen(false);
                      }}
                    />
                  </SheetContent>
                </Sheet>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge className="border border-[#ccd5cf] bg-white text-[#2f3c35]">
                {initialData.source === "database" ? "Sistema conectado" : "Trabajando sin conexión"}
              </Badge>
              <Badge className="border border-[#ccd5cf] bg-white text-[#2f3c35]">
                Rol: {sessionUser.role}
              </Badge>
              <Badge className="border border-[#ccd5cf] bg-white text-[#2f3c35]">
                Riesgo hoy: {atRiskUnits.length}
              </Badge>
              <Badge className="border border-[#ccd5cf] bg-white text-[#2f3c35]">
                Pendientes: {openTickets.length}
              </Badge>
              {offlineOps.length > 0 ? (
                <Badge className="border border-amber-300 bg-amber-50 text-amber-900">Pendientes por enviar: {offlineOps.length}</Badge>
              ) : null}
            </div>
          </header>

            <div className="grid min-w-0 gap-4 p-4 pb-52 md:p-6 md:pb-6">
            {actionError ? (
              <div role="alert" aria-live="polite" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {actionError}
              </div>
            ) : null}
            {actionInfo ? (
              <div aria-live="polite" className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-700">
                {actionInfo}
              </div>
            ) : null}
            {initialData.source === "mock" ? (
              <div aria-live="polite" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <span>Trabajando sin conexión. Tus cambios se guardan en este dispositivo y se enviarán luego. Pendientes: {offlineOps.length}. Red: {isOnline === null ? "desconocida" : isOnline ? "conectada" : "sin conexión"}</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isRefreshing}
                    onClick={() =>
                      startRefresh(() => {
                        router.refresh();
                      })
                    }
                  >
                    {isRefreshing ? "Verificando..." : "Actualizar estado"}
                  </Button>
                </div>
              </div>
            ) : (
              <div aria-live="polite" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                <span>Sistema conectado. Los cambios se guardan en línea. Red: {isOnline === null ? "desconocida" : isOnline ? "conectada" : "sin conexión"}</span>
                {offlineOps.length > 0 ? (
                  <Button size="sm" onClick={() => syncOfflineOps()} aria-label="Enviar cambios pendientes">
                    Enviar {offlineOps.length} pendientes
                  </Button>
                ) : null}
              </div>
            )}
            <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Metric icon={Home} label="Unidades activas" value={String(localUnits.length)} detail={`${atRiskUnits.length} en riesgo hoy`} />
              <Metric icon={ClipboardList} label="Tickets abiertos" value={String(openTickets.length)} detail="Criticos primero" />
              <Metric icon={CalendarClock} label="Check-ins 24h" value={String(checksInNext24h)} detail="Ventana operativa inmediata" />
              <Metric icon={Bell} label="Avisos sin leer" value={String(unreadNotifications.length)} detail="In-app + email" />
            </section>

              <Tabs value={activeTab} onValueChange={setActiveTab} className="min-w-0 w-full">
                <TabsList className="hidden h-auto w-full gap-1 overflow-x-auto bg-[#e7ece4] p-1 md:grid md:grid-cols-6 md:overflow-visible">
                <TabsTrigger value="operacion" className="min-w-max whitespace-nowrap px-3 text-xs data-[state=active]:bg-[#1f2d26] data-[state=active]:text-white md:text-sm">Operacion</TabsTrigger>
                <TabsTrigger value="kanban" className="min-w-max whitespace-nowrap px-3 text-xs data-[state=active]:bg-[#1f2d26] data-[state=active]:text-white md:text-sm">Kanban</TabsTrigger>
                <TabsTrigger value="riesgo" className="min-w-max whitespace-nowrap px-3 text-xs data-[state=active]:bg-[#1f2d26] data-[state=active]:text-white md:text-sm">Riesgo</TabsTrigger>
                <TabsTrigger value="reservas" className="min-w-max whitespace-nowrap px-3 text-xs data-[state=active]:bg-[#1f2d26] data-[state=active]:text-white md:text-sm">Reservas</TabsTrigger>
                <TabsTrigger value="sla" className="min-w-max whitespace-nowrap px-3 text-xs data-[state=active]:bg-[#1f2d26] data-[state=active]:text-white md:text-sm">Tiempos</TabsTrigger>
                <TabsTrigger value="ayuda" className="min-w-max whitespace-nowrap px-3 text-xs data-[state=active]:bg-[#1f2d26] data-[state=active]:text-white md:text-sm">Ayuda</TabsTrigger>
              </TabsList>

              <TabsContent value="operacion" className="mt-4 grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
                <div className="grid min-w-0 gap-4">
                  <Card className="rounded-lg border-[#d8ded6] shadow-none">
                    <CardHeader className="gap-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <CardTitle>Unidades y riesgo de check-in</CardTitle>
                        <label className="relative block sm:w-80">
                          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#66736c]" />
                          <Input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Buscar unidad, barrio u owner"
                            aria-label="Buscar unidad"
                            className="h-11 pl-9"
                          />
                        </label>
                      </div>
                    </CardHeader>
                    <CardContent className="grid gap-3">
                      {filteredUnits.length === 0 ? (
                        <div className="rounded-lg border border-[#d8ded6] bg-white px-3 py-6 text-center text-sm text-[#66736c]">
                          No hay resultados para tu búsqueda.
                        </div>
                      ) : null}
                      {filteredUnits.map((unit) => {
                        const unitTickets = localTickets.filter((ticket) => ticket.unitId === unit.id);
                        const risk = isCheckInAtRisk(unit, unitTickets);

                        return (
                          <button
                            key={unit.id}
                            onClick={() => setSelectedUnitId(unit.id)}
                            className={`grid w-full gap-3 rounded-lg border p-3 text-left transition sm:grid-cols-[130px_minmax(0,1fr)_auto] ${
                              selectedUnitId === unit.id ? "border-[#26352f] bg-[#f0f4ed]" : "border-[#d8ded6] bg-white"
                            }`}
                          >
                            <ApartmentPhoto unit={unit} className="h-24 sm:h-full" />
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold">{unit.code}</span>
                                <Badge className={statusTone[unit.status]}>{unitStatusLabel(unit.status)}</Badge>
                                {risk ? <Badge className="bg-red-600 text-white">riesgo</Badge> : null}
                              </div>
                              <p className="mt-1 text-sm text-[#66736c]">{unit.address}</p>
                              <p className="mt-2 text-xs text-[#66736c]">
                                Piso {unit.floor} · {unit.bedrooms} amb. · Check-in {formatShortDate(unit.nextCheckIn)}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 text-sm text-[#66736c] sm:justify-end">
                              <Wrench className="size-4" />
                              {unitTickets.length} tickets
                            </div>
                          </button>
                        );
                      })}
                    </CardContent>
                  </Card>

                  <TicketsPanel
                    tickets={openTickets}
                    units={visibleUnits}
                    markTicketResolved={markTicketResolved}
                    canResolveTicket={(ticket) => canManage || ticket.assigneeId === sessionUser.id}
                  />
                </div>

                {selectedVisibleUnit ? (
                  <UnitDetail
                    key={selectedVisibleUnit.id}
                    unit={selectedVisibleUnit}
                    tickets={visibleTickets.filter((ticket) => ticket.unitId === selectedVisibleUnit.id)}
                    evidence={localEvidence.filter((item) => item.unitId === selectedVisibleUnit.id)}
                    closures={localClosures.filter((closure) => closure.unitId === selectedVisibleUnit.id)}
                    updateUnitStatus={updateUnitStatus}
                    addEvidence={addEvidence}
                    closeOperationalFlow={closeOperationalFlow}
                    canManageUnit={canManage}
                  />
                ) : (
                  <Card className="h-fit rounded-lg border-[#d8ded6] shadow-none">
                    <CardHeader>
                      <CardTitle>Sin unidad asignada</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-[#66736c]">
                      No hay unidades visibles para tu rol por ahora.
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="kanban" className="mt-4">
                <UnitKanbanPanel
                  units={visibleUnits}
                  tickets={visibleTickets}
                  canManage={canManage}
                  onMoveStatus={(unitId, status) => updateUnitStatus(unitId, status)}
                  onOpenUnit={(unitId) => {
                    setSelectedUnitId(unitId);
                    setActiveTab("operacion");
                  }}
                />
              </TabsContent>

              <TabsContent value="departamentos" className="mt-4">
                <Card className="rounded-lg border-[#d8ded6] shadow-none">
                  <CardHeader className="gap-3">
                    <CardTitle>Gestion masiva de departamentos</CardTitle>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={departmentViewMode === "cards" ? "default" : "outline"}
                        onClick={() => setDepartmentViewMode("cards")}
                      >
                        <LayoutGrid className="mr-1 size-3.5" />
                        Tarjetas
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={departmentViewMode === "list" ? "default" : "outline"}
                        onClick={() => setDepartmentViewMode("list")}
                      >
                        <List className="mr-1 size-3.5" />
                        Lista
                      </Button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_180px_180px_180px_160px]">
                      <label className="relative block">
                        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#66736c]" />
                        <Input
                          value={departmentQuery}
                          onChange={(event) => {
                            setDepartmentQuery(event.target.value);
                            setDepartmentPage(1);
                          }}
                          placeholder="Filtrar por codigo, zona, owner o direccion"
                          className="h-11 pl-9"
                        />
                      </label>
                      <Select
                        value={departmentStatusFilter}
                        onValueChange={(value) => {
                          setDepartmentStatusFilter(value as "all" | Unit["status"]);
                          setDepartmentPage(1);
                        }}
                      >
                        <SelectTrigger className="h-11 w-full">
                          <SelectValue placeholder="Estado" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todos los estados</SelectItem>
                          {unitStatuses.map((status) => (
                            <SelectItem key={status} value={status}>
                              {unitStatusLabel(status)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={departmentZoneFilter}
                        onValueChange={(value) => {
                          setDepartmentZoneFilter(value);
                          setDepartmentPage(1);
                        }}
                      >
                        <SelectTrigger className="h-11 w-full">
                          <SelectValue placeholder="Zona" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todas las zonas</SelectItem>
                          {zoneOptions.map((zone) => (
                            <SelectItem key={zone} value={zone}>
                              {zone}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={departmentSort}
                        onValueChange={(value) => {
                          setDepartmentSort(value as "score" | "code" | "zone" | "checkin");
                          setDepartmentPage(1);
                        }}
                      >
                        <SelectTrigger className="h-11 w-full">
                          <SelectValue placeholder="Orden" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="checkin">Orden: check-in</SelectItem>
                          <SelectItem value="score">Orden: tickets abiertos</SelectItem>
                          <SelectItem value="code">Orden: codigo</SelectItem>
                          <SelectItem value="zone">Orden: zona</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select
                        value={departmentPageSize}
                        onValueChange={(value) => {
                          setDepartmentPageSize(value);
                          setDepartmentPage(1);
                        }}
                      >
                        <SelectTrigger className="h-11 w-full">
                          <SelectValue placeholder="Filas por pagina" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="10">10 por pagina</SelectItem>
                          <SelectItem value="25">25 por pagina</SelectItem>
                          <SelectItem value="50">50 por pagina</SelectItem>
                          <SelectItem value="100">100 por pagina</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    <div className="rounded-lg border border-[#d8ded6] bg-[#f7f9f5] p-3">
                      <div className="grid gap-2 lg:grid-cols-[200px_220px_minmax(180px,1fr)_auto]">
                        <Select value={bulkStatus} onValueChange={(value) => setBulkStatus(value as "none" | Unit["status"])}>
                          <SelectTrigger className="h-10 w-full">
                            <SelectValue placeholder="Estado masivo" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Sin cambio de estado</SelectItem>
                            {unitStatuses.map((status) => (
                              <SelectItem key={status} value={status}>
                                {unitStatusLabel(status)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          value={bulkZone}
                          onChange={(event) => setBulkZone(event.target.value)}
                          placeholder="Zona masiva (opcional)"
                          className="h-10"
                        />
                        <Input
                          value={bulkOwner}
                          onChange={(event) => setBulkOwner(event.target.value)}
                          placeholder="Owner masivo (opcional)"
                          className="h-10"
                        />
                        <Button className="w-full lg:w-auto" onClick={() => applyDepartmentBulkUpdate()} disabled={!canManage || selectedDepartmentIds.length === 0}>
                          Aplicar a {selectedDepartmentIds.length}
                        </Button>
                      </div>
                      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs text-[#66736c]">
                          Seleccionados: {selectedDepartmentIds.length} · Filtro actual: {departmentFilteredUnits.length} departamentos
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => exportFilteredDepartmentsCsv()}
                          disabled={departmentFilteredUnits.length === 0}
                        >
                          Exportar CSV
                        </Button>
                      </div>
                    </div>
                    {departmentViewMode === "cards" ? (
                    <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                      {pagedDepartmentUnits.length === 0 ? (
                        <div className="rounded-lg border border-[#d8ded6] bg-white px-3 py-6 text-center text-sm text-[#66736c]">
                          Sin resultados para los filtros actuales.
                        </div>
                      ) : (
                        pagedDepartmentUnits.map((unit) => {
                          const openUnitTickets = visibleTickets.filter(
                            (ticket) => ticket.unitId === unit.id && !["resuelto", "cerrado"].includes(ticket.status),
                          ).length;
                          return (
                            <div key={unit.id} className="grid min-w-0 gap-3 rounded-lg border border-[#d8ded6] bg-white p-3">
                              <div className="mb-2 flex items-start justify-between gap-2">
                                <div>
                                  <p className="font-semibold">{unit.code}</p>
                                  <p className="text-xs text-[#66736c]">{unit.zone} · {unit.floor} · {unit.bedrooms} amb.</p>
                                </div>
                                <input
                                  type="checkbox"
                                  aria-label={`Seleccionar ${unit.code}`}
                                  checked={selectedDepartmentSet.has(unit.id)}
                                  onChange={() => toggleDepartmentSelection(unit.id)}
                                  className="mt-1 size-4 accent-[#26352f]"
                                />
                              </div>
                              <p className="min-w-0 break-words text-sm text-[#44514a]">{unit.address}</p>
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <Badge className={statusTone[unit.status]}>{unitStatusLabel(unit.status)}</Badge>
                                <Badge variant="outline">{openUnitTickets} tickets</Badge>
                                <span className="text-xs text-[#66736c]">Owner: {unit.owner}</span>
                              </div>
                              <p className="mt-2 text-xs text-[#66736c]">Check-in: {formatShortDate(unit.nextCheckIn)}</p>
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="w-full"
                                  onClick={() => {
                                    setSelectedUnitId(unit.id);
                                    setActiveTab("operacion");
                                  }}
                                >
                                  Abrir operacion
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="w-full"
                                  disabled={!canManage || unit.status === "lista"}
                                  onClick={() => updateUnitStatus(unit.id, "lista")}
                                >
                                  Marcar lista
                                </Button>
                                <Button size="sm" className="w-full" onClick={() => setDepartmentEditorUnit(unit)}>
                                  Editar
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="w-full border-red-300 text-red-700 hover:bg-red-50"
                                  disabled={!canManage}
                                  onClick={() => void removeUnit(unit.id)}
                                >
                                  Eliminar
                                </Button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                    ) : (
                    <div className="overflow-x-auto rounded-lg border border-[#d8ded6] bg-white">
                      <table className="w-full min-w-[1120px] text-sm">
                        <thead className="bg-[#eef1ea] text-left text-xs uppercase tracking-wide text-[#66736c]">
                          <tr>
                            <th className="px-3 py-2">
                              <input
                                type="checkbox"
                                aria-label="Seleccionar pagina"
                                checked={pagedDepartmentUnits.length > 0 && pagedDepartmentUnits.every((unit) => selectedDepartmentSet.has(unit.id))}
                                onChange={() => toggleSelectAllVisibleDepartments()}
                                className="size-4 accent-[#26352f]"
                              />
                            </th>
                            <th className="px-3 py-2">Codigo</th>
                            <th className="px-3 py-2">Zona</th>
                            <th className="px-3 py-2">Direccion</th>
                            <th className="px-3 py-2">Piso</th>
                            <th className="px-3 py-2">Amb.</th>
                            <th className="px-3 py-2">Estado</th>
                            <th className="px-3 py-2">Owner</th>
                            <th className="px-3 py-2">Tickets abiertos</th>
                            <th className="px-3 py-2">Proximo check-in</th>
                            <th className="border-l border-[#d8ded6] bg-[#eef1ea] px-3 py-2 text-right">Acciones</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#d8ded6] bg-white">
                          {pagedDepartmentUnits.length === 0 ? (
                            <tr>
                              <td colSpan={11} className="px-3 py-6 text-center text-sm text-[#66736c]">
                                Sin resultados para los filtros actuales.
                              </td>
                            </tr>
                          ) : (
                            pagedDepartmentUnits.map((unit) => {
                              const openUnitTickets = visibleTickets.filter(
                                (ticket) => ticket.unitId === unit.id && !["resuelto", "cerrado"].includes(ticket.status),
                              ).length;
                              return (
                              <tr key={unit.id} className="hover:bg-[#f8faf7]">
                                <td className="px-3 py-3">
                                  <input
                                    type="checkbox"
                                    aria-label={`Seleccionar ${unit.code}`}
                                    checked={selectedDepartmentSet.has(unit.id)}
                                    onChange={() => toggleDepartmentSelection(unit.id)}
                                    className="size-4 accent-[#26352f]"
                                  />
                                </td>
                                <td className="px-3 py-3 font-medium">{unit.code}</td>
                                <td className="px-3 py-3">{unit.zone}</td>
                                <td className="max-w-[340px] truncate px-3 py-3" title={unit.address}>{unit.address}</td>
                                <td className="px-3 py-3">{unit.floor}</td>
                                <td className="px-3 py-3">{unit.bedrooms}</td>
                                <td className="px-3 py-3">
                                  <Badge className={statusTone[unit.status]}>{unitStatusLabel(unit.status)}</Badge>
                                </td>
                                <td className="max-w-[180px] truncate px-3 py-3" title={unit.owner}>{unit.owner}</td>
                                <td className="px-3 py-3">
                                  <Badge variant="outline">{openUnitTickets}</Badge>
                                </td>
                                <td className="px-3 py-3">{formatShortDate(unit.nextCheckIn)}</td>
                                <td className="border-l border-[#e3e8e2] bg-white px-3 py-3">
                                  <div className="grid w-[164px] grid-cols-2 gap-1.5">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-8 px-2 text-[11px]"
                                      onClick={() => {
                                        setSelectedUnitId(unit.id);
                                        setActiveTab("operacion");
                                      }}
                                    >
                                      Abrir
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-8 px-2 text-[11px]"
                                      disabled={!canManage || unit.status === "lista"}
                                      onClick={() => updateUnitStatus(unit.id, "lista")}
                                    >
                                      Lista
                                    </Button>
                                    <Button size="sm" className="h-8 px-2 text-[11px]" onClick={() => setDepartmentEditorUnit(unit)}>
                                      Editar
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-8 border-red-300 px-2 text-[11px] text-red-700 hover:bg-red-50"
                                      disabled={!canManage}
                                      onClick={() => void removeUnit(unit.id)}
                                    >
                                      Eliminar
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                          )}
                        </tbody>
                      </table>
                    </div>
                    )}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs text-[#66736c]">
                        Mostrando {pagedDepartmentUnits.length === 0 ? 0 : (safeDepartmentPage - 1) * parsedDepartmentPageSize + 1}-
                        {(safeDepartmentPage - 1) * parsedDepartmentPageSize + pagedDepartmentUnits.length} de {departmentFilteredUnits.length}
                      </p>
                       <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={safeDepartmentPage <= 1}
                          onClick={() => setDepartmentPage((current) => Math.max(1, current - 1))}
                        >
                          Anterior
                        </Button>
                        <span className="text-xs text-[#66736c]">
                          Pagina {safeDepartmentPage} de {totalDepartmentPages}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={safeDepartmentPage >= totalDepartmentPages}
                          onClick={() => setDepartmentPage((current) => Math.min(totalDepartmentPages, current + 1))}
                        >
                          Siguiente
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="riesgo" className="mt-4">
                <CheckInRiskPanel
                  units={visibleUnits}
                  tickets={visibleTickets}
                  tasks={visibleTasks}
                  users={visibleUsers}
                  zoneFilter={riskZoneFilter}
                  statusFilter={riskStatusFilter}
                  priorityFilter={riskPriorityFilter}
                  horizonHours={Number(riskHorizonHours)}
                  zones={unitZones}
                  setZoneFilter={setRiskZoneFilter}
                  setStatusFilter={setRiskStatusFilter}
                  setPriorityFilter={setRiskPriorityFilter}
                  setHorizonHours={setRiskHorizonHours}
                  canManage={canManage}
                  openUnit={(unitId) => {
                    setSelectedUnitId(unitId);
                    setActiveTab("operacion");
                  }}
                  markUnitReady={(unitId) => updateUnitStatus(unitId, "lista")}
                  markTicketResolved={markTicketResolved}
                />
              </TabsContent>

              <TabsContent value="sla" className="mt-4">
                <SlaBoardPanel
                  units={visibleUnits}
                  tickets={visibleTickets}
                  tasks={visibleTasks}
                  canManage={canManage}
                  onEscalate={escalateSlaItem}
                  onOpenUnit={(unitId) => {
                    setSelectedUnitId(unitId);
                    setActiveTab("operacion");
                  }}
                />
              </TabsContent>
              <TabsContent value="ejecutivo" className="mt-4">
                <ExecutiveBoardPanel units={visibleUnits} tickets={visibleTickets} tasks={visibleTasks} reservations={localReservations} />
              </TabsContent>
              <TabsContent value="golive" className="mt-4">
                <GoLivePanel
                  units={visibleUnits}
                  tickets={visibleTickets}
                  tasks={visibleTasks}
                  reservations={localReservations}
                  notifications={localNotifications}
                  source={initialData.source}
                />
              </TabsContent>
              <TabsContent value="control" className="mt-4">
                <CommandCenterPanel
                  units={visibleUnits}
                  tickets={visibleTickets}
                  tasks={visibleTasks}
                  reservations={localReservations}
                  notifications={localNotifications}
                />
              </TabsContent>
              <TabsContent value="ayuda" className="mt-4">
                <HelpCenterPanel canManage={canManage} onNavigate={setActiveTab} />
              </TabsContent>

              <TabsContent value="tareas" className="mt-4">
                <TasksPanel
                  tasks={visibleTasks}
                  units={visibleUnits}
                  updateTaskStatus={updateTaskStatus}
                  canUpdateTask={(task) => canManage || task.assigneeId === sessionUser.id}
                />
              </TabsContent>

              <TabsContent value="reservas" className="mt-4 grid items-start gap-4 lg:grid-cols-[1fr_360px]">
                <ReservationsPanel
                  handleCsv={handleCsv}
                  confirmCsvImport={confirmCsvImport}
                  downloadCsvErrors={downloadCsvErrors}
                  saveManualReservation={saveManualReservation}
                  removeManualReservation={removeManualReservation}
                  editingReservationId={editingReservationId}
                  setEditingReservationId={setEditingReservationId}
                  csvPreview={csvPreview}
                  csvErrors={csvErrors}
                  csvImporting={csvImporting}
                  csvResult={csvResult}
                  units={visibleUnits}
                  reservations={localReservations}
                />
              </TabsContent>

              <TabsContent value="avisos" className="mt-4">
                <NotificationsPanel
                  notifications={localNotifications}
                  evaluateOperationalSla={evaluateOperationalSla}
                  markRead={(notificationId) => {
                    setLocalNotifications((current) =>
                      current.map((notification) =>
                        notification.id === notificationId ? { ...notification, read: true } : notification,
                      ),
                    );
                    markNotificationReadAction(notificationId).catch((error) =>
                      handleActionError(error, "No se pudo marcar la notificacion como leida."),
                    );
                  }}
                  markAllRead={() => {
                    setLocalNotifications((current) => current.map((notification) => ({ ...notification, read: true })));
                    markAllNotificationsReadAction().catch((error) =>
                      handleActionError(error, "No se pudieron marcar las notificaciones."),
                    );
                  }}
                />
              </TabsContent>

              <TabsContent value="agentes" className="mt-4">
                <AgentsPanel
                  canManage={canManage}
                  logs={localAgentLogs}
                  onLogCreated={(item) => setLocalAgentLogs((current) => [item, ...current].slice(0, 20))}
                />
              </TabsContent>

              <TabsContent value="usuarios" className="mt-4">
                <UsersPanel
                  users={localUsers}
                  canManage={sessionUser.role === "admin"}
                  onUsersUpdated={setLocalUsers}
                />
              </TabsContent>
            </Tabs>
          </div>
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#d8ded6] bg-[#f6f7f4]/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden">
            <div className="mx-auto flex w-full max-w-7xl snap-x snap-mandatory gap-2 overflow-x-auto">
              <Button variant={activeTab === "operacion" ? "default" : "outline"} className="h-10 shrink-0 snap-start text-xs" onClick={() => setActiveTab("operacion")}>
                Operación
              </Button>
              <Button variant={activeTab === "kanban" ? "default" : "outline"} className="h-10 shrink-0 snap-start text-xs" onClick={() => setActiveTab("kanban")}>
                Kanban
              </Button>
              <Button variant={activeTab === "riesgo" ? "default" : "outline"} className="h-10 shrink-0 snap-start text-xs" onClick={() => setActiveTab("riesgo")}>
                Riesgo
              </Button>
              <Button variant={activeTab === "sla" ? "default" : "outline"} className="h-10 shrink-0 snap-start text-xs" onClick={() => setActiveTab("sla")}>
                Tiempos
              </Button>
              <Button variant={activeTab === "ayuda" ? "default" : "outline"} className="h-10 shrink-0 snap-start text-xs" onClick={() => setActiveTab("ayuda")}>
                Ayuda
              </Button>
              <Button variant={activeTab === "reservas" ? "default" : "outline"} className="h-10 shrink-0 snap-start text-xs" onClick={() => setActiveTab("reservas")}>
                Reservas
              </Button>
              <Button variant="outline" className="h-10 shrink-0 snap-start text-xs" onClick={() => setIsNavOpen(true)}>
                Más
              </Button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function SlaBoardPanel({
  units,
  tickets,
  tasks,
  canManage,
  onEscalate,
  onOpenUnit,
}: {
  units: Unit[];
  tickets: Ticket[];
  tasks: Task[];
  canManage: boolean;
  onEscalate: (input: { title: string; entityType: "ticket" | "task" | "unit"; entityId: string; body?: string }) => void;
  onOpenUnit: (unitId: string) => void;
}) {
  const now = useMemo(() => getOperationalNow(), []);
  const overdueTickets = useMemo(
    () =>
      tickets
        .filter((ticket) => !["resuelto", "cerrado"].includes(ticket.status))
        .filter((ticket) => isBefore(parseISO(ticket.dueAt), now))
        .sort((a, b) => parseISO(a.dueAt).getTime() - parseISO(b.dueAt).getTime()),
    [tickets, now],
  );
  const dueSoonTickets = useMemo(
    () =>
      tickets
        .filter((ticket) => !["resuelto", "cerrado"].includes(ticket.status))
        .map((ticket) => ({ ticket, hours: differenceInHours(parseISO(ticket.dueAt), now) }))
        .filter((item) => item.hours >= 0 && item.hours <= 8)
        .sort((a, b) => a.hours - b.hours),
    [tickets, now],
  );
  const overdueTasks = useMemo(
    () =>
      tasks
        .filter((task) => !["resuelto", "cerrado"].includes(task.status))
        .filter((task) => isBefore(parseISO(task.dueAt), now))
        .sort((a, b) => parseISO(a.dueAt).getTime() - parseISO(b.dueAt).getTime()),
    [tasks, now],
  );
  const blockedUnits = useMemo(
    () =>
      units.filter((unit) => {
        const unitCritical = tickets.some(
          (ticket) => ticket.unitId === unit.id && ticket.priority === "critico" && !["resuelto", "cerrado"].includes(ticket.status),
        );
        return unit.status !== "lista" && unitCritical;
      }),
    [units, tickets],
  );

  return (
    <Card className="min-w-0 rounded-lg border-[#d8ded6] shadow-none">
      <CardHeader className="gap-3">
        <CardTitle>Tablero de tiempos y escalamiento</CardTitle>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm">Tickets vencidos: <strong>{overdueTickets.length}</strong></div>
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm">Tickets &lt;= 8h: <strong>{dueSoonTickets.length}</strong></div>
          <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm">Tareas vencidas: <strong>{overdueTasks.length}</strong></div>
          <div className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm">Unidades bloqueadas: <strong>{blockedUnits.length}</strong></div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-[#d8ded6] bg-white p-3">
          <p className="mb-2 text-sm font-medium">Tickets vencidos</p>
          <div className="grid gap-2">
            {overdueTickets.slice(0, 20).map((ticket) => {
              const unit = units.find((currentUnit) => currentUnit.id === ticket.unitId);
              return (
                <div key={ticket.id} className="rounded-md border border-red-200 bg-red-50 p-2">
                  <p className="text-sm font-medium">{ticket.title}</p>
                  <p className="text-xs text-[#5a6861]">{unit?.code ?? "Unidad"} · vence {formatShortDate(ticket.dueAt)}</p>
                   <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Button size="sm" variant="outline" className="w-full" onClick={() => onOpenUnit(ticket.unitId)}>Abrir unidad</Button>
                    <Button
                      size="sm"
                      className="w-full"
                      disabled={!canManage}
                      onClick={() =>
                        onEscalate({
                          title: ticket.title,
                          entityType: "ticket",
                          entityId: ticket.id,
                          body: `${unit?.code ?? "Unidad"} vencido en SLA`,
                        })
                      }
                    >
                      Escalar
                    </Button>
                  </div>
                </div>
              );
            })}
            {overdueTickets.length === 0 ? <p className="text-xs text-[#66736c]">Sin tickets vencidos.</p> : null}
          </div>
        </div>
        <div className="rounded-lg border border-[#d8ded6] bg-white p-3">
          <p className="mb-2 text-sm font-medium">Cola de escalamiento</p>
          <div className="grid gap-2">
            {dueSoonTickets.slice(0, 12).map((item) => {
              const unit = units.find((currentUnit) => currentUnit.id === item.ticket.unitId);
              return (
                <div key={item.ticket.id} className="rounded-md border border-amber-200 bg-amber-50 p-2">
                  <p className="text-sm font-medium">{item.ticket.title}</p>
                  <p className="text-xs text-[#5a6861]">
                    {unit?.code ?? "Unidad"} · {item.hours}h restantes · {priorityLabel(item.ticket.priority)}
                  </p>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Button size="sm" variant="outline" className="w-full" onClick={() => onOpenUnit(item.ticket.unitId)}>Abrir unidad</Button>
                    <Button
                      size="sm"
                      className="w-full"
                      disabled={!canManage}
                      onClick={() =>
                        onEscalate({
                          title: item.ticket.title,
                          entityType: "ticket",
                          entityId: item.ticket.id,
                          body: `${unit?.code ?? "Unidad"} vence en ${item.hours}h`,
                        })
                      }
                    >
                      Pre-escalar
                    </Button>
                  </div>
                </div>
              );
            })}
            {dueSoonTickets.length === 0 ? <p className="text-xs text-[#66736c]">Sin items en ventana de 8h.</p> : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ExecutiveBoardPanel({
  units,
  tickets,
  tasks,
  reservations,
}: {
  units: Unit[];
  tickets: Ticket[];
  tasks: Task[];
  reservations: Reservation[];
}) {
  const now = useMemo(() => getOperationalNow(), []);
  const openTickets = useMemo(() => tickets.filter((ticket) => !["resuelto", "cerrado"].includes(ticket.status)), [tickets]);
  const resolvedTickets = useMemo(() => tickets.filter((ticket) => ["resuelto", "cerrado"].includes(ticket.status)), [tickets]);
  const openTasks = useMemo(() => tasks.filter((task) => !["resuelto", "cerrado"].includes(task.status)), [tasks]);
  const resolvedTasks = useMemo(() => tasks.filter((task) => ["resuelto", "cerrado"].includes(task.status)), [tasks]);
  const occupancyNext24h = useMemo(() => {
    const horizon = addHours(now, 24);
    const withReservation = new Set(
      reservations
        .filter((reservation) => {
          const inAt = parseISO(reservation.checkIn);
          const outAt = parseISO(reservation.checkOut);
          return inAt <= horizon && outAt >= now;
        })
        .map((reservation) => reservation.unitId),
    );
    if (units.length === 0) return 0;
    return Math.round((withReservation.size / units.length) * 100);
  }, [now, reservations, units]);
  const slaBreachRate = useMemo(() => {
    if (openTickets.length === 0) return 0;
    const breached = openTickets.filter((ticket) => isBefore(parseISO(ticket.dueAt), now)).length;
    return Math.round((breached / openTickets.length) * 100);
  }, [now, openTickets]);
  const avgResolutionHours = useMemo(() => {
    const candidates = tickets
      .filter((ticket) => ["resuelto", "cerrado"].includes(ticket.status))
      .map((ticket) => {
        const resolvedAt = parseISO(ticket.dueAt);
        const createdAt = addHours(resolvedAt, ticket.priority === "critico" ? -2 : -8);
        return Math.max(1, differenceInHours(resolvedAt, createdAt));
      });
    if (candidates.length === 0) return 0;
    return Math.round(candidates.reduce((sum, value) => sum + value, 0) / candidates.length);
  }, [tickets]);

  function exportExecutiveCsv() {
    const rows = [
      { kpi: "units_total", value: units.length },
      { kpi: "occupancy_next_24h_pct", value: occupancyNext24h },
      { kpi: "tickets_open", value: openTickets.length },
      { kpi: "tickets_resolved", value: resolvedTickets.length },
      { kpi: "tasks_open", value: openTasks.length },
      { kpi: "tasks_resolved", value: resolvedTasks.length },
      { kpi: "sla_breach_rate_pct", value: slaBreachRate },
      { kpi: "avg_resolution_hours", value: avgResolutionHours },
    ];
    const csv = Papa.unparse(rows, { columns: ["kpi", "value"] });
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `ejecutivo-kpis-${stamp}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Card className="min-w-0 rounded-lg border-[#d8ded6] shadow-none">
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Dashboard ejecutivo</CardTitle>
          <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={exportExecutiveCsv}>
            Exportar KPI CSV
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-md border border-[#d8ded6] bg-white px-3 py-2 text-sm">Ocupación 24h: <strong>{occupancyNext24h}%</strong></div>
          <div className="rounded-md border border-[#d8ded6] bg-white px-3 py-2 text-sm">Tickets abiertos: <strong>{openTickets.length}</strong></div>
          <div className="rounded-md border border-[#d8ded6] bg-white px-3 py-2 text-sm">Brecha de tiempos: <strong>{slaBreachRate}%</strong></div>
          <div className="rounded-md border border-[#d8ded6] bg-white px-3 py-2 text-sm">Resolución media: <strong>{avgResolutionHours}h</strong></div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-[#d8ded6] bg-white p-3">
          <p className="text-sm font-medium">Estado operativo</p>
          <ul className="mt-2 space-y-1 text-sm text-[#5a6861]">
            <li>Unidades totales: {units.length}</li>
            <li>Reservas cargadas: {reservations.length}</li>
            <li>Tareas abiertas: {openTasks.length}</li>
            <li>Tareas resueltas: {resolvedTasks.length}</li>
          </ul>
        </div>
        <div className="rounded-lg border border-[#d8ded6] bg-white p-3">
          <p className="text-sm font-medium">Semáforo ejecutivo</p>
          <div className="mt-2 grid gap-2">
            <div className={`rounded-md px-2 py-2 text-sm ${slaBreachRate > 35 ? "bg-red-50 text-red-800" : slaBreachRate > 15 ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>
              Tiempos: {slaBreachRate > 35 ? "Crítico" : slaBreachRate > 15 ? "Atención" : "Controlado"}
            </div>
            <div className={`rounded-md px-2 py-2 text-sm ${occupancyNext24h >= 80 ? "bg-emerald-50 text-emerald-800" : occupancyNext24h >= 60 ? "bg-amber-50 text-amber-800" : "bg-zinc-100 text-zinc-800"}`}>
              Demanda 24h: {occupancyNext24h >= 80 ? "Alta" : occupancyNext24h >= 60 ? "Media" : "Baja"}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function GoLivePanel({
  units,
  tickets,
  tasks,
  reservations,
  notifications,
  source,
}: {
  units: Unit[];
  tickets: Ticket[];
  tasks: Task[];
  reservations: Reservation[];
  notifications: NotificationItem[];
  source: "database" | "mock";
}) {
  const now = useMemo(() => getOperationalNow(), []);
  const openTickets = useMemo(() => tickets.filter((ticket) => !["resuelto", "cerrado"].includes(ticket.status)), [tickets]);
  const criticalOpenTickets = useMemo(() => openTickets.filter((ticket) => ticket.priority === "critico"), [openTickets]);
  const overdueTasks = useMemo(
    () => tasks.filter((task) => !["resuelto", "cerrado"].includes(task.status)).filter((task) => isBefore(parseISO(task.dueAt), now)),
    [tasks, now],
  );
  const unitsReady = useMemo(() => units.filter((unit) => unit.status === "lista").length, [units]);
  const unreadNotifications = useMemo(() => notifications.filter((item) => !item.read).length, [notifications]);
  const next24hReservations = useMemo(
    () => reservations.filter((reservation) => differenceInHours(parseISO(reservation.checkIn), now) <= 24 && differenceInHours(parseISO(reservation.checkIn), now) >= 0).length,
    [reservations, now],
  );
  const readinessPct = useMemo(() => {
    const checks = [
      source === "database",
      criticalOpenTickets.length === 0,
      overdueTasks.length === 0,
      units.length === 0 ? false : unitsReady / units.length >= 0.7,
      reservations.length > 0,
      unreadNotifications <= 20,
    ];
    const passed = checks.filter(Boolean).length;
    return Math.round((passed / checks.length) * 100);
  }, [source, criticalOpenTickets.length, overdueTasks.length, units.length, unitsReady, reservations.length, unreadNotifications]);

  const checklist = [
    { id: "db", area: "Infra", item: "DB online y persistencia activa", owner: "Admin", ok: source === "database", detail: source === "database" ? "Conectado a Supabase" : "Mock local activo" },
    { id: "crit", area: "Operación", item: "0 tickets críticos abiertos", owner: "Supervisor", ok: criticalOpenTickets.length === 0, detail: `${criticalOpenTickets.length} críticos abiertos` },
    { id: "task", area: "Operación", item: "0 tareas vencidas", owner: "Supervisor", ok: overdueTasks.length === 0, detail: `${overdueTasks.length} tareas vencidas` },
    { id: "unit", area: "Operación", item: ">=70% unidades listas", owner: "Limpieza", ok: units.length > 0 && unitsReady / units.length >= 0.7, detail: `${unitsReady}/${units.length} listas` },
    { id: "res", area: "Reservas", item: "Reservas próximas 24h cargadas", owner: "Recepción", ok: next24hReservations > 0, detail: `${next24hReservations} check-ins próximos` },
    { id: "notif", area: "Comms", item: "Bandeja controlada (<20 sin leer)", owner: "Supervisor", ok: unreadNotifications < 20, detail: `${unreadNotifications} sin leer` },
  ] as const;

  function exportGoLiveCsv() {
    const rows = checklist.map((row) => ({
      area: row.area,
      item: row.item,
      owner: row.owner,
      status: row.ok ? "ok" : "bloqueado",
      detail: row.detail,
    }));
    const csv = Papa.unparse(rows, { columns: ["area", "item", "owner", "status", "detail"] });
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `golive-checklist-${stamp}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const blockers = checklist.filter((item) => !item.ok);

  return (
    <Card className="min-w-0 rounded-lg border-[#d8ded6] shadow-none">
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Go-Live v1</CardTitle>
          <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={exportGoLiveCsv}>
            Exportar checklist CSV
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-md border border-[#d8ded6] bg-white px-3 py-2 text-sm">Readiness: <strong>{readinessPct}%</strong></div>
          <div className="rounded-md border border-[#d8ded6] bg-white px-3 py-2 text-sm">Bloqueadores: <strong>{blockers.length}</strong></div>
          <div className="rounded-md border border-[#d8ded6] bg-white px-3 py-2 text-sm">Tickets críticos: <strong>{criticalOpenTickets.length}</strong></div>
          <div className="rounded-md border border-[#d8ded6] bg-white px-3 py-2 text-sm">Tareas vencidas: <strong>{overdueTasks.length}</strong></div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-[#d8ded6] bg-white p-3">
          <p className="mb-2 text-sm font-medium">Checklist de salida</p>
          <div className="grid gap-2">
            {checklist.map((item) => (
              <div key={item.id} className={`rounded-md border p-2 text-sm ${item.ok ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{item.item}</span>
                  <Badge variant="outline">{item.area}</Badge>
                </div>
                <p className="mt-1 text-xs text-[#5a6861]">Owner: {item.owner} · {item.detail}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-[#d8ded6] bg-white p-3">
          <p className="mb-2 text-sm font-medium">Bloqueadores activos</p>
          <div className="grid gap-2">
            {blockers.length === 0 ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">Sin bloqueadores. V1 lista para salida controlada.</div>
            ) : (
              blockers.map((item) => (
                <div key={`block-${item.id}`} className="rounded-md border border-red-200 bg-red-50 p-2">
                  <p className="text-sm font-medium">{item.item}</p>
                  <p className="text-xs text-[#5a6861]">Dueño: {item.owner}</p>
                  <p className="text-xs text-red-700">{item.detail}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CommandCenterPanel({
  units,
  tickets,
  tasks,
  reservations,
  notifications,
}: {
  units: Unit[];
  tickets: Ticket[];
  tasks: Task[];
  reservations: Reservation[];
  notifications: NotificationItem[];
}) {
  type ActivityItem = {
    id: string;
    kind: "ticket" | "task" | "reservation" | "notification";
    ts: string;
    title: string;
    unitCode: string;
    detail: string;
    severity: "critico" | "alto" | "normal" | "bajo";
  };
  const [kindFilter, setKindFilter] = useState<"all" | ActivityItem["kind"]>("all");
  const [severityFilter, setSeverityFilter] = useState<"all" | ActivityItem["severity"]>("all");
  const [viewMode, setViewMode] = useState<"cards" | "list">("list");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState("80");
  const activity = useMemo(() => {
    const unitCodeById = new Map(units.map((unit) => [unit.id, unit.code]));
    const rows: ActivityItem[] = [];
    for (const ticket of tickets) {
      rows.push({
        id: `ticket-${ticket.id}`,
        kind: "ticket",
        ts: ticket.dueAt,
        title: ticket.title,
        unitCode: unitCodeById.get(ticket.unitId) ?? "N/A",
        detail: `${ticket.category} · ${ticket.status}`,
        severity: ticket.priority,
      });
    }
    const controlNow = getOperationalNow();
    for (const task of tasks) {
      const taskDueAt = parseISO(task.dueAt);
      const taskOverdue = !["resuelto", "cerrado"].includes(task.status) && isBefore(taskDueAt, controlNow);
      rows.push({
        id: `task-${task.id}`,
        kind: "task",
        ts: task.dueAt,
        title: task.title,
        unitCode: unitCodeById.get(task.unitId) ?? "N/A",
        detail: `${task.role} · ${task.status}`,
        severity: taskOverdue ? "alto" : "normal",
      });
    }
    for (const reservation of reservations) {
      rows.push({
        id: `res-${reservation.id}`,
        kind: "reservation",
        ts: reservation.checkIn,
        title: `Check-in ${reservation.guest}`,
        unitCode: unitCodeById.get(reservation.unitId) ?? "N/A",
        detail: `${reservation.platform} · salida ${formatShortDate(reservation.checkOut)}`,
        severity: "normal",
      });
    }
    for (const notification of notifications) {
      rows.push({
        id: `notif-${notification.id}`,
        kind: "notification",
        ts: notification.createdAt,
        title: notification.title,
        unitCode: "N/A",
        detail: `${notification.type} · ${notification.read ? "leida" : "pendiente"}`,
        severity: notification.read ? "bajo" : "alto",
      });
    }
    return rows.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  }, [notifications, reservations, tasks, tickets, units]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const max = Number.parseInt(limit, 10) || 80;
    return activity
      .filter((item) => (kindFilter === "all" ? true : item.kind === kindFilter))
      .filter((item) => (severityFilter === "all" ? true : item.severity === severityFilter))
      .filter((item) => {
        if (!query) return true;
        return [item.title, item.unitCode, item.detail].some((value) => value.toLowerCase().includes(query));
      })
      .slice(0, Math.max(10, Math.min(500, max)));
  }, [activity, kindFilter, limit, search, severityFilter]);

  function exportControlCsv() {
    if (filtered.length === 0) return;
    const csv = Papa.unparse(
      filtered.map((item) => ({
        ts: item.ts,
        kind: item.kind,
        severity: item.severity,
        unit: item.unitCode,
        title: item.title,
        detail: item.detail,
      })),
      { columns: ["ts", "kind", "severity", "unit", "title", "detail"] },
    );
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `control-center-${stamp}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Card className="min-w-0 rounded-lg border-[#d8ded6] shadow-none">
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Centro de comando</CardTitle>
          <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={exportControlCsv} disabled={filtered.length === 0}>
            Exportar CSV
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_180px_180px_160px]">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar evento, unidad o detalle" className="h-10" />
          <Select value={kindFilter} onValueChange={(value) => setKindFilter(value as typeof kindFilter)}>
            <SelectTrigger className="h-10"><SelectValue placeholder="Tipo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los tipos</SelectItem>
              <SelectItem value="ticket">Ticket</SelectItem>
              <SelectItem value="task">Tarea</SelectItem>
              <SelectItem value="reservation">Reserva</SelectItem>
              <SelectItem value="notification">Notificación</SelectItem>
            </SelectContent>
          </Select>
          <Select value={severityFilter} onValueChange={(value) => setSeverityFilter(value as typeof severityFilter)}>
            <SelectTrigger className="h-10"><SelectValue placeholder="Severidad" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="critico">Critico</SelectItem>
              <SelectItem value="alto">Alto</SelectItem>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="bajo">Bajo</SelectItem>
            </SelectContent>
          </Select>
          <Select value={limit} onValueChange={setLimit}>
            <SelectTrigger className="h-10"><SelectValue placeholder="Límite" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="40">40</SelectItem>
              <SelectItem value="80">80</SelectItem>
              <SelectItem value="150">150</SelectItem>
              <SelectItem value="300">300</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant={viewMode === "cards" ? "default" : "outline"} onClick={() => setViewMode("cards")}>
            <LayoutGrid className="mr-1 size-3.5" />
            Tarjetas
          </Button>
          <Button type="button" size="sm" variant={viewMode === "list" ? "default" : "outline"} onClick={() => setViewMode("list")}>
            <List className="mr-1 size-3.5" />
            Lista
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {viewMode === "cards" ? (
          <div className="grid gap-2">
            {filtered.length === 0 ? (
              <div className="rounded-lg border border-[#d8ded6] bg-white p-4 text-sm text-[#66736c]">Sin eventos para los filtros actuales.</div>
            ) : (
              filtered.map((item) => (
                <div key={item.id} className="rounded-lg border border-[#d8ded6] bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{item.title}</p>
                    <Badge className={item.severity === "critico" ? "bg-red-600 text-white" : item.severity === "alto" ? "bg-orange-500 text-white" : item.severity === "normal" ? "bg-emerald-700 text-white" : "bg-zinc-700 text-white"}>
                      {item.severity}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-[#66736c]">{formatShortDate(item.ts)} · {item.unitCode} · {item.kind}</p>
                  <p className="mt-1 text-sm text-[#4b5851]">{item.detail}</p>
                </div>
              ))
            )}
          </div>
        ) : (
        <div className="max-h-[64vh] overflow-auto rounded-lg border border-[#d8ded6] bg-white">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="sticky top-0 bg-[#eef1ea] text-left text-xs uppercase tracking-wide text-[#66736c]">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Severidad</th>
                <th className="px-3 py-2">Unidad</th>
                <th className="px-3 py-2">Título</th>
                <th className="px-3 py-2">Detalle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e3e8e2]">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-[#66736c]">Sin eventos para los filtros actuales.</td>
                </tr>
              ) : (
                filtered.map((item) => (
                  <tr key={item.id} className="hover:bg-[#f8faf7]">
                    <td className="px-3 py-2">{formatShortDate(item.ts)}</td>
                    <td className="px-3 py-2"><Badge variant="outline">{item.kind}</Badge></td>
                    <td className="px-3 py-2">
                      <Badge className={item.severity === "critico" ? "bg-red-600 text-white" : item.severity === "alto" ? "bg-orange-500 text-white" : item.severity === "normal" ? "bg-emerald-700 text-white" : "bg-zinc-700 text-white"}>
                        {item.severity}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">{item.unitCode}</td>
                    <td className="max-w-[260px] truncate px-3 py-2 font-medium" title={item.title}>{item.title}</td>
                    <td className="max-w-[320px] truncate px-3 py-2 text-[#5a6861]" title={item.detail}>{item.detail}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        )}
      </CardContent>
    </Card>
  );
}

function HelpCenterPanel({ canManage, onNavigate }: { canManage: boolean; onNavigate: (tab: string) => void }) {
  const [helpView, setHelpView] = useState<"operativa" | "admin">("operativa");
  const operationalSections = [
    {
      title: "1) Empezar turno en 60 segundos",
      items: [
        "Revisá primero Riesgo y Tiempos para ver qué puede frenar un check-in hoy.",
        "Entrá a Reservas y confirmá las entradas y salidas de las próximas 24h.",
        "Si estás sin internet, seguí operando: los cambios quedan guardados y se envían cuando vuelve la conexión.",
      ],
    },
    {
      title: "2) Qué hace cada rol operativo",
      items: [
        "Limpieza: ejecuta tareas de limpieza y evidencia de cierre.",
        "Mantenimiento: atiende incidencias técnicas y tareas asignadas.",
        "Supervisor: coordina equipos, asigna, escala y cierra bloqueadores.",
      ],
    },
    {
      title: "3) Flujo recomendado del día",
      items: [
        "Paso 1: Reservas actualizadas.",
        "Paso 2: Kanban al día (ninguna unidad trabada sin responsable).",
        "Paso 3: Riesgo en rojo resuelto primero.",
        "Paso 4: Cierre con evidencia antes de marcar una unidad como lista.",
      ],
    },
    {
      title: "4) Módulos clave",
      items: [
        "Operación: detalle completo de unidad, tickets, tareas y evidencia.",
        "Departamentos: gestión masiva, filtros, orden y acciones rápidas.",
        "Riesgo: score de check-in, acciones bulk y historial.",
        "Tiempos (SLA): semáforos, vencidos y cola de escalamiento.",
        "Ejecutivo/Go-Live/Control: KPIs, checklist de salida y timeline unificada.",
      ],
    },
    {
      title: "5) Problemas frecuentes",
      items: [
        "No me deja marcar lista: revisá si quedan tickets abiertos o faltan evidencias.",
        "No aparece una reserva: verificá unidad y horario de check-in/check-out.",
        "Subí una foto y no quedó: repetí con mejor señal o tamaño menor.",
        "La pantalla no actualiza: refrescá una vez y evitá clicks repetidos.",
      ],
    },
    {
      title: "6) Buenas prácticas en celular",
      items: [
        "Usá la barra inferior para cambiar rápido de sección.",
        "Priorizá Kanban + Riesgo + Tiempos para operar rápido en campo.",
        "Subí evidencia desde cámara en la vista de unidad al momento del cierre.",
      ],
    },
    {
      title: "7) Conceptos simples",
      items: [
        "Ticket: un problema o pedido a resolver.",
        "Tarea: trabajo asignado a una persona/equipo.",
        "Riesgo: probabilidad de no llegar al check-in en condiciones.",
        "Tiempos: plazo recomendado para resolver sin impactar al huésped.",
        "Pendientes por enviar: cambios guardados que se mandan cuando vuelve internet.",
      ],
    },
  ];
  const adminSections = [
    {
      title: "1) Supervisión diaria",
      items: [
        "Confirmar reservas de próximas 24h antes de arrancar.",
        "Atacar primero los casos en rojo de Riesgo y Tiempos.",
        "Asegurar que unidades con check-in próximo terminen en lista.",
      ],
    },
    {
      title: "2) Gestión de equipos",
      items: [
        "Despachar tickets críticos por zona y carga de trabajo.",
        "Monitorear `Kanban` para detectar cuellos de botella por estado.",
        "Usar `Tareas` para seguimiento de responsables y vencimientos.",
      ],
    },
    {
      title: "3) Gobierno operativo",
      items: [
        "Usar `Go-Live` para validar readiness de salida diaria.",
        "Controlar KPIs en `Ejecutivo` y eventos en `Control`.",
        "Registrar decisiones y excepciones críticas para trazabilidad.",
      ],
    },
    {
      title: "4) Escalamiento",
      items: [
        "Escalar de inmediato incidencias críticas sin responsable.",
        "Escalar cuando una tarea vencida impacta check-in próximo.",
        "Si falla una acción repetidamente, abrir incidencia y reasignar.",
      ],
    },
    {
      title: "5) Qué significa cada pantalla",
      items: [
        "Tiempos: vencimientos y foco de urgencias.",
        "Go-Live: chequeo final antes del horario crítico.",
        "Control: historial de lo que se hizo.",
        "Ejecutivo: resumen para seguimiento general.",
      ],
    },
  ];
  const sections = helpView === "operativa" ? operationalSections : adminSections;

  return (
    <Card className="min-w-0 rounded-lg border-[#d8ded6] shadow-none">
      <CardHeader>
        <CardTitle>Centro de ayuda</CardTitle>
        <p className="text-sm text-[#66736c]">
          Guía por perfil para operar la plataforma.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => onNavigate("riesgo")}>Ir a Riesgo</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => onNavigate("reservas")}>Ir a Reservas</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => onNavigate("sla")}>Ir a Tiempos</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => onNavigate("departamentos")}>Ir a Departamentos</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={helpView === "operativa" ? "default" : "outline"}
            onClick={() => setHelpView("operativa")}
          >
            Ayuda operativa
          </Button>
          {canManage ? (
            <Button
              type="button"
              size="sm"
              variant={helpView === "admin" ? "default" : "outline"}
              onClick={() => setHelpView("admin")}
            >
              Ayuda admin
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {sections.map((section) => (
          <div key={section.title} className="rounded-lg border border-[#d8ded6] bg-white p-3">
            <p className="text-sm font-semibold">{section.title}</p>
            <ul className="mt-2 space-y-1 text-sm text-[#4e5b54]">
              {section.items.map((item) => (
                <li key={item}>• {item}</li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function AgentsPanel({
  canManage,
  logs,
  onLogCreated,
}: {
  canManage: boolean;
  logs: AgentActionLogItem[];
  onLogCreated: (item: AgentActionLogItem) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function createManualSuggestion(formData: FormData) {
    if (!canManage) return;
    const agentName = String(formData.get("agentName") ?? "");
    const suggestion = String(formData.get("suggestion") ?? "");
    setMessage(null);
    setError(null);

    startTransition(async () => {
      try {
        const created = await logAgentSuggestionAction({
          agentName,
          suggestion,
          status: "suggested",
        });
        if (created) {
          onLogCreated({
            id: created.id,
            agentName: created.agentName,
            decision: created.decision,
            entityType: created.entityType,
            entityId: created.entityId,
            suggestion: String((created.input as { suggestion?: string } | null)?.suggestion ?? suggestion),
            createdAt: new Date(created.createdAt).toISOString(),
            reviewedAt: created.reviewedAt ? new Date(created.reviewedAt).toISOString() : undefined,
          });
        }
        setMessage("Sugerencia registrada.");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "No se pudo registrar la sugerencia.");
      }
    });
  }

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
      <Card className="rounded-lg border-[#d8ded6] shadow-none">
        <CardHeader className="flex-row items-center gap-3">
          <ShieldCheck className="size-5 text-[#49685c]" />
          <CardTitle>Logs recientes de subagentes</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {logs.length === 0 ? (
            <div className="rounded-lg border border-[#d8ded6] bg-white p-4 text-sm text-[#66736c]">Sin logs todavia.</div>
          ) : null}
          {logs.slice(0, 10).map((log) => (
            <div key={log.id} className="rounded-lg border border-[#d8ded6] bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{log.agentName}</p>
                <Badge variant="outline">{log.decision}</Badge>
              </div>
              <p className="mt-1 text-xs text-[#66736c]">{formatShortDate(log.createdAt)}</p>
              <p className="mt-2 text-sm text-[#42514a]">{log.suggestion || "Sin sugerencia."}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="rounded-lg border-[#d8ded6] shadow-none">
        <CardHeader>
          <CardTitle>Registrar sugerencia manual</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {canManage ? (
            <form action={createManualSuggestion} className="grid gap-3">
              <label htmlFor="agent-name" className="text-sm text-[#55645d]">Agente</label>
              <select
                id="agent-name"
                name="agentName"
                defaultValue="TriageAgent"
                className="h-10 rounded-lg border border-[#d8ded6] bg-white px-3 text-sm"
              >
                {["TriageAgent", "DispatchAgent", "SLAAgent", "CommsAgent", "ReviewAgent"].map((agent) => (
                  <option key={agent} value={agent}>{agent}</option>
                ))}
              </select>
              <label htmlFor="agent-suggestion" className="text-sm text-[#55645d]">Sugerencia</label>
              <Textarea
                id="agent-suggestion"
                name="suggestion"
                required
                minLength={5}
                className="min-h-24 resize-none"
                placeholder="Ej: Escalar ticket critico en REC-204 por vencimiento SLA."
              />
              <Button type="submit" disabled={isPending}>{isPending ? "Guardando..." : "Registrar sugerencia"}</Button>
            </form>
          ) : (
            <p className="rounded-lg border border-[#d8ded6] bg-white p-4 text-sm text-[#66736c]">
              Vista de solo lectura. Solo admin/supervisor pueden registrar sugerencias.
            </p>
          )}
          {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function UnitKanbanPanel({
  units,
  tickets,
  canManage,
  onMoveStatus,
  onOpenUnit,
}: {
  units: Unit[];
  tickets: Ticket[];
  canManage: boolean;
  onMoveStatus: (unitId: string, status: Unit["status"]) => void;
  onOpenUnit: (unitId: string) => void;
}) {
  const [draggingUnitId, setDraggingUnitId] = useState<string | null>(null);
  const [hoverStatus, setHoverStatus] = useState<Unit["status"] | null>(null);
  const columns = unitStatuses.map((status) => ({
    status,
    label: unitStatusLabel(status),
    units: units.filter((unit) => unit.status === status),
  }));

  function moveUnit(unitId: string, toStatus: Unit["status"]) {
    const current = units.find((unit) => unit.id === unitId);
    if (!current) return;
    if (current.status === toStatus) return;
    if (!canManage) return;
    onMoveStatus(unitId, toStatus);
  }

  function moveRelative(unitId: string, delta: -1 | 1) {
    const current = units.find((unit) => unit.id === unitId);
    if (!current) return;
    const currentIndex = unitStatuses.indexOf(current.status);
    const nextIndex = currentIndex + delta;
    if (nextIndex < 0 || nextIndex >= unitStatuses.length) return;
    moveUnit(unitId, unitStatuses[nextIndex]);
  }

  return (
    <Card className="min-w-0 rounded-lg border-[#d8ded6] shadow-none">
      <CardHeader className="gap-2">
        <CardTitle>Kanban operativo por estado</CardTitle>
        <p className="text-sm text-[#66736c]">
          Drag & drop entre columnas. {canManage ? "Movimientos habilitados." : "Solo lectura para tu rol."}
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:hidden">
          {units.map((unit) => {
            const openCount = tickets.filter((ticket) => ticket.unitId === unit.id && !["resuelto", "cerrado"].includes(ticket.status)).length;
            return (
              <div key={unit.id} className="rounded-lg border border-[#d8ded6] bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <button className="text-left font-semibold" onClick={() => onOpenUnit(unit.id)}>
                    {unit.code}
                  </button>
                  <Badge className={statusTone[unit.status]}>{unitStatusLabel(unit.status)}</Badge>
                </div>
                <p className="mt-1 text-xs text-[#66736c]">{unit.zone} · {openCount} tickets abiertos</p>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Button size="sm" variant="outline" disabled={!canManage} onClick={() => moveRelative(unit.id, -1)}>
                    ← Atrás
                  </Button>
                  <Button size="sm" disabled={!canManage} onClick={() => moveRelative(unit.id, 1)}>
                    Adelante →
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <div className="grid min-w-[1040px] grid-cols-6 gap-3">
            {columns.map((column) => (
              <div
                key={column.status}
                onDragOver={(event) => {
                  if (!canManage) return;
                  event.preventDefault();
                  setHoverStatus(column.status);
                }}
                onDragLeave={() => setHoverStatus((current) => (current === column.status ? null : current))}
                onDrop={(event) => {
                  event.preventDefault();
                  if (!canManage) return;
                  const unitId = event.dataTransfer.getData("text/unit-id");
                  if (unitId) moveUnit(unitId, column.status);
                  setDraggingUnitId(null);
                  setHoverStatus(null);
                }}
                className={`rounded-xl border p-2 ${
                  hoverStatus === column.status ? "border-[#26352f] bg-[#f0f4ed]" : "border-[#d8ded6] bg-[#f8faf7]"
                }`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#5a6861]">{column.label}</p>
                  <Badge variant="outline">{column.units.length}</Badge>
                </div>
                <div className="grid max-h-[62vh] gap-2 overflow-y-auto pr-1">
                  {column.units.map((unit) => {
                    const openCount = tickets.filter((ticket) => ticket.unitId === unit.id && !["resuelto", "cerrado"].includes(ticket.status)).length;
                    return (
                      <div
                        key={unit.id}
                        draggable={canManage}
                        onDragStart={(event) => {
                          event.dataTransfer.setData("text/unit-id", unit.id);
                          setDraggingUnitId(unit.id);
                        }}
                        onDragEnd={() => {
                          setDraggingUnitId(null);
                          setHoverStatus(null);
                        }}
                        className={`rounded-lg border border-[#d8ded6] bg-white p-2 ${draggingUnitId === unit.id ? "opacity-50" : ""}`}
                      >
                        <button className="text-left text-sm font-semibold" onClick={() => onOpenUnit(unit.id)}>
                          {unit.code}
                        </button>
                        <p className="mt-1 text-xs text-[#66736c]">{unit.zone} · {openCount} tickets</p>
                        <p className="text-[11px] text-[#8a9690]">{formatShortDate(unit.nextCheckIn)}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function QuickCreateForms({
  addUnit,
  addTicket,
  addTask,
  units: unitOptions,
  users,
}: {
  addUnit: (event: FormEvent<HTMLFormElement>) => void;
  addTicket: (event: FormEvent<HTMLFormElement>) => void;
  addTask: (event: FormEvent<HTMLFormElement>) => void;
  units: Unit[];
  users: AppData["users"];
}) {
  return (
    <Tabs defaultValue="unidad">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="unidad">Unidad</TabsTrigger>
        <TabsTrigger value="ticket">Ticket</TabsTrigger>
        <TabsTrigger value="tarea">Tarea</TabsTrigger>
      </TabsList>
      <TabsContent value="unidad">
        <form onSubmit={addUnit} className="grid gap-3">
          <label htmlFor="create-unit-code" className="text-sm text-[#55645d]">Codigo</label>
          <Input id="create-unit-code" name="code" placeholder="ALM-701" required />
          <label htmlFor="create-unit-address" className="text-sm text-[#55645d]">Direccion</label>
          <Input id="create-unit-address" name="address" placeholder="Arcos 2350, Belgrano" required />
          <label htmlFor="create-unit-zone" className="text-sm text-[#55645d]">Barrio</label>
          <Input id="create-unit-zone" name="zone" placeholder="Belgrano" required />
          <label htmlFor="create-unit-owner" className="text-sm text-[#55645d]">Owner</label>
          <Input id="create-unit-owner" name="owner" placeholder="Owner" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <label htmlFor="create-unit-floor" className="text-sm text-[#55645d]">Piso</label>
              <Input id="create-unit-floor" name="floor" placeholder="8A" />
            </div>
            <div className="grid gap-1">
              <label htmlFor="create-unit-bedrooms" className="text-sm text-[#55645d]">Ambientes</label>
              <Input id="create-unit-bedrooms" name="bedrooms" type="number" min="1" max="6" placeholder="2" />
            </div>
          </div>
          <Button className="bg-[#26352f] text-white">Crear unidad fake</Button>
        </form>
      </TabsContent>
      <TabsContent value="ticket">
        <form onSubmit={addTicket} className="grid gap-3">
          <label htmlFor="create-ticket-unit" className="text-sm text-[#55645d]">Unidad</label>
          <SelectName id="create-ticket-unit" name="unitId" options={unitOptions.map((unit) => [unit.id, unit.code])} />
          <label htmlFor="create-ticket-title" className="text-sm text-[#55645d]">Titulo</label>
          <Input id="create-ticket-title" name="title" placeholder="Perdida de agua en bano" required />
          <label htmlFor="create-ticket-category" className="text-sm text-[#55645d]">Categoria</label>
          <Input id="create-ticket-category" name="category" placeholder="Plomeria" required />
          <label htmlFor="create-ticket-priority" className="text-sm text-[#55645d]">Prioridad</label>
          <SelectName id="create-ticket-priority" name="priority" options={priorities.map((priority) => [priority, priorityLabel(priority)])} />
          <label htmlFor="create-ticket-assignee" className="text-sm text-[#55645d]">Responsable</label>
          <SelectName id="create-ticket-assignee" name="assigneeId" options={users.map((user) => [user.id, `${user.name} (${user.role})`])} />
          <Button className="bg-[#26352f] text-white">Crear ticket</Button>
        </form>
      </TabsContent>
      <TabsContent value="tarea">
        <form onSubmit={addTask} className="grid gap-3">
          <label htmlFor="create-task-unit" className="text-sm text-[#55645d]">Unidad</label>
          <SelectName id="create-task-unit" name="unitId" options={unitOptions.map((unit) => [unit.id, unit.code])} />
          <label htmlFor="create-task-title" className="text-sm text-[#55645d]">Titulo</label>
          <Input id="create-task-title" name="title" placeholder="Reponer amenities" required />
          <label htmlFor="create-task-role" className="text-sm text-[#55645d]">Equipo</label>
          <SelectName id="create-task-role" name="role" options={[["limpieza", "Limpieza"], ["mantenimiento", "Mantenimiento"], ["supervisor", "Supervisor"]]} />
          <label htmlFor="create-task-assignee" className="text-sm text-[#55645d]">Responsable</label>
          <SelectName id="create-task-assignee" name="assigneeId" options={users.map((user) => [user.id, `${user.name} (${user.role})`])} />
          <Button className="bg-[#26352f] text-white">Crear tarea</Button>
        </form>
      </TabsContent>
    </Tabs>
  );
}

function SelectName({ id, name, options }: { id?: string; name: string; options: Array<[string, string]> }) {
  return (
    <select id={id} name={name} className="h-10 rounded-lg border border-[#d8ded6] bg-white px-3 text-sm">
      {options.map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
}

function TicketsPanel({
  tickets: openTickets,
  units: localUnits,
  markTicketResolved,
  canResolveTicket,
}: {
  tickets: Ticket[];
  units: Unit[];
  markTicketResolved: (ticketId: string) => void;
  canResolveTicket: (ticket: Ticket) => boolean;
}) {
  return (
    <Card className="min-w-0 rounded-lg border-[#d8ded6] shadow-none">
      <CardHeader>
        <CardTitle>Tickets activos</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {openTickets.map((ticket) => {
          const unit = localUnits.find((currentUnit) => currentUnit.id === ticket.unitId);

          const canResolve = canResolveTicket(ticket);
          return (
              <div key={ticket.id} className="rounded-lg border border-[#d8ded6] bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{ticket.title}</p>
                  <p className="text-sm text-[#66736c]">{unit?.code} · {ticket.category}</p>
                </div>
                <Badge className={priorityTone[ticket.priority]}>{priorityLabel(ticket.priority)}</Badge>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <span className="text-sm text-[#66736c]">Vence {formatShortDate(ticket.dueAt)}</span>
                <Button variant="outline" className="h-10 w-full sm:w-auto" disabled={!canResolve} onClick={() => markTicketResolved(ticket.id)}>
                  <CheckCircle2 className="size-4" />
                  Resolver
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function CheckInRiskPanel({
  units,
  tickets,
  tasks,
  users,
  zoneFilter,
  statusFilter,
  priorityFilter,
  horizonHours,
  zones,
  setZoneFilter,
  setStatusFilter,
  setPriorityFilter,
  setHorizonHours,
  canManage,
  openUnit,
  markUnitReady,
  markTicketResolved,
}: {
  units: Unit[];
  tickets: Ticket[];
  tasks: Task[];
  users: AppData["users"];
  zoneFilter: string;
  statusFilter: string;
  priorityFilter: string;
  horizonHours: number;
  zones: string[];
  setZoneFilter: (value: string) => void;
  setStatusFilter: (value: string) => void;
  setPriorityFilter: (value: string) => void;
  setHorizonHours: (value: string) => void;
  canManage: boolean;
  openUnit: (unitId: string) => void;
  markUnitReady: (unitId: string) => void;
  markTicketResolved: (ticketId: string) => void;
}) {
  type BulkRiskHistoryItem = {
    id: string;
    type: string;
    createdAt: string | Date;
    payload?: {
      updated?: number;
      unitIdsCount?: number;
      assigneeId?: string | null;
      dueInHours?: number | null;
    };
  };
  const [selectedRiskUnitIds, setSelectedRiskUnitIds] = useState<string[]>([]);
  const [bulkFeedback, setBulkFeedback] = useState<string | null>(null);
  const [dispatchAssigneeId, setDispatchAssigneeId] = useState("none");
  const [dispatchDueHours, setDispatchDueHours] = useState("4");
  const [dispatching, setDispatching] = useState(false);
  const [bulkHistory, setBulkHistory] = useState<BulkRiskHistoryItem[]>([]);
  const [bulkHistoryLoading, setBulkHistoryLoading] = useState(true);
  const [bulkHistoryError, setBulkHistoryError] = useState<string | null>(null);
  const [historyTypeFilter, setHistoryTypeFilter] = useState<
    "all" | "bulk_dispatch_critical" | "bulk_mark_units_ready" | "bulk_resolve_critical"
  >("all");
  const [historyRangeFilter, setHistoryRangeFilter] = useState<"24h" | "7d" | "30d" | "all">("7d");
  const [densityMode, setDensityMode] = useState<"cozy" | "compact">("cozy");
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [columnVisibility, setColumnVisibility] = useState({
    zone: true,
    checkIn: true,
    status: true,
    priority: true,
    overdue: true,
    score: true,
    sla: true,
    actions: true,
  });
  const [riskScrollTop, setRiskScrollTop] = useState(0);
  const rows = useMemo(() => {
    const now = new Date();
    const horizon = addHours(now, Number.isFinite(horizonHours) ? horizonHours : 24);
    return units
      .map((unit) => {
        const unitTickets = tickets.filter((ticket) => ticket.unitId === unit.id && !["resuelto", "cerrado"].includes(ticket.status));
        const unitTasks = tasks.filter((task) => task.unitId === unit.id && !["resuelto", "cerrado"].includes(task.status));
        const checkInAt = parseISO(unit.nextCheckIn);
        const hoursToCheckIn = differenceInHours(checkInAt, now);
        const hasCritical = unitTickets.some((ticket) => ticket.priority === "critico");
        const overdueTickets = unitTickets.filter((ticket) => isBefore(parseISO(ticket.dueAt), now)).length;
        const overdueTasks = unitTasks.filter((task) => isBefore(parseISO(task.dueAt), now)).length;
        const maxPriority: Ticket["priority"] = unitTickets.find((ticket) => ticket.priority === "critico")
          ? "critico"
          : unitTickets.find((ticket) => ticket.priority === "alto")
            ? "alto"
            : unitTickets.find((ticket) => ticket.priority === "normal")
              ? "normal"
              : "bajo";

        let score = 0;
        if (unit.status !== "lista") score += 25;
        if (hoursToCheckIn <= 8) score += 40;
        else if (hoursToCheckIn <= 24) score += 25;
        else if (hoursToCheckIn <= 48) score += 10;
        if (hasCritical) score += 25;
        score += Math.min(20, overdueTickets * 8 + overdueTasks * 6);

        const risk = score >= 70 ? "alto" : score >= 40 ? "medio" : "bajo";
        const withinHorizon = isBefore(checkInAt, horizon);

        return {
          unit,
          score,
          risk,
          maxPriority,
          overdueTickets,
          overdueTasks,
          checkInAt,
          hoursToCheckIn,
          withinHorizon,
        };
      })
      .filter((item) => item.withinHorizon)
      .filter((item) => (zoneFilter === "all" ? true : item.unit.zone === zoneFilter))
      .filter((item) => (statusFilter === "all" ? true : item.unit.status === statusFilter))
      .filter((item) => (priorityFilter === "all" ? true : item.maxPriority === priorityFilter))
      .sort((a, b) => b.score - a.score);
  }, [units, tickets, tasks, horizonHours, zoneFilter, statusFilter, priorityFilter]);
  const visibleRiskUnitIds = useMemo(() => rows.map((row) => row.unit.id), [rows]);
  const visibleRiskUnitIdSet = useMemo(() => new Set(visibleRiskUnitIds), [visibleRiskUnitIds]);
  const effectiveSelectedRiskUnitIds = useMemo(
    () => selectedRiskUnitIds.filter((unitId) => visibleRiskUnitIdSet.has(unitId)),
    [selectedRiskUnitIds, visibleRiskUnitIdSet],
  );
  const selectedRiskUnitSet = useMemo(() => new Set(effectiveSelectedRiskUnitIds), [effectiveSelectedRiskUnitIds]);
  const filteredBulkHistory = useMemo(() => {
    const now = new Date();
    return bulkHistory
      .filter((item) => (historyTypeFilter === "all" ? true : item.type === historyTypeFilter))
      .filter((item) => {
        if (historyRangeFilter === "all") return true;
        const createdAt = new Date(item.createdAt);
        const diffMs = now.getTime() - createdAt.getTime();
        if (Number.isNaN(diffMs)) return false;
        if (historyRangeFilter === "24h") return diffMs <= 24 * 60 * 60 * 1000;
        if (historyRangeFilter === "7d") return diffMs <= 7 * 24 * 60 * 60 * 1000;
        return diffMs <= 30 * 24 * 60 * 60 * 1000;
      });
  }, [bulkHistory, historyTypeFilter, historyRangeFilter]);
  const rowHeight = densityMode === "compact" ? 56 : 78;
  const riskViewportHeight = 520;
  const overscan = 6;
  const visibleCount = Math.ceil(riskViewportHeight / rowHeight);
  const maxRiskScrollTop = Math.max(0, rows.length * rowHeight - riskViewportHeight);
  const safeRiskScrollTop = Math.min(riskScrollTop, maxRiskScrollTop);
  const startIndex = Math.max(0, Math.floor(safeRiskScrollTop / rowHeight) - overscan);
  const endIndex = Math.min(rows.length, startIndex + visibleCount + overscan * 2);
  const virtualRows = rows.slice(startIndex, endIndex);
  const topSpacerHeight = startIndex * rowHeight;
  const bottomSpacerHeight = Math.max(0, (rows.length - endIndex) * rowHeight);
  const compactCellClass = densityMode === "compact" ? "px-2 py-1 text-xs" : "px-2 py-2 text-sm";
  const compactActionClass = densityMode === "compact" ? "h-7 px-1.5 text-[10px]" : "h-8 px-2 text-[11px]";
  const gridTemplateColumns = useMemo(() => {
    const columns: string[] = ["38px", "88px"];
    if (columnVisibility.zone) columns.push("minmax(92px,0.9fr)");
    if (columnVisibility.checkIn) columns.push("minmax(112px,1fr)");
    if (columnVisibility.status) columns.push("minmax(126px,1fr)");
    if (columnVisibility.priority) columns.push("96px");
    if (columnVisibility.overdue) columns.push("minmax(104px,1fr)");
    if (columnVisibility.score) columns.push("112px");
    if (columnVisibility.sla) columns.push("minmax(108px,1fr)");
    if (columnVisibility.actions) columns.push("196px");
    return columns.join(" ");
  }, [columnVisibility]);
  function renderHeaderCell(label: string, hidden: boolean) {
    if (hidden) return null;
    return <div className={compactCellClass}>{label}</div>;
  }

  function renderColumnCheckbox(
    key: keyof typeof columnVisibility,
    label: string,
  ) {
    return (
      <label key={key} className="inline-flex items-center gap-2 text-xs text-[#48534e]">
        <input
          type="checkbox"
          className="size-4 rounded border-[#b7c2ba]"
          checked={columnVisibility[key]}
          onChange={(event) => {
            const checked = event.target.checked;
            setColumnVisibility((current) => ({ ...current, [key]: checked }));
          }}
        />
        {label}
      </label>
    );
  }

  const loadBulkRiskHistory = useCallback(async (options?: { skipLoading?: boolean }) => {
    if (!options?.skipLoading) {
      setBulkHistoryLoading(true);
    }
    setBulkHistoryError(null);
    try {
      const items = await listRecentBulkRiskActionsAction();
      setBulkHistory(items as BulkRiskHistoryItem[]);
    } catch {
      setBulkHistoryError("No se pudo cargar el historial.");
    } finally {
      setBulkHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function runInitialHistoryLoad() {
      try {
        const items = await listRecentBulkRiskActionsAction();
        if (cancelled) return;
        setBulkHistory(items as BulkRiskHistoryItem[]);
        setBulkHistoryError(null);
      } catch {
        if (cancelled) return;
        setBulkHistoryError("No se pudo cargar el historial.");
      } finally {
        if (!cancelled) {
          setBulkHistoryLoading(false);
        }
      }
    }

    void runInitialHistoryLoad();
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleRiskSelection(unitId: string) {
    setBulkFeedback(null);
    setSelectedRiskUnitIds((current) =>
      current.includes(unitId) ? current.filter((id) => id !== unitId) : [...current, unitId],
    );
  }

  function toggleSelectAllVisibleRiskRows() {
    if (visibleRiskUnitIds.length === 0) return;
    setBulkFeedback(null);
    const allVisibleSelected = visibleRiskUnitIds.every((id) => selectedRiskUnitSet.has(id));
    if (allVisibleSelected) {
      setSelectedRiskUnitIds((current) => current.filter((id) => !visibleRiskUnitIds.includes(id)));
      return;
    }
    setSelectedRiskUnitIds((current) => Array.from(new Set([...current, ...visibleRiskUnitIds])));
  }

  function markSelectedRiskUnitsReady() {
    if (!canManage) {
      setBulkFeedback("No tenes permisos para acciones masivas.");
      return;
    }
    if (effectiveSelectedRiskUnitIds.length === 0) {
      setBulkFeedback("Selecciona al menos una unidad.");
      return;
    }
    const selectedRows = rows.filter((row) => selectedRiskUnitSet.has(row.unit.id));
    const toUpdate = selectedRows.filter((row) => row.unit.status !== "lista");
    if (toUpdate.length > 0 && !window.confirm(`Marcar ${toUpdate.length} unidades como lista?`)) return;
    for (const row of toUpdate) {
      markUnitReady(row.unit.id);
    }
    setSelectedRiskUnitIds([]);
    setBulkFeedback(
      toUpdate.length > 0
        ? `Se marcaron ${toUpdate.length} unidades como lista.`
        : "Las unidades seleccionadas ya estaban en estado lista.",
    );
  }

  function resolveCriticalTicketsForSelectedUnits() {
    if (!canManage) {
      setBulkFeedback("No tenes permisos para acciones masivas.");
      return;
    }
    if (effectiveSelectedRiskUnitIds.length === 0) {
      setBulkFeedback("Selecciona al menos una unidad.");
      return;
    }
    const selectedUnits = new Set(effectiveSelectedRiskUnitIds);
    const criticalOpenTickets = tickets.filter(
      (ticket) =>
        selectedUnits.has(ticket.unitId) &&
        ticket.priority === "critico" &&
        !["resuelto", "cerrado"].includes(ticket.status),
    );
    const uniqueTicketIds = Array.from(new Set(criticalOpenTickets.map((ticket) => ticket.id)));
    if (uniqueTicketIds.length > 0 && !window.confirm(`Resolver ${uniqueTicketIds.length} tickets criticos seleccionados?`)) return;
    for (const ticketId of uniqueTicketIds) {
      markTicketResolved(ticketId);
    }
    setSelectedRiskUnitIds([]);
    setBulkFeedback(
      uniqueTicketIds.length > 0
        ? `Se resolvieron ${uniqueTicketIds.length} tickets criticos abiertos.`
        : "No habia tickets criticos abiertos en la seleccion.",
    );
  }

  async function dispatchCriticalTicketsForSelectedUnits() {
    setBulkFeedback(null);
    if (!canManage) {
      setBulkFeedback("No tenes permisos para acciones masivas.");
      return;
    }
    if (effectiveSelectedRiskUnitIds.length === 0) {
      setBulkFeedback("Selecciona al menos una unidad.");
      return;
    }
    const dueInHours = Number.parseInt(dispatchDueHours, 10);
    if (!Number.isFinite(dueInHours) || dueInHours < 1) {
      setBulkFeedback("Define horas de vencimiento validas.");
      return;
    }

    setDispatching(true);
    try {
      const result = await bulkDispatchCriticalTicketsAction({
        unitIds: effectiveSelectedRiskUnitIds,
        assigneeId: dispatchAssigneeId === "none" ? undefined : dispatchAssigneeId,
        dueInHours,
      });
      setSelectedRiskUnitIds([]);
      setBulkFeedback(
        result.updated > 0
          ? `Despacho aplicado: ${result.updated} tickets criticos actualizados.`
          : "No habia tickets criticos abiertos para despachar.",
      );
      await loadBulkRiskHistory();
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo despachar tickets criticos.";
      setBulkFeedback(message);
    } finally {
      setDispatching(false);
    }
  }

  function handleMarkUnitReady(unitId: string, currentStatus: Unit["status"]) {
    if (!canManage) return;
    if (currentStatus === "lista") return;
    markUnitReady(unitId);
  }

  function resolveCriticalTicketsForUnit(unitId: string) {
    if (!canManage) return;
    const criticalOpenTickets = tickets.filter(
      (ticket) => ticket.unitId === unitId && ticket.priority === "critico" && !["resuelto", "cerrado"].includes(ticket.status),
    );
    const uniqueTicketIds = Array.from(new Set(criticalOpenTickets.map((ticket) => ticket.id)));
    if (uniqueTicketIds.length > 0 && !window.confirm(`Resolver ${uniqueTicketIds.length} tickets criticos de esta unidad?`)) return;
    for (const ticketId of uniqueTicketIds) {
      markTicketResolved(ticketId);
    }
    setBulkFeedback(
      uniqueTicketIds.length > 0
        ? `Se resolvieron ${uniqueTicketIds.length} tickets criticos de la unidad.`
        : "No habia tickets criticos abiertos en la unidad.",
    );
  }

  async function dispatchCriticalTicketsForUnitIn4h(unitId: string) {
    setBulkFeedback(null);
    if (!canManage) {
      setBulkFeedback("No tenes permisos para acciones masivas.");
      return;
    }
    setDispatching(true);
    try {
      const result = await bulkDispatchCriticalTicketsAction({
        unitIds: [unitId],
        dueInHours: 4,
      });
      setBulkFeedback(
        result.updated > 0
          ? `Despacho 4h aplicado: ${result.updated} tickets criticos actualizados.`
          : "No habia tickets criticos abiertos para despachar en la unidad.",
      );
      await loadBulkRiskHistory({ skipLoading: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo despachar tickets criticos.";
      setBulkFeedback(message);
    } finally {
      setDispatching(false);
    }
  }

  function getSlaIndicator(score: number, hoursToCheckIn: number) {
    if (score >= 70 || hoursToCheckIn <= 8) {
      return {
        label: "SLA critico",
        dotClassName: "bg-red-500",
        toneClassName: "text-red-700",
      };
    }
    if (score >= 40 || hoursToCheckIn <= 24) {
      return {
        label: "SLA atento",
        dotClassName: "bg-amber-500",
        toneClassName: "text-amber-700",
      };
    }
    return {
      label: "SLA ok",
      dotClassName: "bg-emerald-500",
      toneClassName: "text-emerald-700",
    };
  }

  function exportRiskCsv() {
    if (rows.length === 0) return;

    const csvRows = rows.map((row) => ({
      code: row.unit.code,
      zone: row.unit.zone,
      check_in: row.unit.nextCheckIn,
      hours_to_checkin: row.hoursToCheckIn,
      status: row.unit.status,
      max_priority: row.maxPriority,
      overdue_tickets: row.overdueTickets,
      overdue_tasks: row.overdueTasks,
      score: row.score,
      risk: row.risk,
    }));

    const csv = Papa.unparse(csvRows, {
      columns: [
        "code",
        "zone",
        "check_in",
        "hours_to_checkin",
        "status",
        "max_priority",
        "overdue_tickets",
        "overdue_tasks",
        "score",
        "risk",
      ],
    });

    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    const filename = `riesgo-checkin-${stamp}.csv`;

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function exportRiskHistoryCsv() {
    if (filteredBulkHistory.length === 0) return;
    const csvRows = filteredBulkHistory.map((item) => {
      const payload = item.payload ?? {};
      return {
        id: item.id,
        type: item.type,
        created_at: new Date(item.createdAt).toISOString(),
        updated: Number(payload.updated ?? 0),
        unit_ids_count: Number(payload.unitIdsCount ?? 0),
        assignee_id: payload.assigneeId ?? "",
        due_in_hours: payload.dueInHours ?? "",
      };
    });
    const csv = Papa.unparse(csvRows, {
      columns: ["id", "type", "created_at", "updated", "unit_ids_count", "assignee_id", "due_in_hours"],
    });
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    const filename = `historial-riesgo-${stamp}.csv`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Card className="min-w-0 rounded-lg border-[#d8ded6] shadow-none">
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Riesgo de check-in</CardTitle>
          <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={exportRiskCsv} disabled={rows.length === 0}>
            Exportar Riesgo CSV
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            value={String(horizonHours)}
            onValueChange={(value) => {
              setRiskScrollTop(0);
              setHorizonHours(value);
            }}
          >
            <SelectTrigger className="h-11 w-full">
              <SelectValue placeholder="Horizonte" />
            </SelectTrigger>
            <SelectContent>
              {["8", "24", "48", "72"].map((hours) => (
                <SelectItem key={hours} value={hours}>
                  {hours}h
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={zoneFilter}
            onValueChange={(value) => {
              setRiskScrollTop(0);
              setZoneFilter(value);
            }}
          >
            <SelectTrigger className="h-11 w-full">
              <SelectValue placeholder="Zona" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las zonas</SelectItem>
              {zones.map((zone) => (
                <SelectItem key={zone} value={zone}>
                  {zone}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={statusFilter}
            onValueChange={(value) => {
              setRiskScrollTop(0);
              setStatusFilter(value);
            }}
          >
            <SelectTrigger className="h-11 w-full">
              <SelectValue placeholder="Estado unidad" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              {unitStatuses.map((status) => (
                <SelectItem key={status} value={status}>
                  {unitStatusLabel(status)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={priorityFilter}
            onValueChange={(value) => {
              setRiskScrollTop(0);
              setPriorityFilter(value);
            }}
          >
            <SelectTrigger className="h-11 w-full">
              <SelectValue placeholder="Prioridad ticket" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas prioridades</SelectItem>
              {priorities.map((priority) => (
                <SelectItem key={priority} value={priority}>
                  {priorityLabel(priority)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-[#d8ded6] bg-white p-1" role="group" aria-label="Modo de densidad">
            <button
              type="button"
              className={`rounded px-3 py-1 text-xs ${densityMode === "cozy" ? "bg-[#1f2d26] text-white" : "text-[#4b5851]"}`}
              onClick={() => {
                setRiskScrollTop(0);
                setDensityMode("cozy");
              }}
              aria-pressed={densityMode === "cozy"}
            >
              Cozy
            </button>
            <button
              type="button"
              className={`rounded px-3 py-1 text-xs ${densityMode === "compact" ? "bg-[#1f2d26] text-white" : "text-[#4b5851]"}`}
              onClick={() => {
                setRiskScrollTop(0);
                setDensityMode("compact");
              }}
              aria-pressed={densityMode === "compact"}
            >
              Compact
            </button>
          </div>
          <button
            type="button"
            className="rounded-md border border-[#d8ded6] bg-white px-3 py-1 text-xs text-[#4b5851]"
            onClick={() => setColumnsOpen((current) => !current)}
            aria-expanded={columnsOpen}
            aria-controls="risk-columns-config"
          >
            Columnas
          </button>
        </div>
        {columnsOpen ? (
          <div id="risk-columns-config" className="grid gap-2 rounded-md border border-[#d8ded6] bg-[#f8faf7] p-3 sm:grid-cols-2 lg:grid-cols-4">
            {renderColumnCheckbox("zone", "Zona")}
            {renderColumnCheckbox("checkIn", "Check-in")}
            {renderColumnCheckbox("status", "Estado")}
            {renderColumnCheckbox("priority", "Prioridad")}
            {renderColumnCheckbox("overdue", "Vencidos")}
            {renderColumnCheckbox("score", "Riesgo")}
            {renderColumnCheckbox("sla", "Tiempos")}
            {renderColumnCheckbox("actions", "Acciones")}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="rounded-lg border border-[#d8ded6] bg-[#f7f9f4] p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-[#55635c]">Seleccionados: {effectiveSelectedRiskUnitIds.length}</p>
            <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-2">
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                disabled={!canManage || effectiveSelectedRiskUnitIds.length === 0}
                onClick={markSelectedRiskUnitsReady}
              >
                Marcar seleccionadas lista
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                disabled={!canManage || effectiveSelectedRiskUnitIds.length === 0}
                onClick={resolveCriticalTicketsForSelectedUnits}
              >
                <ShieldCheck className="mr-1 size-3.5" />
                Resolver criticos abiertos
              </Button>
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(180px,1fr)_160px_auto]">
            <Select value={dispatchAssigneeId} onValueChange={setDispatchAssigneeId}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Responsable" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin reasignar responsable</SelectItem>
                {users
                  .filter((user) => ["admin", "supervisor", "mantenimiento"].includes(user.role))
                  .map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name} ({user.role})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Select value={dispatchDueHours} onValueChange={setDispatchDueHours}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Horas de vencimiento" />
              </SelectTrigger>
              <SelectContent>
                {["2", "4", "8", "24"].map((hours) => (
                  <SelectItem key={hours} value={hours}>
                    Vence en {hours}h
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="h-10 w-full lg:w-auto"
              disabled={!canManage || effectiveSelectedRiskUnitIds.length === 0 || dispatching}
              onClick={() => void dispatchCriticalTicketsForSelectedUnits()}
            >
              <Wrench className="mr-1 size-3.5" />
              {dispatching ? "Despachando..." : "Despachar criticos"}
            </Button>
          </div>
          {bulkFeedback ? <p className="mt-2 text-xs text-[#55635c]">{bulkFeedback}</p> : null}
        </div>
        <div className="grid gap-3 md:hidden">
          {rows.length === 0 ? (
            <div className="rounded-lg border border-[#d8ded6] bg-white px-3 py-6 text-center text-sm text-[#66736c]">
              Sin unidades en riesgo dentro del horizonte seleccionado.
            </div>
          ) : (
            rows.map((row) => {
              const sla = getSlaIndicator(row.score, row.hoursToCheckIn);
              return (
                <div key={row.unit.id} className="rounded-lg border border-[#d8ded6] bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{row.unit.code}</p>
                      <p className="text-xs text-[#66736c]">
                        {row.unit.zone} · {formatShortDate(row.unit.nextCheckIn)} ({row.hoursToCheckIn}h)
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      className="mt-1 size-4 rounded border-[#b7c2ba]"
                      checked={selectedRiskUnitSet.has(row.unit.id)}
                      onChange={() => toggleRiskSelection(row.unit.id)}
                      aria-label={`Seleccionar unidad ${row.unit.code}`}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge className={statusTone[row.unit.status]}>{unitStatusLabel(row.unit.status)}</Badge>
                    <Badge className={priorityTone[row.maxPriority]}>{priorityLabel(row.maxPriority)}</Badge>
                      <Badge className={row.risk === "alto" ? "bg-red-600 text-white" : row.risk === "medio" ? "bg-amber-500 text-white" : "bg-emerald-700 text-white"}>
                      Riesgo {row.score}
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs text-[#66736c]">Vencidos: Tickets {row.overdueTickets} / Tareas {row.overdueTasks}</p>
                  <div className={`mt-1 inline-flex items-center gap-2 text-xs font-medium ${sla.toneClassName}`}>
                    <span className={`size-2 rounded-full ${sla.dotClassName}`} />
                    <span>{sla.label}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Button size="sm" variant="outline" onClick={() => openUnit(row.unit.id)}>
                      <Search className="mr-1 size-3.5" />
                      Abrir
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canManage || dispatching}
                      onClick={() => void dispatchCriticalTicketsForUnitIn4h(row.unit.id)}
                    >
                      <Wrench className="mr-1 size-3.5" />
                      Asignar 4h
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canManage}
                      onClick={() => resolveCriticalTicketsForUnit(row.unit.id)}
                    >
                      <ShieldCheck className="mr-1 size-3.5" />
                      Resolver criticos
                    </Button>
                    <Button
                      size="sm"
                      disabled={!canManage || row.unit.status === "lista"}
                      onClick={() => handleMarkUnitReady(row.unit.id, row.unit.status)}
                    >
                      <CheckCircle2 className="mr-1 size-3.5" />
                      Marcar lista
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="hidden rounded-xl border border-[#d8ded6] bg-white md:block">
          <div
            className="overflow-y-auto"
            style={{ height: `${riskViewportHeight}px` }}
            onScroll={(event) => setRiskScrollTop(event.currentTarget.scrollTop)}
            role="region"
            aria-label="Tabla virtualizada de riesgo de check-in"
          >
            <div className="sticky top-0 z-10 border-b border-[#d8ded6] bg-[#eef1ea] text-left text-xs uppercase tracking-wide text-[#66736c]">
              <div className="grid w-full items-center" style={{ gridTemplateColumns }}>
                <div className={compactCellClass}>
                  <input
                    type="checkbox"
                    className="size-4 rounded border-[#b7c2ba]"
                    checked={visibleRiskUnitIds.length > 0 && visibleRiskUnitIds.every((id) => selectedRiskUnitSet.has(id))}
                    onChange={toggleSelectAllVisibleRiskRows}
                    aria-label="Seleccionar todas las unidades visibles en riesgo"
                  />
                </div>
                <div className={compactCellClass}>Unidad</div>
                {renderHeaderCell("Zona", !columnVisibility.zone)}
                {renderHeaderCell("Check-in", !columnVisibility.checkIn)}
                {renderHeaderCell("Estado", !columnVisibility.status)}
                {renderHeaderCell("Prioridad", !columnVisibility.priority)}
                {renderHeaderCell("Vencidos", !columnVisibility.overdue)}
                {renderHeaderCell("Riesgo", !columnVisibility.score)}
                {renderHeaderCell("Tiempos", !columnVisibility.sla)}
                {columnVisibility.actions ? (
                  <div className={`${compactCellClass} border-l border-[#d8ded6] bg-[#eef1ea] text-right`}>
                    Acciones
                  </div>
                ) : null}
              </div>
            </div>
            {rows.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-[#66736c]">
                Sin unidades en riesgo dentro del horizonte seleccionado.
              </div>
            ) : (
              <div>
                {topSpacerHeight > 0 ? <div style={{ height: `${topSpacerHeight}px` }} aria-hidden="true" /> : null}
                {virtualRows.map((row) => {
                  const sla = getSlaIndicator(row.score, row.hoursToCheckIn);
                  return (
                    <div
                      key={row.unit.id}
                      className={`grid w-full items-center border-b border-[#e3e8e2] transition ${selectedRiskUnitSet.has(row.unit.id) ? "bg-[#e5efe2] dark:bg-[#1f2a23]" : "hover:bg-[#f3f7f2] dark:hover:bg-[#1a241f]"}`}
                      style={{ minHeight: `${rowHeight}px`, gridTemplateColumns }}
                    >
                      <div className={compactCellClass}>
                        <input
                          type="checkbox"
                          className="size-4 rounded border-[#b7c2ba]"
                          checked={selectedRiskUnitSet.has(row.unit.id)}
                          onChange={() => toggleRiskSelection(row.unit.id)}
                          aria-label={`Seleccionar unidad ${row.unit.code}`}
                        />
                      </div>
                      <div className={`${compactCellClass} font-semibold`}>{row.unit.code}</div>
                      {columnVisibility.zone ? <div className={compactCellClass}>{row.unit.zone}</div> : null}
                      {columnVisibility.checkIn ? (
                        <div className={`${compactCellClass} truncate`}>
                          {formatShortDate(row.unit.nextCheckIn)}
                          <span className="ml-1 text-xs text-[#66736c]">({row.hoursToCheckIn}h)</span>
                        </div>
                      ) : null}
                      {columnVisibility.status ? (
                        <div className={compactCellClass}>
                          <Badge className={statusTone[row.unit.status]}>{unitStatusLabel(row.unit.status)}</Badge>
                        </div>
                      ) : null}
                      {columnVisibility.priority ? (
                        <div className={compactCellClass}>
                          <Badge className={priorityTone[row.maxPriority]}>{priorityLabel(row.maxPriority)}</Badge>
                        </div>
                      ) : null}
                      {columnVisibility.overdue ? (
                        <div className={`${compactCellClass} truncate`}>
                          Tickets {row.overdueTickets} / Tareas {row.overdueTasks}
                        </div>
                      ) : null}
                      {columnVisibility.score ? (
                        <div className={compactCellClass}>
                          <div className="flex items-center gap-2">
                            <Badge className={row.risk === "alto" ? "bg-red-600 text-white" : row.risk === "medio" ? "bg-amber-500 text-white" : "bg-emerald-700 text-white"}>
                              {row.score}
                            </Badge>
                            <div className="h-2 w-14 overflow-hidden rounded-full bg-[#e3e8e2]">
                              <div
                                className={`h-full ${
                                  row.risk === "alto" ? "bg-red-600" : row.risk === "medio" ? "bg-amber-500" : "bg-emerald-700"
                                }`}
                                style={{ width: `${Math.min(100, Math.max(4, row.score))}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      ) : null}
                      {columnVisibility.sla ? (
                        <div className={`${compactCellClass} truncate`}>
                          <div className={`inline-flex items-center gap-2 text-xs font-medium ${sla.toneClassName}`}>
                            <span className={`size-2 rounded-full ${sla.dotClassName}`} />
                            <span>{sla.label}</span>
                          </div>
                        </div>
                      ) : null}
                      {columnVisibility.actions ? (
                        <div className={`${compactCellClass} border-l border-[#e3e8e2]`}>
                          <div className="grid grid-cols-2 gap-1 pr-1">
                            <Button size="sm" variant="outline" className={`${compactActionClass} h-8 text-xs`} onClick={() => openUnit(row.unit.id)}>
                              <Search className="mr-1 size-3.5" />
                              Abrir
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className={`${compactActionClass} h-8 text-xs`}
                              disabled={!canManage || dispatching}
                              onClick={() => void dispatchCriticalTicketsForUnitIn4h(row.unit.id)}
                            >
                              <Wrench className="mr-1 size-3.5" />
                              Desp.
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className={`${compactActionClass} h-8 text-xs`}
                              disabled={!canManage}
                              onClick={() => resolveCriticalTicketsForUnit(row.unit.id)}
                            >
                              <ShieldCheck className="mr-1 size-3.5" />
                              Resolver
                            </Button>
                            <Button
                              size="sm"
                              className={`${compactActionClass} h-8 text-xs`}
                              disabled={!canManage || row.unit.status === "lista"}
                              onClick={() => handleMarkUnitReady(row.unit.id, row.unit.status)}
                            >
                              <CheckCircle2 className="mr-1 size-3.5" />
                              Lista
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {bottomSpacerHeight > 0 ? <div style={{ height: `${bottomSpacerHeight}px` }} aria-hidden="true" /> : null}
              </div>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-[#d8ded6] bg-white p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-medium text-[#2f3a35]">Historial de acciones masivas</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button type="button" size="sm" variant="outline" onClick={exportRiskHistoryCsv} disabled={filteredBulkHistory.length === 0}>
                Exportar historial CSV
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => void loadBulkRiskHistory()} disabled={bulkHistoryLoading}>
                {bulkHistoryLoading ? "Refrescando..." : "Refrescar"}
              </Button>
            </div>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Select value={historyTypeFilter} onValueChange={(value) => setHistoryTypeFilter(value as typeof historyTypeFilter)}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Tipo de accion" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los tipos</SelectItem>
                <SelectItem value="bulk_dispatch_critical">bulk_dispatch_critical</SelectItem>
                <SelectItem value="bulk_mark_units_ready">bulk_mark_units_ready</SelectItem>
                <SelectItem value="bulk_resolve_critical">bulk_resolve_critical</SelectItem>
              </SelectContent>
            </Select>
            <Select value={historyRangeFilter} onValueChange={(value) => setHistoryRangeFilter(value as typeof historyRangeFilter)}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Rango temporal" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">Ultimas 24h</SelectItem>
                <SelectItem value="7d">Ultimos 7 dias</SelectItem>
                <SelectItem value="30d">Ultimos 30 dias</SelectItem>
                <SelectItem value="all">Todo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="mt-2 text-xs text-[#66736c]">Registros filtrados: {filteredBulkHistory.length}</p>
          {bulkHistoryError ? <p className="mt-2 text-xs text-red-700">{bulkHistoryError}</p> : null}
          {bulkHistoryLoading ? <p className="mt-2 text-xs text-[#66736c]">Cargando historial...</p> : null}
          {filteredBulkHistory.length === 0 && !bulkHistoryLoading ? (
            <p className="mt-2 text-xs text-[#66736c]">Sin acciones masivas registradas.</p>
          ) : null}
          <div className="mt-3 grid gap-2">
            {filteredBulkHistory.slice(0, 8).map((item) => {
              const payload = item.payload ?? {};
              const updated = Number(payload.updated ?? 0);
              const unitIdsCount = Number(payload.unitIdsCount ?? 0);
              const assigneeLabel = payload.assigneeId ? payload.assigneeId : "sin reasignar";
              const dueLabel = payload.dueInHours ? `${payload.dueInHours}h` : "sin cambio";
              return (
                <div key={item.id} className="rounded-md border border-[#e1e7df] bg-[#fbfcfa] p-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge variant="outline" className="text-[11px]">
                      {item.type}
                    </Badge>
                    <span className="text-[11px] text-[#66736c]">{formatShortDate(String(item.createdAt))}</span>
                  </div>
                  <p className="mt-1 text-xs text-[#4b5851]">
                    updated: {updated} · unitIds: {unitIdsCount} · assignee: {assigneeLabel} · due: {dueLabel}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TasksPanel({
  tasks: localTasks,
  units: localUnits,
  updateTaskStatus,
  canUpdateTask,
}: {
  tasks: Task[];
  units: Unit[];
  updateTaskStatus: (taskId: string, status: Task["status"]) => void;
  canUpdateTask: (task: Task) => boolean;
}) {
  return (
    <Card className="min-w-0 rounded-lg border-[#d8ded6] shadow-none">
      <CardHeader>
        <CardTitle>Tareas por equipo</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {localTasks.map((task) => {
          const unit = localUnits.find((currentUnit) => currentUnit.id === task.unitId);

          const canUpdate = canUpdateTask(task);
          return (
            <div key={task.id} className="grid min-w-0 gap-3 rounded-lg border border-[#d8ded6] bg-white p-4 md:grid-cols-[minmax(0,1fr)_auto]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{task.title}</p>
                  <Badge variant="outline">{task.role}</Badge>
                </div>
                <p className="mt-1 text-sm text-[#66736c]">{unit?.code} · vence {formatShortDate(task.dueAt)}</p>
              </div>
              <Select value={task.status} onValueChange={(value) => updateTaskStatus(task.id, value as Task["status"])} disabled={!canUpdate}>
                <SelectTrigger className="h-10 w-full md:w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ticketStatuses.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status.replaceAll("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function ReservationsPanel({
  handleCsv,
  confirmCsvImport,
  downloadCsvErrors,
  saveManualReservation,
  removeManualReservation,
  editingReservationId,
  setEditingReservationId,
  csvPreview,
  csvErrors,
  csvImporting,
  csvResult,
  units: localUnits,
  reservations,
}: {
  handleCsv: (file: File | null) => void;
  confirmCsvImport: () => Promise<void>;
  downloadCsvErrors: () => void;
  saveManualReservation: (input: {
    reservationId?: string;
    unitId: string;
    platform: Reservation["platform"];
    guest: string;
    checkIn: string;
    checkOut: string;
    notes?: string;
    guestData?: Reservation["guestData"];
  }) => Promise<void>;
  removeManualReservation: (reservationId: string) => Promise<void>;
  editingReservationId: string | null;
  setEditingReservationId: (value: string | null) => void;
  csvPreview: Reservation[];
  csvErrors: CsvImportError[];
  csvImporting: boolean;
  csvResult: string;
  units: Unit[];
  reservations: AppData["reservations"];
}) {
  const [opsDay, setOpsDay] = useState(getTodayInputValue);
  const [reservationViewMode, setReservationViewMode] = useState<"cards" | "list">("cards");
  const [reservationEditorOpen, setReservationEditorOpen] = useState(false);
  const editingReservation = reservations.find((reservation) => reservation.id === editingReservationId) ?? null;
  const [primaryPhotoDataUrl, setPrimaryPhotoDataUrl] = useState<string>("");
  const [primaryPhotoPath, setPrimaryPhotoPath] = useState<string>("");
  const [primaryPhotoStatus, setPrimaryPhotoStatus] = useState<string>("Sin foto cargada");
  const effectivePrimaryPhotoDataUrl = primaryPhotoDataUrl || editingReservation?.guestData?.primary.photoDataUrl || "";
  const dayStart = useMemo(() => new Date(`${opsDay}T00:00:00`), [opsDay]);
  const dayEnd = useMemo(() => new Date(`${opsDay}T23:59:59`), [opsDay]);
  const operationalItems = useMemo(() => {
    const events: Array<{
      id: string;
      type: "checkout" | "checkin";
      at: Date;
      hour: number;
      minute: number;
      reservation: Reservation;
      unit?: Unit;
      conflict: boolean;
    }> = [];

    for (const reservation of reservations) {
      const unit = localUnits.find((currentUnit) => currentUnit.id === reservation.unitId);
      const outAt = new Date(reservation.checkOut);
      const inAt = new Date(reservation.checkIn);
      const pushIfInDay = (type: "checkout" | "checkin", at: Date) => {
        if (at < dayStart || at > dayEnd) return;
        events.push({
          id: `${reservation.id}-${type}`,
          type,
          at,
          hour: at.getHours(),
          minute: at.getMinutes(),
          reservation,
          unit,
          conflict: false,
        });
      };
      pushIfInDay("checkout", outAt);
      pushIfInDay("checkin", inAt);
    }

    const unitHourMap = new Map<string, Set<number>>();
    for (const event of events) {
      const unitId = event.reservation.unitId;
      if (!unitHourMap.has(unitId)) unitHourMap.set(unitId, new Set());
      const set = unitHourMap.get(unitId)!;
      if (set.has(event.hour)) {
        event.conflict = true;
      } else {
        set.add(event.hour);
      }
    }

    return events.sort((a, b) => a.at.getTime() - b.at.getTime());
  }, [dayEnd, dayStart, localUnits, reservations]);
  const operationsByHour = useMemo(() => {
    const map = new Map<number, typeof operationalItems>();
    for (let i = 0; i <= 23; i += 1) map.set(i, []);
    for (const event of operationalItems) {
      map.get(event.hour)?.push(event);
    }
    return map;
  }, [operationalItems]);
  const opsSummary = useMemo(() => {
    const checkOuts = operationalItems.filter((item) => item.type === "checkout").length;
    const checkIns = operationalItems.filter((item) => item.type === "checkin").length;
    const conflicts = operationalItems.filter((item) => item.conflict).length;
    const unitsTouched = new Set(operationalItems.map((item) => item.reservation.unitId)).size;
    return { checkOuts, checkIns, conflicts, unitsTouched };
  }, [operationalItems]);

  async function submitManualReservation(formData: FormData) {
    const unitId = String(formData.get("manualUnitId") ?? "");
    const guest = String(formData.get("manualGuest") ?? "").trim();
    const platform = String(formData.get("manualPlatform") ?? "Airbnb") as Reservation["platform"];
    const checkOutRaw = String(formData.get("manualCheckOut") ?? "").trim();
    const checkInRaw = String(formData.get("manualCheckIn") ?? "").trim();
    const notes = String(formData.get("manualNotes") ?? "").trim();
    const primaryDocType = String(formData.get("manualPrimaryDocType") ?? "dni") as "dni" | "pasaporte";
    const primaryDocNumber = String(formData.get("manualPrimaryDocNumber") ?? "").trim();
    const primaryNationality = String(formData.get("manualPrimaryNationality") ?? "").trim();
    const primaryPhone = String(formData.get("manualPrimaryPhone") ?? "").trim();
    const primaryEmail = String(formData.get("manualPrimaryEmail") ?? "").trim();
    const occupantsRaw = String(formData.get("manualOccupants") ?? "").trim();
    const dataConsentAccepted = String(formData.get("manualDataConsent") ?? "") === "on";
    const termsAccepted = String(formData.get("manualTermsAccepted") ?? "") === "on";
    if (!unitId || !guest || !checkOutRaw || !checkInRaw) return;
    if (!dataConsentAccepted || !termsAccepted) {
      throw new Error("Debes aceptar consentimiento de datos y términos.");
    }
    const occupants: NonNullable<Reservation["guestData"]>["occupants"] = occupantsRaw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const [fullName, documentTypeRaw, documentNumber, nationality] = line.split("|").map((value) => value.trim());
        const documentType: "dni" | "pasaporte" = documentTypeRaw === "pasaporte" ? "pasaporte" : "dni";
        return {
          fullName: fullName || "Sin nombre",
          documentType,
          documentNumber: documentNumber || "",
          nationality: nationality || undefined,
        };
      })
      .filter((person) => person.documentNumber.length > 0);
    await saveManualReservation({
      reservationId: editingReservation?.id,
      unitId,
      platform,
      guest,
      checkOut: new Date(checkOutRaw).toISOString(),
      checkIn: new Date(checkInRaw).toISOString(),
      notes: notes || undefined,
      guestData: {
        primary: {
          fullName: guest,
          documentType: primaryDocType,
          documentNumber: primaryDocNumber,
          nationality: primaryNationality || undefined,
          phone: primaryPhone || undefined,
          email: primaryEmail || undefined,
          photoDataUrl: effectivePrimaryPhotoDataUrl || undefined,
          photoPath: primaryPhotoPath || editingReservation?.guestData?.primary.photoPath || undefined,
        },
        occupants,
        legal: {
          dataConsentAccepted,
          termsAccepted,
          acceptedAt: new Date().toISOString(),
        },
      },
    });
    setPrimaryPhotoDataUrl("");
    setPrimaryPhotoPath("");
    setPrimaryPhotoStatus("Sin foto cargada");
  }

  function exportGuestRecord(reservation: Reservation) {
    const unit = localUnits.find((currentUnit) => currentUnit.id === reservation.unitId);
    const primary = reservation.guestData?.primary;
    const occupants = reservation.guestData?.occupants ?? [];
    const legal = reservation.guestData?.legal;
    const rows = [
      ["unidad", unit?.code ?? ""],
      ["huesped_titular", reservation.guest],
      ["documento_tipo", primary?.documentType ?? ""],
      ["documento_numero", primary?.documentNumber ?? ""],
      ["nacionalidad", primary?.nationality ?? ""],
      ["telefono", primary?.phone ?? ""],
      ["email", primary?.email ?? ""],
      ["foto_titular", primary?.photoDataUrl ? "si" : "no"],
      ["check_out", reservation.checkOut],
      ["check_in", reservation.checkIn],
      ["consentimiento_datos", String(legal?.dataConsentAccepted ?? false)],
      ["acepto_terminos", String(legal?.termsAccepted ?? false)],
      ["aceptado_en", legal?.acceptedAt ?? ""],
    ];
    for (const [index, occupant] of occupants.entries()) {
      rows.push([`acompanante_${index + 1}`, `${occupant.fullName} | ${occupant.documentType} | ${occupant.documentNumber} | ${occupant.nationality ?? ""}`]);
    }
    const csv = Papa.unparse(rows, { header: false });
    const stamp = reservation.id.replace(/[^a-zA-Z0-9-]/g, "-");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `ficha-huesped-${stamp}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Card className="min-w-0 rounded-lg border-[#d8ded6] shadow-none">
        <CardHeader className="flex-row items-center justify-between gap-2">
          <CardTitle>{editingReservation ? "Editar reserva" : "Nueva reserva"}</CardTitle>
          <Button
            type="button"
            onClick={() => {
              setEditingReservationId(null);
              setPrimaryPhotoDataUrl("");
              setPrimaryPhotoPath("");
              setPrimaryPhotoStatus("Sin foto cargada");
              setReservationEditorOpen(true);
            }}
          >
            {editingReservation ? "Abrir editor" : "Crear reserva"}
          </Button>
        </CardHeader>
        <CardContent className="text-sm text-[#66736c]">
          Alta y edición de reservas desde modal para no perder contexto.
        </CardContent>
      </Card>

      <Dialog open={reservationEditorOpen} onOpenChange={setReservationEditorOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingReservation ? `Editar reserva · ${editingReservation.guest}` : "Nueva reserva"}</DialogTitle>
          </DialogHeader>
          <form
            action={async (formData) => {
              await submitManualReservation(formData);
              setReservationEditorOpen(false);
              setEditingReservationId(null);
            }}
            className="grid gap-3"
            key={editingReservation?.id ?? "reservation-new"}
          >
            <label htmlFor="manual-unit" className="text-sm text-[#55645d]">Unidad</label>
            <select
              id="manual-unit"
              name="manualUnitId"
              defaultValue={editingReservation?.unitId ?? localUnits[0]?.id}
              className="h-10 rounded-lg border border-[#d8ded6] bg-white px-3 text-sm"
            >
              {localUnits.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.code}
                </option>
              ))}
            </select>
            <label htmlFor="manual-platform" className="text-sm text-[#55645d]">Plataforma</label>
            <select
              id="manual-platform"
              name="manualPlatform"
              defaultValue={editingReservation?.platform ?? "Airbnb"}
              className="h-10 rounded-lg border border-[#d8ded6] bg-white px-3 text-sm"
            >
              {["Airbnb", "Booking", "MercadoLibre", "Directo"].map((platform) => (
                <option key={platform} value={platform}>
                  {platform}
                </option>
              ))}
            </select>
            <label htmlFor="manual-guest" className="text-sm text-[#55645d]">Huesped</label>
            <Input id="manual-guest" name="manualGuest" defaultValue={editingReservation?.guest ?? ""} placeholder="Nombre del huesped" required />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <label htmlFor="manual-primary-doc-type" className="text-sm text-[#55645d]">Documento titular</label>
                <select
                  id="manual-primary-doc-type"
                  name="manualPrimaryDocType"
                  defaultValue={editingReservation?.guestData?.primary.documentType ?? "dni"}
                  className="h-10 rounded-lg border border-[#d8ded6] bg-white px-3 text-sm"
                >
                  <option value="dni">DNI</option>
                  <option value="pasaporte">Pasaporte</option>
                </select>
              </div>
              <div className="grid gap-1">
                <label htmlFor="manual-primary-doc-number" className="text-sm text-[#55645d]">Nro documento</label>
                <Input
                  id="manual-primary-doc-number"
                  name="manualPrimaryDocNumber"
                  defaultValue={editingReservation?.guestData?.primary.documentNumber ?? ""}
                  placeholder="Ej: 30111222"
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <label htmlFor="manual-primary-nationality" className="text-sm text-[#55645d]">Nacionalidad</label>
                <Input
                  id="manual-primary-nationality"
                  name="manualPrimaryNationality"
                  defaultValue={editingReservation?.guestData?.primary.nationality ?? ""}
                  placeholder="Argentina"
                />
              </div>
              <div className="grid gap-1">
                <label htmlFor="manual-primary-phone" className="text-sm text-[#55645d]">Teléfono</label>
                <Input
                  id="manual-primary-phone"
                  name="manualPrimaryPhone"
                  defaultValue={editingReservation?.guestData?.primary.phone ?? ""}
                  placeholder="+54..."
                />
              </div>
            </div>
            <label htmlFor="manual-primary-email" className="text-sm text-[#55645d]">Email titular</label>
            <Input
              id="manual-primary-email"
              name="manualPrimaryEmail"
              type="email"
              defaultValue={editingReservation?.guestData?.primary.email ?? ""}
              placeholder="huesped@email.com"
            />
            <div className="grid gap-2">
              <label className="text-sm text-[#55645d]">Foto del titular</label>
              <label className="flex h-10 cursor-pointer items-center justify-center rounded-lg border border-[#d8ded6] bg-white px-3 text-sm">
                Subir foto
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setPrimaryPhotoStatus("Comprimiendo foto...");
                    try {
                      const compressed = await compressImage(file, 960, 0.75);
                      setPrimaryPhotoDataUrl(compressed.dataUrl);

                      const safeGuest = (String(editingReservation?.guest ?? "titular").toLowerCase().replace(/[^a-z0-9]+/g, "-") || "titular").slice(0, 40);
                      const safeUnit = (String(editingReservation?.unitId ?? "unit").replace(/[^a-zA-Z0-9-]/g, "-") || "unit").slice(0, 40);
                      const path = `guest-photos/${safeUnit}/${safeGuest}-${Date.now()}.jpg`;
                      try {
                        const uploaded = await uploadGuestPhotoAction({
                          path,
                          dataUrl: compressed.dataUrl,
                          contentType: "image/jpeg",
                        });
                        setPrimaryPhotoDataUrl(uploaded.signedUrl ?? compressed.dataUrl);
                        setPrimaryPhotoPath(uploaded.path);
                        setPrimaryPhotoStatus(`Foto subida (${compressed.sizeKb} KB)`);
                      } catch {
                        setPrimaryPhotoStatus(`Foto local (${compressed.sizeKb} KB). Sin subida remota.`);
                      }
                    } catch {
                      setPrimaryPhotoStatus("No se pudo procesar la foto");
                    } finally {
                      event.target.value = "";
                    }
                  }}
                />
              </label>
              <p className="text-xs text-[#66736c]">{primaryPhotoStatus}</p>
              {effectivePrimaryPhotoDataUrl ? (
                <div className="grid gap-2 rounded-lg border border-[#d8ded6] bg-white p-2">
                  <div className="relative h-32 overflow-hidden rounded-md">
                    <Image src={effectivePrimaryPhotoDataUrl} alt="Foto titular" fill className="object-cover" unoptimized />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                  onClick={() => {
                      setPrimaryPhotoDataUrl("");
                      setPrimaryPhotoPath("");
                      setPrimaryPhotoStatus("Sin foto cargada");
                    }}
                  >
                    Quitar foto
                  </Button>
                </div>
              ) : null}
            </div>
            <label htmlFor="manual-occupants" className="text-sm text-[#55645d]">Acompañantes</label>
            <Textarea
              id="manual-occupants"
              name="manualOccupants"
              defaultValue={(editingReservation?.guestData?.occupants ?? [])
                .map((person) => `${person.fullName}|${person.documentType}|${person.documentNumber}|${person.nationality ?? ""}`)
                .join("\n")}
              placeholder="Uno por línea: Nombre|dni|12345678|Argentina"
              className="min-h-24 resize-none"
            />
            <label className="flex items-center gap-2 rounded-lg border border-[#d8ded6] bg-white p-3 text-sm">
              <input id="manual-data-consent" name="manualDataConsent" type="checkbox" className="size-4 accent-[#26352f]" required />
              Confirmo consentimiento de tratamiento de datos personales.
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-[#d8ded6] bg-white p-3 text-sm">
              <input id="manual-terms-accepted" name="manualTermsAccepted" type="checkbox" className="size-4 accent-[#26352f]" required />
              Acepto términos y condiciones de hospedaje.
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <label htmlFor="manual-checkout" className="text-sm text-[#55645d]">Check-out</label>
                <Input id="manual-checkout" name="manualCheckOut" type="datetime-local" defaultValue={editingReservation ? toLocalInput(editingReservation.checkOut) : ""} required />
              </div>
              <div className="grid gap-1">
                <label htmlFor="manual-checkin" className="text-sm text-[#55645d]">Check-in</label>
                <Input id="manual-checkin" name="manualCheckIn" type="datetime-local" defaultValue={editingReservation ? toLocalInput(editingReservation.checkIn) : ""} required />
              </div>
            </div>
            <label htmlFor="manual-notes" className="text-sm text-[#55645d]">Notas</label>
            <Textarea id="manual-notes" name="manualNotes" defaultValue={editingReservation?.notes ?? ""} className="min-h-20 resize-none" />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button type="submit" className="w-full">{editingReservation ? "Guardar cambios" : "Crear reserva"}</Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setReservationEditorOpen(false);
                  setEditingReservationId(null);
                  setPrimaryPhotoDataUrl("");
                  setPrimaryPhotoPath("");
                  setPrimaryPhotoStatus("Sin foto cargada");
                }}
              >
                Cancelar
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Card className="min-w-0 rounded-lg border-[#d8ded6] shadow-none">
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>Calendario operativo diario</CardTitle>
            <Input
              type="date"
              value={opsDay}
              onChange={(event) => setOpsDay(event.target.value)}
              className="h-10 w-full sm:w-[180px]"
              aria-label="Dia operativo"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border border-[#d8ded6] bg-white px-3 py-2 text-sm">Check-outs: <strong>{opsSummary.checkOuts}</strong></div>
            <div className="rounded-md border border-[#d8ded6] bg-white px-3 py-2 text-sm">Check-ins: <strong>{opsSummary.checkIns}</strong></div>
            <div className="rounded-md border border-[#d8ded6] bg-white px-3 py-2 text-sm">Unidades: <strong>{opsSummary.unitsTouched}</strong></div>
            <div className="rounded-md border border-[#d8ded6] bg-white px-3 py-2 text-sm">
              Conflictos: <strong className={opsSummary.conflicts > 0 ? "text-red-700" : "text-emerald-700"}>{opsSummary.conflicts}</strong>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-2">
          <div className="max-h-[46vh] overflow-y-auto rounded-lg border border-[#d8ded6] bg-white">
            {Array.from({ length: 24 }).map((_, hour) => {
              const events = operationsByHour.get(hour) ?? [];
              const hourLabel = `${String(hour).padStart(2, "0")}:00`;
              return (
                <div key={hour} className="grid grid-cols-[68px_1fr] border-b border-[#edf1eb] last:border-b-0">
                  <div className="bg-[#f6f8f3] px-2 py-2 text-xs font-medium text-[#55635c]">{hourLabel}</div>
                  <div className="grid gap-2 px-2 py-2">
                    {events.length === 0 ? <p className="text-xs text-[#94a19a]">sin movimientos</p> : null}
                    {events.map((event) => (
                      <div
                        key={event.id}
                        className={`rounded-md border px-2 py-2 text-xs ${
                          event.type === "checkout"
                            ? "border-amber-200 bg-amber-50 text-amber-900"
                            : "border-sky-200 bg-sky-50 text-sky-900"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <strong>{event.unit?.code ?? "Unidad"} · {event.type === "checkout" ? "Check-out" : "Check-in"}</strong>
                          <span>{String(event.hour).padStart(2, "0")}:{String(event.minute).padStart(2, "0")}</span>
                        </div>
                        <p className="mt-1 text-[11px]">
                          {event.reservation.guest} · {event.reservation.platform}
                          {event.conflict ? <span className="ml-2 font-semibold text-red-700">Conflicto horario</span> : null}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="min-w-0 rounded-lg border-[#d8ded6] shadow-none">
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>Ventanas operativas</CardTitle>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Button type="button" size="sm" className="w-full sm:w-auto" variant={reservationViewMode === "cards" ? "default" : "outline"} onClick={() => setReservationViewMode("cards")}>
                <LayoutGrid className="mr-1 size-3.5" />
                Tarjetas
              </Button>
              <Button type="button" size="sm" className="w-full sm:w-auto" variant={reservationViewMode === "list" ? "default" : "outline"} onClick={() => setReservationViewMode("list")}>
                <List className="mr-1 size-3.5" />
                Lista
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          {reservationViewMode === "cards" ? reservations.map((reservation) => {
            const unit = localUnits.find((currentUnit) => currentUnit.id === reservation.unitId);
            const guestPhoto = reservation.guestData?.primary.photoDataUrl;

            return (
              <div key={reservation.id} className="grid min-w-0 gap-3 rounded-lg border border-[#d8ded6] bg-white p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  {guestPhoto ? (
                    <div className="relative mb-2 h-14 w-14 overflow-hidden rounded-md border border-[#d8ded6]">
                      <Image src={guestPhoto} alt={`Foto titular ${reservation.guest}`} fill className="object-cover" unoptimized />
                    </div>
                  ) : null}
                  <p className="break-words font-medium">{unit?.code} · {reservation.guest}</p>
                  <p className="break-words text-sm text-[#66736c]">{reservation.platform} · {reservation.notes || "Sin observaciones"}</p>
                  {reservation.guestData ? (
                    <p className="text-xs text-[#66736c]">
                      Titular: {reservation.guestData.primary.documentType.toUpperCase()} {reservation.guestData.primary.documentNumber}
                      {" · "}Acompañantes: {reservation.guestData.occupants.length}
                    </p>
                  ) : null}
                  {reservation.guestData?.legal ? (
                    <p className="text-xs text-[#66736c]">
                      Consentimiento: {reservation.guestData.legal.dataConsentAccepted ? "Sí" : "No"} · Términos: {reservation.guestData.legal.termsAccepted ? "Sí" : "No"}
                    </p>
                  ) : null}
                </div>
                <p className="text-sm text-[#66736c] sm:text-right">
                  Sale {formatShortDate(reservation.checkOut)}
                  <br />
                  Entra {formatShortDate(reservation.checkIn)}
                </p>
                <div className="grid grid-cols-1 gap-2 sm:col-span-2 sm:grid-cols-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      setEditingReservationId(reservation.id);
                      setPrimaryPhotoDataUrl(reservation.guestData?.primary.photoDataUrl ?? "");
                      setPrimaryPhotoPath(reservation.guestData?.primary.photoPath ?? "");
                      setPrimaryPhotoStatus(reservation.guestData?.primary.photoDataUrl ? "Foto cargada" : "Sin foto cargada");
                      setReservationEditorOpen(true);
                    }}
                  >
                    Editar
                  </Button>
                  <Button variant="outline" size="sm" className="w-full" onClick={() => exportGuestRecord(reservation)}>
                    Exportar ficha
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full border-red-300 text-red-700 hover:bg-red-50"
                    onClick={() => {
                      if (!window.confirm(`Eliminar reserva de ${reservation.guest}?`)) return;
                      void removeManualReservation(reservation.id);
                    }}
                  >
                    Eliminar
                  </Button>
                </div>
              </div>
            );
          }) : (
            <div className="overflow-x-auto rounded-lg border border-[#d8ded6] bg-white">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-[#eef1ea] text-left text-xs uppercase tracking-wide text-[#66736c]">
                  <tr>
                    <th className="px-3 py-2">Unidad</th>
                    <th className="px-3 py-2">Huesped</th>
                    <th className="px-3 py-2">Plataforma</th>
                    <th className="px-3 py-2">Check-out</th>
                    <th className="px-3 py-2">Check-in</th>
                    <th className="px-3 py-2">Documento</th>
                    <th className="border-l border-[#d8ded6] bg-[#eef1ea] px-3 py-2 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#d8ded6]">
                  {reservations.map((reservation) => {
                    const unit = localUnits.find((currentUnit) => currentUnit.id === reservation.unitId);
                    return (
                      <tr key={reservation.id} className="hover:bg-[#f8faf7]">
                        <td className="px-3 py-3 font-medium">{unit?.code ?? "-"}</td>
                        <td className="max-w-[180px] truncate px-3 py-3" title={reservation.guest}>{reservation.guest}</td>
                        <td className="px-3 py-3">{reservation.platform}</td>
                        <td className="px-3 py-3">{formatShortDate(reservation.checkOut)}</td>
                        <td className="px-3 py-3">{formatShortDate(reservation.checkIn)}</td>
                        <td className="px-3 py-3">
                          <Badge variant="outline">{reservation.guestData?.primary.documentNumber ? "Completo" : "Falta dato"}</Badge>
                        </td>
                        <td className="border-l border-[#e3e8e2] bg-white px-3 py-3">
                          <div className="grid w-[164px] grid-cols-2 gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 px-2 text-[11px]"
                              onClick={() => {
                                setEditingReservationId(reservation.id);
                                setPrimaryPhotoDataUrl(reservation.guestData?.primary.photoDataUrl ?? "");
                                setPrimaryPhotoPath(reservation.guestData?.primary.photoPath ?? "");
                                setPrimaryPhotoStatus(reservation.guestData?.primary.photoDataUrl ? "Foto cargada" : "Sin foto cargada");
                                setReservationEditorOpen(true);
                              }}
                            >
                              Editar
                            </Button>
                            <Button variant="outline" size="sm" className="h-8 px-2 text-[11px]" onClick={() => exportGuestRecord(reservation)}>
                              Exportar
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="col-span-2 h-8 border-red-300 px-2 text-[11px] text-red-700 hover:bg-red-50"
                              onClick={() => {
                                if (!window.confirm(`Eliminar reserva de ${reservation.guest}?`)) return;
                                void removeManualReservation(reservation.id);
                              }}
                            >
                              Eliminar
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="min-w-0 rounded-lg border-[#d8ded6] shadow-none">
        <CardHeader>
          <CardTitle>Importador CSV</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Input
            accept=".csv"
            type="file"
            aria-label="Seleccionar archivo CSV de reservas"
            onChange={(event) => handleCsv(event.target.files?.[0] ?? null)}
          />
          <Textarea readOnly value={csvResult} className="min-h-28 resize-none text-sm" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button className="w-full" onClick={() => confirmCsvImport()} disabled={csvPreview.length === 0 || csvImporting}>
              {csvImporting ? "Importando..." : `Confirmar import (${csvPreview.length})`}
            </Button>
            <Button className="w-full" variant="outline" onClick={downloadCsvErrors} disabled={csvErrors.length === 0}>
              Descargar errores ({csvErrors.length})
            </Button>
          </div>
          <p className="text-sm text-[#66736c]">
            La v1 valida el formato en navegador. La persistencia queda lista para Supabase cuando haya credenciales.
          </p>
        </CardContent>
      </Card>
    </>
  );
}

function NotificationsPanel({
  notifications,
  evaluateOperationalSla,
  markRead,
  markAllRead,
}: {
  notifications: NotificationItem[];
  evaluateOperationalSla: () => void;
  markRead: (notificationId: string) => void;
  markAllRead: () => void;
}) {
  const unreadCount = notifications.filter((notification) => !notification.read).length;

  return (
    <Card className="rounded-lg border-[#d8ded6] shadow-none">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>Bandeja de avisos</CardTitle>
          <p className="mt-1 text-sm text-[#66736c]">{unreadCount} pendientes para revisar</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-10" onClick={evaluateOperationalSla} aria-label="Evaluar alertas de tiempos">
            Evaluar tiempos
          </Button>
          <Button variant="outline" className="h-10" onClick={markAllRead} aria-label="Marcar todas las notificaciones como leidas">
            Marcar todo
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {notifications.length === 0 ? (
          <div className="rounded-lg border border-[#d8ded6] bg-white p-5 text-sm text-[#66736c]">Sin avisos por ahora.</div>
        ) : null}
        {notifications.map((notification) => (
          <button
            key={notification.id}
            onClick={() => markRead(notification.id)}
            aria-label={`Marcar notificacion ${notification.title} como leida`}
            className={`rounded-lg border p-4 text-left transition ${
              notification.read ? "border-[#d8ded6] bg-white" : "border-[#26352f] bg-[#f0f4ed]"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">{notification.title}</p>
              <Badge variant="outline">{notification.targetRole}</Badge>
            </div>
            <p className="mt-2 text-xs text-[#66736c]">
              {notification.type.replaceAll("_", " ")} · {formatShortDate(notification.createdAt)}
            </p>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

function UsersPanel({
  users,
  canManage,
  onUsersUpdated,
}: {
  users: User[];
  canManage: boolean;
  onUsersUpdated: (users: User[] | ((current: User[]) => User[])) => void;
}) {
  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage) return;
    const form = new FormData(event.currentTarget);
    const input = {
      email: String(form.get("email") ?? "").trim().toLowerCase(),
      name: String(form.get("name") ?? "").trim(),
      role: String(form.get("role") ?? "supervisor"),
      zone: String(form.get("zone") ?? "Todas").trim(),
      password: String(form.get("password") ?? ""),
    };
    if (!input.email || !input.name || !input.password) return;
    const created = await createAppUserAction(input);
    const localUser: User = {
      id: created?.id ?? `local-user-${Date.now()}`,
      email: created?.email ?? input.email,
      name: created?.name ?? input.name,
      role: (created?.role as Role) ?? (input.role as Role),
      zone: created?.zone ?? input.zone,
      active: created?.active ?? false,
    };
    onUsersUpdated((current) => [localUser, ...current]);
    event.currentTarget.reset();
  }

  async function toggleUser(user: User) {
    if (!canManage) return;
    await updateAppUserAccessAction({
      userId: user.id,
      active: !(user.active ?? false),
    });
    onUsersUpdated((current) =>
      current.map((item) => (item.id === user.id ? { ...item, active: !(item.active ?? false) } : item)),
    );
  }

  async function resetPassword(user: User) {
    if (!canManage) return;
    const password = window.prompt(`Nueva contraseña para ${user.email ?? user.name} (mínimo 8 caracteres):`, "");
    if (!password) return;
    if (password.length < 8) {
      window.alert("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    await updateAppUserPasswordAction({
      userId: user.id,
      password,
    });
    window.alert("Contraseña actualizada.");
  }

  return (
    <Card className="rounded-lg border-[#d8ded6] shadow-none">
      <CardHeader>
        <CardTitle>Usuarios del sistema</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form onSubmit={createUser} className="grid gap-2 rounded-lg border border-[#d8ded6] bg-[#f8faf7] p-3 md:grid-cols-6">
          <Input name="name" placeholder="Nombre" className="md:col-span-1" required />
          <Input name="email" type="email" placeholder="email@dominio.com" className="md:col-span-2" required />
          <SelectName
            name="role"
            options={[
              ["admin", "Admin"],
              ["supervisor", "Supervisor"],
              ["limpieza", "Limpieza"],
              ["mantenimiento", "Mantenimiento"],
            ]}
          />
          <Input name="zone" placeholder="Zona" defaultValue="Todas" className="md:col-span-1" required />
          <Input name="password" type="password" placeholder="Contraseña inicial" className="md:col-span-1" required />
          <Button className="md:col-span-1" disabled={!canManage}>
            Registrar
          </Button>
        </form>
        <div className="overflow-x-auto rounded-lg border border-[#d8ded6] bg-white">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-[#eef1ea] text-left text-xs uppercase tracking-wide text-[#66736c]">
              <tr>
                <th className="px-3 py-2">Nombre</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Rol</th>
                <th className="px-3 py-2">Zona</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#d8ded6]">
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="px-3 py-2 font-medium">{user.name}</td>
                  <td className="px-3 py-2">{user.email ?? "-"}</td>
                  <td className="px-3 py-2">{user.role}</td>
                  <td className="px-3 py-2">{user.zone}</td>
                  <td className="px-3 py-2">
                    <Badge className={user.active ? "bg-emerald-700 text-white" : "bg-zinc-600 text-white"}>
                      {user.active ? "Activo" : "Pendiente"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" disabled={!canManage} onClick={() => void toggleUser(user)}>
                        {user.active ? "Desactivar" : "Activar"}
                      </Button>
                      <Button size="sm" variant="outline" disabled={!canManage} onClick={() => void resetPassword(user)}>
                        Reset clave
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function Navigation({
  activeTab,
  onNavigate,
}: {
  activeTab: string;
  onNavigate: (tab: string) => void;
}) {
  return (
    <nav className="mt-4 grid gap-2">
      <div className="mb-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#26352f] text-white">
          <Home className="size-5" />
        </div>
        <p className="mt-3 text-lg font-semibold leading-tight">
          MRAnalytics
          <br />
          Departments
        </p>
        <p className="text-sm text-[#66736c]">Version actual: v1</p>
      </div>
      {[
        [ClipboardList, "Operacion", "operacion"],
        [Home, "Kanban", "kanban"],
        [AlertTriangle, "Riesgo", "riesgo"],
        [CalendarClock, "Reservas", "reservas"],
        [ShieldCheck, "Tiempos", "sla"],
        [Bell, "Avisos", "avisos"],
        [UserRoundCog, "Usuarios", "usuarios"],
        [UserRoundCog, "Ayuda", "ayuda"],
      ].map(([Icon, label, tab]) => (
        <Button
          key={label as string}
          variant={activeTab === tab ? "default" : "ghost"}
          className="h-11 justify-start gap-3 rounded-lg"
          onClick={() => onNavigate(tab as string)}
        >
          <Icon className="size-4" />
          {label as string}
        </Button>
      ))}
      <Separator className="my-2" />
      <p className="px-2 text-xs font-medium uppercase tracking-wide text-[#66736c]">Vistas avanzadas</p>
      {[
        ["Usuarios", "usuarios"],
        ["Departamentos", "departamentos"],
        ["Tareas", "tareas"],
        ["Ejecutivo", "ejecutivo"],
        ["Go-Live", "golive"],
        ["Control", "control"],
        ["Agentes", "agentes"],
      ].map(([label, tab]) => (
        <Button
          key={label}
          variant={activeTab === tab ? "default" : "ghost"}
          className="h-10 justify-start rounded-lg text-sm"
          onClick={() => onNavigate(tab)}
        >
          {label}
        </Button>
      ))}
    </nav>
  );
}

function Metric({ icon: Icon, label, value, detail }: { icon: typeof Home; label: string; value: string; detail: string }) {
  return (
    <Card className="rounded-xl border-[#d8ded6] bg-white/95 shadow-none dark:border-[#263229] dark:bg-[#121813]">
      <CardContent className="flex items-center gap-4 p-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#e0e8dc] text-[#26352f] dark:bg-[#223026] dark:text-[#d8e4dc]">
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-[#66736c] dark:text-[#9eb0a5]">{label}</p>
          <p className="text-2xl font-semibold leading-none text-[#111814] dark:text-[#eef5f0]">{value}</p>
          <p className="text-xs leading-tight text-[#66736c] dark:text-[#a6b8ae]">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function UnitDetail({
  unit,
  tickets,
  evidence,
  closures,
  updateUnitStatus,
  addEvidence,
  closeOperationalFlow,
  canManageUnit,
}: {
  unit: Unit;
  tickets: Ticket[];
  evidence: EvidenceItem[];
  closures: OperationalClosure[];
  updateUnitStatus: (unitId: string, status: Unit["status"]) => void;
  addEvidence: (input: { unitId: string; ticketId?: string; file: File; note?: string }) => Promise<void>;
  closeOperationalFlow: (input: {
    unitId: string;
    ticketId?: string;
    checklist: Record<string, boolean>;
    evidenceRequired: boolean;
    evidenceCount: number;
    notes?: string;
  }) => Promise<void>;
  canManageUnit: boolean;
}) {
  const risk = isCheckInAtRisk(unit, tickets);
  const [evidenceNote, setEvidenceNote] = useState("");
  const [selectedTicketId, setSelectedTicketId] = useState(tickets[0]?.id ?? "");
  const [evidenceStatus, setEvidenceStatus] = useState("Lista para cargar evidencia");
  const [locationMessage, setLocationMessage] = useState("Ubicación lista para compartir");
  const [closureNotes, setClosureNotes] = useState("");
  const [closureChecklist, setClosureChecklist] = useState<Record<string, boolean>>({
    fotos: true,
    limpieza: false,
    mantenimiento: false,
    lista: false,
  });

  async function handleEvidenceFile(file: File | null) {
    if (!file) return;
    setEvidenceStatus("Comprimiendo imagen...");

    try {
      await addEvidence({
        unitId: unit.id,
        ticketId: selectedTicketId || undefined,
        file,
        note: evidenceNote,
      });
      setEvidenceStatus("Evidencia agregada");
      setEvidenceNote("");
    } catch (error) {
      setEvidenceStatus(error instanceof Error ? error.message : "No se pudo agregar evidencia");
    }
  }

  const encodedAddress = encodeURIComponent(unit.address);
  const mapEmbedUrl = `https://www.google.com/maps?q=${encodedAddress}&output=embed`;
  const mapOpenUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
  const whatsappText = encodeURIComponent(
    `Ubicación del departamento%0A${unit.address}%0AMapa: ${mapOpenUrl}`,
  );
  const whatsappUrl = `https://wa.me/?text=${whatsappText}`;

  async function shareLocation() {
    const payload = {
      title: `${unit.code} - Ubicación`,
      text: `${unit.code} · ${unit.address}`,
      url: mapOpenUrl,
    };

    try {
      if (navigator.share) {
        await navigator.share(payload);
        setLocationMessage("Ubicación compartida");
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(mapOpenUrl);
        setLocationMessage("Link copiado");
        return;
      }
      setLocationMessage("No se pudo compartir automáticamente");
    } catch {
      setLocationMessage("No se pudo compartir automáticamente");
    }
  }

  return (
    <Card className="h-fit rounded-lg border-[#d8ded6] shadow-none">
      <CardHeader>
        <ApartmentPhoto unit={unit} className="mb-4 h-44" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{unit.code}</CardTitle>
            <p className="mt-1 text-sm text-[#66736c]">{unit.address}</p>
          </div>
          {risk ? <AlertTriangle className="size-5 text-red-600" /> : <CheckCircle2 className="size-5 text-emerald-700" />}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Select value={unit.status} onValueChange={(value) => updateUnitStatus(unit.id, value as Unit["status"])}>
          <SelectTrigger className="h-11 w-full" disabled={!canManageUnit}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {unitStatuses.map((status) => (
              <SelectItem key={status} value={status}>
                {unitStatusLabel(status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!canManageUnit ? <p className="text-xs text-[#66736c]">Sin permisos para cambiar estado de unidad.</p> : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Info label="Zona" value={unit.zone} />
          <Info label="Piso" value={unit.floor} />
          <Info label="Owner" value={unit.owner} />
          <Info label="Check-in" value={formatShortDate(unit.nextCheckIn)} />
        </div>
        <div className="rounded-lg border border-[#d8ded6] bg-white p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Ubicación</p>
            <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto sm:flex-wrap">
              <Button size="sm" className="w-full gap-1" variant="outline" onClick={() => window.open(mapOpenUrl, "_blank", "noopener,noreferrer")}>
                <MapPinned className="size-3.5" />
                Ver mapa
              </Button>
              <Button size="sm" className="w-full gap-1" variant="outline" onClick={() => window.open(whatsappUrl, "_blank", "noopener,noreferrer")}>
                <MessageCircle className="size-3.5" />
                WhatsApp
              </Button>
              <Button size="sm" className="w-full gap-1" onClick={() => void shareLocation()}>
                <Share2 className="size-3.5" />
                Compartir
              </Button>
            </div>
          </div>
          <div className="overflow-hidden rounded-md border border-[#d8ded6]">
            <iframe
              title={`Mapa ${unit.code}`}
              src={mapEmbedUrl}
              className="h-44 w-full"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
          <p className="mt-2 text-xs text-[#66736c]">{locationMessage}</p>
        </div>
        {canManageUnit ? (
          <p className="text-xs text-[#66736c]">
            La edición de datos del departamento se realiza desde la sección <strong>Departamentos</strong>.
          </p>
        ) : null}
        <Separator />
        <div>
          <p className="mb-3 text-sm font-medium">Checklist de cierre</p>
          <div className="grid gap-2">
            {[
              ["fotos", "Fotos antes/despues"],
              ["limpieza", "Limpieza validada"],
              ["mantenimiento", "Mantenimiento sin bloqueos"],
              ["lista", "Unidad lista para check-in"],
            ].map(([key, item], index) => (
                <label
                  key={item}
                  htmlFor={`closure-check-${unit.id}-${index}`}
                  className="flex items-center gap-3 rounded-lg border border-[#d8ded6] bg-white p-3 text-sm"
                >
                  <input
                    id={`closure-check-${unit.id}-${index}`}
                    checked={Boolean(closureChecklist[key])}
                    onChange={(event) =>
                      setClosureChecklist((current) => ({
                        ...current,
                        [key]: event.target.checked,
                      }))
                    }
                    type="checkbox"
                    className="size-4 accent-[#26352f]"
                  />
                  {item}
                </label>
              ),
            )}
          </div>
          <Textarea
            value={closureNotes}
            onChange={(event) => setClosureNotes(event.target.value)}
            placeholder="Notas de cierre operativo"
            className="mt-3 min-h-20 resize-none"
          />
          <Button
            className="mt-3 w-full"
            onClick={() =>
              closeOperationalFlow({
                unitId: unit.id,
                ticketId: selectedTicketId || undefined,
                checklist: closureChecklist,
                evidenceRequired: closureChecklist.fotos,
                evidenceCount: evidence.length,
                notes: closureNotes,
              })
            }
          >
            Registrar cierre operativo
          </Button>
          <div className="mt-3 space-y-2">
            {closures.slice(0, 3).map((closure) => (
              <div key={closure.id} className="rounded-lg border border-[#d8ded6] bg-[#eef1ea] p-2 text-xs text-[#33423b]">
                Cierre {formatShortDate(closure.closedAt)} · evidencias {closure.evidenceCount}
              </div>
            ))}
          </div>
        </div>
        <Separator />
        <div className="grid gap-3">
          <p className="text-sm font-medium">Evidencia</p>
          <Textarea
            value={evidenceNote}
            onChange={(event) => setEvidenceNote(event.target.value)}
            placeholder="Nota breve: bano listo, aire revisado, faltan blancos..."
            className="min-h-20 resize-none"
          />
          <Select value={selectedTicketId} onValueChange={setSelectedTicketId}>
            <SelectTrigger className="h-11 w-full">
              <SelectValue placeholder="Asociar a ticket" />
            </SelectTrigger>
            <SelectContent>
              {tickets.map((ticket) => (
                <SelectItem key={ticket.id} value={ticket.id}>
                  {ticket.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#26352f] px-4 text-sm font-medium text-white hover:bg-[#31473e]">
            <Camera className="size-4" />
            Agregar foto
            <input
              accept="image/*"
              capture="environment"
              type="file"
              className="sr-only"
              onChange={(event) => handleEvidenceFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <p className="text-xs text-[#66736c]">{evidenceStatus}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {evidence.slice(0, 4).map((item) => (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="overflow-hidden rounded-lg border border-[#d8ded6] bg-white"
              >
                {item.kind === "photo" ? (
                  <div className="h-24 bg-cover bg-center" style={{ backgroundImage: `url("${item.url}")` }} />
                ) : (
                  <div className="flex h-24 items-center justify-center p-3 text-center text-xs text-[#66736c]">Link externo</div>
                )}
                <p className="truncate px-2 py-1 text-xs text-[#66736c]">{item.note ?? `${item.sizeKb ?? 0} KB`}</p>
              </a>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[#eef1ea] p-3">
      <p className="text-xs text-[#66736c]">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}

function ApartmentPhoto({ unit, className = "" }: { unit: Unit; className?: string }) {
  return (
    <div
      aria-label={`Foto fake ${unit.code}`}
      role="img"
      className={`w-full rounded-lg bg-cover bg-center ${className}`}
      style={{ backgroundImage: `url("${unit.imageUrl}")` }}
    />
  );
}

function toLocalInput(iso: string) {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function withImageUrl(form: FormData, imageUrl: string) {
  const nextForm = new FormData();
  form.forEach((value, key) => nextForm.append(key, value));
  nextForm.set("imageUrl", imageUrl);

  return nextForm;
}
