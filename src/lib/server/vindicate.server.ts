import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

type Row = Record<string, unknown>;

type Entitlement = "basic" | "full";

type PurchaseMode = "monthly" | "yearly" | "single";

export type PlanTier = "free" | "pro_monthly" | "pro_yearly";

export interface UserSummary {
  id: string;
  email: string;
  plan: PlanTier;
  monthlyUsageCount: number;
  usageCycle: string;
  payPerUseCredits: number;
}

export interface VehicleRecord {
  id: string;
  year: number | null;
  make: string;
  model: string;
  vin: string;
  vinData: Row | null;
  manualTitle: string;
  manualPdfUrl: string;
  createdAt: string;
}

export interface ManualReference {
  title: string;
  pdfUrl: string;
  page: number;
  section: string;
}

export interface VideoLink {
  title: string;
  url: string;
}

export interface PartsStore {
  name: string;
  address: string;
  phone: string;
}

export interface PartInventoryItem {
  part: string;
  estimatedPrice: string;
  stores: PartsStore[];
}

export interface DiagnosisResult {
  probableIssue: string;
  confidence: number;
  diyTimeEstimate: string;
  difficulty: number;
  summary: string;
  repairSteps: string[];
  requiredTools: string[];
  manualReferences: ManualReference[];
  videos: VideoLink[];
  parts: PartInventoryItem[];
  localRepairShops: PartsStore[];
  entitlement: Entitlement;
}

export interface DiagnosisHistoryRecord {
  id: string;
  vehicleId: string;
  vehicleLabel: string;
  symptomText: string;
  audioLabel: string;
  photoLabel: string;
  createdAt: string;
  diagnosis: DiagnosisResult;
}

export interface DashboardData {
  user: UserSummary;
  vehicles: VehicleRecord[];
  diagnoses: DiagnosisHistoryRecord[];
}

export interface AuthResponse {
  token: string;
  user: UserSummary;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  plan: string;
  monthly_usage_count: number;
  usage_cycle: string;
  pay_per_use_credits: number;
}

interface SessionUser {
  user: UserRow;
}

interface StoreLookupContext {
  city: string;
  state: string;
  latitude: number;
  longitude: number;
}

let schemaReadyPromise: Promise<void> | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function usageCycleKey(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${String(y)}-${m}`;
}

function sqlValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function teamDb(sql: string): Promise<Row[]> {
  const proc = Bun.spawn(["team-db", sql], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, stdoutText, stderrText] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(stderrText || `team-db failed with exit code ${String(exitCode)}`);
  }

  const trimmed = stdoutText.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed as Row[];
    return [];
  } catch (error) {
    throw new Error(`Unable to parse team-db JSON. ${(error as Error).message}`);
  }
}

async function ensureSchema(): Promise<void> {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const statements = [
        `CREATE TABLE IF NOT EXISTS app_users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          plan TEXT NOT NULL DEFAULT 'free',
          monthly_usage_count INTEGER NOT NULL DEFAULT 0,
          usage_cycle TEXT NOT NULL,
          pay_per_use_credits INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS app_sessions (
          token TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS app_password_resets (
          token TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          used_at TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS app_vehicles (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          year INTEGER,
          make TEXT,
          model TEXT,
          vin TEXT,
          vin_data_json TEXT,
          manual_title TEXT,
          manual_pdf_url TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS app_diagnoses (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          vehicle_id TEXT NOT NULL,
          symptom_text TEXT NOT NULL,
          audio_label TEXT,
          photo_label TEXT,
          diagnosis_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          completed_success INTEGER
        )`,
        `CREATE TABLE IF NOT EXISTS app_payments (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          mode TEXT NOT NULL,
          amount_cents INTEGER NOT NULL,
          provider TEXT NOT NULL,
          provider_session_id TEXT,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_app_sessions_user ON app_sessions(user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_app_vehicles_user ON app_vehicles(user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_app_diagnoses_user ON app_diagnoses(user_id)`,
      ];

      for (const statement of statements) {
        await teamDb(statement);
      }
    })();
  }

  await schemaReadyPromise;
}

function parseNumber(input: unknown, fallback = 0): number {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input === "string") {
    const n = Number(input);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function asString(input: unknown): string {
  return typeof input === "string" ? input : "";
}

function toUserRow(row: Row | undefined): UserRow | null {
  if (!row) return null;
  return {
    id: asString(row.id),
    email: asString(row.email),
    password_hash: asString(row.password_hash),
    plan: asString(row.plan) || "free",
    monthly_usage_count: parseNumber(row.monthly_usage_count, 0),
    usage_cycle: asString(row.usage_cycle),
    pay_per_use_credits: parseNumber(row.pay_per_use_credits, 0),
  };
}

function toPlanTier(plan: string): PlanTier {
  if (plan === "pro_monthly" || plan === "pro_yearly") return plan;
  return "free";
}

function toUserSummary(user: UserRow): UserSummary {
  return {
    id: user.id,
    email: user.email,
    plan: toPlanTier(user.plan),
    monthlyUsageCount: user.monthly_usage_count,
    usageCycle: user.usage_cycle,
    payPerUseCredits: user.pay_per_use_credits,
  };
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, encoded: string): boolean {
  const [salt, storedHash] = encoded.split(":");
  if (!salt || !storedHash) return false;
  const computed = scryptSync(password, salt, 64);
  const stored = Buffer.from(storedHash, "hex");
  if (computed.length !== stored.length) return false;
  return timingSafeEqual(computed, stored);
}

async function getUserByEmail(email: string): Promise<UserRow | null> {
  await ensureSchema();
  const rows = await teamDb(
    `SELECT id, email, password_hash, plan, monthly_usage_count, usage_cycle, pay_per_use_credits
     FROM app_users WHERE email = ${sqlValue(email.toLowerCase())} LIMIT 1`,
  );
  return toUserRow(rows[0]);
}

async function getUserById(userId: string): Promise<UserRow | null> {
  await ensureSchema();
  const rows = await teamDb(
    `SELECT id, email, password_hash, plan, monthly_usage_count, usage_cycle, pay_per_use_credits
     FROM app_users WHERE id = ${sqlValue(userId)} LIMIT 1`,
  );
  return toUserRow(rows[0]);
}

async function updateUsageCycleIfNeeded(user: UserRow): Promise<UserRow> {
  const currentCycle = usageCycleKey();
  if (user.usage_cycle === currentCycle) return user;
  await teamDb(
    `UPDATE app_users SET usage_cycle = ${sqlValue(currentCycle)}, monthly_usage_count = 0, updated_at = ${sqlValue(nowIso())}
     WHERE id = ${sqlValue(user.id)}`,
  );
  return {
    ...user,
    usage_cycle: currentCycle,
    monthly_usage_count: 0,
  };
}

async function createSession(userId: string): Promise<string> {
  const token = randomBytes(24).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30);
  await teamDb(
    `INSERT INTO app_sessions (token, user_id, created_at, expires_at)
     VALUES (${sqlValue(token)}, ${sqlValue(userId)}, ${sqlValue(now.toISOString())}, ${sqlValue(expires.toISOString())})`,
  );
  return token;
}

async function requireSession(token: string): Promise<SessionUser> {
  await ensureSchema();
  const safeToken = token.trim();
  if (!safeToken) throw new Error("Not authenticated.");

  const rows = await teamDb(
    `SELECT u.id, u.email, u.password_hash, u.plan, u.monthly_usage_count, u.usage_cycle, u.pay_per_use_credits, s.expires_at
     FROM app_sessions s
     JOIN app_users u ON u.id = s.user_id
     WHERE s.token = ${sqlValue(safeToken)} LIMIT 1`,
  );

  const row = rows[0];
  if (!row) throw new Error("Session not found. Please login again.");

  const expiresAt = asString(row.expires_at);
  if (!expiresAt || Number.isNaN(Date.parse(expiresAt)) || Date.parse(expiresAt) < Date.now()) {
    await teamDb(`DELETE FROM app_sessions WHERE token = ${sqlValue(safeToken)}`);
    throw new Error("Session expired. Please login again.");
  }

  const user = toUserRow(row);
  if (!user) throw new Error("Unable to load account.");
  const normalized = await updateUsageCycleIfNeeded(user);
  return { user: normalized };
}

function labelForVehicle(vehicle: VehicleRecord): string {
  const bits = [vehicle.year ? String(vehicle.year) : "", vehicle.make, vehicle.model].filter(Boolean);
  return bits.length ? bits.join(" ") : vehicle.vin || "Unknown vehicle";
}

function parseVinData(raw: string): Row | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Row;
  } catch {
    return null;
  }
}

function parseDiagnosis(raw: string): DiagnosisResult {
  try {
    const parsed = JSON.parse(raw) as DiagnosisResult;
    return {
      probableIssue: parsed.probableIssue || "Unknown",
      confidence: Number(parsed.confidence) || 0,
      diyTimeEstimate: parsed.diyTimeEstimate || "Unknown",
      difficulty: Math.max(1, Math.min(10, Number(parsed.difficulty) || 5)),
      summary: parsed.summary || "",
      repairSteps: Array.isArray(parsed.repairSteps) ? parsed.repairSteps : [],
      requiredTools: Array.isArray(parsed.requiredTools) ? parsed.requiredTools : [],
      manualReferences: Array.isArray(parsed.manualReferences) ? parsed.manualReferences : [],
      videos: Array.isArray(parsed.videos) ? parsed.videos : [],
      parts: Array.isArray(parsed.parts) ? parsed.parts : [],
      localRepairShops: Array.isArray(parsed.localRepairShops) ? parsed.localRepairShops : [],
      entitlement: parsed.entitlement === "full" ? "full" : "basic",
    };
  } catch {
    return {
      probableIssue: "Unknown",
      confidence: 0,
      diyTimeEstimate: "Unknown",
      difficulty: 5,
      summary: "Unable to parse diagnosis payload.",
      repairSteps: [],
      requiredTools: [],
      manualReferences: [],
      videos: [],
      parts: [],
      localRepairShops: [],
      entitlement: "basic",
    };
  }
}

export async function createAccount(input: { email: string; password: string }): Promise<AuthResponse> {
  await ensureSchema();

  const email = input.email.trim().toLowerCase();
  const password = input.password;

  if (!email.includes("@")) throw new Error("Please provide a valid email address.");
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");

  const existing = await getUserByEmail(email);
  if (existing) throw new Error("Email already exists. Please login.");

  const id = randomUUID();
  const ts = nowIso();
  const cycle = usageCycleKey();

  await teamDb(
    `INSERT INTO app_users (id, email, password_hash, plan, monthly_usage_count, usage_cycle, pay_per_use_credits, created_at, updated_at)
     VALUES (${sqlValue(id)}, ${sqlValue(email)}, ${sqlValue(hashPassword(password))}, 'free', 0, ${sqlValue(cycle)}, 0, ${sqlValue(ts)}, ${sqlValue(ts)})`,
  );

  const token = await createSession(id);
  const user = await getUserById(id);
  if (!user) throw new Error("Account created but could not be loaded.");

  return {
    token,
    user: toUserSummary(user),
  };
}

export async function loginAccount(input: { email: string; password: string }): Promise<AuthResponse> {
  await ensureSchema();
  const email = input.email.trim().toLowerCase();
  const user = await getUserByEmail(email);
  if (!user || !verifyPassword(input.password, user.password_hash)) {
    throw new Error("Invalid email or password.");
  }

  const token = await createSession(user.id);
  const normalized = await updateUsageCycleIfNeeded(user);

  return {
    token,
    user: toUserSummary(normalized),
  };
}

export async function logoutAccount(input: { token: string }): Promise<{ ok: true }> {
  await ensureSchema();
  await teamDb(`DELETE FROM app_sessions WHERE token = ${sqlValue(input.token.trim())}`);
  return { ok: true };
}

export async function requestPasswordReset(input: { email: string }): Promise<{ message: string }> {
  await ensureSchema();
  const email = input.email.trim().toLowerCase();
  const user = await getUserByEmail(email);

  if (!user) {
    return { message: "If that account exists, a reset link has been sent." };
  }

  const token = randomBytes(18).toString("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 30).toISOString();

  await teamDb(
    `INSERT INTO app_password_resets (token, user_id, expires_at, used_at)
     VALUES (${sqlValue(token)}, ${sqlValue(user.id)}, ${sqlValue(expiresAt)}, NULL)`,
  );

  console.info(`[vindicate] Password reset token generated for ${email}: ${token}`);

  return { message: "If that account exists, a reset link has been sent." };
}

export async function resetPassword(input: { token: string; newPassword: string }): Promise<{ ok: true }> {
  await ensureSchema();
  if (input.newPassword.length < 8) throw new Error("New password must be at least 8 characters.");

  const rows = await teamDb(
    `SELECT token, user_id, expires_at, used_at
     FROM app_password_resets WHERE token = ${sqlValue(input.token.trim())} LIMIT 1`,
  );

  const row = rows[0];
  if (!row) throw new Error("Reset token not found.");

  const usedAt = asString(row.used_at);
  if (usedAt) throw new Error("Reset token was already used.");

  const expiresAt = asString(row.expires_at);
  if (!expiresAt || Date.parse(expiresAt) < Date.now()) {
    throw new Error("Reset token has expired.");
  }

  const userId = asString(row.user_id);
  if (!userId) throw new Error("Invalid reset token.");

  await teamDb(
    `UPDATE app_users SET password_hash = ${sqlValue(hashPassword(input.newPassword))}, updated_at = ${sqlValue(nowIso())}
     WHERE id = ${sqlValue(userId)}`,
  );

  await teamDb(
    `UPDATE app_password_resets SET used_at = ${sqlValue(nowIso())} WHERE token = ${sqlValue(input.token.trim())}`,
  );

  return { ok: true };
}

async function fetchVinData(vin: string): Promise<Row | null> {
  const cleaned = vin.trim().toUpperCase();
  if (!cleaned) return null;

  const url = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${encodeURIComponent(cleaned)}?format=json`;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const payload = (await response.json()) as { Results?: Row[] };
    const result = payload.Results?.[0];
    if (!result) return null;

    return {
      Make: asString(result.Make),
      Model: asString(result.Model),
      ModelYear: asString(result.ModelYear),
      VehicleType: asString(result.VehicleType),
      BodyClass: asString(result.BodyClass),
      EngineModel: asString(result.EngineModel),
      EngineHP: asString(result.EngineHP),
      FuelTypePrimary: asString(result.FuelTypePrimary),
      PlantCountry: asString(result.PlantCountry),
    };
  } catch {
    return null;
  }
}

export async function decodeVin(input: { vin: string }): Promise<{ vinData: Row | null }> {
  const vinData = await fetchVinData(input.vin);
  return { vinData };
}

export async function addVehicle(input: {
  token: string;
  year: number | null;
  make: string;
  model: string;
  vin: string;
  manualTitle: string;
  manualPdfUrl: string;
}): Promise<{ vehicle: VehicleRecord; user: UserSummary }> {
  const session = await requireSession(input.token);
  const user = session.user;

  const existingCountRows = await teamDb(
    `SELECT COUNT(*) AS count FROM app_vehicles WHERE user_id = ${sqlValue(user.id)}`,
  );
  const existingCount = parseNumber(existingCountRows[0]?.count, 0);

  if (user.plan === "free" && existingCount >= 1) {
    throw new Error("Free tier supports one vehicle. Upgrade to add unlimited vehicles.");
  }

  const vin = input.vin.trim().toUpperCase();
  const vinData = vin ? await fetchVinData(vin) : null;

  const decodedYear = parseNumber(vinData?.ModelYear, 0);
  const year = input.year || (decodedYear > 1900 ? decodedYear : null);
  const make = (input.make.trim() || asString(vinData?.Make) || "").trim();
  const model = (input.model.trim() || asString(vinData?.Model) || "").trim();

  if (!year && !make && !model && !vin) {
    throw new Error("Please provide at least VIN or year/make/model.");
  }

  const id = randomUUID();
  const ts = nowIso();
  const manualTitle = input.manualTitle.trim() || `${year ?? ""} ${make} ${model} Owner's Manual`.trim();

  await teamDb(
    `INSERT INTO app_vehicles (id, user_id, year, make, model, vin, vin_data_json, manual_title, manual_pdf_url, created_at, updated_at)
     VALUES (${sqlValue(id)}, ${sqlValue(user.id)}, ${year === null ? "NULL" : sqlValue(year)}, ${sqlValue(make)}, ${sqlValue(model)}, ${sqlValue(vin)}, ${sqlValue(vinData ? JSON.stringify(vinData) : "")}, ${sqlValue(manualTitle)}, ${sqlValue(input.manualPdfUrl.trim())}, ${sqlValue(ts)}, ${sqlValue(ts)})`,
  );

  return {
    vehicle: {
      id,
      year,
      make,
      model,
      vin,
      vinData,
      manualTitle,
      manualPdfUrl: input.manualPdfUrl.trim(),
      createdAt: ts,
    },
    user: toUserSummary(user),
  };
}

function estimatePrice(part: string): string {
  let hash = 0;
  for (let i = 0; i < part.length; i += 1) {
    hash = (hash + part.charCodeAt(i) * (i + 3)) % 300;
  }
  const low = 12 + (hash % 70);
  const high = low + 18 + (hash % 40);
  return `$${String(low)} - $${String(high)}`;
}

async function locationContextFromZip(zip: string): Promise<StoreLookupContext | null> {
  const cleaned = zip.trim();
  if (!cleaned) return null;

  try {
    const resp = await fetch(`https://api.zippopotam.us/us/${encodeURIComponent(cleaned)}`);
    if (!resp.ok) return null;
    const payload = (await resp.json()) as {
      places?: Array<{
        "place name"?: string;
        state?: string;
        latitude?: string;
        longitude?: string;
      }>;
    };

    const place = payload.places?.[0];
    if (!place) return null;

    const latitude = Number(place.latitude ?? "0");
    const longitude = Number(place.longitude ?? "0");
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    return {
      city: place["place name"] ?? "",
      state: place.state ?? "",
      latitude,
      longitude,
    };
  } catch {
    return null;
  }
}

function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "Phone unavailable";
  return trimmed;
}

interface BusinessLookupConfig {
  googleQuery: string;
  defaultName: string;
  emptyAddress: string;
  fallbackAddressPrefix: string;
  overpassFilters: string[];
}

function buildOverpassQuery(ctx: StoreLookupContext, filters: string[]): string {
  const selectors = filters
    .map(
      (filter) =>
        `node(around:16000,${String(ctx.latitude)},${String(ctx.longitude)})[${filter}];\n` +
        `  way(around:16000,${String(ctx.latitude)},${String(ctx.longitude)})[${filter}];\n` +
        `  relation(around:16000,${String(ctx.latitude)},${String(ctx.longitude)})[${filter}];`,
    )
    .join("\n  ");

  return `[out:json][timeout:25];(\n  ${selectors}\n);out center tags 30;`;
}

async function businessesFromGoogle(zip: string, query: string, defaultName: string): Promise<PartsStore[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) return [];

  try {
    const searchUrl = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
    searchUrl.searchParams.set("query", query);
    searchUrl.searchParams.set("key", key);

    const searchResp = await fetch(searchUrl.toString());
    if (!searchResp.ok) return [];

    const searchJson = (await searchResp.json()) as {
      results?: Array<{
        name?: string;
        formatted_address?: string;
        place_id?: string;
      }>;
    };

    const top = (searchJson.results ?? []).slice(0, 3);
    const stores: PartsStore[] = [];

    for (const result of top) {
      const detailsUrl = new URL("https://maps.googleapis.com/maps/api/place/details/json");
      detailsUrl.searchParams.set("key", key);
      detailsUrl.searchParams.set("place_id", result.place_id ?? "");
      detailsUrl.searchParams.set("fields", "formatted_phone_number");

      let phone = "Phone unavailable";
      if (result.place_id) {
        const detailsResp = await fetch(detailsUrl.toString());
        if (detailsResp.ok) {
          const detailsJson = (await detailsResp.json()) as {
            result?: { formatted_phone_number?: string };
          };
          phone = normalizePhone(detailsJson.result?.formatted_phone_number ?? "");
        }
      }

      stores.push({
        name: result.name ?? defaultName,
        address: result.formatted_address ?? `Near ${zip}`,
        phone,
      });
    }

    return stores;
  } catch {
    return [];
  }
}

async function businessesFromOverpass(zip: string, defaultName: string, overpassFilters: string[]): Promise<PartsStore[]> {
  const ctx = await locationContextFromZip(zip);
  if (!ctx) return [];

  try {
    const resp = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
      },
      body: buildOverpassQuery(ctx, overpassFilters),
    });

    if (!resp.ok) return [];

    const payload = (await resp.json()) as {
      elements?: Array<{
        tags?: Record<string, string>;
      }>;
    };

    const stores: PartsStore[] = [];

    for (const element of payload.elements ?? []) {
      const tags = element.tags ?? {};
      const name = tags.name || defaultName;
      const address = [tags["addr:housenumber"], tags["addr:street"], tags["addr:city"], tags["addr:state"]]
        .filter(Boolean)
        .join(" ");
      const phone = normalizePhone(tags.phone || tags["contact:phone"] || "");

      stores.push({
        name,
        address: address || `${ctx.city}, ${ctx.state}`,
        phone,
      });

      if (stores.length >= 3) break;
    }

    return stores;
  } catch {
    return [];
  }
}

async function lookupNearbyBusinesses(zip: string, config: BusinessLookupConfig): Promise<PartsStore[]> {
  const cleaned = zip.trim();
  if (!cleaned) {
    return [
      {
        name: config.defaultName,
        address: config.emptyAddress,
        phone: "Phone unavailable",
      },
    ];
  }

  const google = await businessesFromGoogle(cleaned, config.googleQuery, config.defaultName);
  if (google.length) return google;

  const overpass = await businessesFromOverpass(cleaned, config.defaultName, config.overpassFilters);
  if (overpass.length) return overpass;

  return [
    {
      name: config.defaultName,
      address: `${config.fallbackAddressPrefix} ${cleaned}`,
      phone: "Phone unavailable",
    },
  ];
}

async function lookupPartsStores(zip: string): Promise<PartsStore[]> {
  return lookupNearbyBusinesses(zip, {
    googleQuery: `auto parts store in ${zip}`,
    defaultName: "Local Auto Parts",
    emptyAddress: "Enter a ZIP for local store results",
    fallbackAddressPrefix: "Near ZIP",
    overpassFilters: ['"shop"="car_parts"'],
  });
}

async function lookupRepairShops(zip: string): Promise<PartsStore[]> {
  return lookupNearbyBusinesses(zip, {
    googleQuery: `auto repair shop in ${zip}`,
    defaultName: "Local Repair Shop",
    emptyAddress: "Enter a ZIP for local repair shop results",
    fallbackAddressPrefix: "Near ZIP",
    overpassFilters: ['"amenity"="car_repair"', '"shop"="car_repair"', '"craft"="car_repair"'],
  });
}

async function youtubeResults(query: string): Promise<VideoLink[]> {
  const key = process.env.YOUTUBE_API_KEY?.trim();

  if (!key) {
    const variants = [
      `${query} diagnosis and fix`,
      `${query} DIY repair`,
      `${query} step by step`,
    ];
    return variants.map((q) => ({
      title: q,
      url: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
    }));
  }

  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("key", key);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("maxResults", "3");
    url.searchParams.set("type", "video");
    url.searchParams.set("q", query);

    const response = await fetch(url.toString());
    if (!response.ok) return [];

    const payload = (await response.json()) as {
      items?: Array<{
        id?: { videoId?: string };
        snippet?: { title?: string };
      }>;
    };

    return (payload.items ?? [])
      .map((item) => ({
        title: item.snippet?.title ?? "YouTube repair video",
        url: `https://www.youtube.com/watch?v=${item.id?.videoId ?? ""}`,
      }))
      .filter((item) => item.url.endsWith("=") === false);
  } catch {
    return [];
  }
}

interface DiagnosisTemplate {
  issue: string;
  confidence: number;
  summary: string;
  diyTime: string;
  difficulty: number;
  tools: string[];
  steps: string[];
  parts: string[];
  localShops: PartsStore[];
  manualSections: Array<{ page: number; section: string }>;
}

function heuristicDiagnosis(symptoms: string): DiagnosisTemplate {
  const text = symptoms.toLowerCase();

  if (text.includes("won't start") || text.includes("wont start") || text.includes("clicking") || text.includes("dead battery")) {
    return {
      issue: "Weak battery, corroded terminals, or charging-system fault",
      confidence: 0.78,
      summary: "No-start and clicking symptoms often indicate low battery voltage or poor battery cable contact.",
      diyTime: "45-90 minutes",
      difficulty: 4,
      tools: ["Digital multimeter", "10mm wrench", "Battery terminal brush", "Safety gloves"],
      steps: [
        "Measure battery voltage with engine off; if below 12.4V, charge/test battery.",
        "Inspect battery terminals for corrosion and clean them.",
        "Crank engine while monitoring voltage drop; if severe, replace battery.",
        "If battery tests good, test alternator output at idle and under load.",
      ],
      parts: ["12V battery", "Battery terminal cleaner", "Alternator belt"],
      localShops: [],
      manualSections: [
        { page: 312, section: "Battery inspection" },
        { page: 318, section: "Charging system test" },
      ],
    };
  }

  if (text.includes("overheat") || text.includes("hot") || text.includes("coolant") || text.includes("steam")) {
    return {
      issue: "Cooling system issue (low coolant, stuck thermostat, or fan fault)",
      confidence: 0.74,
      summary: "Overheating generally traces to low coolant level, circulation restrictions, or radiator fan problems.",
      diyTime: "2-3 hours",
      difficulty: 6,
      tools: ["Coolant pressure tester", "Socket set", "Drain pan", "Safety glasses"],
      steps: [
        "Verify coolant level in radiator/overflow after engine cools completely.",
        "Pressure-test cooling system and inspect hoses/radiator for leaks.",
        "Check thermostat opening behavior and radiator fan operation.",
        "Refill with manufacturer-specified coolant and bleed air pockets.",
      ],
      parts: ["Thermostat", "Coolant", "Upper radiator hose"],
      localShops: [],
      manualSections: [
        { page: 226, section: "Cooling system diagram" },
        { page: 229, section: "Thermostat replacement" },
      ],
    };
  }

  if (text.includes("brake") || text.includes("squeal") || text.includes("grind")) {
    return {
      issue: "Worn brake pads or rotor surface damage",
      confidence: 0.8,
      summary: "Squealing or grinding while braking usually means friction material is near or below minimum thickness.",
      diyTime: "1-2 hours",
      difficulty: 5,
      tools: ["Floor jack", "Jack stands", "Lug wrench", "C-clamp", "Torque wrench"],
      steps: [
        "Lift vehicle safely and remove wheel on noisy corner.",
        "Inspect pad thickness and rotor condition for grooves/heat spots.",
        "Replace pads; machine/replace rotors if below spec or severely scored.",
        "Torque wheel lugs to spec and bed in new pads with gentle stops.",
      ],
      parts: ["Brake pad set", "Brake rotor", "Brake cleaner"],
      localShops: [],
      manualSections: [
        { page: 404, section: "Front brake inspection" },
        { page: 410, section: "Pad replacement" },
      ],
    };
  }

  if (text.includes("rough idle") || text.includes("misfire") || text.includes("shaking")) {
    return {
      issue: "Ignition or air-fuel imbalance causing misfire",
      confidence: 0.69,
      summary: "Rough idle often comes from worn spark plugs, vacuum leaks, or dirty throttle/intake components.",
      diyTime: "60-120 minutes",
      difficulty: 4,
      tools: ["OBD-II scanner", "Spark plug socket", "Torque wrench", "Vacuum gauge"],
      steps: [
        "Scan for active/stored diagnostic trouble codes.",
        "Inspect spark plugs and ignition coils for wear or contamination.",
        "Inspect intake/vacuum lines for leaks and clean throttle body.",
        "Clear codes and verify idle stability in a test run.",
      ],
      parts: ["Spark plugs", "Ignition coil", "Air filter"],
      localShops: [],
      manualSections: [
        { page: 145, section: "Engine misfire diagnosis" },
        { page: 152, section: "Spark plug service" },
      ],
    };
  }

  return {
    issue: "General drivability issue requiring baseline inspection",
    confidence: 0.55,
    summary: "Symptoms are broad. Start with fluid levels, scan codes, and visible wear checks.",
    diyTime: "1-3 hours",
    difficulty: 5,
    tools: ["OBD-II scanner", "Flashlight", "Basic socket set", "Multimeter"],
    steps: [
      "Run a complete OBD-II scan and note any fault codes.",
      "Inspect fluids, belts, hoses, and battery connections.",
      "Test-drive briefly to reproduce symptom and identify trigger conditions.",
      "Perform component tests relevant to any discovered codes.",
    ],
    parts: ["Engine oil", "Air filter", "Fuses"],
    localShops: [],
    manualSections: [
      { page: 98, section: "Troubleshooting basics" },
      { page: 104, section: "Diagnostic flowchart" },
    ],
  };
}

interface LlmDiagnosis {
  issue: string;
  confidence: number;
  summary: string;
  diyTime: string;
  difficulty: number;
  tools: string[];
  steps: string[];
  parts: string[];
}

async function llmDiagnosis(input: {
  vehicleLabel: string;
  symptomText: string;
  audioLabel: string;
  photoLabel: string;
}): Promise<LlmDiagnosis | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;

  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";

  const prompt = [
    "You are an automotive diagnostics assistant.",
    "Return strict JSON with keys: issue, confidence (0-1), summary, diyTime (string), difficulty (1-10), tools (array), steps (array), parts (array).",
    `Vehicle: ${input.vehicleLabel}`,
    `Symptoms: ${input.symptomText}`,
    `Audio hint: ${input.audioLabel || "none"}`,
    `Photo hint: ${input.photoLabel || "none"}`,
  ].join("\n");

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "Respond with valid JSON only." },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) return null;
    const payload = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string };
      }>;
    };

    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content) as Partial<LlmDiagnosis>;
    if (!parsed.issue || !Array.isArray(parsed.steps) || !Array.isArray(parsed.tools) || !Array.isArray(parsed.parts)) {
      return null;
    }

    return {
      issue: parsed.issue,
      confidence: Number(parsed.confidence) > 0 ? Number(parsed.confidence) : 0.6,
      summary: parsed.summary || "AI-generated analysis.",
      diyTime: parsed.diyTime ? String(parsed.diyTime) : "1-2 hours",
      difficulty: Math.max(1, Math.min(10, Number(parsed.difficulty) || 5)),
      tools: parsed.tools.map((item) => String(item)),
      steps: parsed.steps.map((item) => String(item)),
      parts: parsed.parts.map((item) => String(item)),
    };
  } catch {
    return null;
  }
}

function manualReferenceTitle(vehicle: VehicleRecord): string {
  if (vehicle.manualTitle) return vehicle.manualTitle;
  return `${labelForVehicle(vehicle)} Owner's Manual`;
}

function manualReferenceUrl(vehicle: VehicleRecord): string {
  if (vehicle.manualPdfUrl) return vehicle.manualPdfUrl;
  const query = `${labelForVehicle(vehicle)} owner manual pdf`;
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

async function buildDiagnosisResult(input: {
  vehicle: VehicleRecord;
  symptomText: string;
  audioLabel: string;
  photoLabel: string;
  zipCode: string;
  entitlement: Entitlement;
}): Promise<DiagnosisResult> {
  const fallback = heuristicDiagnosis(input.symptomText);

  const ai = await llmDiagnosis({
    vehicleLabel: labelForVehicle(input.vehicle),
    symptomText: input.symptomText,
    audioLabel: input.audioLabel,
    photoLabel: input.photoLabel,
  });

  const issue = ai?.issue ?? fallback.issue;
  const confidence = Math.max(0.05, Math.min(0.99, ai?.confidence ?? fallback.confidence));
  const summary = ai?.summary ?? fallback.summary;
  const diyTimeEstimate = ai?.diyTime ?? fallback.diyTime;
  const difficulty = Math.max(1, Math.min(10, ai?.difficulty ?? fallback.difficulty));
  const tools = ai?.tools?.length ? ai.tools : fallback.tools;
  const steps = ai?.steps?.length ? ai.steps : fallback.steps;
  const partsList = ai?.parts?.length ? ai.parts : fallback.parts;

  const references: ManualReference[] = fallback.manualSections.map((entry) => ({
    title: manualReferenceTitle(input.vehicle),
    pdfUrl: manualReferenceUrl(input.vehicle),
    page: entry.page,
    section: entry.section,
  }));

  const videos = await youtubeResults(`${labelForVehicle(input.vehicle)} ${issue}`);
  const stores = await lookupPartsStores(input.zipCode);
  const repairShops = await lookupRepairShops(input.zipCode);

  const parts: PartInventoryItem[] = partsList.map((part) => ({
    part,
    estimatedPrice: estimatePrice(part),
    stores,
  }));

  if (input.entitlement === "basic") {
    return {
      probableIssue: issue,
      confidence,
      diyTimeEstimate,
      difficulty,
      summary,
      repairSteps: steps,
      requiredTools: [],
      manualReferences: [],
      videos: [],
      parts: [],
      localRepairShops: [],
      entitlement: "basic",
    };
  }

  return {
    probableIssue: issue,
    confidence,
    diyTimeEstimate,
    difficulty,
    summary,
    repairSteps: steps,
    requiredTools: tools,
    manualReferences: references,
    videos,
    parts,
    localRepairShops: repairShops.length ? repairShops : fallback.localShops,
    entitlement: "full",
  };
}

function randomUUID(): string {
  return crypto.randomUUID();
}

async function getVehicleForUser(userId: string, vehicleId: string): Promise<VehicleRecord | null> {
  const rows = await teamDb(
    `SELECT id, year, make, model, vin, vin_data_json, manual_title, manual_pdf_url, created_at
     FROM app_vehicles
     WHERE id = ${sqlValue(vehicleId)} AND user_id = ${sqlValue(userId)} LIMIT 1`,
  );

  const row = rows[0];
  if (!row) return null;

  return {
    id: asString(row.id),
    year: row.year === null || row.year === undefined ? null : parseNumber(row.year, 0),
    make: asString(row.make),
    model: asString(row.model),
    vin: asString(row.vin),
    vinData: parseVinData(asString(row.vin_data_json)),
    manualTitle: asString(row.manual_title),
    manualPdfUrl: asString(row.manual_pdf_url),
    createdAt: asString(row.created_at),
  };
}

async function consumeDiagnosisEntitlement(user: UserRow): Promise<{ updated: UserRow; entitlement: Entitlement }> {
  if (user.plan === "pro_monthly" || user.plan === "pro_yearly") {
    return {
      updated: user,
      entitlement: "full",
    };
  }

  if (user.pay_per_use_credits > 0) {
    const updatedCredits = user.pay_per_use_credits - 1;
    await teamDb(
      `UPDATE app_users SET pay_per_use_credits = ${sqlValue(updatedCredits)}, updated_at = ${sqlValue(nowIso())}
       WHERE id = ${sqlValue(user.id)}`,
    );

    return {
      updated: {
        ...user,
        pay_per_use_credits: updatedCredits,
      },
      entitlement: "full",
    };
  }

  if (user.monthly_usage_count >= 3) {
    throw new Error("Free tier limit reached (3 diagnoses/month). Upgrade or buy a single diagnosis.");
  }

  const updatedUsage = user.monthly_usage_count + 1;
  await teamDb(
    `UPDATE app_users SET monthly_usage_count = ${sqlValue(updatedUsage)}, updated_at = ${sqlValue(nowIso())}
     WHERE id = ${sqlValue(user.id)}`,
  );

  return {
    updated: {
      ...user,
      monthly_usage_count: updatedUsage,
    },
    entitlement: "basic",
  };
}

export async function runDiagnosis(input: {
  token: string;
  vehicleId: string;
  symptomText: string;
  audioLabel: string;
  photoLabel: string;
  zipCode: string;
}): Promise<{ diagnosis: DiagnosisResult; user: UserSummary }> {
  const session = await requireSession(input.token);
  const user = session.user;

  const symptomText = input.symptomText.trim();
  if (!symptomText) throw new Error("Please describe the symptom before diagnosing.");

  const vehicle = await getVehicleForUser(user.id, input.vehicleId.trim());
  if (!vehicle) throw new Error("Vehicle not found.");

  const entitlement = await consumeDiagnosisEntitlement(user);

  const diagnosis = await buildDiagnosisResult({
    vehicle,
    symptomText,
    audioLabel: input.audioLabel.trim(),
    photoLabel: input.photoLabel.trim(),
    zipCode: input.zipCode.trim(),
    entitlement: entitlement.entitlement,
  });

  const diagnosisId = randomUUID();
  await teamDb(
    `INSERT INTO app_diagnoses (id, user_id, vehicle_id, symptom_text, audio_label, photo_label, diagnosis_json, created_at, completed_success)
     VALUES (${sqlValue(diagnosisId)}, ${sqlValue(user.id)}, ${sqlValue(vehicle.id)}, ${sqlValue(symptomText)}, ${sqlValue(input.audioLabel.trim())}, ${sqlValue(input.photoLabel.trim())}, ${sqlValue(JSON.stringify(diagnosis))}, ${sqlValue(nowIso())}, NULL)`,
  );

  return {
    diagnosis,
    user: toUserSummary(entitlement.updated),
  };
}

function purchaseDetails(mode: PurchaseMode): { amountCents: number; plan: PlanTier | null; credits: number } {
  switch (mode) {
    case "monthly":
      return { amountCents: 999, plan: "pro_monthly", credits: 0 };
    case "yearly":
      return { amountCents: 9900, plan: "pro_yearly", credits: 0 };
    case "single":
      return { amountCents: 499, plan: null, credits: 1 };
    default:
      return { amountCents: 0, plan: null, credits: 0 };
  }
}

async function applyPurchase(user: UserRow, mode: PurchaseMode): Promise<UserRow> {
  const details = purchaseDetails(mode);

  let nextPlan = user.plan;
  let nextCredits = user.pay_per_use_credits;

  if (details.plan) nextPlan = details.plan;
  nextCredits += details.credits;

  await teamDb(
    `UPDATE app_users SET plan = ${sqlValue(nextPlan)}, pay_per_use_credits = ${sqlValue(nextCredits)}, updated_at = ${sqlValue(nowIso())}
     WHERE id = ${sqlValue(user.id)}`,
  );

  return {
    ...user,
    plan: nextPlan,
    pay_per_use_credits: nextCredits,
  };
}

async function createStripeCheckout(input: {
  user: UserRow;
  mode: PurchaseMode;
  origin: string;
}): Promise<{ checkoutUrl: string | null; providerSessionId: string | null }> {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) return { checkoutUrl: null, providerSessionId: null };

  const priceMap: Record<PurchaseMode, string | undefined> = {
    monthly: process.env.STRIPE_PRICE_MONTHLY,
    yearly: process.env.STRIPE_PRICE_YEARLY,
    single: process.env.STRIPE_PRICE_SINGLE,
  };

  const price = priceMap[input.mode]?.trim();
  if (!price) return { checkoutUrl: null, providerSessionId: null };

  const params = new URLSearchParams();
  params.set("mode", input.mode === "single" ? "payment" : "subscription");
  params.set("customer_email", input.user.email);
  params.set("success_url", `${input.origin}/?checkout=success`);
  params.set("cancel_url", `${input.origin}/?checkout=cancel`);
  params.set("line_items[0][price]", price);
  params.set("line_items[0][quantity]", "1");
  params.set("metadata[user_id]", input.user.id);
  params.set("metadata[purchase_mode]", input.mode);

  try {
    const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!resp.ok) return { checkoutUrl: null, providerSessionId: null };
    const payload = (await resp.json()) as { id?: string; url?: string };

    return {
      checkoutUrl: payload.url ?? null,
      providerSessionId: payload.id ?? null,
    };
  } catch {
    return { checkoutUrl: null, providerSessionId: null };
  }
}

export async function startPurchase(input: {
  token: string;
  mode: PurchaseMode;
  origin: string;
  simulate: boolean;
}): Promise<{ checkoutUrl: string | null; user: UserSummary; message: string }> {
  const session = await requireSession(input.token);
  const user = session.user;

  const stripe = await createStripeCheckout({
    user,
    mode: input.mode,
    origin: input.origin,
  });

  const details = purchaseDetails(input.mode);
  const paymentId = randomUUID();

  if (stripe.checkoutUrl && !input.simulate) {
    await teamDb(
      `INSERT INTO app_payments (id, user_id, mode, amount_cents, provider, provider_session_id, status, created_at)
       VALUES (${sqlValue(paymentId)}, ${sqlValue(user.id)}, ${sqlValue(input.mode)}, ${sqlValue(details.amountCents)}, 'stripe', ${sqlValue(stripe.providerSessionId ?? "")}, 'pending', ${sqlValue(nowIso())})`,
    );

    return {
      checkoutUrl: stripe.checkoutUrl,
      user: toUserSummary(user),
      message: "Stripe checkout created. Complete payment, then confirm via webhook integration.",
    };
  }

  const updated = await applyPurchase(user, input.mode);

  await teamDb(
    `INSERT INTO app_payments (id, user_id, mode, amount_cents, provider, provider_session_id, status, created_at)
     VALUES (${sqlValue(paymentId)}, ${sqlValue(user.id)}, ${sqlValue(input.mode)}, ${sqlValue(details.amountCents)}, ${sqlValue(stripe.checkoutUrl ? "stripe-simulated" : "simulated")}, ${sqlValue(stripe.providerSessionId ?? "")}, 'completed', ${sqlValue(nowIso())})`,
  );

  return {
    checkoutUrl: null,
    user: toUserSummary(updated),
    message: stripe.checkoutUrl
      ? "Stripe is configured, but this environment used simulated completion for MVP flow."
      : "Simulated purchase complete for MVP testing.",
  };
}

export async function getDashboard(input: { token: string }): Promise<DashboardData> {
  const session = await requireSession(input.token);
  const user = session.user;

  const vehicleRows = await teamDb(
    `SELECT id, year, make, model, vin, vin_data_json, manual_title, manual_pdf_url, created_at
     FROM app_vehicles WHERE user_id = ${sqlValue(user.id)}
     ORDER BY created_at DESC`,
  );

  const vehicles: VehicleRecord[] = vehicleRows.map((row) => ({
    id: asString(row.id),
    year: row.year === null || row.year === undefined ? null : parseNumber(row.year, 0),
    make: asString(row.make),
    model: asString(row.model),
    vin: asString(row.vin),
    vinData: parseVinData(asString(row.vin_data_json)),
    manualTitle: asString(row.manual_title),
    manualPdfUrl: asString(row.manual_pdf_url),
    createdAt: asString(row.created_at),
  }));

  const vehicleMap = new Map<string, VehicleRecord>();
  for (const vehicle of vehicles) {
    vehicleMap.set(vehicle.id, vehicle);
  }

  const diagnosisRows = await teamDb(
    `SELECT id, vehicle_id, symptom_text, audio_label, photo_label, diagnosis_json, created_at
     FROM app_diagnoses WHERE user_id = ${sqlValue(user.id)}
     ORDER BY created_at DESC LIMIT 40`,
  );

  const diagnoses: DiagnosisHistoryRecord[] = diagnosisRows.map((row) => {
    const vehicleId = asString(row.vehicle_id);
    const vehicle = vehicleMap.get(vehicleId);
    return {
      id: asString(row.id),
      vehicleId,
      vehicleLabel: vehicle ? labelForVehicle(vehicle) : "Unknown vehicle",
      symptomText: asString(row.symptom_text),
      audioLabel: asString(row.audio_label),
      photoLabel: asString(row.photo_label),
      createdAt: asString(row.created_at),
      diagnosis: parseDiagnosis(asString(row.diagnosis_json)),
    };
  });

  return {
    user: toUserSummary(user),
    vehicles,
    diagnoses,
  };
}
