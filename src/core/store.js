// 持久化 + 应用操作：localStorage 存取、坏数据回退空数据、防重复提交
import {
  PRIORITY_ORDER,
  STATUS_ORDER,
  canTransition,
  createId,
  isOpenStatus,
  isValidDateStr,
  orderTotalCost,
  todayStr,
  transitionTarget
} from "./model.js";
import {
  validateDeviceInput,
  validateOrderInput,
  validatePropertyInput,
  validateRoomInput,
  validateWorkLogInput
} from "./validation.js";

export const STORAGE_KEY = "zfl-14-home-repair:v2";
const STATE_VERSION = 2;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export function emptyState() {
  return {
    version: STATE_VERSION,
    properties: [],
    rooms: [],
    devices: [],
    orders: [],
    settings: { monthlyBudget: null },
    counters: { order: 0 },
    tokens: []
  };
}

// 反序列化：任何坏数据（非法 JSON / 结构错误）一律回退到空数据
export function parseState(raw) {
  if (raw == null || raw === "") return emptyState();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return emptyState();
  }
  const state = sanitizeState(data);
  return state;
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value) {
  return typeof value === "string" ? value : "";
}

function asNonNegativeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

function sanitizeState(data) {
  if (!isObject(data) || !Array.isArray(data.orders)) return emptyState();
  const base = emptyState();
  const properties = Array.isArray(data.properties) ? data.properties : [];
  const rooms = Array.isArray(data.rooms) ? data.rooms : [];
  const devices = Array.isArray(data.devices) ? data.devices : [];

  base.properties = properties
    .filter((item) => isObject(item) && asString(item.id) && asString(item.name))
    .map((item) => ({
      id: asString(item.id),
      name: asString(item.name).slice(0, 50),
      address: asString(item.address).slice(0, 200),
      createdAt: asString(item.createdAt)
    }));

  const propertyIds = new Set(base.properties.map((item) => item.id));
  base.rooms = rooms
    .filter(
      (item) =>
        isObject(item) &&
        asString(item.id) &&
        asString(item.name) &&
        propertyIds.has(asString(item.propertyId))
    )
    .map((item) => ({
      id: asString(item.id),
      propertyId: asString(item.propertyId),
      name: asString(item.name).slice(0, 50),
      createdAt: asString(item.createdAt)
    }));

  const roomIds = new Set(base.rooms.map((item) => item.id));
  base.devices = devices
    .filter((item) => isObject(item) && asString(item.id) && asString(item.name) && roomIds.has(asString(item.roomId)))
    .map((item) => ({
      id: asString(item.id),
      roomId: asString(item.roomId),
      name: asString(item.name).slice(0, 50),
      brand: asString(item.brand).slice(0, 50),
      model: asString(item.model).slice(0, 80),
      note: asString(item.note).slice(0, 500),
      createdAt: asString(item.createdAt)
    }));

  const deviceIds = new Set(base.devices.map((item) => item.id));
  base.orders = data.orders
    .filter(
      (item) =>
        isObject(item) &&
        asString(item.id) &&
        deviceIds.has(asString(item.deviceId)) &&
        asString(item.title) &&
        STATUS_ORDER.includes(item.status) &&
        PRIORITY_ORDER.includes(item.priority) &&
        isValidDateStr(asString(item.dueDate))
    )
    .map((item) => sanitizeOrder(item));

  if (isObject(data.settings) && (data.settings.monthlyBudget === null || Number.isFinite(Number(data.settings.monthlyBudget)))) {
    base.settings.monthlyBudget = data.settings.monthlyBudget === null ? null : Number(data.settings.monthlyBudget);
  }
  base.counters.order = Number.isInteger(data?.counters?.order) ? data.counters.order : 0;
  base.tokens = Array.isArray(data.tokens)
    ? data.tokens.filter((token) => isObject(token) && typeof token.key === "string" && Number.isFinite(token.expiresAt))
    : [];
  return base;
}

function sanitizeOrder(item) {
  return {
    id: asString(item.id),
    code: asString(item.code),
    deviceId: asString(item.deviceId),
    deviceName: asString(item.deviceName),
    roomId: asString(item.roomId),
    roomName: asString(item.roomName),
    propertyId: asString(item.propertyId),
    propertyName: asString(item.propertyName),
    title: asString(item.title).slice(0, 200),
    description: asString(item.description).slice(0, 1000),
    priority: item.priority,
    dueDate: asString(item.dueDate),
    estimatedCost: asNonNegativeNumber(item.estimatedCost),
    status: item.status,
    createdAt: asString(item.createdAt),
    updatedAt: asString(item.updatedAt),
    token: asString(item.token),
    rejectReason: asString(item.rejectReason),
    history: Array.isArray(item.history)
      ? item.history
          .filter((h) => isObject(h) && STATUS_ORDER.includes(h.from) && STATUS_ORDER.includes(h.to))
          .map((h) => ({
            from: asString(h.from),
            to: asString(h.to),
            action: asString(h.action),
            at: asString(h.at),
            note: asString(h.note)
          }))
      : [],
    workLogs: Array.isArray(item.workLogs)
      ? item.workLogs
          .filter((log) => isObject(log) && asString(log.id))
          .map((log) => ({
            id: asString(log.id),
            date: isValidDateStr(asString(log.date)) ? asString(log.date) : todayStr(),
            actualCost: asNonNegativeNumber(log.actualCost),
            result: asString(log.result).slice(0, 1000),
            at: asString(log.at),
            materials: Array.isArray(log.materials)
              ? log.materials
                  .filter((m) => isObject(m) && asString(m.name))
                  .map((m) => ({
                    name: asString(m.name).slice(0, 50),
                    quantity: asNonNegativeNumber(m.quantity) || 1,
                    cost: asNonNegativeNumber(m.cost)
                  }))
              : []
          }))
      : []
  };
}

export class RepairStore {
  constructor(storage, { key = STORAGE_KEY, now = () => new Date() } = {}) {
    this.storage = storage;
    this.key = key;
    this.now = now;
    this.state = this.load();
  }

  load() {
    let raw = null;
    try {
      raw = this.storage.getItem(this.key);
    } catch {
      raw = null;
    }
    this.state = parseState(raw);
    this.pruneTokens();
    return this.state;
  }

  save() {
    try {
      this.storage.setItem(this.key, JSON.stringify(this.state));
    } catch {
      // 存储不可用（隐私模式/超额）时内存中仍可继续操作
    }
    return this.state;
  }

  // 防重复提交：同一 token 只生效一次，返回 { duplicated, id }
  reserveToken(token) {
    const key = String(token || "").trim();
    if (!key) return { duplicated: false, token: createId() };
    this.pruneTokens();
    const exists = this.state.tokens.some((item) => item.key === key);
    if (exists) return { duplicated: true, token: key };
    this.state.tokens.push({ key, expiresAt: this.now().getTime() + TOKEN_TTL_MS });
    return { duplicated: false, token: key };
  }

  pruneTokens() {
    const ts = this.now().getTime();
    this.state.tokens = this.state.tokens.filter((token) => token.expiresAt > ts);
  }

  // ---------- 档案 ----------
  addProperty(input) {
    const result = validatePropertyInput(input);
    if (!result.ok) return { ok: false, errors: result.errors };
    const property = { id: createId(), ...result.value, createdAt: this.now().toISOString() };
    this.state.properties.push(property);
    this.save();
    return { ok: true, property };
  }

  addRoom(input) {
    const result = validateRoomInput(input, { properties: this.state.properties });
    if (!result.ok) return { ok: false, errors: result.errors };
    const room = { id: createId(), ...result.value, createdAt: this.now().toISOString() };
    this.state.rooms.push(room);
    this.save();
    return { ok: true, room };
  }

  addDevice(input) {
    const result = validateDeviceInput(input, { rooms: this.state.rooms });
    if (!result.ok) return { ok: false, errors: result.errors };
    const device = { id: createId(), ...result.value, createdAt: this.now().toISOString() };
    this.state.devices.push(device);
    this.save();
    return { ok: true, device };
  }

  // ---------- 工单 ----------
  nextOrderCode() {
    this.state.counters.order += 1;
    const ymd = todayStr(this.now()).replace(/-/g, "");
    return `WO-${ymd}-${String(this.state.counters.order).padStart(4, "0")}`;
  }

  createOrder(input, token) {
    const reservation = this.reserveToken(token);
    if (reservation.duplicated) {
      // 找到该 token 对应的工单（最近创建），不重复落单
      const existing = [...this.state.orders]
        .reverse()
        .find((order) => order.token === reservation.token);
      return { ok: true, duplicated: true, order: existing || null };
    }
    const result = validateOrderInput(input, { devices: this.state.devices });
    if (!result.ok) {
      // 校验失败：释放预占 token，允许用户修正后用同一表单重试
      this.state.tokens = this.state.tokens.filter((item) => item.key !== reservation.token);
      return { ok: false, errors: result.errors };
    }
    const device = this.state.devices.find((item) => item.id === result.value.deviceId);
    const room = this.state.rooms.find((item) => item.id === device.roomId);
    const property = this.state.properties.find((item) => item.id === room.propertyId);
    const ts = this.now().toISOString();
    const order = {
      id: createId(),
      code: this.nextOrderCode(),
      deviceId: device.id,
      deviceName: device.name,
      roomId: room.id,
      roomName: room.name,
      propertyId: property.id,
      propertyName: property.name,
      title: result.value.title,
      description: result.value.description,
      priority: result.value.priority,
      dueDate: result.value.dueDate,
      estimatedCost: result.value.estimatedCost,
      status: "pending",
      token: reservation.token,
      rejectReason: "",
      history: [{ from: "pending", to: "pending", action: "create", at: ts, note: "工单创建" }],
      workLogs: [],
      createdAt: ts,
      updatedAt: ts
    };
    this.state.orders.unshift(order);
    this.save();
    return { ok: true, duplicated: false, order };
  }

  getOrder(id) {
    return this.state.orders.find((order) => order.id === id) || null;
  }

  transition(orderId, action, { note = "" } = {}) {
    const order = this.getOrder(orderId);
    if (!order) return { ok: false, errors: { form: "工单不存在" } };
    if (!canTransition(order.status, action)) {
      return { ok: false, errors: { form: `当前状态不能执行该操作（${order.status} -> ${action}）` } };
    }
    const from = order.status;
    const to = transitionTarget(from, action);
    const ts = this.now().toISOString();
    order.status = to;
    order.updatedAt = ts;
    order.rejectReason = action === "reject" ? String(note || "").trim().slice(0, 500) : "";
    order.history.push({ from, to, action, at: ts, note: String(note || "").trim().slice(0, 500) });
    this.save();
    return { ok: true, order };
  }

  // 维修中记录实际费用 / 耗材 / 处理结果
  addWorkLog(orderId, input) {
    const order = this.getOrder(orderId);
    if (!order) return { ok: false, errors: { form: "工单不存在" } };
    if (order.status !== "doing") {
      return { ok: false, errors: { form: "只有处理中的工单可以记录维修信息" } };
    }
    const result = validateWorkLogInput(input);
    if (!result.ok) return { ok: false, errors: result.errors };
    const ts = this.now().toISOString();
    const log = {
      id: createId(),
      date: todayStr(this.now()),
      at: ts,
      actualCost: result.value.actualCost,
      materials: result.value.materials,
      result: result.value.result
    };
    order.workLogs.push(log);
    order.updatedAt = ts;
    order.history.push({ from: order.status, to: order.status, action: "worklog", at: ts, note: "记录维修信息" });
    this.save();
    return { ok: true, log, totalCost: orderTotalCost(order) };
  }

  setMonthlyBudget(value) {
    if (value === "" || value === null || Number.isNaN(Number(value))) {
      this.state.settings.monthlyBudget = null;
    } else {
      const num = Number(value);
      if (num < 0 || !Number.isFinite(num)) return { ok: false, errors: { budget: "预算必须为不小于 0 的数字" } };
      this.state.settings.monthlyBudget = Math.round(num * 100) / 100;
    }
    this.save();
    return { ok: true };
  }

  resetAll() {
    this.state = emptyState();
    this.save();
    return this.state;
  }

  isOpen(id) {
    const order = this.getOrder(id);
    return order ? isOpenStatus(order.status) : false;
  }
}
