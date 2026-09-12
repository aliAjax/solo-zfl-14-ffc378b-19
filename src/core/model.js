// 领域模型：工单状态机、优先级、日期工具

export const STATUSES = {
  pending: "待确认",
  doing: "处理中",
  accepting: "待验收",
  accepted: "已验收",
  cancelled: "已取消"
};

export const STATUS_ORDER = ["pending", "doing", "accepting", "accepted", "cancelled"];

// 未完成（仍需跟进）的状态
export const OPEN_STATUSES = ["pending", "doing", "accepting"];
// 终态
export const FINISHED_STATUSES = ["accepted", "cancelled"];

// 允许的流转动作：from -> [{action,to,label}]
export const TRANSITIONS = {
  pending: [
    { action: "start", to: "doing", label: "开始处理" },
    { action: "cancel", to: "cancelled", label: "取消工单" }
  ],
  doing: [
    { action: "complete", to: "accepting", label: "完成维修，提交验收" },
    { action: "cancel", to: "cancelled", label: "取消工单" }
  ],
  accepting: [
    { action: "accept", to: "accepted", label: "验收通过" },
    { action: "reject", to: "doing", label: "验收不通过，退回处理" }
  ]
};

export const PRIORITIES = {
  urgent: "紧急",
  high: "高",
  medium: "中",
  low: "低"
};

export const PRIORITY_ORDER = ["urgent", "high", "medium", "low"];

// 紧急度排序权重：数字越小越紧急
export function priorityRank(priority) {
  const index = PRIORITY_ORDER.indexOf(priority);
  return index === -1 ? PRIORITY_ORDER.length : index;
}

export function canTransition(from, action) {
  return Boolean(TRANSITIONS[from]?.some((item) => item.action === action));
}

export function transitionTarget(from, action) {
  const step = TRANSITIONS[from]?.find((item) => item.action === action);
  return step ? step.to : null;
}

export function isOpenStatus(status) {
  return OPEN_STATUSES.includes(status);
}

// YYYY-MM-DD，按本地时区取日期
export function toDateStr(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayStr(now = new Date()) {
  return toDateStr(now);
}

// 仅做格式与日历有效性校验（YYYY-MM-DD）
export function isValidDateStr(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

// 未完成且计划完成日早于今天 => 逾期
export function isOverdue(order, today = todayStr()) {
  if (!order || !isOpenStatus(order.status)) return false;
  if (!order.dueDate || !isValidDateStr(order.dueDate)) return false;
  return order.dueDate < today;
}

// 工单实际费用 = 各条维修记录（实际费用 + 耗材）合计
export function orderTotalCost(order) {
  return (order.workLogs || []).reduce((sum, log) => {
    const actual = Number(log.actualCost) || 0;
    const materials = (log.materials || []).reduce(
      (sub, item) => sub + (Number(item.cost) || 0) * (Number(item.quantity) || 0),
      0
    );
    return sum + actual + materials;
  }, 0);
}

export function createId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
