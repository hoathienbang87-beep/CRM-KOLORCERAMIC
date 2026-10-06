import assert from "node:assert/strict";

export function observeBrowserPage(page, {allowedHosts = ["127.0.0.1", "localhost"]} = {}) {
  const findings = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    httpErrors: [],
    externalRequests: []
  };
  page.on("console", message => {
    if (message.type() === "error") findings.consoleErrors.push(message.text());
  });
  page.on("pageerror", error => findings.pageErrors.push(error.message));
  page.on("requestfailed", request => findings.failedRequests.push(`${request.url()} :: ${request.failure()?.errorText || "failed"}`));
  page.on("response", response => {
    if (response.status() >= 400) findings.httpErrors.push(`${response.status()} ${response.url()}`);
  });
  page.on("request", request => {
    const url = new URL(request.url());
    if (["http:", "https:"].includes(url.protocol) && !allowedHosts.includes(url.hostname)) findings.externalRequests.push(request.url());
  });
  return findings;
}

export function assertBrowserObservability(findings) {
  for (const [name, values] of Object.entries(findings)) assert.deepEqual(values, [], `${name}: ${values.join(" | ")}`);
}
