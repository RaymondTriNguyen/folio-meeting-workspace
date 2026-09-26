"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="error-page">
      <h1>Let&apos;s try that again.</h1>
      <p>
        Something interrupted your workspace. Your saved meetings are still
        there.
      </p>
      <button className="button primary" onClick={reset}>
        Reload workspace
      </button>
    </main>
  );
}
