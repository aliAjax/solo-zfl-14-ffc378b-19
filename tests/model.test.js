import { describe, expect, it } from "vitest";
import {
  TRANSITIONS,
  canTransition,
  isOverdue,
  isValidDateStr,
  orderTotalCost,
  priorityRank,
  toDateStr,
  transitionTarget
} from "../src/core/model.js";

describe("状态机", () => {
  it("允许的流转路径", () => {
    expect(canTransition("pending", "start")).toBe(true);
    expect(canTransition("pending", "cancel")).toBe(true);
    expect(canTransition("doing", "complete")).toBe(true);
    expect(canTransition("accepting", "accept")).toBe(true);
    expect(canTransition("accepting", "reject")).toBe(true);
  });

  it("禁止非法流转：待确认不能直接验收", () => {
    expect(canTransition("pending", "accept")).toBe(false);
    expect(canTransition("accepted", "start")).toBe(false);
    expect(canTransition("cancelled", "start")).toBe(false);
  });

  it("验收不通过退回处理中", () => {
    expect(transitionTarget("accepting", "reject")).toBe("doing");
  });

  it("处理中可以提交验收，已验收为终态无后续动作", () => {
    expect(transitionTarget("doing", "complete")).toBe("accepting");
    expect(TRANSITIONS.accepted).toBeUndefined();
    expect(TRANSITIONS.cancelled).toBeUndefined();
  });
});

describe("优先级与日期", () => {
  it("紧急度排序：urgent < high < medium < low", () => {
    expect(priorityRank("urgent")).toBe(0);
    expect(priorityRank("high")).toBe(1);
    expect(priorityRank("medium")).toBe(2);
    expect(priorityRank("low")).toBe(3);
    expect(priorityRank("unknown")).toBe(4);
  });

  it("校验日期格式与日历有效性", () => {
    expect(isValidDateStr("2026-09-12")).toBe(true);
    expect(isValidDateStr("2026-02-29")).toBe(false); // 2026 平年
    expect(isValidDateStr("2024-02-29")).toBe(true); // 2024 闰年
    expect(isValidDateStr("2026-13-01")).toBe(false);
    expect(isValidDateStr("2026/09/12")).toBe(false);
    expect(isValidDateStr("")).toBe(false);
  });

  it("toDateStr 按本地日期输出 YYYY-MM-DD", () => {
    expect(toDateStr(new Date(2026, 8, 12))).toBe("2026-09-12");
    expect(toDateStr("not a date")).toBe("");
  });

  it("逾期：仅未完成状态且计划日早于今天", () => {
    const order = (overrides) => ({ status: "pending", dueDate: "2026-09-10", ...overrides });
    expect(isOverdue(order(), "2026-09-12")).toBe(true);
    expect(isOverdue(order({ dueDate: "2026-09-12" }), "2026-09-12")).toBe(false);
    expect(isOverdue(order({ dueDate: "2026-09-20" }), "2026-09-12")).toBe(false);
    expect(isOverdue(order({ status: "accepted", dueDate: "2026-09-10" }), "2026-09-12")).toBe(false);
    expect(isOverdue(order({ status: "cancelled", dueDate: "2026-09-10" }), "2026-09-12")).toBe(false);
    expect(isOverdue(order({ dueDate: "" }), "2026-09-12")).toBe(false);
  });
});

describe("工单费用", () => {
  it("实际费用 = 实际人工 + 耗材单价*数量 累计", () => {
    const order = {
      workLogs: [
        { actualCost: 100, materials: [{ name: "软管", quantity: 2, cost: 30 }] },
        { actualCost: 50.5, materials: [{ name: "胶带", quantity: 1, cost: 9.9 }] }
      ]
    };
    // 100+60 + 50.5+9.9 = 220.4
    expect(orderTotalCost(order)).toBeCloseTo(220.4, 2);
  });

  it("无维修记录时实际费用为 0", () => {
    expect(orderTotalCost({ workLogs: [] })).toBe(0);
    expect(orderTotalCost({})).toBe(0);
  });
});
