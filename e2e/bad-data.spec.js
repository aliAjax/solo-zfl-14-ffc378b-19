import { expect, test } from "@playwright/test";
import { STORAGE_KEY, makeProfile, stateFromProfiles } from "./helpers.js";

async function setRawStorage(page, raw) {
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: STORAGE_KEY, value: raw }
  );
}

test("存储里是非法 JSON 时回退到空数据，应用不崩溃", async ({ page }) => {
  await setRawStorage(page, "{这不是合法JSON");
  await page.goto("/");

  await expect(page.getByTestId("stat-unfinished")).toHaveText("0");
  await expect(page.getByTestId("no-device-hint")).toBeVisible();
  await expect(page.getByTestId("order-card")).toHaveCount(0);
});

test("顶层结构损坏时回退到空数据", async ({ page }) => {
  await setRawStorage(page, JSON.stringify({ orders: "wat", properties: 42 }));
  await page.goto("/");

  await expect(page.getByTestId("stat-unfinished")).toHaveText("0");
  await expect(page.getByTestId("order-card")).toHaveCount(0);
  await expect(page.getByTestId("no-device-hint")).toBeVisible();
});

for (const raw of ["[]", '"hello"', "123", "null"]) {
  test(`存储是其他类型（${raw}）时回退到空数据`, async ({ page }) => {
    await setRawStorage(page, raw);
    await page.goto("/");
    await expect(page.getByTestId("stat-unfinished")).toHaveText("0");
    await expect(page.getByTestId("order-card")).toHaveCount(0);
  });
}

test("局部坏数据：合法工单保留，非法工单被剔除", async ({ page }) => {
  const profile = makeProfile({ propertyName: "滨江公寓", roomName: "厨房", deviceName: "燃气灶" });
  const state = stateFromProfiles([profile], [
    { id: "good", title: "打不着火", status: "pending", priority: "high", dueDate: "2026-09-20", estimatedCost: 120 },
    { id: "bad", title: "状态非法", status: "hacked", priority: "high", dueDate: "2026-09-20", estimatedCost: 50 }
  ]);
  await setRawStorage(page, JSON.stringify(state));
  await page.goto("/");

  await expect(page.getByTestId("order-card")).toHaveCount(1);
  await expect(page.getByTestId("order-card")).toContainText("打不着火");
  await expect(page.getByTestId("stat-unfinished")).toHaveText("1");
});

test("工单引用不存在的设备时被剔除，其他工单正常", async ({ page }) => {
  const profile = makeProfile();
  const state = stateFromProfiles([profile], [
    { id: "ok", title: "正常工单", status: "pending", priority: "medium", dueDate: "2026-09-20", estimatedCost: 10 }
  ]);
  state.orders.push({
    ...state.orders[0],
    id: "orphan",
    deviceId: "ghost-device",
    title: "孤儿工单"
  });
  await setRawStorage(page, JSON.stringify(state));
  await page.goto("/");

  await expect(page.getByTestId("order-card")).toHaveCount(1);
  await expect(page.getByTestId("order-card")).toContainText("正常工单");
});

test("坏数据回退后应用仍可正常建档和报修", async ({ page }) => {
  await setRawStorage(page, "%%corrupt%%");
  await page.goto("/");
  await expect(page.getByTestId("no-device-hint")).toBeVisible();

  await page.getByTestId("tab-profile").click();
  await page.getByTestId("property-name").fill("新家");
  await page.getByTestId("property-form").getByRole("button", { name: "添加房产" }).click();
  await expect(page.getByTestId("property-list")).toContainText("新家");

  await page.getByTestId("room-property").selectOption({ index: 1 });
  await page.getByTestId("room-name").fill("阳台");
  await page.getByTestId("room-form").getByRole("button", { name: "添加房间" }).click();
  await page.getByTestId("device-room").selectOption({ index: 1 });
  await page.getByTestId("device-name").fill("晾衣架");
  await page.getByTestId("device-form").getByRole("button", { name: "添加设备" }).click();

  await page.getByTestId("tab-orders").click();
  await page.getByTestId("order-device").selectOption({ index: 1 });
  await page.getByTestId("order-title").fill("手摇不动");
  await page.getByTestId("order-due").fill("2026-09-22");
  await page.getByTestId("order-cost").fill("60");
  await page.getByTestId("order-submit").click();
  await expect(page.getByTestId("order-card")).toHaveCount(1);
  await expect(page.getByTestId("order-card")).toContainText("手摇不动");
});
