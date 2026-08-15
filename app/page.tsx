import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center px-6">
      <main className="max-w-lg text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          Options trade capture
        </h1>
        <p className="mt-3 text-ink-muted">
          Send Interactive Brokers screenshots to your Telegram bot. Trades are
          extracted with OpenAI, stored in Convex, and shown on the dashboard
          (with optional Excel download).
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/login"
            className="rounded-full bg-accent-solid px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-solid-hover"
          >
            Open dashboard
          </Link>
          <a
            href="https://core.telegram.org/bots/api#setwebhook"
            className="rounded-full border border-edge-strong px-5 py-2.5 text-sm font-medium text-ink-soft hover:bg-surface-hover"
            target="_blank"
            rel="noreferrer"
          >
            Telegram webhooks
          </a>
        </div>
      </main>
    </div>
  );
}
