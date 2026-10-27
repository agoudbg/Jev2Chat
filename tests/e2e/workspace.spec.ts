import { readFile } from "node:fs/promises";
import { expect, test, type Page, type Route } from "@playwright/test";
import { choicePayloadSchema } from "../../src/server/handlers";
import { taskSchema, vocabularySchema } from "../../src/lib/domain";

async function open(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Jev2Chat", exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "已保存在此设备" })).toBeVisible();
}

async function configure(page: Page, mock = false) {
  await page.getByRole("button", { name: "模型连接", exact: true }).click();
  if (mock) {
    await page.getByLabel("Provider", { exact: true }).click();
    await page.getByRole("option", { name: "Mock · 仅开发测试" }).click();
  } else {
    await page.getByLabel("API Token", { exact: true }).fill("e2e-only-not-a-real-token");
  }
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "模型连接", exact: true })).toBeHidden();
}

async function answer(route: Route, key: string) {
  const payload = choicePayloadSchema.parse(route.request().postDataJSON());
  await route.fulfill({
    json: {
      model: "jev-e2e-boundary",
      answers: {
        next_content: {
          type: "choice",
          choice: key,
          confidence: 1,
          probabilities: Object.fromEntries(
            payload.input.candidates.map((item) => [item.key, item.key === key ? 1 : 0]),
          ),
        },
      },
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  });
  return payload;
}

async function exportTask(page: Page) {
  await page.getByRole("button", { name: "导出任务", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "导出完整任务 JSON", exact: true }).click();
  const download = await pending;
  const path = await download.path();
  if (!path) throw new Error("The browser did not save the task export.");
  return taskSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

test("loads an empty workspace, changes theme and remains usable on a narrow screen", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await expect(page.getByRole("button", { name: "开始生成", exact: true })).toBeDisabled();
  await expect(page.getByRole("switch", { name: "自动滚动" })).toBeInViewport();
  await page.getByRole("button", { name: "切换明暗主题" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "帮助与协议" }).click();
  await expect(page.getByRole("dialog")).toContainText("option key");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "生成配置", exact: true }).click();
  await expect(page.getByLabel("提示词", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Questions · 0", exact: true }).click();
  await expect(page.getByText("等待第一次选择", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("invalidates a successful connection test when Base URL or Token changes", async ({
  page,
}) => {
  await page.route("**/api/connection", (route) =>
    route.fulfill({ json: { models: [{ name: "jev-latest" }] } }),
  );
  await open(page);
  await page.getByRole("button", { name: "模型连接", exact: true }).click();
  await page.getByLabel("API Token", { exact: true }).fill("e2e-only-not-a-real-token");
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(page.getByText("测试有效", { exact: true })).toBeVisible();
  await page.getByLabel("API Base URL", { exact: true }).fill("https://another.example");
  await expect(page.getByText("尚未测试", { exact: true })).toBeVisible();
  await expect(page.getByText("测试有效", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(page.getByText("测试有效", { exact: true })).toBeVisible();
  await page.getByLabel("API Token", { exact: true }).fill("changed-e2e-token");
  await expect(page.getByText("尚未测试", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "保存设置" }).click();
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  expect(stored).toContain("another.example");
  expect(stored).not.toContain("changed-e2e-token");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "模型连接", exact: true }).click();
  await expect(page.getByLabel("API Token", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("API Base URL", { exact: true })).toHaveValue(
    "https://another.example",
  );
});

test("pauses, edits exact State, resumes with its new context, exports and restores after refresh", async ({
  page,
}) => {
  const requests: string[] = [];
  let first: Route | undefined;
  await page.route("**/api/choice", async (route) => {
    const payload = choicePayloadSchema.parse(route.request().postDataJSON());
    requests.push(payload.input.state);
    if (requests.length === 1) first = route;
    else await answer(route, "eos");
  });
  await open(page);
  await configure(page);
  await page.getByLabel("提示词", { exact: true }).fill("Write a greeting.");
  await page.getByRole("button", { name: "开始生成", exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  if (!first) throw new Error("The first Choice request was not intercepted.");
  await answer(first, "ascii_72");
  await expect(page.getByRole("button", { name: "继续生成", exact: true })).toBeVisible();
  await expect(page.getByLabel("State 正文", { exact: true })).toHaveValue("H");
  const exact = "edited \r\n\t\\ context ";
  await page.getByRole("tab", { name: "源码", exact: true }).click();
  await page.getByLabel("State JSON 字符串", { exact: true }).fill(JSON.stringify(exact));
  await expect(page.getByRole("button", { name: "继续生成", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "应用到 State", exact: true }).click();
  await page.getByRole("button", { name: "继续生成", exact: true }).click();
  await expect(page.getByText("生成结束", { exact: true })).toBeVisible();
  expect(requests).toEqual(["", exact]);
  const exported = await exportTask(page);
  expect(exported.state).toBe(exact);
  expect(exported.history).toHaveLength(2);
  expect(exported.history[1].optionKey).toBe("eos");
  expect(JSON.stringify(exported)).not.toContain("e2e-only-not-a-real-token");
  for (const format of ["导出 TXT", "导出 Markdown"]) {
    await page.getByRole("button", { name: "导出任务", exact: true }).click();
    const pending = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: format, exact: true }).click();
    const path = await (await pending).path();
    if (!path) throw new Error("Missing plain text export.");
    expect(await readFile(path, "utf8")).toBe(exact);
  }
  await expect(page.getByRole("status").filter({ hasText: "已保存在此设备" })).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("State 正文", { exact: true })).toHaveValue(
    exact.replace(/\r\n/g, "\n"),
  );
  expect((await exportTask(page)).state).toBe(exact);
});

test("stopping discards a delayed response and issues no further requests", async ({ page }) => {
  let calls = 0;
  let first: Route | undefined;
  await page.route("**/api/choice", (route) => {
    calls++;
    first = route;
  });
  await open(page);
  await configure(page);
  await page.getByLabel("提示词", { exact: true }).fill("Write.");
  await page.getByRole("button", { name: "开始生成", exact: true }).click();
  await expect.poll(() => calls).toBe(1);
  await page.getByRole("button", { name: "停止", exact: true }).click();
  if (!first) throw new Error("No pending request.");
  await answer(first, "ascii_97");
  const exported = await exportTask(page);
  expect(exported.status).toBe("stopped");
  expect(exported.state).toBe("");
  expect(exported.history[0].status).toBe("cancelled");
  expect(calls).toBe(1);
});

test("shows invalid model responses without appending their content", async ({ page }) => {
  await page.route("**/api/choice", (route) =>
    route.fulfill({ body: "{invalid", contentType: "application/json" }),
  );
  await open(page);
  await configure(page);
  await page.getByLabel("提示词", { exact: true }).fill("Write.");
  await page.getByRole("button", { name: "开始生成", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "State 工作区" }).getByText("请求失败", { exact: true }),
  ).toBeVisible();
  const exported = await exportTask(page);
  expect(exported.status).toBe("error");
  expect(exported.state).toBe("");
  expect(exported.requests).toBe(1);
});

test("saves, reloads, exports and imports a vocabulary with independent labels, values and keys", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "词表", exact: true }).click();
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await page.getByLabel("词表名称", { exact: true }).fill("Whitespace phrases");
  await page.getByRole("button", { name: "添加候选项", exact: true }).click();
  await page.getByLabel("显示标签", { exact: true }).fill("Greeting");
  await page.getByLabel("option key", { exact: true }).fill("greet_key");
  await page
    .getByLabel("实际值（JSON 字符串）", { exact: true })
    .fill(JSON.stringify("hello \t\n\\"));
  await page.getByRole("button", { name: "应用候选项", exact: true }).click();
  await page.getByRole("button", { name: "保存词表", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 JSON", exact: true }).click();
  const download = await pending;
  const path = await download.path();
  if (!path) throw new Error("Missing vocabulary export.");
  const json = await readFile(path, "utf8");
  const vocabulary = vocabularySchema.parse(JSON.parse(json));
  expect(vocabulary.candidates.find((item) => item.key === "greet_key")).toMatchObject({
    label: "Greeting",
    value: "hello \t\n\\",
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("status").filter({ hasText: "已保存在此设备" })).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "词表", exact: true }).click();
  await page.getByLabel("本地词表", { exact: true }).click();
  await page.getByRole("option", { name: "Whitespace phrases · v1", exact: true }).click();
  await expect(page.getByText("greet_key", { exact: true })).toBeVisible();
  await page.getByLabel("导入词表文件", { exact: true }).setInputFiles({
    name: "import.json",
    mimeType: "application/json",
    buffer: Buffer.from(json),
  });
  await page.getByRole("button", { name: "保存词表", exact: true }).click();
  await expect(page.getByText("greet_key", { exact: true })).toBeVisible();
});

test("the explicit development Mock runs through the HTTP route and is labeled", async ({
  page,
}) => {
  const configuration = await (await page.request.get("/api/config")).json();
  test.skip(configuration.mockEnabled !== true, "The production server disables development Mock.");
  await open(page);
  await configure(page, true);
  await expect(page.getByRole("alert").filter({ hasText: "MOCK · 开发测试" })).toBeVisible();
  await page.getByLabel("提示词", { exact: true }).fill("Only a development test.");
  await page.getByRole("button", { name: "开始生成", exact: true }).click();
  await expect(page.getByText("生成结束", { exact: true })).toBeVisible({ timeout: 30_000 });
  const exported = await exportTask(page);
  expect(exported.history).toHaveLength(9);
  expect(exported.history.every((round) => round.provider.includes("mock"))).toBe(true);
  expect(exported.state).toHaveLength(8);
});

test("protects unapplied source edits and keeps local tasks independent", async ({ page }) => {
  await open(page);
  await configure(page);
  await page.getByLabel("任务名称", { exact: true }).fill("First experiment");
  await page.getByLabel("提示词", { exact: true }).fill("Write.");
  await page.getByLabel("State 正文", { exact: true }).fill("saved state");
  await page.getByRole("tab", { name: "源码", exact: true }).click();
  await page
    .getByLabel("State JSON 字符串", { exact: true })
    .fill(JSON.stringify("unapplied state"));
  await expect(page.getByRole("button", { name: "开始生成", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "新建任务", exact: true })).toBeDisabled();
  await page.getByRole("tab", { name: "正文", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("还没有应用");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "应用到 State", exact: true }).click();
  await expect(page.getByRole("button", { name: "开始生成", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  expect((await exportTask(page)).state).toBe("");
  await page.getByRole("button", { name: "本地任务", exact: true }).click();
  await page.getByRole("menuitem", { name: "First experiment", exact: true }).click();
  expect((await exportTask(page)).state).toBe("unapplied state");
});
