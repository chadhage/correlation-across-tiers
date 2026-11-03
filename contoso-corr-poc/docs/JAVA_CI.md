# Java pull-request checks

`.github\workflows\ci-java.yml` runs the entire serial reactor on every pull
request, with no path filter, Azure credentials, deployment or cloud target.
The Windows runner installs the JDK and Maven archives from
`config\versions.lock.json` into the ignored `.tools\java` directory and checks
their SHA-256/SHA-512 values. It verifies the agent hash/size, builds the sampler,
and requires its SHA-256 to equal the lock before exporting both test variables.

The full `clean verify` run supplies `CONTOSO_AGENT_JAR` and
`CONTOSO_PARENT_SAFE_JAR`, with statsbeat and live metrics disabled in the job
environment. `Assert-JavaTestResults.ps1` prints executed, passed,
failed, error, skipped and cancelled totals. Missing/stale module reports,
incomplete XML, duplicate test identities, any skipped/cancelled test, or a
missing environment-gated agent test fails the job. DTDs are prohibited.
Cancelled-only cases are never counted as passed; cancellation represented as
an error or skip is not subtracted twice.
The existing second-SDK and disabled-instrumentation controls remain required.

Results are source/unit evidence on that runner image only. Workflow source
tests are not an actual hosted pull-request execution. Neither replaces the
deployed-build JDK 25, provider, exporter, service compatibility or owner checks.
