import { AppHeader } from "@/components/layout/app-header";
import { CreateRoomForm } from "@/components/rooms/create-room-form";
import { JoinRoomForm } from "@/components/rooms/join-room-form";

export default function LobbyPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <h1 className="text-3xl font-semibold tracking-tight">Lobby</h1>
        <p className="mt-2 max-w-2xl text-[var(--muted)]">
          Create or join a secure room. Secrets are hashed client-side;
          membership is enforced with Supabase Row Level Security.
        </p>
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <CreateRoomForm />
          <JoinRoomForm />
        </div>
      </main>
    </>
  );
}
