import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import {
  addVehicle,
  createAccount,
  decodeVin,
  getDashboard,
  loginAccount,
  logoutAccount,
  requestPasswordReset,
  resetPassword,
  runDiagnosis,
  startPurchase,
  type DashboardData,
  type DiagnosisResult,
  type PlanTier,
} from "~/lib/server/vindicate.server";

const signUpFn = createServerFn({ method: "POST" })
  .validator((data: { email: string; password: string }) => data)
  .handler(async ({ data }) => createAccount(data));

const loginFn = createServerFn({ method: "POST" })
  .validator((data: { email: string; password: string }) => data)
  .handler(async ({ data }) => loginAccount(data));

const logoutFn = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => logoutAccount(data));

const requestResetFn = createServerFn({ method: "POST" })
  .validator((data: { email: string }) => data)
  .handler(async ({ data }) => requestPasswordReset(data));

const resetPasswordFn = createServerFn({ method: "POST" })
  .validator((data: { token: string; newPassword: string }) => data)
  .handler(async ({ data }) => resetPassword(data));

const dashboardFn = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => getDashboard(data));

const decodeVinFn = createServerFn({ method: "POST" })
  .validator((data: { vin: string }) => data)
  .handler(async ({ data }) => decodeVin(data));

const addVehicleFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      token: string;
      year: number | null;
      make: string;
      model: string;
      vin: string;
      manualTitle: string;
      manualPdfUrl: string;
    }) => data,
  )
  .handler(async ({ data }) => addVehicle(data));

const runDiagnosisFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      token: string;
      vehicleId: string;
      symptomText: string;
      audioLabel: string;
      photoLabel: string;
      zipCode: string;
    }) => data,
  )
  .handler(async ({ data }) => runDiagnosis(data));

const startPurchaseFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      token: string;
      mode: "monthly" | "yearly" | "single";
      origin: string;
      simulate: boolean;
    }) => data,
  )
  .handler(async ({ data }) => startPurchase(data));

export const Route = createFileRoute("/")({
  component: Home,
});

type AuthMode = "login" | "signup" | "request-reset" | "reset";

const TOKEN_KEY = "vindicate-session-token";

function planLabel(plan: PlanTier): string {
  switch (plan) {
    case "pro_monthly":
      return "Pro Monthly";
    case "pro_yearly":
      return "Pro Yearly";
    default:
      return "Free";
  }
}

function formatDateTime(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function vehicleLabel(vehicle: DashboardData["vehicles"][number]): string {
  const bits = [vehicle.year ? String(vehicle.year) : "", vehicle.make, vehicle.model].filter(Boolean);
  if (bits.length) return bits.join(" ");
  return vehicle.vin || "Unnamed vehicle";
}

function Home() {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState("");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [latestDiagnosis, setLatestDiagnosis] = useState<DiagnosisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [vin, setVin] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [manualPdfUrl, setManualPdfUrl] = useState("");

  const [vehicleId, setVehicleId] = useState("");
  const [symptomText, setSymptomText] = useState("");
  const [audioLabel, setAudioLabel] = useState("");
  const [photoLabel, setPhotoLabel] = useState("");
  const [zipCode, setZipCode] = useState("");

  const hasSession = token.length > 0;

  const clearMessages = useCallback(() => {
    setError("");
    setNotice("");
  }, []);

  const refreshDashboard = useCallback(
    async (sessionToken: string) => {
      if (!sessionToken) return;
      const payload = await dashboardFn({ data: { token: sessionToken } });
      setDashboard(payload);
    },
    [],
  );

  useEffect(() => {
    const stored = globalThis.localStorage?.getItem(TOKEN_KEY) ?? "";
    if (stored) setToken(stored);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || !token) return;
    void refreshDashboard(token).catch((err: unknown) => {
      setError((err as Error).message || "Could not load dashboard.");
      setToken("");
      setDashboard(null);
      globalThis.localStorage?.removeItem(TOKEN_KEY);
    });
  }, [ready, token, refreshDashboard]);

  useEffect(() => {
    if (dashboard?.vehicles.length && !vehicleId) {
      setVehicleId(dashboard.vehicles[0]?.id ?? "");
    }
  }, [dashboard, vehicleId]);

  const usageHint = useMemo(() => {
    if (!dashboard) return "";
    if (dashboard.user.plan === "free") {
      return `Free tier: ${String(dashboard.user.monthlyUsageCount)}/3 diagnoses used this cycle (${dashboard.user.usageCycle}).`;
    }
    return "Unlimited diagnoses enabled by subscription.";
  }, [dashboard]);

  const handleAuth = useCallback(
    async (mode: "login" | "signup") => {
      clearMessages();
      setBusy(true);
      try {
        const action = mode === "login" ? loginFn : signUpFn;
        const response = await action({ data: { email, password } });
        setToken(response.token);
        globalThis.localStorage?.setItem(TOKEN_KEY, response.token);
        setPassword("");
        await refreshDashboard(response.token);
        setNotice(mode === "login" ? "Logged in." : "Account created and logged in.");
      } catch (err: unknown) {
        setError((err as Error).message || "Authentication failed.");
      } finally {
        setBusy(false);
      }
    },
    [clearMessages, email, password, refreshDashboard],
  );

  const handleLogout = useCallback(async () => {
    clearMessages();
    if (!token) return;
    setBusy(true);
    try {
      await logoutFn({ data: { token } });
    } catch {
      // Ignore logout failures and still clear local session.
    } finally {
      globalThis.localStorage?.removeItem(TOKEN_KEY);
      setToken("");
      setDashboard(null);
      setLatestDiagnosis(null);
      setBusy(false);
    }
  }, [clearMessages, token]);

  const handleRequestReset = useCallback(async () => {
    clearMessages();
    setBusy(true);
    try {
      const response = await requestResetFn({ data: { email: resetEmail } });
      setResetToken(response.resetToken);
      setNotice("Password reset token generated (demo mode). Use it in the form below.");
      setAuthMode("reset");
    } catch (err: unknown) {
      setError((err as Error).message || "Unable to request password reset.");
    } finally {
      setBusy(false);
    }
  }, [clearMessages, resetEmail]);

  const handleResetPassword = useCallback(async () => {
    clearMessages();
    setBusy(true);
    try {
      await resetPasswordFn({ data: { token: resetToken, newPassword } });
      setNotice("Password updated. Please login.");
      setAuthMode("login");
      setNewPassword("");
    } catch (err: unknown) {
      setError((err as Error).message || "Could not reset password.");
    } finally {
      setBusy(false);
    }
  }, [clearMessages, newPassword, resetToken]);

  const handleDecodeVin = useCallback(async () => {
    clearMessages();
    if (!vin.trim()) {
      setError("Enter a VIN first.");
      return;
    }
    setBusy(true);
    try {
      const response = await decodeVinFn({ data: { vin } });
      const vinData = response.vinData;
      if (!vinData) {
        setNotice("VIN decoded with limited data.");
        return;
      }
      if (!make) setMake(String(vinData.Make ?? ""));
      if (!model) setModel(String(vinData.Model ?? ""));
      if (!year) {
        const decodedYear = Number(vinData.ModelYear ?? "0");
        if (Number.isFinite(decodedYear) && decodedYear > 1900) {
          setYear(String(decodedYear));
        }
      }
      setNotice("VIN decoded successfully.");
    } catch (err: unknown) {
      setError((err as Error).message || "VIN decode failed.");
    } finally {
      setBusy(false);
    }
  }, [clearMessages, make, model, vin, year]);

  const handleAddVehicle = useCallback(async () => {
    clearMessages();
    if (!token) return;
    setBusy(true);
    try {
      await addVehicleFn({
        data: {
          token,
          year: year.trim() ? Number(year) : null,
          make,
          model,
          vin,
          manualTitle,
          manualPdfUrl,
        },
      });
      setYear("");
      setMake("");
      setModel("");
      setVin("");
      setManualTitle("");
      setManualPdfUrl("");
      await refreshDashboard(token);
      setNotice("Vehicle added to Garage.");
    } catch (err: unknown) {
      setError((err as Error).message || "Unable to add vehicle.");
    } finally {
      setBusy(false);
    }
  }, [clearMessages, make, manualPdfUrl, manualTitle, model, refreshDashboard, token, vin, year]);

  const handleRunDiagnosis = useCallback(async () => {
    clearMessages();
    if (!token) return;
    setBusy(true);
    try {
      const response = await runDiagnosisFn({
        data: {
          token,
          vehicleId,
          symptomText,
          audioLabel,
          photoLabel,
          zipCode,
        },
      });
      setLatestDiagnosis(response.diagnosis);
      setSymptomText("");
      setAudioLabel("");
      setPhotoLabel("");
      await refreshDashboard(token);
      if (response.diagnosis.entitlement === "basic") {
        setNotice("Diagnosis complete. Free tier shows text-only guidance.");
      } else {
        setNotice("Diagnosis complete with manuals, tools, parts, and videos.");
      }
    } catch (err: unknown) {
      setError((err as Error).message || "Diagnosis failed.");
    } finally {
      setBusy(false);
    }
  }, [audioLabel, clearMessages, photoLabel, refreshDashboard, symptomText, token, vehicleId, zipCode]);

  const handlePurchase = useCallback(
    async (mode: "monthly" | "yearly" | "single") => {
      clearMessages();
      if (!token) return;
      setBusy(true);
      try {
        const response = await startPurchaseFn({
          data: {
            token,
            mode,
            origin: globalThis.location?.origin ?? "http://localhost:3000",
            simulate: true,
          },
        });
        if (response.checkoutUrl) {
          globalThis.open(response.checkoutUrl, "_blank", "noopener,noreferrer");
        }
        await refreshDashboard(token);
        setNotice(response.message);
      } catch (err: unknown) {
        setError((err as Error).message || "Purchase failed.");
      } finally {
        setBusy(false);
      }
    },
    [clearMessages, refreshDashboard, token],
  );

  if (!ready) {
    return <main className="mx-auto max-w-5xl p-6">Loading VINdicate...</main>;
  }

  return (
    <main className="mx-auto min-h-dvh max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <header className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">VINdicate</p>
            <h1 className="text-3xl font-bold">Universal Vehicle Diagnostic MVP</h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              Diagnose by audio, photo, or text. Get repair steps, tools, manuals, videos, parts stores, and Garage history.
            </p>
          </div>
          {hasSession ? (
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              Logout
            </button>
          ) : null}
        </div>
      </header>

      {error ? (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          {notice}
        </div>
      ) : null}

      {!hasSession || !dashboard ? (
        <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <h2 className="mb-3 text-xl font-semibold">Authentication</h2>
            <div className="mb-4 flex flex-wrap gap-2">
              {([
                ["login", "Login"],
                ["signup", "Sign Up"],
                ["request-reset", "Request Reset"],
                ["reset", "Reset Password"],
              ] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setAuthMode(mode)}
                  className={`rounded-md px-3 py-1.5 text-sm ${
                    authMode === mode
                      ? "bg-indigo-600 text-white"
                      : "border border-gray-300 text-gray-700 dark:border-gray-700 dark:text-gray-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {authMode === "login" || authMode === "signup" ? (
              <div className="space-y-3">
                <label className="block text-sm font-medium">Email</label>
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-950"
                />
                <label className="block text-sm font-medium">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="At least 8 characters"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-950"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleAuth(authMode)}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
                >
                  {authMode === "login" ? "Login" : "Create account"}
                </button>
              </div>
            ) : null}

            {authMode === "request-reset" ? (
              <div className="space-y-3">
                <label className="block text-sm font-medium">Account email</label>
                <input
                  value={resetEmail}
                  onChange={(event) => setResetEmail(event.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-950"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleRequestReset()}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
                >
                  Generate reset token
                </button>
              </div>
            ) : null}

            {authMode === "reset" ? (
              <div className="space-y-3">
                <label className="block text-sm font-medium">Reset token</label>
                <input
                  value={resetToken}
                  onChange={(event) => setResetToken(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-950"
                />
                <label className="block text-sm font-medium">New password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-950"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleResetPassword()}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
                >
                  Reset password
                </button>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <h2 className="mb-3 text-xl font-semibold">Plans</h2>
            <ul className="space-y-2 text-sm">
              <li>
                <strong>Free:</strong> 3 diagnoses/mo, 1 vehicle, text-only guidance.
              </li>
              <li>
                <strong>Subscription:</strong> $9.99/mo or $99/yr for unlimited diagnoses, manuals, videos, parts scan, full Garage.
              </li>
              <li>
                <strong>Pay-per-use:</strong> $4.99 for one full diagnosis credit.
              </li>
            </ul>
          </div>
        </section>
      ) : (
        <section className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <h2 className="text-xl font-semibold">Account & Entitlements</h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Signed in as {dashboard.user.email}</p>
              <p className="mt-2 inline-flex rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                {planLabel(dashboard.user.plan)}
              </p>
              <p className="mt-3 text-sm">{usageHint}</p>
              <p className="mt-1 text-sm">Pay-per-use credits: {String(dashboard.user.payPerUseCredits)}</p>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handlePurchase("single")}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
                >
                  Buy 1 Diagnosis ($4.99)
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handlePurchase("monthly")}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
                >
                  Upgrade Monthly ($9.99)
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handlePurchase("yearly")}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
                >
                  Upgrade Yearly ($99)
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <h2 className="text-xl font-semibold">Garage Snapshot</h2>
              <p className="mt-2 text-sm">Vehicles: {String(dashboard.vehicles.length)}</p>
              <p className="text-sm">Diagnoses logged: {String(dashboard.diagnoses.length)}</p>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Garage stores vehicles, diagnosis history, manual refs, and parts lookups.
              </p>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <h3 className="text-lg font-semibold">Add Vehicle (with VIN decode)</h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="mb-1 block font-medium">VIN</span>
                  <input
                    value={vin}
                    onChange={(event) => setVin(event.target.value)}
                    placeholder="17-char VIN"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-950"
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-medium">Year</span>
                  <input
                    value={year}
                    onChange={(event) => setYear(event.target.value)}
                    placeholder="2020"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-950"
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-medium">Make</span>
                  <input
                    value={make}
                    onChange={(event) => setMake(event.target.value)}
                    placeholder="Ford"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-950"
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-medium">Model</span>
                  <input
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    placeholder="F-150"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-950"
                  />
                </label>
                <label className="text-sm sm:col-span-2">
                  <span className="mb-1 block font-medium">Owner's manual title</span>
                  <input
                    value={manualTitle}
                    onChange={(event) => setManualTitle(event.target.value)}
                    placeholder="2020 Ford F-150 Owner's Manual"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-950"
                  />
                </label>
                <label className="text-sm sm:col-span-2">
                  <span className="mb-1 block font-medium">Owner's manual PDF URL (optional)</span>
                  <input
                    value={manualPdfUrl}
                    onChange={(event) => setManualPdfUrl(event.target.value)}
                    placeholder="https://...pdf"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-950"
                  />
                </label>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleDecodeVin()}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
                >
                  Decode VIN
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleAddVehicle()}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
                >
                  Save to Garage
                </button>
              </div>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <h3 className="text-lg font-semibold">Garage Vehicles</h3>
              <div className="mt-3 max-h-80 space-y-2 overflow-auto pr-2">
                {dashboard.vehicles.length ? (
                  dashboard.vehicles.map((vehicle) => (
                    <article key={vehicle.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                      <h4 className="font-medium">{vehicleLabel(vehicle)}</h4>
                      {vehicle.vin ? <p className="text-xs text-gray-500">VIN: {vehicle.vin}</p> : null}
                      {vehicle.manualPdfUrl ? (
                        <a
                          className="mt-1 inline-block text-xs text-indigo-600 underline dark:text-indigo-300"
                          href={vehicle.manualPdfUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Manual PDF
                        </a>
                      ) : null}
                    </article>
                  ))
                ) : (
                  <p className="text-sm text-gray-600 dark:text-gray-300">No vehicles yet.</p>
                )}
              </div>
            </section>
          </div>

          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <h3 className="text-lg font-semibold">Run Diagnosis (audio + photo + typed symptom)</h3>
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block font-medium">Vehicle</span>
                <select
                  value={vehicleId}
                  onChange={(event) => setVehicleId(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-950"
                >
                  <option value="">Select a vehicle...</option>
                  {dashboard.vehicles.map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicleLabel(vehicle)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm">
                <span className="mb-1 block font-medium">ZIP code (parts scan)</span>
                <input
                  value={zipCode}
                  onChange={(event) => setZipCode(event.target.value)}
                  placeholder="90210"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-950"
                />
              </label>

              <label className="text-sm xl:col-span-2">
                <span className="mb-1 block font-medium">Typed symptom description</span>
                <textarea
                  value={symptomText}
                  onChange={(event) => setSymptomText(event.target.value)}
                  placeholder="Example: Car won't start, only clicking noise, headlights dim..."
                  rows={4}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-950"
                />
              </label>

              <div className="space-y-2 rounded-lg border border-dashed border-gray-300 p-3 dark:border-gray-700">
                <p className="text-sm font-medium">Audio input</p>
                <AudioRecorder onLabelChange={setAudioLabel} />
                {audioLabel ? <p className="text-xs text-gray-500">Attached: {audioLabel}</p> : null}
              </div>

              <div className="space-y-2 rounded-lg border border-dashed border-gray-300 p-3 dark:border-gray-700">
                <p className="text-sm font-medium">Photo input</p>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    setPhotoLabel(file?.name ?? "");
                  }}
                  className="w-full text-sm"
                />
                {photoLabel ? <p className="text-xs text-gray-500">Attached: {photoLabel}</p> : null}
              </div>
            </div>
            <div className="mt-4">
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleRunDiagnosis()}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                Diagnose Now
              </button>
            </div>
          </section>

          {latestDiagnosis ? <DiagnosisPanel diagnosis={latestDiagnosis} /> : null}

          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <h3 className="text-lg font-semibold">Diagnostic History</h3>
            <div className="mt-3 overflow-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="px-2 py-2">When</th>
                    <th className="px-2 py-2">Vehicle</th>
                    <th className="px-2 py-2">Symptom</th>
                    <th className="px-2 py-2">Issue</th>
                    <th className="px-2 py-2">Detail level</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.diagnoses.map((entry) => (
                    <tr key={entry.id} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="px-2 py-2 align-top text-xs">{formatDateTime(entry.createdAt)}</td>
                      <td className="px-2 py-2 align-top">{entry.vehicleLabel}</td>
                      <td className="max-w-72 px-2 py-2 align-top">{entry.symptomText}</td>
                      <td className="px-2 py-2 align-top">{entry.diagnosis.probableIssue}</td>
                      <td className="px-2 py-2 align-top">{entry.diagnosis.entitlement === "full" ? "Full" : "Basic"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!dashboard.diagnoses.length ? <p className="mt-2 text-sm text-gray-500">No diagnoses yet.</p> : null}
            </div>
          </section>
        </section>
      )}
    </main>
  );
}

function DiagnosisPanel({ diagnosis }: { diagnosis: DiagnosisResult }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <h3 className="text-lg font-semibold">Latest Diagnosis</h3>
      <p className="mt-2 text-sm">
        <span className="font-medium">Probable issue:</span> {diagnosis.probableIssue}
      </p>
      <p className="text-sm">
        <span className="font-medium">Confidence:</span> {(diagnosis.confidence * 100).toFixed(1)}%
      </p>
      <p className="mt-2 text-sm">{diagnosis.summary}</p>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <InfoList title="Step-by-step repair" values={diagnosis.repairSteps} />
        <InfoList title="Required tools" values={diagnosis.requiredTools} emptyText="Available on paid diagnosis output." />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <h4 className="font-medium">Owner's Manual Pages</h4>
          {diagnosis.manualReferences.length ? (
            <ul className="mt-2 space-y-2 text-sm">
              {diagnosis.manualReferences.map((manual, index) => (
                <li key={`${manual.page}-${String(index)}`}>
                  <p className="font-medium">Page {String(manual.page)} — {manual.section}</p>
                  <a
                    href={manual.pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-indigo-600 underline dark:text-indigo-300"
                  >
                    {manual.title}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-gray-500">Upgrade or use pay-per-use for manual page links.</p>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <h4 className="font-medium">Top 3 Repair Videos</h4>
          {diagnosis.videos.length ? (
            <ul className="mt-2 space-y-2 text-sm">
              {diagnosis.videos.map((video) => (
                <li key={video.url}>
                  <a href={video.url} target="_blank" rel="noreferrer" className="text-indigo-600 underline dark:text-indigo-300">
                    {video.title}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-gray-500">Upgrade or use pay-per-use for video recommendations.</p>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <h4 className="font-medium">Parts Store Scan</h4>
          {diagnosis.parts.length ? (
            <ul className="mt-2 space-y-3 text-sm">
              {diagnosis.parts.map((item) => (
                <li key={item.part}>
                  <p className="font-medium">{item.part} ({item.estimatedPrice})</p>
                  {item.stores.map((store) => (
                    <p key={`${item.part}-${store.name}`} className="text-xs text-gray-600 dark:text-gray-300">
                      {store.name} — {store.address} — {store.phone}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-gray-500">Upgrade or use pay-per-use for parts-store inventory estimates.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function InfoList({ title, values, emptyText = "No data." }: { title: string; values: string[]; emptyText?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <h4 className="font-medium">{title}</h4>
      {values.length ? (
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
          {values.map((value) => (
            <li key={`${title}-${value}`}>{value}</li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-sm text-gray-500">{emptyText}</p>
      )}
    </div>
  );
}

function AudioRecorder({ onLabelChange }: { onLabelChange: (label: string) => void }) {
  const [isRecording, setIsRecording] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);

  useEffect(
    () => () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    },
    [previewUrl],
  );

  const startRecording = useCallback(async () => {
    if (!globalThis.navigator?.mediaDevices) {
      return;
    }

    const stream = await globalThis.navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream);
    const chunks: BlobPart[] = [];

    mediaRecorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
      const nextUrl = URL.createObjectURL(blob);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(nextUrl);
      onLabelChange(`mic-recording-${Date.now()}.webm`);
      stream.getTracks().forEach((track) => track.stop());
    };

    mediaRecorder.start();
    setRecorder(mediaRecorder);
    setIsRecording(true);
  }, [onLabelChange, previewUrl]);

  const stopRecording = useCallback(() => {
    if (!recorder) return;
    recorder.stop();
    setRecorder(null);
    setIsRecording(false);
  }, [recorder]);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void startRecording()}
          disabled={isRecording}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          Start Mic Recording
        </button>
        <button
          type="button"
          onClick={stopRecording}
          disabled={!isRecording}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          Stop
        </button>
      </div>
      {previewUrl ? <audio controls src={previewUrl} className="w-full" /> : <p className="text-xs text-gray-500">No recording yet.</p>}
    </div>
  );
}
