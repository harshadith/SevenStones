import { Suspense } from "react";
import { RoomClient } from "@/components/rooms/room-client";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense fallback={<p className="p-8 text-[var(--muted)]">Loading room…</p>}>
      <RoomClient roomId={id} />
    </Suspense>
  );
}
