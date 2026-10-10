"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/providers/supabase-provider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type {
  ChatMessage,
  GameAction,
  Room,
  RoomMember,
} from "@/lib/supabase/database.types";
import {
  simulateTamper,
  verifyActionChain,
  type VerifyResult,
} from "@/lib/game/verify";
import { PBKDF2_ITERATIONS } from "@/lib/crypto/e2e";

type SecurityLabProps = {
  room: Room | null;
  members: RoomMember[];
  actions: GameAction[];
  chatMessages: ChatMessage[];
  inviteCodeShown?: string | null;
  lastJoinInviteHash?: string | null;
  chatUnlocked: boolean;
};

function decodeJwtPayload(token: string | undefined): Record<string, unknown> | null {
  if (!token) return null;
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function SecurityLab({
  room,
  members,
  actions,
  chatMessages,
  inviteCodeShown,
  lastJoinInviteHash,
  chatUnlocked,
}: SecurityLabProps) {
  const { user, session, refreshSession } = useAuth();
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [tamperMode, setTamperMode] = useState(false);
  const [open, setOpen] = useState(true);

  const claims = useMemo(
    () => decodeJwtPayload(session?.access_token),
    [session?.access_token]
  );

  const expiry = claims?.exp
    ? new Date(Number(claims.exp) * 1000).toLocaleString()
    : "—";

  const displayActions = tamperMode ? simulateTamper(actions) : actions;
  const latestChat = chatMessages[chatMessages.length - 1];

  useEffect(() => {
    setVerifyResult(null);
  }, [actions, tamperMode]);

  async function runVerify() {
    if (!room) return;
    const result = await verifyActionChain(room.id, displayActions);
    setVerifyResult(result);
  }

  if (!open) {
    return (
      <Button
        className="fixed bottom-4 right-4 z-40 shadow-lg"
        onClick={() => setOpen(true)}
      >
        Open Security Lab
      </Button>
    );
  }

  return (
    <aside className="fixed bottom-0 right-0 z-40 flex max-h-[70vh] w-full flex-col border-t border-l border-[var(--border)] bg-[var(--surface)] shadow-2xl sm:bottom-4 sm:right-4 sm:max-h-[80vh] sm:w-[420px] sm:rounded-lg sm:border">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <div>
          <p className="text-sm font-semibold">Security Lab</p>
          <p className="text-xs text-[var(--muted)]">
            Live demo of crypto &amp; network security
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
      <div className="overflow-y-auto p-4">
        <Tabs defaultValue="auth">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="auth">Auth</TabsTrigger>
            <TabsTrigger value="room">Room</TabsTrigger>
            <TabsTrigger value="integrity">Integrity</TabsTrigger>
            <TabsTrigger value="chat">Chat</TabsTrigger>
          </TabsList>

          <TabsContent value="auth" className="space-y-3 text-sm">
            <Row label="User ID" value={user?.id ?? "—"} mono />
            <Row label="Email" value={user?.email ?? "—"} />
            <Row label="JWT expiry" value={expiry} />
            <Row
              label="Role claim"
              value={String(claims?.role ?? "—")}
              mono
            />
            <Button size="sm" variant="secondary" onClick={() => refreshSession()}>
              Refresh session
            </Button>
            <p className="text-xs text-[var(--muted)]">
              Middleware blocks unauthenticated access to /lobby, /room, and
              /game. Sign-out clears the JWT cookie session.
            </p>
          </TabsContent>

          <TabsContent value="room" className="space-y-3 text-sm">
            <Row label="Room ID" value={room?.id ?? "—"} mono />
            <Row label="Status" value={room?.status ?? "—"} />
            <Row
              label="Invite code (host only)"
              value={inviteCodeShown ?? "(not shown — hashed in DB)"}
              mono
            />
            <Row
              label="Invite hash in DB"
              value={room?.invite_code_hash?.slice(0, 24) + "…" || "—"}
              mono
            />
            {lastJoinInviteHash && (
              <Row label="Your join invite hash" value={lastJoinInviteHash} mono />
            )}
            <Row
              label="Passphrase salt"
              value={room?.passphrase_salt?.slice(0, 16) + "…" || "—"}
              mono
            />
            <Row label="Members (RLS)" value={String(members.length)} />
            <p className="text-xs text-[var(--muted)]">
              Only hashed invite/passphrase values are stored. RLS denies
              non-members from reading room, game, and chat rows.
            </p>
          </TabsContent>

          <TabsContent value="integrity" className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={runVerify}>
                Verify state
              </Button>
              <Button
                size="sm"
                variant={tamperMode ? "danger" : "outline"}
                onClick={() => setTamperMode((v) => !v)}
              >
                {tamperMode ? "Tamper ON" : "Simulate tamper"}
              </Button>
            </div>
            {verifyResult && (
              <div
                className={`rounded-md border p-3 ${
                  verifyResult.valid
                    ? "border-emerald-700 bg-emerald-950/40"
                    : "border-red-700 bg-red-950/40"
                }`}
              >
                <Badge variant={verifyResult.valid ? "success" : "danger"}>
                  {verifyResult.valid ? "VALID" : "TAMPER DETECTED"}
                </Badge>
                <p className="mt-2">{verifyResult.message}</p>
                {verifyResult.failedAt != null && (
                  <p className="mt-1 font-mono text-xs">
                    expected {verifyResult.expectedHash?.slice(0, 16)}…
                    <br />
                    actual {verifyResult.actualHash?.slice(0, 16)}…
                  </p>
                )}
              </div>
            )}
            <div className="max-h-48 space-y-2 overflow-y-auto">
              {displayActions.length === 0 && (
                <p className="text-[var(--muted)]">No actions yet.</p>
              )}
              {displayActions
                .slice()
                .sort((a, b) => b.seq - a.seq)
                .map((a) => (
                  <div
                    key={a.id + String(tamperMode)}
                    className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-2 font-mono text-[10px]"
                  >
                    <div>
                      #{a.seq} {a.action_type}
                    </div>
                    <div className="truncate text-[var(--muted)]">
                      hash {a.action_hash.slice(0, 20)}…
                    </div>
                  </div>
                ))}
            </div>
            <p className="text-xs text-[var(--muted)]">
              Each action hash = SHA-256(prevHash | seq | actor | type | payload
              | nonce). Simulate tamper alters payload locally without updating
              the hash so verification fails.
            </p>
          </TabsContent>

          <TabsContent value="chat" className="space-y-3 text-sm">
            <Row
              label="Chat key"
              value={
                chatUnlocked
                  ? `Unlocked (PBKDF2 ${PBKDF2_ITERATIONS} iter → AES-GCM)`
                  : "Locked — enter room passphrase"
              }
            />
            {latestChat ? (
              <>
                <Row label="Latest IV" value={latestChat.iv} mono />
                <div>
                  <p className="text-xs text-[var(--muted)]">Ciphertext (hex)</p>
                  <p className="mt-1 break-all rounded bg-[var(--surface-2)] p-2 font-mono text-[10px]">
                    {latestChat.ciphertext}
                  </p>
                </div>
              </>
            ) : (
              <p className="text-[var(--muted)]">No messages yet.</p>
            )}
            <p className="text-xs text-[var(--muted)]">
              Supabase stores only ciphertext + IV. Plaintext is decrypted in
              the browser with a key derived from the room passphrase.
            </p>
          </TabsContent>
        </Tabs>
      </div>
    </aside>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className={`mt-0.5 break-all ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </p>
    </div>
  );
}
