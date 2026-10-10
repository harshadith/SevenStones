"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sha256 } from "@/lib/crypto/hash";
import {
  prepareJoinSecrets,
  storeRoomPassphrase,
} from "@/lib/rooms/secrets";
import type { Team } from "@/lib/supabase/database.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function JoinRoomForm() {
  const router = useRouter();
  const [inviteCode, setInviteCode] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [team, setTeam] = useState<Team>("guardians");
  const [hashPreview, setHashPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const inviteHash = await sha256(inviteCode.trim().toUpperCase());
      setHashPreview(inviteHash);

      const { data: salt, error: saltError } = await supabase.rpc(
        "get_room_salt_by_invite",
        { p_invite_code_hash: inviteHash }
      );
      if (saltError) throw saltError;

      const secrets = await prepareJoinSecrets(
        inviteCode.trim(),
        passphrase,
        salt as string
      );

      const { data: roomId, error: joinError } = await supabase.rpc(
        "join_room_secure",
        {
          p_invite_code_hash: secrets.inviteCodeHash,
          p_passphrase_hash: secrets.passphraseHash,
          p_team: team,
        }
      );
      if (joinError) throw joinError;

      storeRoomPassphrase(roomId as string, passphrase);
      router.push(`/room/${roomId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join room");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Join room</CardTitle>
        <CardDescription>
          Your invite code is hashed locally, then matched server-side. A salt
          is fetched only after the invite hash is known.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invite">Invite code</Label>
            <Input
              id="invite"
              required
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              className="font-mono uppercase tracking-widest"
              placeholder="ABC123"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="joinPass">Passphrase</Label>
            <Input
              id="joinPass"
              type="password"
              required
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Your team</Label>
            <div className="flex gap-2">
              {(["seekers", "guardians"] as Team[]).map((t) => (
                <Button
                  key={t}
                  type="button"
                  variant={team === t ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTeam(t)}
                >
                  {t === "seekers" ? "Seekers" : "Guardians"}
                </Button>
              ))}
            </div>
          </div>
          {hashPreview && (
            <div className="rounded-md bg-[var(--surface-2)] p-2">
              <p className="text-xs text-[var(--muted)]">Invite SHA-256</p>
              <p className="break-all font-mono text-[10px]">{hashPreview}</p>
            </div>
          )}
          {error && <p className="text-sm text-red-300">{error}</p>}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Joining…" : "Join with hashed secrets"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
