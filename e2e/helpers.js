export const STORAGE_KEY = "zfl-14-home-repair:v2";

let seq = 0;
function id(prefix) {
  seq += 1;
  return `${prefix}-${seq}`;
}

export function makeState(overrides = {}) {
  return {
    version: 2,
    properties: [],
    rooms: [],
    devices: [],
    orders: [],
    settings: { monthlyBudget: null },
    counters: { order: 0 },
    tokens: [],
    ...overrides
  };
}

// 房产 -> 房间 -> 设备
export function makeProfile({ propertyName = "滨江公寓", roomName = "主卧", deviceName = "空调" } = {}) {
  const property = { id: id("p"), name: propertyName, address: "", createdAt: "2026-09-01T08:00:00.000Z" };
  const room = { id: id("r"), propertyId: property.id, name: roomName, createdAt: "2026-09-01T08:00:00.000Z" };
  const device = { id: id("d"), roomId: room.id, name: deviceName, brand: "", model: "", note: "", createdAt: "2026-09-01T08:00:00.000Z" };
  return { property, room, device };
}

export function makeOrder(overrides = {}) {
  const profile = overrides._profile || makeProfile();
  const { property, room, device } = profile;
  const n = (overrides._counter ?? 0) + 1;
  return {
    id: overrides.id || id("o"),
    code: overrides.code || `WO-20260912-${String(n).padStart(4, "0")}`,
    deviceId: device.id,
    deviceName: device.name,
    roomId: room.id,
    roomName: room.name,
    propertyId: property.id,
    propertyName: property.name,
    title: "维修问题",
    description: "",
    priority: "medium",
    dueDate: "2026-09-20",
    estimatedCost: 100,
    status: "pending",
    token: "",
    rejectReason: "",
    history: [{ from: "pending", to: "pending", action: "create", at: "2026-09-10T08:00:00.000Z", note: "工单创建" }],
    workLogs: [],
    createdAt: "2026-09-10T08:00:00.000Z",
    updatedAt: "2026-09-10T08:00:00.000Z",
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => !k.startsWith("_")))
  };
}

export function stateFromProfiles(profiles, orders = []) {
  const properties = profiles.map((p) => p.property);
  const rooms = profiles.map((p) => p.room);
  const devices = profiles.map((p) => p.device);
  return makeState({
    properties,
    rooms,
    devices,
    orders: orders.map((o, i) => makeOrder({ ...o, _profile: profiles[o._profileIndex ?? 0], _counter: i })),
    counters: { order: orders.length }
  });
}

export async function seedState(page, state) {
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: STORAGE_KEY, value: JSON.stringify(state) }
  );
}

export async function seedRaw(page, raw) {
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: STORAGE_KEY, value: raw }
  );
}
