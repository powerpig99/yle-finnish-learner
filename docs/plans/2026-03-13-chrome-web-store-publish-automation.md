# Chrome Web Store Publish Automation

Date: 2026-03-13
Status: Closed

## Goal

Record the previously researched Chrome Web Store automation path and why it is not being pursued.

## Current Decision

- Keep the existing Chrome Web Store listing as a stable store version.
- Publish new releases on GitHub instead of pushing future versions to the Chrome Web Store.
- Do not implement Chrome Web Store upload or publish automation unless the distribution strategy changes.

## Recommended Future Path

If Chrome Web Store publishing is resumed later, use the Chrome Web Store API v2 with a service account and extend the existing GitHub Actions release workflow.

Authoritative release signal:
- Push a git tag like `v6.2.1`

Required secrets/config:
- `CWS_PUBLISHER_ID`
- `CWS_EXTENSION_ID`
- Service account credentials with Chrome Web Store publisher access

Suggested workflow:
1. Trigger on pushed version tags.
2. Run `npm test`.
3. Run `./package_project.sh`.
4. Obtain an access token for the service account.
5. Upload the zip with the Chrome Web Store upload endpoint.
6. Poll item status until processing completes.
7. Publish with `DEFAULT_PUBLISH` or `STAGED_PUBLISH`.

Suggested repo changes when implementing:
- Add `scripts/cws-publish.sh`
- Update `.github/workflows/release.yml` to publish after packaging
- Keep `package_project.sh` as the packaging source of truth

## API Notes

Upload:
- `POST https://chromewebstore.googleapis.com/upload/v2/publishers/{publisherId}/items/{extensionId}:upload`

Fetch status:
- `GET https://chromewebstore.googleapis.com/v2/publishers/{publisherId}/items/{extensionId}:fetchStatus`

Publish:
- `POST https://chromewebstore.googleapis.com/v2/publishers/{publisherId}/items/{extensionId}:publish`

Recommended publish body:

```json
{
  "publishType": "DEFAULT_PUBLISH"
}
```

Safer staged rollout option:

```json
{
  "publishType": "STAGED_PUBLISH"
}
```

## Constraints

- Store listing copy and screenshots should still be treated as manual dashboard updates unless the API surface expands.
- Review requirements still apply; publish requests can be blocked if review is required.

## Official References

- https://developer.chrome.com/docs/webstore/api/reference/rest
- https://developer.chrome.com/docs/webstore/using-api
- https://developer.chrome.com/docs/webstore/service-accounts?hl=en
- https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/publish?hl=en
- https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/fetchStatus?hl=en
