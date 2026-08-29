import './versionBadge.css';

const REPO = 'sarjarapu/test-sssf';

/**
 * Build stamp for the running site. The strings are compiled in by
 * vite.config.ts `define`, so the badge always names the exact commit that is
 * live. See specs/release-deploy-pipeline.md §4.3.
 *
 * - production:  `v0.2.0`
 * - preview:     `v0.2.0 · feat/foo · abc1234`
 * - local:       `v0.2.0 · local`
 */
export default function VersionBadge() {
  const isProd = __BUILD_ENV__ === 'production';
  const isLocal = __BUILD_ENV__ === 'local';

  const label = isProd
    ? `v${__APP_VERSION__}`
    : isLocal
      ? `v${__APP_VERSION__} · local`
      : `v${__APP_VERSION__} · ${__GIT_REF__} · ${__GIT_SHA__}`;

  const title = [
    `version ${__APP_VERSION__}`,
    `ref ${__GIT_REF__}`,
    `commit ${__GIT_SHA__}`,
    `env ${__BUILD_ENV__}`,
  ].join('\n');

  const href =
    __GIT_SHA__ === 'unknown'
      ? undefined
      : `https://github.com/${REPO}/commit/${__GIT_SHA__}`;

  return (
    <a
      className="version-badge"
      href={href}
      title={title}
      target="_blank"
      rel="noreferrer"
    >
      {label}
    </a>
  );
}
