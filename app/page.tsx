import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center bg-zinc-50 px-6 dark:bg-zinc-950">
      <main className="max-w-lg text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Options trade capture
        </h1>
        <p className="mt-3 text-zinc-600 dark:text-zinc-400">
          Send Interactive Brokers screenshots to your Telegram bot. Trades are
          extracted with OpenAI, stored in Convex, appended to Google Sheets, and
          shown on the dashboard.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/login"
            className="rounded-full bg-emerald-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-800"
          >
            Open dashboard
          </Link>
          <a
            href="https://core.telegram.org/bots/api#setwebhook"
            className="rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-900"
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
