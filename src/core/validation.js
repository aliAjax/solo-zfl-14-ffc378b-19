// 输入校验：返回 { ok, value, errors }
import { PRIORITY_ORDER, STATUSES, STATUS_ORDER, isValidDateStr } from "./model.js";

const MAX_TEXT = 200;
const MAX_NOTE = 1000;
const MAX_MONEY = 10_000_000;

export function trimText(value) {
  return String(value ?? "").trim();
}

export function requiredText(value, field, errors, { max = MAX_TEXT } = {}) {
  const text = trimText(value);
  if (!text) {
    errors[field] = "必填项不能为空";
    return "";
  }
  if (text.length > max) {
    errors[field] = `长度不能超过 ${max} 个字符`;
    return text.slice(0, max);
  }
  return text;
}

export function optionalText(value, field, errors, { max = MAX_TEXT } = {}) {
  const text = trimText(value);
  if (text && text.length > max) {
    errors[field] = `长度不能超过 ${max} 个字符`;
    return text.slice(0, max);
  }
  return text;
}

export function enumValue(value, allowed, fallback = allowed[0]) {
  return allowed.includes(value) ? value : fallback;
}

export function money(value, field, errors, { required = false } = {}) {
  const raw = trimText(value);
  if (raw === "") {
    if (required) errors[field] = "请填写金额";
    return 0;
  }
  // 允许：12、12.5、12.50；不允许：12元、abc、1,200
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    errors[field] = "请输入合法金额（非负数字，最多两位小数）";
    return 0;
  }
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0) {
    errors[field] = "金额必须不小于 0";
    return 0;
  }
  if (num > MAX_MONEY) {
    errors[field] = `金额不能超过 ${MAX_MONEY}`;
    return MAX_MONEY;
  }
  return Math.round(num * 100) / 100;
}

export function positiveInt(value, field, errors) {
  const raw = trimText(value);
  if (raw === "") return 1;
  if (!/^\d+$/.test(raw)) {
    errors[field] = "数量必须是正整数";
    return 1;
  }
  const num = Number(raw);
  if (num < 1) {
    errors[field] = "数量至少为 1";
    return 1;
  }
  if (num > 10000) {
    errors[field] = "数量不能超过 10000";
    return 10000;
  }
  return num;
}

export function dueDate(value, field, errors) {
  const text = trimText(value);
  if (!text) {
    errors[field] = "请选择计划完成日";
    return "";
  }
  if (!isValidDateStr(text)) {
    errors[field] = "日期格式不正确（YYYY-MM-DD）";
    return "";
  }
  return text;
}

// 报修表单
export function validateOrderInput(input, { devices = [] } = {}) {
  const errors = {};
  const deviceId = trimText(input.deviceId);
  if (!deviceId) errors.deviceId = "请选择设备";
  else if (devices.length && !devices.some((device) => device.id === deviceId)) {
    errors.deviceId = "所选设备不存在";
  }
  const title = requiredText(input.title, "title", errors, { max: MAX_TEXT });
  const priority = enumValue(trimText(input.priority), PRIORITY_ORDER, "medium");
  const dueDateValue = dueDate(input.dueDate, "dueDate", errors);
  const estimatedCost = money(input.estimatedCost, "estimatedCost", errors);
  const description = optionalText(input.description, "description", errors, { max: MAX_NOTE });
  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: { deviceId, title, priority, dueDate: dueDateValue, estimatedCost, description }
  };
}

// 档案：房产 / 房间 / 设备
export function validatePropertyInput(input) {
  const errors = {};
  const name = requiredText(input.name, "name", errors, { max: 50 });
  const address = optionalText(input.address, "address", errors, { max: 200 });
  return { ok: Object.keys(errors).length === 0, errors, value: { name, address } };
}

export function validateRoomInput(input, { properties = [] } = {}) {
  const errors = {};
  const propertyId = trimText(input.propertyId);
  if (!propertyId) errors.propertyId = "请选择所属房产";
  else if (properties.length && !properties.some((item) => item.id === propertyId)) {
    errors.propertyId = "所选房产不存在";
  }
  const name = requiredText(input.name, "name", errors, { max: 50 });
  return { ok: Object.keys(errors).length === 0, errors, value: { propertyId, name } };
}

export function validateDeviceInput(input, { rooms = [] } = {}) {
  const errors = {};
  const roomId = trimText(input.roomId);
  if (!roomId) errors.roomId = "请选择所在房间";
  else if (rooms.length && !rooms.some((item) => item.id === roomId)) {
    errors.roomId = "所选房间不存在";
  }
  const name = requiredText(input.name, "name", errors, { max: 50 });
  const brand = optionalText(input.brand, "brand", errors, { max: 50 });
  const model = optionalText(input.model, "model", errors, { max: 80 });
  const note = optionalText(input.note, "note", errors, { max: 500 });
  return { ok: Object.keys(errors).length === 0, errors, value: { roomId, name, brand, model, note } };
}

// 维修记录（处理中填写）
export function validateWorkLogInput(input) {
  const errors = {};
  const actualCost = money(input.actualCost, "actualCost", errors);
  const result = optionalText(input.result, "result", errors, { max: MAX_NOTE });
  let materials = [];
  const rows = Array.isArray(input.materials) ? input.materials : [];
  for (const row of rows) {
    const name = trimText(row?.name);
    if (!name) {
      errors.materialName = "耗材名称不能为空";
      continue;
    }
    const rowErrors = {};
    const quantity = positiveInt(row?.quantity, "materialQuantity", rowErrors);
    const cost = money(row?.cost, "materialCost", rowErrors);
    Object.assign(errors, rowErrors);
    materials.push({ name, quantity, cost });
  }
  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: { actualCost, result, materials }
  };
}

export function isValidStatus(value) {
  return STATUS_ORDER.includes(value);
}

export const STATUS_LABELS = STATUSES;
