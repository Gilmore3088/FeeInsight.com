import { describe, expect, it } from "vitest";

import {
  detectPlatform,
  isReusablePath,
  isSitemapIndex,
  looksJavaScriptBuilt,
  looksLikeBotChallenge,
  robotsAllows,
  robotsDisallows,
  robotsSitemaps,
  sitemapLocations,
} from "./site-signals";

describe("Magellan site signals", () => {
  it("reads site map locations, indexes and robots.txt entries", () => {
    expect(sitemapLocations("<urlset><url><loc> https://a.example/fees?x=1&amp;y=2 </loc></url><url><loc><![CDATA[https://a.example/b]]></loc></url></urlset>")).toEqual([
      "https://a.example/fees?x=1&y=2",
      "https://a.example/b",
    ]);
    expect(isSitemapIndex("<?xml?><sitemapindex>")).toBe(true);
    expect(robotsSitemaps("User-agent: *\nSitemap: https://a.example/sitemap_index.xml\nsitemap:https://a.example/b.xml")).toEqual([
      "https://a.example/sitemap_index.xml",
      "https://a.example/b.xml",
    ]);
  });

  it("applies the robots.txt group for our crawler, else the * group", () => {
    const robots = "User-agent: *\nDisallow: /admin\n\nUser-agent: FeeInsightBot\nUser-agent: OtherBot\nDisallow: /private\nDisallow: /*.cgi$\n";
    const ours = robotsDisallows(robots);
    expect(ours).toEqual(["/private", "/*.cgi$"]);
    expect(robotsAllows("/admin", ours)).toBe(true);
    expect(robotsAllows("/private/fees", ours)).toBe(false);
    expect(robotsAllows("/x/run.cgi", ours)).toBe(false);
    expect(robotsAllows("/x/run.cgi?a=1", ours)).toBe(true);
    expect(robotsDisallows("User-agent: *\nDisallow: /tmp\nDisallow:")).toEqual(["/tmp"]);
    expect(robotsDisallows("User-agent: Googlebot\nDisallow: /")).toEqual([]);
  });

  it("names the website platform with platform_registry keys", () => {
    expect(detectPlatform('<script src="https://cdn.q2ebanking.com/sdk.js"></script>')).toBe("q2");
    expect(detectPlatform('<link href="https://banno.com/x.css">')).toBe("banno");
    expect(detectPlatform('<script src="https://www.jackhenry.com/a.js">')).toBe("banno");
    expect(detectPlatform('<img src="https://dicontent.example/a.png">')).toBe("fiserv");
    expect(detectPlatform('<script src="https://digitalone.fis.example/a.js">')).toBe("fis");
    expect(detectPlatform('<a href="https://bank.d3banking.com">Login</a>')).toBe("ncr");
    expect(detectPlatform('<a href="/_/kcms-doc/12/fees.pdf">Fees</a>')).toBe("kentico");
    expect(detectPlatform('<script src="/wp-includes/js/x.js"></script>')).toBe("wordpress");
    expect(detectPlatform('<img src="/sites/default/files/logo.png">')).toBe("drupal");
    expect(detectPlatform("<p>plain</p>")).toBeNull();
    expect(looksJavaScriptBuilt('<div id="root"></div><script src="/app.js"></script>')).toBe(true);
    expect(looksJavaScriptBuilt('<a href="/1">1</a><a href="/2">2</a><a href="/3">3</a><a href="/4">4</a><a href="/5">5</a><script src="/app.js"></script>')).toBe(false);
  });

  it("recognizes a bot wall served with HTTP 200, not a real homepage", () => {
    expect(looksLikeBotChallenge("<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>")).toBe(true);
    expect(looksLikeBotChallenge("<title>Access Denied</title><h1>Access Denied</h1>")).toBe(true);
    expect(looksLikeBotChallenge('<script src="/_Incapsula_Resource?x=1"></script>')).toBe(true);
    expect(looksLikeBotChallenge("<title>First Community Bank</title><p>Welcome</p>")).toBe(false);
    const realHome = "<title>Access Denied Bank</title>" + [1, 2, 3, 4, 5].map((n) => `<a href="/${n}">${n}</a>`).join("") + "<div>challenge-platform</div>";
    expect(looksLikeBotChallenge(realHome)).toBe(false);
  });

  it("shares only paths that can exist on another bank's site", () => {
    expect(isReusablePath("/wp-content/uploads/fee-schedule.pdf")).toBe(true);
    expect(isReusablePath("/wp-content/uploads/2024/03/fee-schedule.pdf")).toBe(false);
    expect(isReusablePath("/files/123456/fees.pdf")).toBe(false);
    expect(isReusablePath("/")).toBe(false);
  });
});
