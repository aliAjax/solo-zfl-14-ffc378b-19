// 查询：组合筛选、排序；统计仪表盘
import {
  isOpenStatus,
  isOverdue,
  orderTotalCost,
  priorityRank,
  todayStr
} from "./model.js";

export const SORTS = {
  urgency: "紧急度优先",
  costDesc: "预计费用从高到低",
  costAsc: "预计费用从低到高",
  dueSoon: "计划完成日临近"
};

// criteria: { status, priority, propertyId, deviceId, overdueOnly, keyword, overdue }
export function filterOrders(orders, criteria = {}, today = todayStr()) {
  const keyword = String(criteria.keyword ?? "").trim().toLowerCase();
  return orders.filter((order) => {
    if (criteria.status && criteria.status !== "all" && order.status !== criteria.status) return false;
    if (criteria.priority && criteria.priority !== "all" && order.priority !== criteria.priority) return false;
    if (criteria.propertyId && criteria.propertyId !== "all" && order.propertyId !== criteria.propertyId) return false;
    if (criteria.deviceId && criteria.deviceId !== "all" && order.deviceId !== criteria.deviceId) return false;
    if (criteria.overdueOnly && !isOverdue(order, today)) return false;
    if (keyword) {
      const haystack = [
        order.title,
        order.description,
        order.deviceName,
        order.roomName,
        order.propertyName,
        ...(order.workLogs || []).map((log) => log.result)
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  });
}

export function sortOrders(orders, sort = "urgency", today = todayStr()) {
  const copy = [...orders];
  copy.sort((a, b) => {
    switch (sort) {
      case "costDesc":
        return Number(b.estimatedCost || 0) - Number(a.estimatedCost || 0) || urgencyTiebreak(a, b, today);
      case "costAsc":
        return Number(a.estimatedCost || 0) - Number(b.estimatedCost || 0) || urgencyTiebreak(a, b, today);
      case "dueSoon":
        return compareDueDate(a, b) || urgencyTiebreak(a, b, today);
      case "urgency":
      default:
        return urgencyTiebreak(a, b, today);
    }
  });
  return copy;
}

// 紧急度分数：越小越紧急。逾期占绝对优先；其次优先级；待验收/处理中加权；再看计划完成日临近度；终态沉底
export function urgencyScore(order, today = todayStr()) {
  if (!isOpenStatus(order.status)) return 1_000_000;
  let score = 0;
  if (isOverdue(order, today)) score -= 1000;
  score += priorityRank(order.priority) * 100;
  if (order.status === "accepting") score -= 20;
  if (order.status === "doing") score -= 10;
  if (order.dueDate) score += daysBetween(today, order.dueDate) * 2;
  return score;
}

function urgencyTiebreak(a, b, today) {
  // 分数越小越紧急 → 升序排列
  const diff = urgencyScore(a, today) - urgencyScore(b, today);
  if (diff !== 0) return diff;
  return compareDueDate(a, b);
}

function compareDueDate(a, b) {
  if (a.dueDate && b.dueDate) return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
  if (a.dueDate) return -1;
  if (b.dueDate) return 1;
  return 0;
}

function daysBetween(fromStr, toStr) {
  const from = new Date(`${fromStr}T00:00:00`);
  const to = new Date(`${toStr}T00:00:00`);
  return Math.round((to - from) / 86400000);
}

export function queryOrders(orders, criteria = {}, today = todayStr()) {
  return sortOrders(filterOrders(orders, criteria, today), criteria.sort, today);
}

// 统计
// monthlyBudget: 本月维修支出预算（实际费用合计），超出则提醒
export function computeStats(orders, { monthlyBudget = null, today = todayStr() } = {}) {
  const open = orders.filter((order) => isOpenStatus(order.status));
  const overdue = orders.filter((order) => isOverdue(order, today));
  const accepting = orders.filter((order) => order.status === "accepting");

  const [year, month] = today.split("-");
  const monthlySpent = orders.reduce((sum, order) => {
    const logs = (order.workLogs || []).filter((log) => {
      const date = String(log.date || "");
      return date.startsWith(`${year}-${month}`);
    });
    return sum + logs.reduce((sub, log) => sub + orderLogCost(log), 0);
  }, 0);

  const unfinishedEstimated = open.reduce((sum, order) => sum + (Number(order.estimatedCost) || 0), 0);

  const budget = monthlyBudget === null || monthlyBudget === "" || Number.isNaN(Number(monthlyBudget))
    ? null
    : Number(monthlyBudget);
  const overBudget = budget !== null && monthlySpent > budget;

  return {
    total: orders.length,
    unfinishedCount: open.length,
    overdueCount: overdue.length,
    acceptingCount: accepting.length,
    monthlySpent: round2(monthlySpent),
    unfinishedEstimated: round2(unfinishedEstimated),
    monthlyBudget: budget,
    overBudget,
    budgetRemaining: budget === null ? null : round2(budget - monthlySpent)
  };
}

export function orderLogCost(log) {
  const actual = Number(log.actualCost) || 0;
  const materials = (log.materials || []).reduce(
    (sum, item) => sum + (Number(item.cost) || 0) * (Number(item.quantity) || 0),
    0
  );
  return actual + materials;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

export { orderTotalCost };
