import { describe, expect, it } from "vitest";
import { computeStats, filterOrders, queryOrders, sortOrders } from "../src/core/stats.js";

const base = {
  title: "x",
  deviceName: "空调",
  roomName: "主卧",
  propertyName: "滨江公寓",
  description: "",
  workLogs: []
};

const orders = [
  { id: "1", ...base, status: "pending", priority: "low", propertyId: "p1", propertyName: "滨江公寓", deviceId: "d1", dueDate: "2026-10-01", estimatedCost: 100 },
  { id: "2", ...base, status: "doing", priority: "urgent", propertyId: "p1", propertyName: "滨江公寓", deviceId: "d2", dueDate: "2026-09-01", estimatedCost: 800, title: "水管爆裂漏水" },
  { id: "3", ...base, status: "accepting", priority: "medium", propertyId: "p2", propertyName: "老房子", deviceId: "d3", dueDate: "2026-09-20", estimatedCost: 300 },
  { id: "4", ...base, status: "accepted", priority: "high", propertyId: "p2", propertyName: "老房子", deviceId: "d4", dueDate: "2026-08-01", estimatedCost: 500,
    workLogs: [{ actualCost: 450, date: "2026-09-03", materials: [{ name: "零件", quantity: 1, cost: 50 }] }] },
  { id: "5", ...base, status: "cancelled", priority: "low", propertyId: "p1", propertyName: "滨江公寓", deviceId: "d5", dueDate: "2026-08-10", estimatedCost: 200 },
  { id: "6", ...base, status: "pending", priority: "high", propertyId: "p2", propertyName: "老房子", deviceId: "d6", dueDate: "2026-09-13", estimatedCost: 1200, title: "门锁损坏" }
];

describe("组合筛选", () => {
  const today = "2026-09-12";

  it("按状态筛选", () => {
    expect(filterOrders(orders, { status: "pending" }, today).map((o) => o.id)).toEqual(["1", "6"]);
    expect(filterOrders(orders, { status: "doing" }, today).map((o) => o.id)).toEqual(["2"]);
  });

  it("按优先级筛选", () => {
    expect(filterOrders(orders, { priority: "urgent" }, today).map((o) => o.id)).toEqual(["2"]);
  });

  it("按房产筛选", () => {
    expect(filterOrders(orders, { propertyId: "p2" }, today).map((o) => o.id)).toEqual(["3", "4", "6"]);
  });

  it("按设备筛选", () => {
    expect(filterOrders(orders, { deviceId: "d3" }, today).map((o) => o.id)).toEqual(["3"]);
  });

  it("只看逾期", () => {
    expect(filterOrders(orders, { overdueOnly: true }, today).map((o) => o.id)).toEqual(["2"]);
  });

  it("关键词匹配标题/设备/房间/房产/处理结果", () => {
    expect(filterOrders(orders, { keyword: "漏水" }, today).map((o) => o.id)).toEqual(["2"]);
    expect(filterOrders(orders, { keyword: "空调" }, today).map((o) => o.id).sort()).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(filterOrders(orders, { keyword: "滨江" }, today).map((o) => o.id)).toEqual(["1", "2", "5"]);
    expect(filterOrders(orders, { keyword: "  漏水  " }, today)).toHaveLength(1);
    expect(filterOrders(orders, { keyword: "不存在的词xyz" }, today)).toHaveLength(0);
  });

  it("组合条件叠加（状态+优先级+房产+逾期）", () => {
    expect(
      filterOrders(orders, { status: "doing", priority: "urgent", propertyId: "p1", overdueOnly: true }, today).map((o) => o.id)
    ).toEqual(["2"]);
    expect(
      filterOrders(orders, { status: "pending", priority: "urgent" }, today)
    ).toHaveLength(0);
  });
});

describe("排序", () => {
  const today = "2026-09-12";

  it("紧急度排序：逾期+高优先级在最前，高优先级临近到期次之", () => {
    const ids = sortOrders(orders, "urgency", today).map((o) => o.id);
    expect(ids[0]).toBe("2"); // 逾期且紧急
    expect(ids[1]).toBe("6"); // 高优先级、明天到期
    // 终态沉底
    expect(ids.slice(-2).sort()).toEqual(["4", "5"]);
  });

  it("按预计费用降序/升序", () => {
    expect(sortOrders(orders, "costDesc", today).map((o) => o.id)[0]).toBe("6");
    expect(sortOrders(orders, "costAsc", today).map((o) => o.id)[0]).toBe("1");
  });

  it("queryOrders 组合筛选+排序", () => {
    const result = queryOrders(orders, { status: "pending", sort: "costDesc" }, today);
    expect(result.map((o) => o.id)).toEqual(["6", "1"]);
  });
});

describe("统计", () => {
  const today = "2026-09-12";

  it("未完成、逾期、待验收数量", () => {
    const stats = computeStats(orders, { today });
    expect(stats.unfinishedCount).toBe(4); // 1,2,3,6
    expect(stats.overdueCount).toBe(1); // 2
    expect(stats.acceptingCount).toBe(1); // 3
  });

  it("本月支出按当月维修记录合计（实际费用+耗材）", () => {
    const stats = computeStats(orders, { today });
    expect(stats.monthlySpent).toBe(500); // 450+50
  });

  it("未完成预计费用", () => {
    const stats = computeStats(orders, { today });
    expect(stats.unfinishedEstimated).toBe(2400); // 100+800+300+1200
  });

  it("超预算提醒", () => {
    const over = computeStats(orders, { today, monthlyBudget: 400 });
    expect(over.overBudget).toBe(true);
    expect(over.budgetRemaining).toBe(-100);

    const within = computeStats(orders, { today, monthlyBudget: 1000 });
    expect(within.overBudget).toBe(false);
    expect(within.budgetRemaining).toBe(500);

    const noBudget = computeStats(orders, { today });
    expect(noBudget.overBudget).toBe(false);
    expect(noBudget.budgetRemaining).toBeNull();
  });

  it("跨月维修记录不计入本月", () => {
    const crossMonth = [
      { ...base, id: "x", status: "accepted", estimatedCost: 0,
        workLogs: [{ actualCost: 999, date: "2026-08-15", materials: [] }] }
    ];
    expect(computeStats(crossMonth, { today }).monthlySpent).toBe(0);
  });
});
