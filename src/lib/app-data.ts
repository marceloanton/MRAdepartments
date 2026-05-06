import type {
  AgentActionLogItem,
  EvidenceItem,
  NotificationItem,
  OperationalClosure,
  Reservation,
  Task,
  Ticket,
  Unit,
  User,
} from "./domain";

export type AppData = {
  units: Unit[];
  tickets: Ticket[];
  tasks: Task[];
  reservations: Reservation[];
  notifications: NotificationItem[];
  evidence: EvidenceItem[];
  closures: OperationalClosure[];
  agentLogs: AgentActionLogItem[];
  users: User[];
  source: "database" | "mock";
};
