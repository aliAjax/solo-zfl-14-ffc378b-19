import { expect, test } from "@playwright/test";
import { STORAGE_KEY, makeProfile, stateFromProfiles } from "./helpers.js";

async function seedOneOrder(page, orderOverrides = {}) {
  const profile = makeProfile({ propertyName: "滨江公寓", roomName: "卫生间", deviceName: "热水器" });
  const state = stateFromProfiles([profile], [
    {
      title: "热水器不出热水",
      priority: "urgent",
      dueDate: "2026-09-20",
      estimatedCost: 600,
      ...orderOverrides
    }
  ]);
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: STORAGE_KEY, value: JSON.stringify(state) }
  );
  await page.goto("/");
  await page.getByTestId("order-card").first().click();
  return profile;
}

test("完整流转：待确认→处理中→待验收→已验收", async ({ page }) => {
  await seedOneOrder(page);

  await expect(page.getByTestId("detail-status")).toHaveText("待确认");
  await page.getByTestId("btn-start").click();
  await expect(page.getByTestId("detail-status")).toHaveText("处理中");

  // 处理中记录实际费用、耗材和处理结果
  await page.getByTestId("log-cost").fill("200");
  await page.getByTestId("material-name").fill("镁棒");
  await page.locator('[name="materialQuantity"]').fill("1");
  await page.locator('[name="materialCost"]').fill("45.5");
  await page.getByRole("button", { name: "+ 添加耗材" }).click();
  const rows = page.locator("[data-material-row]");
  await rows.nth(1).locator('[name="materialName"]').fill("密封垫");
  await rows.nth(1).locator('[name="materialCost"]').fill("4.5");
  await page.getByTestId("log-result").fill("更换镁棒和密封垫，试机正常");
  await page.getByTestId("log-submit").click();

  await expect(page.getByTestId("worklog-list")).toContainText("镁棒×1");
  await expect(page.getByTestId("worklog-list")).toContainText("密封垫×1");
  await expect(page.getByTestId("actual-total")).toContainText("250.00"); // 200 + 45.5 + 4.5

  await page.getByTestId("btn-complete").click();
  await expect(page.getByTestId("detail-status")).toHaveText("待验收");

  await page.getByTestId("btn-accept").click();
  await expect(page.getByTestId("detail-status")).toHaveText("已验收");
  await expect(page.getByTestId("history")).toContainText("验收通过");
  // 终态没有任何操作按钮
  await expect(page.getByTestId("btn-start")).toHaveCount(0);
  await expect(page.getByTestId("btn-accept")).toHaveCount(0);
});

test("验收不通过必须填退回原因，退回后回到处理中并可再次提交验收", async ({ page }) => {
  await seedOneOrder(page);

  await page.getByTestId("btn-start").click();
  await page.getByTestId("btn-complete").click();
  await expect(page.getByTestId("detail-status")).toHaveText("待验收");

  // 展开退回表单但不填原因 => 提示，不流转
  await page.getByTestId("btn-reject").click();
  await page.getByTestId("reject-confirm").click();
  await expect(page.getByTestId("detail-status")).toHaveText("待验收");

  // 填写原因后确认退回
  await page.getByTestId("reject-note").fill("仍然出冷水");
  await page.getByTestId("reject-confirm").click();
  await expect(page.getByTestId("detail-status")).toHaveText("处理中");
  await expect(page.getByTestId("reject-reason")).toContainText("仍然出冷水");
  await expect(page.getByTestId("worklog-panel")).toBeVisible();

  // 重新维修后再次提交验收并通过
  await page.getByTestId("log-cost").fill("80");
  await page.getByTestId("log-result").fill("重新点火调试");
  await page.getByTestId("log-submit").click();
  await page.getByTestId("btn-complete").click();
  await page.getByTestId("btn-accept").click();
  await expect(page.getByTestId("detail-status")).toHaveText("已验收");
});

test("待确认工单可以取消，取消后不可再流转", async ({ page }) => {
  await seedOneOrder(page);

  await page.getByRole("button", { name: "取消工单" }).click();
  await expect(page.getByTestId("detail-status")).toHaveText("已取消");
  await expect(page.getByRole("button", { name: "开始处理" })).toHaveCount(0);
});

test("不能跳跃流转：待确认状态没有验收按钮", async ({ page }) => {
  await seedOneOrder(page);
  await expect(page.getByTestId("btn-accept")).toHaveCount(0);
  await expect(page.getByTestId("btn-reject")).toHaveCount(0);
});
