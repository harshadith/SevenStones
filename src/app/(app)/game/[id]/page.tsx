import { Suspense } from "react";
import { GameClient } from "@/components/arena/game-client";

export default async function GamePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense fallback={<p className="p-8 text-[var(--muted)]">Loading arena…</p>}>
      <GameClient roomId={id} />
    </Suspense>
  );
}
