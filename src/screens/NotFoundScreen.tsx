import { Link } from 'react-router-dom';

export default function NotFoundScreen() {
  return (
    <div className="not-found">
      <h1>Game not found</h1>
      <p>That game isn&apos;t in the arcade — maybe it&apos;s still loading quarters.</p>
      <Link to="/" className="link-button">
        <span aria-hidden="true">←</span> Back to Home
      </Link>
    </div>
  );
}
