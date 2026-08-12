"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="notFound">
      <div className="brandMark">!</div>
      <h1>RoadSafe AI hit a runtime error</h1>
      <p>No live value was invented. Retry the application or check the deployment logs.</p>
      <button className="primaryButton" onClick={() => reset()}>Try again</button>
    </main>
  );
}
