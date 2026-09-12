import { beforeEach, describe, expect, it } from "vitest";
import { RepairStore, STORAGE_KEY, emptyState, parseState } from "../src/core/store.js";

class MemoryStorage {
  constructor(initial = {}) {
    this.map = new Map(Object.entries(initial));
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(key, String(value));
  }
  removeItem(key) {
    this.map.delete(key);
  }
}

const FIXED_NOW = new Date("2026-09-12T10:00:00");

function makeStore(storage = new MemoryStorage()) {
  return new RepairStore(storage, { now: () => new Date(FIXED_NOW) });
}

// 建立 房产->房间->设备，返回 id
function seedProfile(store) {
  const property = store.addProperty({ name: "滨江公寓", address: "江南大道 1 号" }).property;
  const room = store.addRoom({ propertyId: property.id, name: "主卧" }).room;
  const device = store.addDevice({ roomId: room.id, name: "空调", brand: "美的", model: "KFR-35" }).device;
  return { property, room, device };
}

describe("parseState 坏数据回退", () => {
  it("空值回退到空数据", () => {
    expect(parseState(null).orders).toEqual([]);
    expect(parseState("").properties).toEqual([]);
  });

  it("非法 JSON 回退到空数据", () => {
    expect(parseState("{not json").orders).toEqual([]);
    expect(parseState("undefined").devices).toEqual([]);
  });

  it("结构错误回退到空数据", () => {
    expect(parseState("[]").orders).toEqual([]);
    expect(parseState('"str"').rooms).toEqual([]);
    expect(parseState("123").properties).toEqual([]);
    expect(parseState(JSON.stringify({ foo: 1 })).orders).toEqual([]);
  });

  it("引用了不存在房产的房间与挂在其下的设备被剔除", () => {
    const { device } = seedProfile(makeStore());
    const good = {
      ...emptyState(),
      devices: [device],
      rooms: [{ id: "r1", propertyId: "ghost-property", name: "厨房" }],
      properties: [{ id: "p1", name: "家" }]
    };
    const state = parseState(JSON.stringify(good));
    expect(state.properties).toHaveLength(1);
    expect(state.rooms).toHaveLength(0);
    expect(state.devices).toHaveLength(0);
  });

  it("工单字段非法（错误状态/优先级/日期/不存在的设备）被剔除", () => {
    const store = makeStore();
    const { device } = seedProfile(store);
    const raw = {
      ...emptyState(),
      properties: store.state.properties,
      rooms: store.state.rooms,
      devices: store.state.devices,
      orders: [
        { id: "ok", deviceId: device.id, title: "正常", status: "pending", priority: "high", dueDate: "2026-09-20", estimatedCost: 10 },
        { id: "bad-status", deviceId: device.id, title: "x", status: "wat", priority: "high", dueDate: "2026-09-20" },
        { id: "bad-priority", deviceId: device.id, title: "x", status: "pending", priority: "wat", dueDate: "2026-09-20" },
        { id: "bad-date", deviceId: device.id, title: "x", status: "pending", priority: "high", dueDate: "2026-13-40" },
        { id: "bad-device", deviceId: "ghost", title: "x", status: "pending", priority: "high", dueDate: "2026-09-20" },
        { id: "bad-money", deviceId: device.id, title: "x", status: "pending", priority: "high", dueDate: "2026-09-20", estimatedCost: -50 }
      ]
    };
    const state = parseState(JSON.stringify(raw));
    expect(state.orders.map((o) => o.id)).toEqual(["ok", "bad-money"]);
    expect(state.orders[0].estimatedCost).toBe(10);
    // 负金额被钳为 0，而不是丢弃整条工单
    expect(state.orders[1].estimatedCost).toBe(0);
  });
});

describe("持久化：刷新后数据还在", () => {
  it("保存后用新 store 实例读取，数据一致", () => {
    const storage = new MemoryStorage();
    const store1 = makeStore(storage);
    const { device } = seedProfile(store1);
    store1.createOrder(
      { deviceId: device.id, title: "不制冷", priority: "urgent", dueDate: "2026-09-15", estimatedCost: "300" },
      "token-1"
    );

    const store2 = new RepairStore(storage, { now: () => new Date(FIXED_NOW) });
    expect(store2.state.properties).toHaveLength(1);
    expect(store2.state.devices).toHaveLength(1);
    expect(store2.state.orders).toHaveLength(1);
    expect(store2.state.orders[0].title).toBe("不制冷");
    expect(store2.state.orders[0].estimatedCost).toBe(300);
  });
});

describe("报修校验", () => {
  let store;
  let device;
  beforeEach(() => {
    store = makeStore();
    device = seedProfile(store).device;
  });

  const validInput = () => ({
    deviceId: device.id,
    title: "空调不制冷",
    priority: "high",
    dueDate: "2026-09-20",
    estimatedCost: "300",
    description: "出风口只有风"
  });

  it("正常报修成功，初始状态为待确认，生成工单号", () => {
    const result = store.createOrder(validInput(), "t1");
    expect(result.ok).toBe(true);
    expect(result.duplicated).toBe(false);
    expect(result.order.status).toBe("pending");
    expect(result.order.code).toMatch(/^WO-20260912-\d{4}$/);
    expect(result.order.estimatedCost).toBe(300);
    expect(result.order.history[0].action).toBe("create");
  });

  it("设备/问题/计划完成日缺失给出错误", () => {
    const result = store.createOrder({ ...validInput(), deviceId: "", title: "  ", dueDate: "" }, "t2");
    expect(result.ok).toBe(false);
    expect(result.errors.deviceId).toBeTruthy();
    expect(result.errors.title).toBeTruthy();
    expect(result.errors.dueDate).toBeTruthy();
  });

  it("非法金额与日期给出错误且不落单", () => {
    const result = store.createOrder({ ...validInput(), estimatedCost: "abc", dueDate: "2026-02-30" }, "t3");
    expect(result.ok).toBe(false);
    expect(result.errors.estimatedCost).toBeTruthy();
    expect(result.errors.dueDate).toBeTruthy();
    expect(store.state.orders).toHaveLength(0);
  });

  it("引用不存在的设备拒绝", () => {
    const result = store.createOrder({ ...validInput(), deviceId: "ghost" }, "t4");
    expect(result.ok).toBe(false);
    expect(result.errors.deviceId).toBeTruthy();
  });
});

describe("防重复提交", () => {
  let store;
  let device;
  beforeEach(() => {
    store = makeStore();
    device = seedProfile(store).device;
  });

  const input = () => ({
    deviceId: device.id,
    title: "漏水",
    priority: "high",
    dueDate: "2026-09-15",
    estimatedCost: "200"
  });

  it("同一 token 连续提交只产生一张工单", () => {
    const first = store.createOrder(input(), "same-token");
    const second = store.createOrder(input(), "same-token");
    const third = store.createOrder(input(), "same-token");
    expect(first.duplicated).toBe(false);
    expect(second.duplicated).toBe(true);
    expect(third.duplicated).toBe(true);
    expect(second.order.id).toBe(first.order.id);
    expect(store.state.orders).toHaveLength(1);
  });

  it("不同 token 分别创建工单", () => {
    store.createOrder(input(), "token-a");
    store.createOrder(input(), "token-b");
    expect(store.state.orders).toHaveLength(2);
  });

  it("校验失败不占用 token，修正后可用同一 token 提交成功", () => {
    const failed = store.createOrder({ ...input(), title: "" }, "retry-token");
    expect(failed.ok).toBe(false);
    const retry = store.createOrder(input(), "retry-token");
    expect(retry.ok).toBe(true);
    expect(retry.duplicated).toBe(false);
    expect(store.state.orders).toHaveLength(1);
  });

  it("重复 token 刷新后仍然有效（持久化）", () => {
    const storage = new MemoryStorage();
    const s1 = makeStore(storage);
    const d = seedProfile(s1).device;
    s1.createOrder({ deviceId: d.id, title: "x", priority: "low", dueDate: "2026-09-20", estimatedCost: "1" }, "persist-token");
    const s2 = new RepairStore(storage, { now: () => new Date(FIXED_NOW) });
    const again = s2.createOrder(
      { deviceId: d.id, title: "x", priority: "low", dueDate: "2026-09-20", estimatedCost: "1" },
      "persist-token"
    );
    expect(again.duplicated).toBe(true);
    expect(s2.state.orders).toHaveLength(1);
  });
});

describe("工单流转", () => {
  let store;
  let orderId;
  beforeEach(() => {
    store = makeStore();
    const { device } = seedProfile(store);
    orderId = store.createOrder(
      { deviceId: device.id, title: "漏水", priority: "urgent", dueDate: "2026-09-15", estimatedCost: "500" },
      "t"
    ).order.id;
  });

  it("完整流程：待确认→处理中→待验收→已验收", () => {
    expect(store.transition(orderId, "start").order.status).toBe("doing");
    expect(store.transition(orderId, "complete").order.status).toBe("accepting");
    expect(store.transition(orderId, "accept").order.status).toBe("accepted");
    const order = store.getOrder(orderId);
    expect(order.history.map((h) => h.action)).toEqual(["create", "start", "complete", "accept"]);
  });

  it("验收不通过退回处理中，并记录退回原因", () => {
    store.transition(orderId, "start");
    store.transition(orderId, "complete");
    const result = store.transition(orderId, "reject", { note: "仍然漏水" });
    expect(result.order.status).toBe("doing");
    expect(result.order.rejectReason).toBe("仍然漏水");
    // 退回后可重新提交验收并通过
    store.transition(orderId, "complete");
    expect(store.transition(orderId, "accept").order.status).toBe("accepted");
  });

  it("取消流程：待确认/处理中可取消，终态不可再操作", () => {
    expect(store.transition(orderId, "cancel").order.status).toBe("cancelled");
    const illegal = store.transition(orderId, "start");
    expect(illegal.ok).toBe(false);
  });

  it("跳跃流转被拒绝（待确认不能直接验收）", () => {
    expect(store.transition(orderId, "accept").ok).toBe(false);
    expect(store.getOrder(orderId).status).toBe("pending");
  });

  it("不存在的工单返回错误", () => {
    expect(store.transition("nope", "start").ok).toBe(false);
  });
});

describe("维修记录", () => {
  let store;
  let orderId;
  beforeEach(() => {
    store = makeStore();
    const { device } = seedProfile(store);
    orderId = store.createOrder(
      { deviceId: device.id, title: "水管", priority: "high", dueDate: "2026-09-15", estimatedCost: "800" },
      "t"
    ).order.id;
  });

  it("仅处理中可记录实际费用、耗材和处理结果", () => {
    expect(store.addWorkLog(orderId, { actualCost: "100", result: "先观察" }).ok).toBe(false);
    store.transition(orderId, "start");
    const result = store.addWorkLog(orderId, {
      actualCost: "300",
      result: "更换软管",
      materials: [{ name: "软管", quantity: "2", cost: "45.5" }]
    });
    expect(result.ok).toBe(true);
    expect(result.totalCost).toBeCloseTo(391, 2); // 300 + 2*45.5
  });

  it("多条维修记录累计费用，坏耗材行报错", () => {
    store.transition(orderId, "start");
    expect(store.addWorkLog(orderId, { actualCost: "100", materials: [] }).ok).toBe(true);
    const bad = store.addWorkLog(orderId, {
      actualCost: "x",
      materials: [{ name: "  ", quantity: "1", cost: "10" }]
    });
    expect(bad.ok).toBe(false);
    expect(bad.errors.actualCost).toBeTruthy();
    expect(bad.errors.materialName).toBeTruthy();
    expect(store.getOrder(orderId).workLogs).toHaveLength(1);
  });
});

describe("预算设置", () => {
  it("保存合法预算，拒绝负数", () => {
    const store = makeStore();
    expect(store.setMonthlyBudget("1000").ok).toBe(true);
    expect(store.state.settings.monthlyBudget).toBe(1000);
    expect(store.setMonthlyBudget(-1).ok).toBe(false);
    expect(store.setMonthlyBudget("").ok).toBe(true);
    expect(store.state.settings.monthlyBudget).toBeNull();
  });
});

describe("存储键与版本", () => {
  it("使用 v2 键，避免旧版数据污染", () => {
    expect(STORAGE_KEY).toBe("zfl-14-home-repair:v2");
    expect(emptyState().version).toBe(2);
  });
});
