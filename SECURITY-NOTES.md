# Security review notes

## npm advisory remaining in development tooling

As of 2026-10-23, `npm audit` reports five high-severity entries in the development-only lint dependency chain:

`eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces`

The underlying advisory is [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), affecting `braces` versions through `3.0.3` and describing stack-exhaustion denial of service from deeply nested patterns. The current npm registry lists `3.0.3` as the latest `braces` release, so there is no compatible patched version available for the `micromatch` dependency range. npm suggests downgrading `eslint-config-next` to `14.2.35`; that does not match this Next.js 15 application and is not applied.

The affected packages are development tooling, are not included in production dependencies, and are not imported by the application runtime. The production dependency audit is clean after pinning the vulnerable `@grpc/grpc-js` transitive dependency to the patched `1.14.6` line. Avoid running lint against attacker-controlled glob patterns until a compatible patched `braces` release or a Next.js-compatible dependency update is available.

## Promotion/PDI evaluation privacy

New promotion requests contain no conventional evaluation scores or comments. Their confidential evaluation snapshots are retained under `promotionRequests/{requestId}/evaluationEvidence`, readable by active company administrators only. The original conventional evaluation documents remain unchanged and keep their existing evaluator/admin access rules. Legacy promotion requests that embedded conventional evaluation data are readable only by administrators; leaders are notified when such history is hidden.
