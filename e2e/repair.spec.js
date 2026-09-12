import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

async function createFullProfile(page) {
  await page.getByTestId("tab-profile").click();

  await page.getByTestId("property-name").fill("测试公寓");
  await page.getByTestId("property-form").getByRole("button", { name: "添加房产" }).click();
  await expect(page.getByTestId("property-list")).toContainText("测试公寓");

  await page.getByTestId("room-property").selectOption({ index: 1 });
  await page.getByTestId("room-name").fill("厨房");
  await page.getByTestId("room-form").getByRole("button", { name: "添加房间" }).click();
  await expect(page.getByTestId("room-list")).toContainText("厨房");

  await page.getByTestId("device-room").selectOption({ index: 1 });
  await page.getByTestId("device-name").fill("抽油烟机");
  await page.getByTestId("device-form").getByRole("button", { name: "添加设备" }).click();
  await expect(page.getByTestId("device-list")).toContainText("抽油烟机");

  await page.getByTestId("tab-orders").click();
  await expect(page.getByTestId("order-form")).toBeVisible();
}

test("先建房产/房间/设备档案，再按设备报修，工单进入待确认", async ({ page }) => {
  await createFullProfile(page);

  await page.getByTestId("order-device").selectOption({ index: 1 });
  await page.getByTestId("order-title").fill("开机有异响");
  await page.getByTestId("order-priority").selectOption("high");
  await page.getByTestId("order-due").fill("2026-09-20");
  await page.getByTestId("order-cost").fill("250");
  await page.getByTestId("order-submit").click();

  await expect(page.getByTestId("order-card")).toHaveCount(1);
  await expect(page.getByTestId("order-card").locator(".status-pending")).toHaveText("待确认");
  await expect(page.getByTestId("order-card")).toContainText("开机有异响");
  await expect(page.getByTestId("order-card")).toContainText("测试公寓 / 厨房 / 抽油烟机");
  await expect(page.getByTestId("stat-unfinished")).toHaveText("1");
  await expect(page.getByTestId("stat-estimated")).toContainText("250");
});

test("异常输入给出字段级提示，且不产生工单", async ({ page }) => {
  await createFullProfile(page);

  // 不选设备、不填问题、费用非法、清空日期
  await page.getByTestId("order-title").fill("");
  await page.getByTestId("order-due").fill("");
  await page.getByTestId("order-cost").fill("abc");
  await page.getByTestId("order-submit").click();

  await expect(page.locator('[data-error="deviceId"]')).not.toHaveText("");
  await expect(page.locator('[data-error="title"]')).not.toHaveText("");
  await expect(page.locator('[data-error="dueDate"]')).not.toHaveText("");
  await expect(page.locator('[data-error="estimatedCost"]')).not.toHaveText("");
  await expect(page.getByTestId("order-card")).toHaveCount(0);

  // 修正后可以提交（同一表单）
  await page.getByTestId("order-device").selectOption({ index: 1 });
  await page.getByTestId("order-title").fill("灯不亮");
  await page.getByTestId("order-due").fill("2026-09-25");
  await page.getByTestId("order-cost").fill("30.5");
  await page.getByTestId("order-submit").click();
  await expect(page.getByTestId("order-card")).toHaveCount(1);
});

test("重复提交不会产生重复工单", async ({ page }) => {
  await createFullProfile(page);

  await page.getByTestId("order-device").selectOption({ index: 1 });
  await page.getByTestId("order-title").fill("漏水");
  await page.getByTestId("order-due").fill("2026-09-18");
  await page.getByTestId("order-cost").fill("100");

  // 同一表单实例同步触发两次 submit（模拟双击 / 重复触发）
  await page.$eval("#order-form", (form) => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

  await expect(page.getByTestId("order-card")).toHaveCount(1);
  await expect(page.getByTestId("stat-unfinished")).toHaveText("1");
});

test("刷新后数据还在", async ({ page }) => {
  await createFullProfile(page);

  await page.getByTestId("order-device").selectOption({ index: 1 });
  await page.getByTestId("order-title").fill("需要清洗");
  await page.getByTestId("order-due").fill("2026-09-30");
  await page.getByTestId("order-cost").fill("80");
  await page.getByTestId("order-submit").click();
  await expect(page.getByTestId("order-card")).toHaveCount(1);

  await page.reload();

  await expect(page.getByTestId("order-card")).toHaveCount(1);
  await expect(page.getByTestId("order-card")).toContainText("需要清洗");
  await expect(page.getByTestId("order-card")).toContainText("测试公寓 / 厨房 / 抽油烟机");
  await expect(page.getByTestId("stat-unfinished")).toHaveText("1");
  await page.getByTestId("tab-profile").click();
  await expect(page.getByTestId("property-list")).toContainText("测试公寓");
  await expect(page.getByTestId("device-list")).toContainText("抽油烟机");
});

test("没有设备档案时引导先建档案", async ({ page }) => {
  await expect(page.getByTestId("no-device-hint")).toBeVisible();
  await page.getByRole("button", { name: "去建档案" }).click();
  await expect(page.getByTestId("property-form")).toBeVisible();
});
