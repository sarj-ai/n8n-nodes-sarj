# n8n-nodes-sarj

Read Sarj AI call history, details, transcripts and analysis in n8n workflows.

This is a release candidate. npm publication and n8n verification have not completed.

## Requirements

- n8n 2.49.7 or later, running on a supported Node.js 24 or later release.
- An existing Sarj organization and an API key for that organization with `calls:read` permission.
- Call history, transcript and analysis access enabled for the organization. These existing API reads are organization-gated and may require pilot eligibility. Contact engineering@sarj.ai if your organization is not enabled. Installing this package does not enable the service feature.

The node uses Sarj's existing REST API at `https://platform-api.sarj.ai/api/v1`. It integrates one service and contains no runtime dependencies. The four reads use the same organization and feature checks as Sarj's call analytics service.

## Installation

After the package is published, an n8n instance owner can install `n8n-nodes-sarj` from **Settings → Community nodes**, following [n8n's installation guide](https://docs.n8n.io/integrations/community-nodes/installation/).

Availability in the verified nodes panel and n8n Cloud depends on n8n approving the package. This release candidate does not claim verified status.

## Credentials

1. Open [Sarj API keys](https://platform.sarj.ai/api-keys) and obtain a key with `calls:read` for the intended organization. Ask an organization administrator if your role cannot issue keys.
2. Add a **Sarj API** credential in n8n and paste the key into **API Key**.
3. Test the credential. The test reads at most one call to validate the key, organization access and call-read feature eligibility.
4. Select this credential in your **Sarj AI** node.

n8n stores the credential using its encrypted credential system. The node passes authentication through n8n's `httpRequestWithAuthentication` helper. It does not read keys from workflow parameters, environment variables or files.

## Operations

Choose **Resource → Call** and one of the following operations:

| n8n operation  | Existing REST read                | Output                                                    |
| -------------- | --------------------------------- | --------------------------------------------------------- |
| Get Many       | `GET /calls`                      | One n8n item per call summary, newest first               |
| Get            | `GET /calls/{call_id}`            | The call's details and available outcome                  |
| Get Transcript | `GET /calls/{call_id}/transcript` | Ordered spoken or typed turns                             |
| Get Analysis   | `GET /calls/{call_id}/analysis`   | Available outcome, caller experience and quality analysis |

For **Get Many**, use **Limit** (1–100, default 50) or **Return All**. Optional filters are scenario UUID, status, an inclusive **Created From** timestamp, an exclusive **Created To** timestamp, and a supplied pagination cursor. Timestamps must include a timezone. The node always acts in the credential's organization and has no organization override.

**Return All** follows server cursors for at most 100 pages and 45 seconds per input item. If that bound is reached, narrow the creation-time range. The node rejects repeated cursors and does not return a partial result as a completed result. Individual HTTP requests have a maximum 30-second deadline, a 2 MiB response limit, and honor workflow cancellation. HTTP redirects are disabled.

For the other operations, set **Call ID** to an ID returned by **Get Many**, for example `={{$json.id}}`. Transcript and analysis reads require a UUID. The details endpoint accepts the service's documented string ID and encodes it as one path segment.

Outputs contain the API's `data` fields; request metadata and list pagination metadata are omitted. Null analysis fields and empty transcripts remain unchanged when processing has not completed or the feature is unavailable. n8n item links identify the input that produced each output.

## Example workflow

Import [examples/review-calls.json](examples/review-calls.json), then select your own Sarj credential in each Sarj AI node. The workflow lists one call and uses its ID to retrieve details, transcript and analysis. It contains no credential values and no customer records.

For a daily report, add a Schedule Trigger before **Get Many**, filter by the previous day's creation-time range, and enable **Return All**. Downstream nodes can inspect each call's status, duration and available outcome.

## Errors and data handling

Authentication, permission/pilot eligibility, missing call, rate-limit, timeout and malformed-response failures have concise messages. Raw service errors, request headers and credential values are not copied into node errors. **Continue On Fail** returns only the safe message for the affected input item.

Read results are returned to your n8n workflow, where your instance's execution-data settings apply. The package adds no logging, telemetry or separate data storage. Network access is restricted to the fixed Sarj REST host. The node exposes four GET operations; Sarj's separate write operations are not included.

## Development

```sh
npm ci
npm run check
npm run check:package
npm run dev
```

`npm run check` runs the unchanged official n8n strict linter and builds/tests the actual node class with synthetic HTTP fixtures. `npm run check:package` checks the distributable in a separate consumer. Tests use generic synthetic data, not a Sarj account or customer records. `npm run dev` launches the official n8n development runner.

The production-source OpenAPI schemas were checked on 27 November 2026. All four REST routes already exist. Call history, transcript and analysis access depend on the organization's enabled service features.

## Publishing and verification

Publish from the public `sarj-ai/n8n-nodes-sarj` repository through `.github/workflows/publish.yml`, with npm provenance. Configure npm Trusted Publishing for that repository and workflow, or use the owner's approved npm authentication in GitHub Actions. The official `npm run release` command prepares tags locally and publishes with provenance when run by GitHub Actions.

After publication, run `npx @n8n/scan-community-package n8n-nodes-sarj` and submit the published package in the [n8n Creator Portal](https://creators.n8n.io/nodes). n8n controls review and verified-node availability. A separate public n8n integrations landing page is not guaranteed.

## Support and references

- Support: engineering@sarj.ai
- [Sarj API documentation](https://platform-docs.sarj.ai/)
- [Current public OpenAPI schema](https://platform-docs.sarj.ai/api-reference/openapi.json)
- [Privacy policy](https://sarj.ai/privacy)
- [Service terms](https://sarj.ai/terms)
- [n8n community node verification rules](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines/)

## License and branding

The node's code is MIT-licensed, retaining the n8n starter attribution. Sarj's hosted service is governed by its service terms. The icons are faithful vector traces of Sarj's official S icon, with monochrome variants for light and dark themes. Sarj names and logos remain Sarj brand assets; the code license grants no trademark rights.
