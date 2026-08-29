/// <reference types="vite/client" />

// Injected by vite.config.ts `define` at build time. See specs/release-deploy-pipeline.md §4.
declare const __APP_VERSION__: string;
declare const __GIT_SHA__: string;
declare const __GIT_REF__: string;
declare const __BUILD_ENV__: string;
