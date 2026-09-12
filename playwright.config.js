import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";

// 无 root 环境下，Chromium 依赖的系统库解包在仓库内 .playwright-libs/root
const localLibRoot = path.resolve(".playwright-libs/root");
if (existsSync(localLibRoot)) {
  const libDirs = [
    path.join(localLibRoot, "lib/aarch64-linux-gnu"),
    path.join(localLibRoot, "usr/lib/aarch64-linux-gnu")
  ].filter(existsSync);
  if (libDirs.length) {
    process.env.LD_LIBRARY_PATH = [process.env.LD_LIBRARY_PATH, ...libDirs].filter(Boolean).join(":");
  }
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5114",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5114",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: process.env
  }
});
