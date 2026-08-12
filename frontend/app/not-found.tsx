import Link from "next/link";

export default function NotFound() {
  return (
    <main className="notFound">
      <div className="brandMark">RS</div>
      <h1>Page not found</h1>
      <p>The requested RoadSafe AI page does not exist.</p>
      <Link href="/" className="primaryButton">Return to dashboard</Link>
    </main>
  );
}
