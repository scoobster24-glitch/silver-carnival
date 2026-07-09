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
  const [sessionLoading, setSessionLoading] = useState(false);
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
    setSessionLoading(true);
    void refreshDashboard(token)
      .catch((err: unknown) => {
        setError((err as Error).message || "Could not load dashboard.");
        setToken("");
        setDashboard(null);
        globalThis.localStorage?.removeItem(TOKEN_KEY);
      })
      .finally(() => {
        setSessionLoading(false);
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
      setSessionLoading(true);
      try {
        const action = mode === "login" ? loginFn : signUpFn;
        const response = await action({ data: { email, password } });
        setToken(response.token);
        globalThis.localStorage?.setItem(TOKEN_KEY, response.token);
        setPassword("");
        setNotice(mode === "login" ? "Logged in." : "Account created and logged in.");
      } catch (err: unknown) {
        setError((err as Error).message || "Authentication failed.");
        setSessionLoading(false);
      } finally {
        setBusy(false);
      }
    },
    [clearMessages, email, password],
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
      setSessionLoading(false);
      setBusy(false);
    }
  }, [clearMessages, token]);

  const handleRequestReset = useCallback(async () => {
    clearMessages();
    setBusy(true);
    try {
      const response = await requestResetFn({ data: { email: resetEmail } });
      setNotice(response.message || "If that account exists, a reset link has been sent.");
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
        setNotice("Diagnosis complete. Free tier shows text-only guidance with DIY time and difficulty.");
      } else {
        setNotice("Diagnosis complete with time estimate, difficulty score, manuals, videos, parts, and local repair shops.");
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
    <main className="mx-auto min-h-dvh max-w-6xl space-y-8 px-4 py-6 sm:px-6">
      {/* Header with Navigation Branding */}
      <header className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-indigo-600 text-lg font-black text-white">V</span>
            <div>
              <span className="text-lg font-bold tracking-tight text-gray-900 dark:text-white">VINdicate</span>
              <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400">MVP</span>
            </div>
          </div>
          {hasSession ? (
            <div className="flex items-center gap-4">
              <span className="hidden text-xs text-gray-500 sm:inline">Signed in as {dashboard?.user.email}</span>
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="rounded-lg border border-gray-300 px-3.5 py-1.5 text-xs font-semibold hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800 transition"
              >
                Logout
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setAuthMode("login");
                  document.getElementById("auth-section")?.scrollIntoView({ behavior: "smooth" });
                }}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
              >
                Login
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode("signup");
                  document.getElementById("auth-section")?.scrollIntoView({ behavior: "smooth" });
                }}
                className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 shadow-sm transition"
              >
                Get Started
              </button>
            </div>
          )}
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

      {!hasSession ? (
        <>
          {/* Stunning SaaS Hero Section */}
          <section className="grid gap-8 items-center lg:grid-cols-12 py-4">
            <div className="lg:col-span-7 space-y-6">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400">
                <svg className="size-3 text-indigo-500 animate-pulse" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /></svg>
                AI-Powered Multi-Vehicle Diagnostics
              </span>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight text-gray-900 dark:text-white leading-none">
                Turn Car Stress Into an <span className="text-indigo-600 dark:text-indigo-400">Enjoyable</span> DIY Victory.
              </h1>
              <p className="text-base sm:text-lg text-gray-600 dark:text-gray-300 leading-relaxed">
                Hear a weird noise? Snap a photo? Describe the symptom? We&apos;ll decode the mystery in seconds. Get precise diagnoses, DIY time estimates, difficulty scores, step-by-step guides, owner&apos;s manual lookups, parts store scans, and repair shop finders—all in one place.
              </p>
              <div className="flex flex-wrap gap-4">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode("signup");
                    document.getElementById("auth-section")?.scrollIntoView({ behavior: "smooth" });
                  }}
                  className="rounded-xl bg-indigo-600 px-6 py-3.5 text-sm font-bold text-white hover:bg-indigo-500 shadow-md hover:shadow-lg transition-all cursor-pointer"
                >
                  Start Your Free Diagnosis
                </button>
                <button
                  type="button"
                  onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })}
                  className="rounded-xl border border-gray-300 px-6 py-3.5 text-sm font-semibold hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800 transition cursor-pointer"
                >
                  See How It Works
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="flex items-center gap-2">
                  <span className="text-indigo-500 font-bold">✓</span>
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Unlimited vehicle types (cars, boats, RVs, bikes)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-indigo-500 font-bold">✓</span>
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">VIN decoding for precision diagnostics</span>
                </div>
              </div>
            </div>
            <div className="lg:col-span-5">
              <div className="relative overflow-hidden rounded-3xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-2 shadow-2xl">
                <img
                  src="/images/hero-vehicles.png"
                  alt="VINdicate multi-vehicle visual diagnosis platform"
                  className="rounded-2xl w-full object-cover aspect-[3/2] shadow-inner"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent pointer-events-none rounded-2xl" />
              </div>
            </div>
          </section>

          {/* Owner Vision Testimonial Card */}
          <section className="rounded-3xl bg-indigo-50/50 dark:bg-indigo-950/20 p-8 border border-indigo-100/50 dark:border-indigo-900/20 text-center max-w-4xl mx-auto my-4">
            <span className="text-3xl text-indigo-500 leading-none">“</span>
            <blockquote className="text-base sm:text-lg italic font-medium text-indigo-900 dark:text-indigo-200 max-w-2xl mx-auto mt-1">
              I want to make working on your vehicle an enjoyable experience by providing all the necessary resources you need to eliminate stress related to vehicle problems. Anyone can now hop on VINdicate, record the noise that&apos;s raising concern, upload a photo of what they see, and hit diagnose. In a couple of seconds, you have everything you need to make it as stress-free as possible.
            </blockquote>
            <div className="mt-4">
              <cite className="not-italic font-bold text-sm text-gray-900 dark:text-white">VINdicate Founder &amp; Team</cite>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Committed to Stress-Free DIY Vehicle Care</p>
            </div>
          </section>

          {/* Detailed How It Works Steps with Icons */}
          <section id="how-it-works" className="space-y-6 pt-6 scroll-mt-6">
            <div className="text-center max-w-3xl mx-auto space-y-2">
              <h2 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl">How VINdicate Works</h2>
              <p className="text-gray-600 dark:text-gray-300">From a strange sound under the hood to a warning light, get answers and resources in three simple steps.</p>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-sm space-y-4">
                <div className="inline-flex size-10 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-300 font-bold text-lg">
                  1
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Capture Symptoms</h3>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Record a 5-second sound of a weird squeal or click, upload a photo of a fluid leak, or type what your vehicle is doing.
                </p>
              </div>

              <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-sm space-y-4">
                <div className="inline-flex size-10 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-300 font-bold text-lg">
                  2
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Instant Diagnostics</h3>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Get a detailed diagnosis with confidence score, DIY time estimate, and a difficulty rating (1-10) to decide your next move.
                </p>
              </div>

              <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-sm space-y-4">
                <div className="inline-flex size-10 items-center justify-center rounded-xl bg-purple-50 dark:bg-purple-950 text-purple-600 dark:text-purple-300 font-bold text-lg">
                  3
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Fix and Source Parts</h3>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Follow step-by-step guidance, open exact owner&apos;s manual pages, watch relevant YouTube videos, find local parts stores, or look up nearby repair shops.
                </p>
              </div>
            </div>
          </section>

          {/* Why Drivers Trust Section & Review Blocks */}
          <section className="grid gap-8 lg:grid-cols-2 items-center py-6">
            <div className="space-y-4">
              <h2 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">Why Drivers &amp; DIY Mechanics Trust VINdicate</h2>
              <p className="text-gray-600 dark:text-gray-300">
                Traditional OBD-II scanners only read standard engine fault codes for passenger cars. VINdicate is a complete, multi-vehicle diagnostic suite designed to remove frustration from any vehicle issue.
              </p>
              <ul className="space-y-3">
                <li className="flex gap-2.5 text-sm">
                  <span className="text-emerald-500 font-bold">✓</span>
                  <div>
                    <strong className="text-gray-900 dark:text-white">Not Just Cars:</strong> Works across trucks, motorcycles, boats, golf carts, RVs, and powersports.
                  </div>
                </li>
                <li className="flex gap-2.5 text-sm">
                  <span className="text-emerald-500 font-bold">✓</span>
                  <div>
                    <strong className="text-gray-900 dark:text-white">Audio &amp; Photo Analysis:</strong> Diagnoses visual damage or strange mechanical sounds using intelligent pattern matching.
                  </div>
                </li>
                <li className="flex gap-2.5 text-sm">
                  <span className="text-emerald-500 font-bold">✓</span>
                  <div>
                    <strong className="text-gray-900 dark:text-white">All-In-One Toolkit:</strong> Integrates YouTube videos, exact owner manual references, live inventory scans at local auto parts stores, and local mechanic maps.
                  </div>
                </li>
              </ul>
            </div>
            <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm space-y-4">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">What Real DIYers Say</h3>
              <div className="space-y-4">
                <div className="text-xs space-y-1">
                  <div className="flex text-yellow-400 text-sm">★★★★★</div>
                  <p className="italic text-gray-600 dark:text-gray-300">&quot;My car was making a weird clicking sound. I was terrified of a $1,000 repair bill. I recorded the noise on VINdicate, and it diagnosed a loose heat shield. It was a 10-minute fix that cost me $0!&quot;</p>
                  <p className="font-semibold text-gray-900 dark:text-white text-[10px]">Marcus K. — Toyota Tacoma Owner</p>
                </div>
                <div className="border-t border-gray-100 dark:border-gray-800 pt-3 text-xs space-y-1">
                  <div className="flex text-yellow-400 text-sm">★★★★★</div>
                  <p className="italic text-gray-600 dark:text-gray-300">&quot;VINdicate makes working on my boat actually fun. Finding exact manual pages and local parts in one search saved me hours of frustration. This app pays for itself on the first fix.&quot;</p>
                  <p className="font-semibold text-gray-900 dark:text-white text-[10px]">Elena R. — Yamaha Outboard Owner</p>
                </div>
              </div>
            </div>
          </section>

          {/* Pricing Plans Sections */}
          <section id="pricing" className="space-y-6 pt-6 scroll-mt-6">
            <div className="text-center max-w-3xl mx-auto space-y-2">
              <h2 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl">Flexible, Cost-Effective Plans</h2>
              <p className="text-gray-600 dark:text-gray-300">Whether you are a one-time DIYer or a multi-vehicle household, find a plan that fits your repair style.</p>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              {/* Free Plan */}
              <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-sm flex flex-col justify-between space-y-6">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">Free Basic</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Great for a quick checkup</p>
                  </div>
                  <div className="text-3xl font-black text-gray-900 dark:text-white">
                    $0<span className="text-xs font-normal text-gray-500"> / month</span>
                  </div>
                  <ul className="space-y-2 text-xs text-gray-600 dark:text-gray-300">
                    <li className="flex gap-2"><span>✓</span> 3 basic diagnoses per month</li>
                    <li className="flex gap-2"><span>✓</span> 1 vehicle saved in Garage</li>
                    <li className="flex gap-2"><span>✓</span> Text-only repair guidance</li>
                  </ul>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode("signup");
                    document.getElementById("auth-section")?.scrollIntoView({ behavior: "smooth" });
                  }}
                  className="w-full py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-xs font-bold transition cursor-pointer"
                >
                  Create Free Account
                </button>
              </div>

              {/* Pro Plan */}
              <div className="rounded-2xl border-2 border-indigo-600 bg-white dark:bg-gray-900 p-6 shadow-md flex flex-col justify-between space-y-6 relative">
                <span className="absolute top-0 right-1/2 translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-600 px-3 py-1 text-[10px] font-extrabold text-white uppercase tracking-wider">
                  BEST VALUE
                </span>
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                      Pro Subscriber
                    </h3>
                    <p className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold">Ultimate Peace of Mind</p>
                  </div>
                  <div className="text-3xl font-black text-gray-900 dark:text-white">
                    $9.99<span className="text-xs font-normal text-gray-500"> / month</span>
                  </div>
                  <ul className="space-y-2 text-xs text-gray-600 dark:text-gray-300">
                    <li className="flex gap-2"><span className="text-indigo-500 font-bold">✓</span> Unlimited diagnostics</li>
                    <li className="flex gap-2"><span className="text-indigo-500 font-bold">✓</span> Unlimited vehicles in Garage</li>
                    <li className="flex gap-2"><span className="text-indigo-500 font-bold">✓</span> Step-by-step guides &amp; tool lists</li>
                    <li className="flex gap-2"><span className="text-indigo-500 font-bold">✓</span> DIY time estimates &amp; 1-10 difficulty</li>
                    <li className="flex gap-2"><span className="text-indigo-500 font-bold">✓</span> Hand-picked YouTube repair tutorials</li>
                    <li className="flex gap-2"><span className="text-indigo-500 font-bold">✓</span> Exact Owner&apos;s Manual pages</li>
                    <li className="flex gap-2"><span className="text-indigo-500 font-bold">✓</span> Local auto parts store inventory &amp; pricing</li>
                    <li className="flex gap-2"><span className="text-indigo-500 font-bold">✓</span> Map of nearby professional repair shops</li>
                  </ul>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode("signup");
                    document.getElementById("auth-section")?.scrollIntoView({ behavior: "smooth" });
                  }}
                  className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow transition cursor-pointer"
                >
                  Go Pro Now (Save with $99/yr)
                </button>
              </div>

              {/* Pay-per-use Plan */}
              <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-sm flex flex-col justify-between space-y-6">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">Pay-Per-Use</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">One-off comprehensive repair</p>
                  </div>
                  <div className="text-3xl font-black text-gray-900 dark:text-white">
                    $4.99<span className="text-xs font-normal text-gray-500"> / diagnosis</span>
                  </div>
                  <ul className="space-y-2 text-xs text-gray-600 dark:text-gray-300">
                    <li className="flex gap-2"><span>✓</span> 1 comprehensive Pro diagnostic credit</li>
                    <li className="flex gap-2"><span>✓</span> Includes step-by-step guides &amp; tools list</li>
                    <li className="flex gap-2"><span>✓</span> Includes video, manual, &amp; parts lookups</li>
                    <li className="flex gap-2"><span>✓</span> No monthly subscription required</li>
                  </ul>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode("signup");
                    document.getElementById("auth-section")?.scrollIntoView({ behavior: "smooth" });
                  }}
                  className="w-full py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-xs font-bold transition cursor-pointer"
                >
                  Buy Single Credit
                </button>
              </div>
            </div>
          </section>

          {/* Beautifully Framed Authentication Container */}
          <section id="auth-section" className="scroll-mt-6 pt-6">
            <div className="max-w-md mx-auto rounded-3xl border border-gray-200 bg-white p-8 shadow-md dark:border-gray-800 dark:bg-gray-900 space-y-6">
              <div className="text-center space-y-1">
                <h2 className="text-2xl font-black text-gray-900 dark:text-white">Ready to Diagnose?</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">Sign up or login to start your diagnostic journey</p>
              </div>
              <div className="flex gap-1.5 rounded-xl bg-gray-100 p-1 dark:bg-gray-950">
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
                    className={`w-full rounded-lg py-1.5 text-center text-xs font-bold transition-all ${
                      authMode === mode
                        ? "bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-white"
                        : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white cursor-pointer"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {authMode === "login" || authMode === "signup" ? (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">Email Address</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@example.com"
                      className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm dark:border-gray-800 dark:bg-gray-950 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">Password</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="At least 8 characters"
                      className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm dark:border-gray-800 dark:bg-gray-950 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleAuth(authMode)}
                    className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-60 shadow transition-all cursor-pointer"
                  >
                    {authMode === "login" ? "Login to Your Account" : "Create Free Account"}
                  </button>
                </div>
              ) : null}

              {authMode === "request-reset" ? (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">Account Email Address</label>
                    <input
                      type="email"
                      value={resetEmail}
                      onChange={(event) => setResetEmail(event.target.value)}
                      placeholder="you@example.com"
                      className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm dark:border-gray-800 dark:bg-gray-950"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleRequestReset()}
                    className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-60 shadow transition-all cursor-pointer"
                  >
                    Send Reset Instructions
                  </button>
                </div>
              ) : null}

              {authMode === "reset" ? (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">Reset Token</label>
                    <input
                      value={resetToken}
                      onChange={(event) => setResetToken(event.target.value)}
                      placeholder="Paste your reset token here"
                      className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm dark:border-gray-800 dark:bg-gray-950"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">New Password</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      placeholder="At least 8 characters"
                      className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm dark:border-gray-800 dark:bg-gray-950 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleResetPassword()}
                    className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-60 shadow transition-all cursor-pointer"
                  >
                    Reset Password
                  </button>
                </div>
              ) : null}
            </div>
          </section>
        </>
      ) : sessionLoading || !dashboard ? (
        <section className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-600 shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
          Loading your Garage and diagnosis history...
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
                    if (!file) {
                      setPhotoLabel("");
                      return;
                    }
                    if (!file.type.startsWith("image/")) {
                      setPhotoLabel("");
                      setError("Please upload a valid image file (JPG, PNG, WebP, etc).");
                      event.target.value = "";
                      return;
                    }
                    setError("");
                    setPhotoLabel(file.name);
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
            <div className="mt-3 space-y-3">
              <div className="space-y-2 md:hidden">
                {dashboard.diagnoses.map((entry) => (
                  <article key={entry.id} className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
                    <p className="text-xs text-gray-500 dark:text-gray-400">{formatDateTime(entry.createdAt)}</p>
                    <p className="mt-1 font-medium">{entry.vehicleLabel}</p>
                    <p className="mt-1 text-xs"><span className="font-medium">Symptom:</span> {entry.symptomText}</p>
                    <p className="mt-1 text-xs"><span className="font-medium">Issue:</span> {entry.diagnosis.probableIssue}</p>
                    <p className="mt-1 text-xs"><span className="font-medium">Detail:</span> {entry.diagnosis.entitlement === "full" ? "Full" : "Basic"}</p>
                  </article>
                ))}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-[760px] text-left text-sm">
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
              </div>

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
      <p className="text-sm">
        <span className="font-medium">DIY time estimate:</span> {diagnosis.diyTimeEstimate}
      </p>
      <p className="text-sm">
        <span className="font-medium">Difficulty (1-10):</span> {String(diagnosis.difficulty)}/10
      </p>
      <p className="mt-2 text-sm">{diagnosis.summary}</p>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <InfoList title="Step-by-step repair" values={diagnosis.repairSteps} />
        <InfoList title="Required tools" values={diagnosis.requiredTools} emptyText="Available on paid diagnosis output." />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
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

        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <h4 className="font-medium">Nearby Repair Shops</h4>
          {diagnosis.localRepairShops.length ? (
            <ul className="mt-2 space-y-2 text-sm">
              {diagnosis.localRepairShops.map((shop) => (
                <li key={`${shop.name}-${shop.address}`}>
                  <p className="font-medium">{shop.name}</p>
                  <p className="text-xs text-gray-600 dark:text-gray-300">{shop.address}</p>
                  <p className="text-xs text-gray-600 dark:text-gray-300">{shop.phone}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-gray-500">Upgrade or use pay-per-use to unlock nearby repair shop listings.</p>
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
  const [micError, setMicError] = useState("");

  useEffect(
    () => () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    },
    [previewUrl],
  );

  const startRecording = useCallback(async () => {
    setMicError("");

    if (!globalThis.navigator?.mediaDevices) {
      setMicError("Microphone recording is not supported in this browser.");
      return;
    }

    try {
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
    } catch {
      setMicError("Could not start microphone recording. Check browser permissions and microphone availability.");
    }
  }, [onLabelChange, previewUrl]);

  const stopRecording = useCallback(() => {
    if (!recorder) return;
    recorder.stop();
    setRecorder(null);
    setIsRecording(false);
  }, [recorder]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
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
        {isRecording ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-1 text-[11px] font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-200">
            <span className="size-2 rounded-full bg-red-500" /> Recording in progress
          </span>
        ) : null}
      </div>
      {micError ? <p className="text-xs text-red-600 dark:text-red-300">{micError}</p> : null}
      {previewUrl ? <audio controls src={previewUrl} className="w-full" /> : <p className="text-xs text-gray-500">No recording yet.</p>}
    </div>
  );
}
