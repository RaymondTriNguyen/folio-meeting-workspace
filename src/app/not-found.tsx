import Link from "next/link";
export default function NotFound() {
  return (
    <main className="error-page">
      <h1>This page got lost in the notes.</h1>
      <p>Head back to your workspace to find your meetings.</p>
      <Link className="button primary" href="/">
        Back to Folio
      </Link>
    </main>
  );
}
