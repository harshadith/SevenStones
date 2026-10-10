"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  prepareCreateSecrets,
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

export function CreateRoomForm() {
  const router = useRouter();
  const [name, setName] = useState("Courtyard Match");
  const [passphrase, setPassphrase] = useState("");
  const [team, setTeam] = useState<Team>("seekers");
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const secrets = await prepareCreateSecrets(passphrase);
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc("create_room_secure", {
        p_name: name,
        p_invite_code_hash: secrets.inviteCodeHash,
        p_passphrase_salt: secrets.salt,
        p_passphrase_hash: secrets.passphraseHash,
        p_host_team: team,
      });
      if (rpcError) throw rpcError;
      const roomId = data as string;
      storeRoomPassphrase(roomId, passphrase);
      setInviteCode(secrets.inviteCode);
      // Brief pause so host can copy invite before navigating
      sessionStorage.setItem(
        `ss_invite_code:${roomId}`,
        secrets.inviteCode
      );
      router.push(`/room/${roomId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create room");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create room</CardTitle>
        <CardDescription>
          Invite code and passphrase are hashed with SHA-256 before storage.
          Plaintext secrets never leave your browser for the database.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="roomName">Room name</Label>
            <Input
              id="roomName"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="passphrase">Room passphrase (E2E chat key)</Label>
            <Input
              id="passphrase"
              type="password"
              required
              minLength={4}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Shared with teammates"
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
          {error && <p className="text-sm text-red-300">{error}</p>}
          {inviteCode && (
            <p className="rounded-md bg-[var(--surface-2)] p-2 font-mono text-sm">
              Invite: {inviteCode}
            </p>
          )}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Creating…" : "Create secure room"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
