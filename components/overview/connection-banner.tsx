"use client";

import React, { useState } from "react";
import {
  InstagramIcon,
  ShieldCheckIcon,
  ArrowUpRightIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
  InfoIcon,
  XIcon,
  ClockIcon,
} from "../ui/icons";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import {
  useInstagramStatus,
  type InstagramStatusData,
} from "../../app/lib/instagram/use-instagram-status";

export interface ConnectionBannerNotification {
  type: "success" | "error";
  message: string;
}

export interface ConnectionBannerProps {
  statusData?: InstagramStatusData | null;
  isLoading?: boolean;
  error?: string | null;
  isDisconnecting?: boolean;
  onRefresh?: () => void;
  onDisconnect?: () => Promise<boolean>;
  onConnectClick?: () => void;
  notification?: ConnectionBannerNotification | null;
  onDismissNotification?: () => void;
}

export function ConnectionBanner({
  statusData: controlledStatus,
  isLoading: controlledIsLoading,
  error: controlledError,
  isDisconnecting: controlledIsDisconnecting,
  onRefresh: controlledOnRefresh,
  onDisconnect: controlledOnDisconnect,
  onConnectClick,
  notification,
  onDismissNotification,
}: ConnectionBannerProps) {
  // If controlled props are not provided, instantiate internal hook
  const internalHook = useInstagramStatus({
    autoFetch: controlledStatus === undefined,
  });

  const status = controlledStatus !== undefined ? controlledStatus : internalHook.data;
  const isLoading = controlledIsLoading !== undefined ? controlledIsLoading : internalHook.isLoading;
  const error = controlledError !== undefined ? controlledError : internalHook.error;
  const isDisconnecting =
    controlledIsDisconnecting !== undefined
      ? controlledIsDisconnecting
      : internalHook.isDisconnecting;
  const refreshStatus = controlledOnRefresh || internalHook.fetchStatus;
  const executeDisconnect = controlledOnDisconnect || internalHook.disconnect;

  const [showPermissionsModal, setShowPermissionsModal] = useState<boolean>(false);
  const [showDisconnectModal, setShowDisconnectModal] = useState<boolean>(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const handleConnect = () => {
    if (onConnectClick) {
      onConnectClick();
    } else if (typeof window !== "undefined") {
      window.location.assign(new URL("/api/auth/instagram", window.location.origin).href);
    }
  };

  const handleConfirmDisconnect = async () => {
    setDisconnectError(null);
    const success = await executeDisconnect();
    if (success) {
      setShowDisconnectModal(false);
    } else {
      setDisconnectError("Failed to disconnect account. Please try again.");
    }
  };

  // Helper formatting dates
  const formatDate = (isoString?: string | null): string => {
    if (!isoString) return "N/A";
    try {
      return new Date(isoString).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return "N/A";
    }
  };

  return (
    <div className="space-y-4">
      {/* 1. Notification Banner (OAuth callback success or error) */}
      {notification && (
        <div
          role="alert"
          className={`flex items-start justify-between gap-3 p-4 rounded-xl border text-xs animate-in fade-in duration-150 ${
            notification.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-800/60 dark:text-emerald-200"
              : "bg-rose-50 border-rose-200 text-rose-900 dark:bg-rose-950/40 dark:border-rose-800/60 dark:text-rose-200"
          }`}
        >
          <div className="flex items-start gap-2.5">
            {notification.type === "success" ? (
              <CheckCircle2Icon size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircleIcon size={16} className="text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            )}
            <div>
              <p className="font-semibold">
                {notification.type === "success"
                  ? "Instagram Connection Updated"
                  : "Connection Notice"}
              </p>
              <p className="mt-0.5 text-zinc-700 dark:text-zinc-300 leading-relaxed">
                {notification.message}
              </p>
            </div>
          </div>

          {onDismissNotification && (
            <button
              type="button"
              onClick={onDismissNotification}
              aria-label="Dismiss notification"
              className="rounded-md p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors"
            >
              <XIcon size={15} />
            </button>
          )}
        </div>
      )}

      {/* 2. Main Connection Card Surface */}
      <div className="relative overflow-hidden rounded-2xl border border-indigo-200 dark:border-indigo-500/30 bg-gradient-to-br from-indigo-50/90 via-white to-zinc-50 dark:from-indigo-950/40 dark:via-zinc-900 dark:to-zinc-950 p-6 sm:p-7 shadow-md dark:shadow-lg shadow-indigo-100/50 dark:shadow-indigo-950/30">
        <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-indigo-500/5 dark:bg-indigo-500/10 blur-3xl" />

        {/* LOADING SKELETON */}
        {isLoading && (
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 animate-pulse">
            <div className="space-y-3 max-w-xl">
              <div className="h-5 w-28 rounded-full bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-7 w-72 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-4 w-96 rounded bg-zinc-200/80 dark:bg-zinc-800/80" />
              <div className="h-4 w-64 rounded bg-zinc-200/60 dark:bg-zinc-800/60" />
            </div>
            <div className="h-10 w-44 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
          </div>
        )}

        {/* ERROR STATE */}
        {!isLoading && error && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800/60 text-rose-600 dark:text-rose-400">
                <AlertCircleIcon size={20} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-rose-800 dark:text-rose-200">
                  Unable to Load Connection Status
                </h3>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5 leading-relaxed">
                  {error}
                </p>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={refreshStatus}
              className="shrink-0 text-xs self-start sm:self-center"
            >
              <span>Retry</span>
            </Button>
          </div>
        )}

        {/* CONNECTED STATE */}
        {!isLoading && !error && status?.status === "connected" && (
          <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="space-y-3 max-w-2xl">
              <div className="flex flex-wrap items-center gap-2.5">
                <Badge variant="success" dot>
                  Connected
                </Badge>
                <span className="text-xs font-mono text-zinc-500 dark:text-zinc-400">
                  Official Meta Graph API
                </span>
                {status.profile?.account_type && (
                  <Badge variant="purple" className="capitalize">
                    {status.profile.account_type.toLowerCase().replace("_", " ")}
                  </Badge>
                )}
              </div>

              {/* Creator Account Identity */}
              <div className="flex items-center gap-3.5 pt-1">
                {status.profile?.profile_picture_url ? (
                  <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-indigo-300 dark:border-indigo-500/40 shadow-xs">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={status.profile.profile_picture_url}
                      alt={status.username || "Instagram Avatar"}
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-700 text-white shadow-md shadow-indigo-950/60 ring-1 ring-white/20">
                    <InstagramIcon size={24} />
                  </div>
                )}

                <div>
                  <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900 dark:text-white flex items-center gap-2">
                    <span>@{status.username || "creator"}</span>
                  </h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {status.profile?.name ? status.profile.name : "Instagram Creator Account"}
                  </p>
                </div>
              </div>

              <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed pt-1">
                Your professional Instagram account is actively synced. Encrypted access tokens are
                securely stored and verified for background analytics telemetry.
              </p>

              {/* Connected Telemetry Details */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 text-xs text-zinc-500 dark:text-zinc-400">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2Icon size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>Linked on {formatDate(status.connectedAt)}</span>
                </div>
                {status.expiresAt && (
                  <div className="flex items-center gap-1.5">
                    <ClockIcon size={14} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <span>Token active through {formatDate(status.expiresAt)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Actions for Connected State */}
            <div className="flex flex-col sm:flex-row lg:flex-col gap-2.5 shrink-0 lg:w-48">
              <Button
                variant="outline"
                size="md"
                onClick={refreshStatus}
                className="w-full justify-center text-xs"
              >
                <span>Refresh Status</span>
              </Button>

              <Button
                variant="destructive"
                size="md"
                onClick={() => setShowDisconnectModal(true)}
                className="w-full justify-center text-xs border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:hover:bg-rose-900 dark:border-rose-800/60 dark:text-rose-200 shadow-2xs dark:shadow-none"
              >
                <span>Disconnect</span>
              </Button>
            </div>
          </div>
        )}

        {/* EXPIRED STATE */}
        {!isLoading && !error && status?.status === "expired" && (
          <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="space-y-3 max-w-2xl">
              <div className="flex flex-wrap items-center gap-2.5">
                <Badge variant="warning" dot>
                  Token Expired
                </Badge>
                <span className="text-xs font-mono text-zinc-500 dark:text-zinc-400">
                  Re-authorization Required
                </span>
              </div>

              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900 dark:text-white flex items-center gap-2">
                <span>@{status.username || "Account"} Connection Expired</span>
              </h2>

              <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
                Meta access tokens expire every 60 days. Your access token expired on{" "}
                <strong className="text-amber-600 dark:text-amber-300">{formatDate(status.expiresAt)}</strong>. Reconnect
                your Instagram account to restore telemetry metrics and insights.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row lg:flex-col gap-2.5 shrink-0 lg:w-52">
              <Button
                variant="primary"
                size="lg"
                onClick={handleConnect}
                className="w-full justify-center shadow-md shadow-indigo-900/40"
              >
                <InstagramIcon size={18} />
                <span>Reconnect via Meta</span>
              </Button>

              <Button
                variant="outline"
                size="md"
                onClick={() => setShowDisconnectModal(true)}
                className="w-full justify-center text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
              >
                <span>Remove Connection</span>
              </Button>
            </div>
          </div>
        )}

        {/* DISCONNECTED (DEFAULT) STATE */}
        {!isLoading && !error && status?.status !== "connected" && status?.status !== "expired" && (
          <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="space-y-3 max-w-2xl">
              <div className="flex flex-wrap items-center gap-2.5">
                <Badge variant="purple" dot>
                  Meta Integration
                </Badge>
                <span className="text-xs font-mono text-zinc-500 dark:text-zinc-400">
                  Official Meta Graph API
                </span>
              </div>

              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
                Connect your Instagram Creator Account
              </h2>

              <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
                CreatorPilot AI uses official Meta APIs to extract real engagement metrics, diagnose
                audience retention, and generate data-backed creative directions. Connect your account
                to replace sample data with live insights.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <div className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                  <CheckCircle2Icon size={15} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>Verified Meta API protocol</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                  <CheckCircle2Icon size={15} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>Encrypted credential vault</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                  <CheckCircle2Icon size={15} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>Audience privacy compliant</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row lg:flex-col gap-3 shrink-0 lg:w-56">
              <Button
                variant="primary"
                size="lg"
                onClick={handleConnect}
                className="w-full justify-center shadow-md shadow-indigo-900/40"
              >
                <InstagramIcon size={18} />
                <span>Connect via Meta</span>
              </Button>

              <Button
                variant="outline"
                size="md"
                onClick={() => setShowPermissionsModal(true)}
                className="w-full justify-center text-xs"
              >
                <InfoIcon size={15} />
                <span>Required Permissions</span>
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 3. Disconnect Confirmation Modal */}
      {showDisconnectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/80 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="disconnect-modal-title"
            className="w-full max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-2xl text-zinc-900 dark:text-zinc-100"
          >
            <div className="flex items-center gap-3 pb-3 border-b border-zinc-200 dark:border-zinc-800">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-50 dark:bg-rose-950/70 border border-rose-200 dark:border-rose-800/60 text-rose-600 dark:text-rose-400">
                <AlertCircleIcon size={20} />
              </div>
              <div>
                <h3 id="disconnect-modal-title" className="text-sm font-semibold text-zinc-900 dark:text-white">
                  Disconnect Instagram Account
                </h3>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  @{status?.username || "Connected Account"}
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3 text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
              <p>
                Are you sure you want to disconnect your Instagram Professional account?
              </p>
              <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950/70 border border-zinc-200 dark:border-zinc-800/80 text-zinc-600 dark:text-zinc-400 text-[11px]">
                <p>• Your encrypted Meta access tokens will be permanently purged.</p>
                <p className="mt-1">• Telemetry synchronization will pause until you re-authenticate.</p>
              </div>

              {disconnectError && (
                <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs">
                  {disconnectError}
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-2.5 pt-3 border-t border-zinc-200 dark:border-zinc-800">
              <Button
                variant="outline"
                size="sm"
                disabled={isDisconnecting}
                onClick={() => setShowDisconnectModal(false)}
              >
                Cancel
              </Button>

              <Button
                variant="destructive"
                size="sm"
                isLoading={isDisconnecting}
                onClick={handleConfirmDisconnect}
                className="bg-rose-600 hover:bg-rose-500 text-white"
              >
                <span>Confirm Disconnect</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Permissions Information Modal */}
      {showPermissionsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/80 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="permissions-modal-title"
            className="w-full max-w-lg rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-2xl text-zinc-900 dark:text-zinc-100"
          >
            <div className="flex items-center justify-between pb-4 border-b border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-400">
                  <ShieldCheckIcon size={18} />
                </div>
                <div>
                  <h3 id="permissions-modal-title" className="text-sm font-semibold text-zinc-900 dark:text-white">
                    Meta Graph API Permissions
                  </h3>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Instagram Login Integration Scope
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowPermissionsModal(false)}
                aria-label="Close dialog"
                className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white"
              >
                <XIcon size={18} />
              </button>
            </div>

            <div className="mt-4 space-y-3.5 text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
              <p>
                CreatorPilot AI adheres to least-privilege security. We only request the minimum
                permissions necessary to analyze professional creator performance:
              </p>

              <div className="rounded-xl bg-zinc-50 dark:bg-zinc-950/70 p-3.5 border border-zinc-200 dark:border-zinc-800/80 space-y-2">
                <div className="flex items-start gap-2">
                  <span className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400 shrink-0">
                    instagram_business_basic
                  </span>
                  <span className="text-zinc-600 dark:text-zinc-400">
                    Retrieves your authorized account type, username, app-scoped user ID, and avatar.
                  </span>
                </div>
              </div>

              <div className="rounded-lg bg-zinc-50 dark:bg-zinc-950/50 p-3 border border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-600 dark:text-zinc-400">
                <strong>Requirement:</strong> Your account must be an eligible Instagram Professional
                (Creator or Business) account to connect.
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2.5 pt-3 border-t border-zinc-200 dark:border-zinc-800">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowPermissionsModal(false)}
              >
                Close
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setShowPermissionsModal(false);
                  handleConnect();
                }}
              >
                <span>Continue to Meta</span>
                <ArrowUpRightIcon size={14} />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
