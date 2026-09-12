import "./styles.css";
import { RepairStore } from "./core/store.js";
import {
  PRIORITIES,
  PRIORITY_ORDER,
  STATUSES,
  STATUS_ORDER,
  TRANSITIONS,
  isOverdue,
  orderTotalCost,
  todayStr
} from "./core/model.js";
import { computeStats, queryOrders } from "./core/stats.js";

const app = document.querySelector("#app");

const store = new RepairStore(
  typeof localStorage !== "undefined"
    ? localStorage
    : { getItem: () => null, setItem: () => {}, removeItem: () => {} }
);

// 视图状态（不持久化）
const view = {
  tab: "orders",
  filters: {
    status: "all",
    priority: "all",
    propertyId: "all",
    deviceId: "all",
    overdueOnly: false,
    keyword: "",
    sort: "urgency"
  },
  selectedOrderId: null,
  // 报修表单防重复提交令牌；成功创建后轮换
  orderFormToken: newToken(),
  submitting: false
};

function newToken() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `t-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function h(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function moneyFmt(value) {
  return `¥${(Number(value) || 0).toFixed(2)}`;
}

let toastTimer = null;
function toast(message, type = "info") {
  let el = document.querySelector("#toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.dataset.type = type;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

// ---------------- 渲染入口 ----------------
function render() {
  const stats = computeStats(store.state.orders, {
    monthlyBudget: store.state.settings.monthlyBudget
  });
  app.innerHTML = `
    <main class="shell">
      <header class="header">
        <div>
          <p class="eyebrow">家庭维修协同台</p>
          <h1>家庭维修工单</h1>
        </div>
        <nav class="tabs" aria-label="主导航">
          <button class="tab ${view.tab === "orders" ? "active" : ""}" data-tab="orders" data-testid="tab-orders">工单</button>
          <button class="tab ${view.tab === "profile" ? "active" : ""}" data-tab="profile" data-testid="tab-profile">档案</button>
          <button class="tab ${view.tab === "settings" ? "active" : ""}" data-tab="settings" data-testid="tab-settings">设置</button>
        </nav>
      </header>
      ${renderBudgetBanner(stats)}
      ${view.tab === "orders" ? renderOrdersView(stats) : ""}
      ${view.tab === "profile" ? renderProfileView() : ""}
      ${view.tab === "settings" ? renderSettingsView() : ""}
    </main>
  `;
  bindEvents();
}

function renderBudgetBanner(stats) {
  if (!stats.overBudget) return "";
  return `
    <div class="banner danger" data-testid="budget-alert" role="alert">
      ⚠️ 本月支出 ${moneyFmt(stats.monthlySpent)} 已超过预算 ${moneyFmt(stats.monthlyBudget)}（超出 ${moneyFmt(-stats.budgetRemaining)}）
    </div>
  `;
}

// ---------------- 工单视图 ----------------
function renderOrdersView(stats) {
  const hasDevices = store.state.devices.length > 0;
  const selected = view.selectedOrderId ? store.getOrder(view.selectedOrderId) : null;
  return `
    <section class="stats" data-testid="stats-bar">
      <div class="stat"><span>未完成</span><strong data-testid="stat-unfinished">${stats.unfinishedCount}</strong></div>
      <div class="stat warn"><span>逾期</span><strong data-testid="stat-overdue">${stats.overdueCount}</strong></div>
      <div class="stat"><span>待验收</span><strong data-testid="stat-accepting">${stats.acceptingCount}</strong></div>
      <div class="stat"><span>本月支出</span><strong data-testid="stat-monthly">${moneyFmt(stats.monthlySpent)}</strong></div>
      <div class="stat"><span>未完成预计费用</span><strong data-testid="stat-estimated">${moneyFmt(stats.unfinishedEstimated)}</strong></div>
      ${stats.monthlyBudget !== null ? `<div class="stat ${stats.overBudget ? "danger" : ""}"><span>预算余额</span><strong>${moneyFmt(stats.budgetRemaining)}</strong></div>` : ""}
    </section>

    <section class="layout">
      <aside class="panel">
        <h2>按设备报修</h2>
        ${hasDevices ? renderOrderForm() : renderNoDeviceHint()}
      </aside>

      <section class="panel">
        ${selected ? renderOrderDetail(selected) : renderOrderList()}
      </section>
    </section>
  `;
}

function renderNoDeviceHint() {
  return `
    <div class="empty" data-testid="no-device-hint">
      <p>还没有设备档案，先到「档案」页建立房产、房间和设备后再报修。</p>
      <button class="ghost" data-go-profile type="button">去建档案</button>
    </div>
  `;
}

function renderOrderForm() {
  return `
    <form class="form" id="order-form" data-testid="order-form" novalidate>
      <label>设备
        <select name="deviceId" data-testid="order-device" required>
          <option value="">请选择设备…</option>
          ${renderDeviceGroupOptions()}
        </select>
        <small class="error" data-error="deviceId"></small>
      </label>
      <label>问题描述
        <input name="title" maxlength="200" data-testid="order-title" placeholder="例如：空调不制冷" required />
        <small class="error" data-error="title"></small>
      </label>
      <label>优先级
        <select name="priority" data-testid="order-priority">
          ${PRIORITY_ORDER.map((p) => `<option value="${p}" ${p === "medium" ? "selected" : ""}>${PRIORITIES[p]}</option>`).join("")}
        </select>
      </label>
      <label>计划完成日
        <input name="dueDate" type="date" data-testid="order-due" required />
        <small class="error" data-error="dueDate"></small>
      </label>
      <label>预计费用（元）
        <input name="estimatedCost" inputmode="decimal" placeholder="0.00" data-testid="order-cost" />
        <small class="error" data-error="estimatedCost"></small>
      </label>
      <label>补充说明
        <textarea name="description" rows="2" maxlength="1000" placeholder="现象、联系人等（可选）"></textarea>
        <small class="error" data-error="description"></small>
      </label>
      <button class="primary" type="submit" data-testid="order-submit" ${view.submitting ? "disabled" : ""}>
        ${view.submitting ? "提交中…" : "提交报修"}
      </button>
      <p class="form-error" data-error="form"></p>
    </form>
  `;
}

function renderDeviceGroupOptions() {
  return store.state.properties
    .map((property) => {
      const rooms = store.state.rooms.filter((room) => room.propertyId === property.id);
      const groups = rooms
        .map((room) => {
          const devices = store.state.devices.filter((device) => device.roomId === room.id);
          if (!devices.length) return "";
          return `<optgroup label="${h(property.name)} / ${h(room.name)}">
            ${devices.map((d) => `<option value="${d.id}">${h(d.name)}</option>`).join("")}
          </optgroup>`;
        })
        .join("");
      return groups;
    })
    .join("");
}

function renderFilterBar(count) {
  const f = view.filters;
  return `
    <div class="filters" data-testid="filter-bar">
      <label>状态
        <select data-filter="status" data-testid="filter-status">
          <option value="all" ${f.status === "all" ? "selected" : ""}>全部</option>
          ${STATUS_ORDER.map((s) => `<option value="${s}" ${f.status === s ? "selected" : ""}>${STATUSES[s]}</option>`).join("")}
        </select>
      </label>
      <label>优先级
        <select data-filter="priority" data-testid="filter-priority">
          <option value="all" ${f.priority === "all" ? "selected" : ""}>全部</option>
          ${PRIORITY_ORDER.map((p) => `<option value="${p}" ${f.priority === p ? "selected" : ""}>${PRIORITIES[p]}</option>`).join("")}
        </select>
      </label>
      <label>房产
        <select data-filter="propertyId" data-testid="filter-property">
          <option value="all" ${f.propertyId === "all" ? "selected" : ""}>全部房产</option>
          ${store.state.properties.map((p) => `<option value="${p.id}" ${f.propertyId === p.id ? "selected" : ""}>${h(p.name)}</option>`).join("")}
        </select>
      </label>
      <label>设备
        <select data-filter="deviceId" data-testid="filter-device">
          <option value="all" ${f.deviceId === "all" ? "selected" : ""}>全部设备</option>
          ${renderDeviceGroupOptions()}
        </select>
      </label>
      <label>排序
        <select data-filter="sort" data-testid="filter-sort">
          <option value="urgency" ${f.sort === "urgency" ? "selected" : ""}>紧急度优先</option>
          <option value="costDesc" ${f.sort === "costDesc" ? "selected" : ""}>预计费用 高→低</option>
          <option value="costAsc" ${f.sort === "costAsc" ? "selected" : ""}>预计费用 低→高</option>
          <option value="dueSoon" ${f.sort === "dueSoon" ? "selected" : ""}>计划完成日临近</option>
        </select>
      </label>
      <label class="check"><input type="checkbox" data-filter="overdueOnly" data-testid="filter-overdue" ${f.overdueOnly ? "checked" : ""}/> 只看逾期</label>
      <input class="keyword" data-filter="keyword" data-testid="filter-keyword" placeholder="搜索问题/设备/房间/房产/处理结果" value="${h(f.keyword)}" />
      <button class="ghost small" data-filter-reset type="button">重置</button>
      <span class="count" data-testid="list-count">共 ${count} 单</span>
    </div>
  `;
}

function renderOrderList() {
  const orders = queryOrders(store.state.orders, view.filters);
  return `
    ${renderFilterBar(orders.length)}
    <div class="orders" data-testid="order-list">
      ${orders.length ? orders.map(renderOrderCard).join("") : `<div class="empty" data-testid="empty-list">没有符合条件的工单</div>`}
    </div>
  `;
}

function renderOrderCard(order) {
  const overdue = isOverdue(order);
  return `
    <article class="order-card priority-${order.priority} ${overdue ? "overdue" : ""}" data-testid="order-card" data-order-id="${order.id}">
      <button class="card-button" type="button" data-open-order="${order.id}">
        <div class="card-head">
          <span class="code" data-testid="order-code">${h(order.code)}</span>
          <span class="status-badge status-${order.status}">${STATUSES[order.status]}</span>
          <span class="priority-badge priority-badge-${order.priority}">${PRIORITIES[order.priority]}</span>
          ${overdue ? `<span class="overdue-badge" data-testid="overdue-badge">逾期</span>` : ""}
        </div>
        <h3>${h(order.title)}</h3>
        <p class="meta">${h(order.propertyName)} / ${h(order.roomName)} / ${h(order.deviceName)}</p>
        <div class="card-foot">
          <span>计划完成：${h(order.dueDate)}</span>
          <span>预计 ${moneyFmt(order.estimatedCost)}</span>
          <span>实际 ${moneyFmt(orderTotalCost(order))}</span>
        </div>
      </button>
    </article>
  `;
}

// ---------------- 工单详情（流转 / 维修记录 / 验收退回） ----------------
function renderOrderDetail(order) {
  const overdue = isOverdue(order);
  const transitions = TRANSITIONS[order.status] || [];
  const canLogWork = order.status === "doing";
  return `
    <div class="detail" data-testid="order-detail" data-order-id="${order.id}">
      <button class="ghost small" type="button" data-back-list>← 返回列表</button>
      <div class="detail-head">
        <div>
          <span class="code">${h(order.code)}</span>
          <h2>${h(order.title)}</h2>
          <p class="meta">${h(order.propertyName)} / ${h(order.roomName)} / ${h(order.deviceName)}</p>
        </div>
        <div class="badges">
          <span class="status-badge status-${order.status}" data-testid="detail-status">${STATUSES[order.status]}</span>
          <span class="priority-badge priority-badge-${order.priority}">${PRIORITIES[order.priority]}</span>
          ${overdue ? `<span class="overdue-badge">逾期 ${daysLate(order.dueDate)} 天</span>` : ""}
        </div>
      </div>

      ${order.description ? `<p class="description">${h(order.description)}</p>` : ""}
      ${order.rejectReason ? `<div class="banner warn" data-testid="reject-reason">退回原因：${h(order.rejectReason)}</div>` : ""}

      <div class="detail-grid">
        <div><span>计划完成日</span><strong>${h(order.dueDate)}</strong></div>
        <div><span>预计费用</span><strong>${moneyFmt(order.estimatedCost)}</strong></div>
        <div><span>实际费用合计</span><strong data-testid="actual-total">${moneyFmt(orderTotalCost(order))}</strong></div>
        <div><span>创建时间</span><strong>${formatTime(order.createdAt)}</strong></div>
      </div>

      <section class="actions-row">
        ${transitions
          .map((t) => {
            if (t.action === "reject") {
              return `<button class="danger-outline" type="button" data-action="${t.action}" data-testid="btn-reject">${t.label}</button>`;
            }
            if (t.action === "cancel") {
              return `<button class="ghost" type="button" data-action="${t.action}">${t.label}</button>`;
            }
            return `<button class="primary" type="button" data-action="${t.action}" data-testid="btn-${t.action}">${t.label}</button>`;
          })
          .join("")}
      </section>

      ${order.status === "accepting" ? `
        <form class="inline-form" id="reject-form" hidden data-testid="reject-form">
          <label>退回原因（必填）
            <textarea name="note" rows="2" maxlength="500" data-testid="reject-note" placeholder="说明验收不通过的原因"></textarea>
          </label>
          <div class="actions-row">
            <button class="danger-outline" type="submit" data-testid="reject-confirm">确认退回处理</button>
            <button class="ghost" type="button" data-reject-cancel>取消</button>
          </div>
        </form>` : ""}

      ${canLogWork ? renderWorkLogForm() : ""}
      ${renderWorkLogs(order)}
      ${renderHistory(order)}
    </div>
  `;
}

function renderWorkLogForm() {
  return `
    <section class="panel inner" data-testid="worklog-panel">
      <h3>维修记录（实际费用 / 耗材 / 处理结果）</h3>
      <form id="worklog-form" data-testid="worklog-form" novalidate>
        <div class="form-row">
          <label>实际费用（人工等，元）
            <input name="actualCost" inputmode="decimal" placeholder="0.00" data-testid="log-cost" />
            <small class="error" data-error="actualCost"></small>
          </label>
        </div>
        <div class="materials" data-testid="materials">
          <div class="materials-head">
            <strong>耗材</strong>
            <button class="ghost small" type="button" data-add-material>+ 添加耗材</button>
          </div>
          <div class="material-rows" data-material-rows>
            ${renderMaterialRow()}
          </div>
          <small class="error" data-error="materialName"></small>
          <small class="error" data-error="materialQuantity"></small>
          <small class="error" data-error="materialCost"></small>
        </div>
        <label>处理结果
          <textarea name="result" rows="2" maxlength="1000" data-testid="log-result" placeholder="本次处理了什么"></textarea>
          <small class="error" data-error="result"></small>
        </label>
        <button class="primary" type="submit" data-testid="log-submit">保存维修记录</button>
      </form>
    </section>
  `;
}

function renderMaterialRow() {
  return `
    <div class="material-row" data-material-row>
      <input name="materialName" placeholder="耗材名称" data-testid="material-name" />
      <input name="materialQuantity" inputmode="numeric" placeholder="数量" value="1" class="qty" />
      <input name="materialCost" inputmode="decimal" placeholder="单价" class="unit" />
      <button class="ghost small" type="button" data-remove-material>删</button>
    </div>
  `;
}

function renderWorkLogs(order) {
  if (!order.workLogs.length) return `<section class="panel inner"><h3>维修记录</h3><div class="empty">暂无维修记录</div></section>`;
  return `
    <section class="panel inner">
      <h3>维修记录（${order.workLogs.length}）</h3>
      <ul class="logs" data-testid="worklog-list">
        ${order.workLogs
          .map(
            (log) => `
          <li>
            <div class="log-head">
              <strong>${h(log.date)}</strong>
              <span>${moneyFmt(log.actualCost)}${
                log.materials.length
                  ? ` + 耗材 ${moneyFmt(log.materials.reduce((s, m) => s + m.cost * m.quantity, 0))}`
                  : ""
              }</span>
            </div>
            ${log.materials.length ? `<p class="materials-line">耗材：${h(log.materials.map((m) => `${m.name}×${m.quantity}`).join("、"))}</p>` : ""}
            ${log.result ? `<p>${h(log.result)}</p>` : ""}
          </li>`
          )
          .join("")}
      </ul>
    </section>
  `;
}

function renderHistory(order) {
  return `
    <section class="panel inner">
      <h3>流转记录</h3>
      <ol class="history" data-testid="history">
        ${order.history
          .map((item) => {
            const stateLabel = item.from === item.to ? STATUSES[item.from] : `${STATUSES[item.from]} → ${STATUSES[item.to]}`;
            return `<li><span class="hist-time">${formatTime(item.at)}</span> <span class="hist-action">${h(actionLabel(item.action))}</span> <span class="hist-state">${stateLabel}</span>${item.note && item.action !== "create" ? ` <em>${h(item.note)}</em>` : ""}</li>`;
          })
          .join("")}
      </ol>
    </section>
  `;
}

function actionLabel(action) {
  const map = { create: "创建工单", start: "开始处理", complete: "提交验收", accept: "验收通过", reject: "验收退回", cancel: "取消工单", worklog: "记录维修" };
  return map[action] || action;
}

function daysLate(dueDate) {
  const today = new Date(`${todayStr()}T00:00:00`);
  const due = new Date(`${dueDate}T00:00:00`);
  return Math.max(0, Math.round((today - due) / 86400000));
}

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------- 档案视图 ----------------
function renderProfileView() {
  return `
    <section class="profile-grid">
      <div class="panel">
        <h2>房产</h2>
        <form id="property-form" class="form" data-testid="property-form" novalidate>
          <label>名称<input name="name" maxlength="50" placeholder="例如：滨江公寓" data-testid="property-name" /><small class="error" data-error="name"></small></label>
          <label>地址<input name="address" maxlength="200" placeholder="详细地址（可选）" /></label>
          <button class="primary" type="submit">添加房产</button>
        </form>
        <ul class="profile-list" data-testid="property-list">
          ${store.state.properties.map((p) => `<li><strong>${h(p.name)}</strong>${p.address ? `<em>${h(p.address)}</em>` : ""}</li>`).join("") || `<li class="empty">暂无房产</li>`}
        </ul>
      </div>

      <div class="panel">
        <h2>房间</h2>
        <form id="room-form" class="form" data-testid="room-form" novalidate>
          <label>所属房产
            <select name="propertyId" data-testid="room-property"><option value="">请选择…</option>${store.state.properties
              .map((p) => `<option value="${p.id}">${h(p.name)}</option>`)
              .join("")}</select>
            <small class="error" data-error="propertyId"></small>
          </label>
          <label>房间名称<input name="name" maxlength="50" placeholder="例如：主卧" data-testid="room-name" /><small class="error" data-error="name"></small></label>
          <button class="primary" type="submit" ${store.state.properties.length ? "" : "disabled"}>添加房间</button>
        </form>
        <ul class="profile-list" data-testid="room-list">
          ${store.state.rooms
            .map((room) => {
              const property = store.state.properties.find((p) => p.id === room.propertyId);
              return `<li><strong>${h(room.name)}</strong><em>${h(property?.name || "")}</em></li>`;
            })
            .join("") || `<li class="empty">暂无房间</li>`}
        </ul>
      </div>

      <div class="panel">
        <h2>设备</h2>
        <form id="device-form" class="form" data-testid="device-form" novalidate>
          <label>所在房间
            <select name="roomId" data-testid="device-room"><option value="">请选择…</option>${renderRoomOptions()}</select>
            <small class="error" data-error="roomId"></small>
          </label>
          <label>设备名称<input name="name" maxlength="50" placeholder="例如：挂式空调" data-testid="device-name" /><small class="error" data-error="name"></small></label>
          <label>品牌（可选）<input name="brand" maxlength="50" placeholder="美的" /></label>
          <label>型号（可选）<input name="model" maxlength="80" placeholder="KFR-35" /></label>
          <label>备注（可选）<textarea name="note" rows="2" maxlength="500" placeholder="安装日期、保修信息等"></textarea></label>
          <button class="primary" type="submit" ${store.state.rooms.length ? "" : "disabled"}>添加设备</button>
        </form>
        <ul class="profile-list" data-testid="device-list">
          ${store.state.devices
            .map((device) => {
              const room = store.state.rooms.find((r) => r.id === device.roomId);
              const property = room && store.state.properties.find((p) => p.id === room.propertyId);
              return `<li><strong>${h(device.name)}</strong><em>${h([property?.name, room?.name].filter(Boolean).join(" / "))}</em>${device.brand || device.model ? `<em class="sub">${h([device.brand, device.model].filter(Boolean).join(" "))}</em>` : ""}</li>`;
            })
            .join("") || `<li class="empty">暂无设备</li>`}
        </ul>
      </div>
    </section>
  `;
}

function renderRoomOptions() {
  return store.state.properties
    .map((property) => {
      const rooms = store.state.rooms.filter((room) => room.propertyId === property.id);
      if (!rooms.length) return "";
      return `<optgroup label="${h(property.name)}">${rooms
        .map((room) => `<option value="${room.id}">${h(room.name)}</option>`)
        .join("")}</optgroup>`;
    })
    .join("");
}

// ---------------- 设置视图 ----------------
function renderSettingsView() {
  const budget = store.state.settings.monthlyBudget;
  return `
    <section class="panel settings">
      <h2>设置</h2>
      <form id="budget-form" class="form narrow" data-testid="budget-form" novalidate>
        <label>本月维修支出预算（元，留空表示不设预算）
          <input name="budget" type="number" min="0" step="0.01" data-testid="budget-input" value="${budget === null ? "" : budget}" />
          <small class="error" data-error="budget"></small>
        </label>
        <button class="primary" type="submit">保存预算</button>
      </form>

      <div class="danger-zone panel inner">
        <h3>清空全部数据</h3>
        <p>将删除所有房产、房间、设备和工单数据，不可恢复。</p>
        <button class="danger-outline" type="button" data-wipe data-testid="wipe-btn">清空数据</button>
      </div>
    </section>
  `;
}

// ---------------- 事件绑定 ----------------
function clearErrors(form) {
  form.querySelectorAll("[data-error]").forEach((el) => {
    el.textContent = "";
  });
}

function showErrors(form, errors) {
  for (const [field, message] of Object.entries(errors)) {
    const el = form.querySelector(`[data-error="${field}"]`);
    if (el) el.textContent = message;
  }
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function restoreFormValues(form, values) {
  if (!form) return;
  for (const [key, value] of Object.entries(values)) {
    const el = form.elements[key];
    if (el && !["submit", "button", "checkbox", "radio"].includes(el.type)) el.value = value;
  }
}

function bindEvents() {
  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      view.tab = btn.dataset.tab;
      view.selectedOrderId = null;
      render();
    });
  });

  const goProfile = document.querySelector("[data-go-profile]");
  if (goProfile) goProfile.addEventListener("click", () => { view.tab = "profile"; render(); });

  bindOrderForm();
  bindFilters();
  bindOrderActions();
  bindProfileForms();
  bindSettings();
}

function bindOrderForm() {
  const form = document.querySelector("#order-form");
  if (!form) return;
  // 默认计划完成日 = 今天
  const due = form.querySelector("[name=dueDate]");
  if (due && !due.value) due.value = todayStr();

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (form.dataset.submitted === "1") {
      // 同一表单实例已成功提交（双击 / 触发两次），直接忽略
      toast("该报修已提交，请勿重复提交", "warn");
      return;
    }
    if (view.submitting) {
      toast("正在提交，请勿重复点击", "warn");
      return;
    }
    clearErrors(form);
    const values = formValues(form);
    // 提交为同步操作；提交期间禁用按钮，配合 token 双重防重复
    view.submitting = true;
    const submitButton = form.querySelector("[type=submit]");
    if (submitButton) submitButton.disabled = true;
    const result = store.createOrder(
      {
        deviceId: values.deviceId,
        title: values.title,
        priority: values.priority,
        dueDate: values.dueDate,
        estimatedCost: values.estimatedCost,
        description: values.description
      },
      view.orderFormToken
    );
    view.submitting = false;
    if (result.duplicated) {
      if (submitButton) submitButton.disabled = false;
      view.selectedOrderId = result.order?.id || null;
      if (view.selectedOrderId) {
        render();
      }
      toast("该报修已提交，请勿重复提交", "warn");
      return;
    }
    if (!result.ok) {
      if (submitButton) submitButton.disabled = false;
      showErrors(form, result.errors);
      toast("请检查表单中标红的项", "error");
      return;
    }
    // 成功：标记该表单实例已提交，轮换令牌，整体重渲染
    form.dataset.submitted = "1";
    view.orderFormToken = newToken();
    toast("报修已提交，工单进入待确认", "success");
    render();
  });
}

function bindFilters() {
  document.querySelectorAll("[data-filter]").forEach((el) => {
    const handler = () => {
      const key = el.dataset.filter;
      if (el.type === "checkbox") view.filters[key] = el.checked;
      else view.filters[key] = el.value;
      render();
      if (key === "keyword") {
        const input = document.querySelector('[data-filter="keyword"]');
        if (input) {
          input.focus();
          const len = input.value.length;
          input.setSelectionRange(len, len);
        }
      }
    };
    el.addEventListener("input", handler);
    el.addEventListener("change", handler);
  });
  const reset = document.querySelector("[data-filter-reset]");
  if (reset) {
    reset.addEventListener("click", () => {
      view.filters = { status: "all", priority: "all", propertyId: "all", deviceId: "all", overdueOnly: false, keyword: "", sort: "urgency" };
      render();
    });
  }
}

function bindOrderActions() {
  document.querySelectorAll("[data-open-order]").forEach((btn) => {
    btn.addEventListener("click", () => {
      view.selectedOrderId = btn.dataset.openOrder;
      render();
    });
  });
  const back = document.querySelector("[data-back-list]");
  if (back) back.addEventListener("click", () => { view.selectedOrderId = null; render(); });

  document.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      if (action === "reject") {
        const form = document.querySelector("#reject-form");
        if (form) form.hidden = false;
        return;
      }
      applyTransition(view.selectedOrderId, action, "");
    });
  });

  const rejectCancel = document.querySelector("[data-reject-cancel]");
  if (rejectCancel) {
    rejectCancel.addEventListener("click", () => {
      document.querySelector("#reject-form").hidden = true;
    });
  }

  const rejectForm = document.querySelector("#reject-form");
  if (rejectForm) {
    rejectForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const note = rejectForm.elements.note.value.trim();
      if (!note) {
        toast("请填写退回原因", "error");
        rejectForm.elements.note.focus();
        return;
      }
      applyTransition(view.selectedOrderId, "reject", note);
    });
  }

  bindWorkLogForm();
}

function applyTransition(orderId, action, note) {
  const result = store.transition(orderId, action, { note });
  if (!result.ok) {
    toast(result.errors.form || "操作失败", "error");
    return;
  }
  toast(`工单已流转到「${STATUSES[result.order.status]}」`, "success");
  render();
}

function bindWorkLogForm() {
  const form = document.querySelector("#worklog-form");
  if (!form) return;

  document.querySelector("[data-add-material]").addEventListener("click", () => {
    const wrap = document.querySelector("[data-material-rows]");
    const div = document.createElement("div");
    div.innerHTML = renderMaterialRow();
    while (div.firstElementChild) wrap.appendChild(div.firstElementChild);
  });

  form.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-remove-material]");
    if (!btn) return;
    btn.closest("[data-material-row]")?.remove();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    clearErrors(form);
    const values = formValues(form);
    const rows = [...form.querySelectorAll("[data-material-row]")];
    const materials = rows
      .map((row) => ({
        name: row.querySelector('[name="materialName"]')?.value || "",
        quantity: row.querySelector('[name="materialQuantity"]')?.value || "",
        cost: row.querySelector('[name="materialCost"]')?.value || ""
      }))
      .filter((row) => row.name.trim() || row.cost.trim() || (row.quantity.trim() && row.quantity !== "1"));

    const result = store.addWorkLog(view.selectedOrderId, {
      actualCost: values.actualCost,
      result: values.result,
      materials
    });
    if (!result.ok) {
      showErrors(form, result.errors);
      toast(result.errors.form || "请检查维修记录中标红的项", "error");
      return;
    }
    toast(`维修记录已保存，实际费用合计 ${moneyFmt(result.totalCost)}`, "success");
    render();
  });
}

function bindProfileForms() {
  const propertyForm = document.querySelector("#property-form");
  if (propertyForm) {
    propertyForm.addEventListener("submit", (event) => {
      event.preventDefault();
      clearErrors(propertyForm);
      const result = store.addProperty(formValues(propertyForm));
      if (!result.ok) { showErrors(propertyForm, result.errors); toast("请检查房产表单", "error"); return; }
      toast("房产已添加", "success");
      render();
    });
  }
  const roomForm = document.querySelector("#room-form");
  if (roomForm) {
    roomForm.addEventListener("submit", (event) => {
      event.preventDefault();
      clearErrors(roomForm);
      const result = store.addRoom(formValues(roomForm));
      if (!result.ok) { showErrors(roomForm, result.errors); toast("请检查房间表单", "error"); return; }
      toast("房间已添加", "success");
      render();
    });
  }
  const deviceForm = document.querySelector("#device-form");
  if (deviceForm) {
    deviceForm.addEventListener("submit", (event) => {
      event.preventDefault();
      clearErrors(deviceForm);
      const result = store.addDevice(formValues(deviceForm));
      if (!result.ok) { showErrors(deviceForm, result.errors); toast("请检查设备表单", "error"); return; }
      toast("设备已添加", "success");
      render();
    });
  }
}

function bindSettings() {
  const budgetForm = document.querySelector("#budget-form");
  if (budgetForm) {
    budgetForm.addEventListener("submit", (event) => {
      event.preventDefault();
      clearErrors(budgetForm);
      const result = store.setMonthlyBudget(budgetForm.elements.budget.value);
      if (!result.ok) { showErrors(budgetForm, result.errors); return; }
      toast("预算已保存", "success");
      render();
    });
  }
  const wipe = document.querySelector("[data-wipe]");
  if (wipe) {
    let armed = false;
    wipe.addEventListener("click", () => {
      if (!armed) {
        armed = true;
        wipe.textContent = "再点一次确认清空";
        toast("再点击一次确认清空全部数据", "warn");
        return;
      }
      store.resetAll();
      view.selectedOrderId = null;
      view.orderFormToken = newToken();
      toast("全部数据已清空", "success");
      render();
    });
  }
}

render();
