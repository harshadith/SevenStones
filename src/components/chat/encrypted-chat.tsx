"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  decryptMessage,
  deriveChatKey,
  encryptMessage,
} from "@/lib/crypto/e2e";
import { loadRoomPassphrase, storeRoomPassphrase } from "@/lib/rooms/secrets";
import type { ChatMessage, Profile } from "@/lib/supabase/database.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

type EncryptedChatProps = {
  roomId: string;
  passphraseSalt: string;
  userId: string;
  onChatUnlocked?: (unlocked: boolean) => void;
  onMessagesChange?: (messages: ChatMessage[]) => void;
  showCiphertext?: boolean;
};

type DecryptedRow = ChatMessage & {
  plaintext?: string;
  decryptError?: boolean;
};

export function EncryptedChat({
  roomId,
  passphraseSalt,
  userId,
  onChatUnlocked,
  onMessagesChange,
  showCiphertext = false,
}: EncryptedChatProps) {
  const supabase = useMemo(() => createClient(), []);
  const [passphrase, setPassphrase] = useState("");
  const [chatKey, setChatKey] = useState<CryptoKey | null>(null);
  const [messages, setMessages] = useState<DecryptedRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [viewCipher, setViewCipher] = useState(showCiphertext);

  useEffect(() => {
    const saved = loadRoomPassphrase(roomId);
    if (saved) {
      setPassphrase(saved);
      void unlock(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, passphraseSalt]);

  async function unlock(pass: string) {
    setError(null);
    try {
      const key = await deriveChatKey(pass, passphraseSalt);
      setChatKey(key);
      storeRoomPassphrase(roomId, pass);
      onChatUnlocked?.(true);
      await loadMessages(key);
    } catch {
      setError("Could not derive chat key");
      onChatUnlocked?.(false);
    }
  }

  async function loadMessages(key: CryptoKey) {
    const { data, error: fetchError } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("room_id", roomId)
      .order("created_at", { ascending: true });
    if (fetchError) {
      setError(fetchError.message);
      return;
    }
    const rows = await Promise.all(
      (data ?? []).map(async (msg) => {
        try {
          const plaintext = await decryptMessage(key, msg.ciphertext, msg.iv);
          return { ...msg, plaintext };
        } catch {
          return { ...msg, decryptError: true };
        }
      })
    );
    setMessages(rows);
    onMessagesChange?.(rows);

    const ids = [...new Set(rows.map((r) => r.sender_id))];
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", ids);
      const map: Record<string, string> = {};
      (profs as Profile[] | null)?.forEach((p) => {
        map[p.id] = p.display_name;
      });
      setProfiles(map);
    }
  }

  useEffect(() => {
    const channel = supabase
      .channel(`chat:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `room_id=eq.${roomId}`,
        },
        async (payload) => {
          const msg = payload.new as ChatMessage;
          if (!chatKey) {
            setMessages((prev) => [...prev, msg]);
            return;
          }
          try {
            const plaintext = await decryptMessage(
              chatKey,
              msg.ciphertext,
              msg.iv
            );
            setMessages((prev) => {
              const next = [...prev, { ...msg, plaintext }];
              onMessagesChange?.(next);
              return next;
            });
          } catch {
            setMessages((prev) => [...prev, { ...msg, decryptError: true }]);
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, roomId, chatKey, onMessagesChange]);

  async function onUnlock(e: FormEvent) {
    e.preventDefault();
    await unlock(passphrase);
  }

  async function onSend(e: FormEvent) {
    e.preventDefault();
    if (!chatKey || !draft.trim()) return;
    setError(null);
    try {
      const encrypted = await encryptMessage(chatKey, draft.trim());
      const { error: insertError } = await supabase.from("chat_messages").insert({
        room_id: roomId,
        sender_id: userId,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
      });
      if (insertError) throw insertError;
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    }
  }

  if (!chatKey) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <h3 className="font-medium">Unlock E2E chat</h3>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Derive AES-GCM key from room passphrase via PBKDF2.
        </p>
        <form onSubmit={onUnlock} className="mt-3 space-y-2">
          <Label htmlFor="chatPass">Passphrase</Label>
          <Input
            id="chatPass"
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            required
          />
          <Button type="submit" size="sm">
            Unlock chat
          </Button>
        </form>
        {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[280px] flex-col rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Room chat</h3>
          <Badge variant="success">E2E</Badge>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setViewCipher((v) => !v)}
        >
          {viewCipher ? "Show plaintext" : "Show ciphertext"}
        </Button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.map((m) => (
          <div key={m.id} className="text-sm">
            <span className="text-xs text-[var(--muted)]">
              {profiles[m.sender_id] ?? m.sender_id.slice(0, 8)}
            </span>
            <p className={viewCipher ? "break-all font-mono text-[10px]" : ""}>
              {viewCipher
                ? m.ciphertext
                : m.decryptError
                  ? "[decrypt failed]"
                  : m.plaintext}
            </p>
          </div>
        ))}
      </div>
      <form
        onSubmit={onSend}
        className="flex gap-2 border-t border-[var(--border)] p-3"
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Encrypted message…"
        />
        <Button type="submit" size="sm">
          Send
        </Button>
      </form>
      {error && <p className="px-3 pb-2 text-sm text-red-300">{error}</p>}
    </div>
  );
}
