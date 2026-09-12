import { expect, test } from "@playwright/test";
import { STORAGE_KEY, makeState } from "./helpers.js";

const TODAY = "2026-09-12T09:00:00.000Z";

function order({ id, code, device, room, property, title, status, priority, dueDate, estimatedCost, workLogs = [] }) {
  return {
    id,
    code,
    deviceId: device.id,
    deviceName: device.name,
    roomId: room.id,
    roomName: room.name,
    propertyId: property.id,
    propertyName: property.name,
    title,
    description: "",
    priority,
    dueDate,
    estimatedCost,
    status,
    token: "",
    rejectReason: "",
    history: [{ from: "pending", to: "pending", action: "create", at: TODAY, note: "工单创建" }],
    workLogs,
    createdAt: TODAY,
    updatedAt: TODAY
  };
}

function buildState() {
  const p1 = { id: "p1", name: "滨江公寓", address: "", createdAt: TODAY };
  const p2 = { id: "p2", name: "老房子", address: "", createdAt: TODAY };
  const r1 = { id: "r1", propertyId: "p1", name: "厨房", createdAt: TODAY };
  const r2 = { id: "r2", propertyId: "p1", name: "卫生间", createdAt: TODAY };
  const r3 = { id: "r3", propertyId: "p2", name: "客厅", createdAt: TODAY };
  const d1 = { id: "d1", roomId: "r1", name: "空调", brand: "", model: "", note: "", createdAt: TODAY };
  const d2 = { id: "d2", roomId: "r2", name: "热水器", brand: "", model: "", note: "", createdAt: TODAY };
  const d3 = { id: "d3", roomId: "r3", name: "门锁", brand: "", model: "", note: "", createdAt: TODAY };

  const state = makeState({
    properties: [p1, p2],
    rooms: [r1, r2, r3],
    devices: [d1, d2, d3],
    counters: { order: 5 },
    orders: [
      order({ id: "o1", code: "WO-20260912-0001", device: d1, room: r1, property: p1, title: "空调不制冷", status: "pending", priority: "high", dueDate: "2026-09-01", estimatedCost: 800 }),
      order({
        id: "o2", code: "WO-20260912-0002", device: d2, room: r2, property: p1, title: "热水器跳闸",
        status: "doing", priority: "urgent", dueDate: "2026-09-01", estimatedCost: 300,
        workLogs: [{ id: "w1", date: "2026-09-12", at: TODAY, actualCost: 260, result: "更换温控器", materials: [] }]
      }),
      order({ id: "o3", code: "WO-20260912-0003", device: d3, room: r3, property: p2, title: "门锁卡顿", status: "accepting", priority: "medium", dueDate: "2026-09-25", estimatedCost: 150 }),
      order({ id: "o4", code: "WO-20260912-0004", device: d3, room: r3, property: p2, title: "换锁芯", status: "accepted", priority: "low", dueDate: "2026-08-01", estimatedCost: 500 }),
      order({ id: "o5", code: "WO-20260912-0005", device: d1, room: r1, property: p1, title: "滤网清洗", status: "pending", priority: "low", dueDate: "2026-10-10", estimatedCost: 50 })
    ]
  });
  return state;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: STORAGE_KEY, value: JSON.stringify(buildState()) }
  );
  await page.goto("/");
});

async function cardTitles(page) {
  return page.getByTestId("order-card").locator("h3").allInnerTexts();
}

test("统计：未完成 4、逾期 2、待验收 1、本月支出 260、未完成预计费用 1300", async ({ page }) => {
  await expect(page.getByTestId("stat-unfinished")).toHaveText("4");
  await expect(page.getByTestId("stat-overdue")).toHaveText("2");
  await expect(page.getByTestId("stat-accepting")).toHaveText("1");
  await expect(page.getByTestId("stat-monthly")).toContainText("260");
  await expect(page.getByTestId("stat-estimated")).toContainText("1300");
});

test("逾期工单有逾期标记", async ({ page }) => {
  await expect(page.getByTestId("overdue-badge")).toHaveCount(2);
});

test("按状态筛选", async ({ page }) => {
  await page.getByTestId("filter-status").selectOption("pending");
  expect(await cardTitles(page)).toEqual(["空调不制冷", "滤网清洗"]);
});

test("按优先级筛选", async ({ page }) => {
  await page.getByTestId("filter-priority").selectOption("urgent");
  expect(await cardTitles(page)).toEqual(["热水器跳闸"]);
});

test("按房产筛选", async ({ page }) => {
  await page.getByTestId("filter-property").selectOption("p1");
  expect(await cardTitles(page)).toEqual(["热水器跳闸", "空调不制冷", "滤网清洗"]);
});

test("按设备筛选", async ({ page }) => {
  await page.getByTestId("filter-device").selectOption("d1");
  expect(await cardTitles(page)).toEqual(["空调不制冷", "滤网清洗"]);
});

test("只看逾期", async ({ page }) => {
  await page.getByTestId("filter-overdue").check();
  expect(await cardTitles(page)).toEqual(["热水器跳闸", "空调不制冷"]);
});

test("关键词搜索", async ({ page }) => {
  await page.getByTestId("filter-keyword").fill("门锁");
  expect(await cardTitles(page)).toEqual(["门锁卡顿", "换锁芯"]);
});

test("组合筛选：状态 + 房产", async ({ page }) => {
  await page.getByTestId("filter-status").selectOption("pending");
  await page.getByTestId("filter-property").selectOption("p1");
  expect(await cardTitles(page)).toEqual(["空调不制冷", "滤网清洗"]);
  await expect(page.getByTestId("list-count")).toContainText("2");
});

test("默认紧急度排序：逾期+紧急最前，终态沉底", async ({ page }) => {
  expect(await cardTitles(page)).toEqual(["热水器跳闸", "空调不制冷", "门锁卡顿", "滤网清洗", "换锁芯"]);
});

test("排序：按预计费用降序", async ({ page }) => {
  await page.getByTestId("filter-sort").selectOption("costDesc");
  expect(await cardTitles(page)).toEqual(["空调不制冷", "换锁芯", "热水器跳闸", "门锁卡顿", "滤网清洗"]);
});

test("重置筛选恢复全部", async ({ page }) => {
  await page.getByTestId("filter-status").selectOption("accepted");
  expect(await cardTitles(page)).toEqual(["换锁芯"]);
  await page.getByRole("button", { name: "重置" }).click();
  expect(await cardTitles(page)).toHaveLength(5);
});

test("超预算提醒：本月支出超过预算时顶部出现告警，调回预算内消失", async ({ page }) => {
  await page.getByTestId("tab-settings").click();
  await page.getByTestId("budget-input").fill("200");
  await page.getByTestId("budget-form").getByRole("button", { name: "保存预算" }).click();

  const alert = page.getByTestId("budget-alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("260.00");
  await expect(alert).toContainText("200.00");
  await expect(alert).toContainText("60.00");

  await page.getByTestId("budget-input").fill("300");
  await page.getByTestId("budget-form").getByRole("button", { name: "保存预算" }).click();
  await expect(page.getByTestId("budget-alert")).toHaveCount(0);
});
