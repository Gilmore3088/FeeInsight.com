// @vitest-environment node
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

type Trust = (address: string, hop: number) => boolean;
type SyntheticRequest = { socket: { remoteAddress: string }; headers: { "x-forwarded-for"?: string } };
const proxyaddr = createRequire(import.meta.url)("proxy-addr") as {
  (request: SyntheticRequest, trust: Trust): string;
  compile(subnets: string | string[]): Trust;
  all(request: SyntheticRequest, trust: Trust): string[];
};
const request = (remoteAddress: string, forwarded?: string): SyntheticRequest => ({
  socket: { remoteAddress }, headers: forwarded ? { "x-forwarded-for": forwarded } : {},
});

describe("actual proxy-addr trust-subnet security", () => {
  const unsafeCases = ["::ffff:10.0.0.0/8", "::/1"].flatMap((subnet) =>
    ["203.0.113.7", "::ffff:203.0.113.7"].flatMap((peer) => [false, true].map((multiple) => ({ subnet, peer, multiple }))),
  );
  it.each(unsafeCases)("rejects cross-family trust: $subnet / $peer / multiple=$multiple", ({ subnet, peer, multiple }) => {
    const trust = proxyaddr.compile(multiple ? [subnet, "192.0.2.0/24"] : subnet);
    expect(trust(peer, 0)).toBe(false);
    expect(proxyaddr(request(peer, "198.51.100.66"), trust)).toBe(peer);
  });

  it.each([false, true])("does not admit native IPv6 through a mapped subnet (multiple=%s)", (multiple) => {
    const subnet = "::ffff:10.0.0.0/8";
    const trust = proxyaddr.compile(multiple ? [subnet, "192.0.2.0/24"] : subnet);
    expect(trust("::1", 0)).toBe(false);
    expect(proxyaddr(request("::1", "198.51.100.66"), trust)).toBe("::1");
  });

  it("retains ordinary IPv4 subnet boundaries and mapped-peer compatibility", () => {
    const trust = proxyaddr.compile(["10.0.0.0/8", "192.0.2.0/24"]);
    for (const peer of ["10.23.4.5", "::ffff:10.23.4.5"]) {
      expect(trust(peer, 0)).toBe(true);
      expect(proxyaddr(request(peer, "198.51.100.66"), trust)).toBe("198.51.100.66");
    }
    for (const peer of ["203.0.113.7", "::ffff:203.0.113.7"]) {
      expect(trust(peer, 0)).toBe(false);
      expect(proxyaddr(request(peer, "198.51.100.66"), trust)).toBe(peer);
    }
  });

  it("retains correctly specified mapped IPv4 subnet boundaries", () => {
    const trust = proxyaddr.compile("::ffff:10.0.0.0/104");
    expect(trust("10.23.4.5", 0)).toBe(true);
    expect(trust("::ffff:10.23.4.5", 0)).toBe(true);
    expect(trust("203.0.113.7", 0)).toBe(false);
    expect(trust("::ffff:203.0.113.7", 0)).toBe(false);
    expect(proxyaddr(request("10.23.4.5", "198.51.100.66"), trust)).toBe("198.51.100.66");
  });

  it("retains actual IPv6 subnets without admitting unrelated IPv4 peers", () => {
    const trust = proxyaddr.compile(["2001:db8:1234::/48", "192.0.2.0/24"]);
    expect(trust("2001:db8:1234::9", 0)).toBe(true);
    expect(trust("2001:db8:5678::9", 0)).toBe(false);
    expect(trust("203.0.113.7", 0)).toBe(false);
    expect(proxyaddr(request("2001:db8:1234::9", "2001:db8:5678::1"), trust)).toBe("2001:db8:5678::1");
    expect(proxyaddr.compile("::/1")("2001:db8::1", 0)).toBe(true);
  });

  it("stops a forwarded chain at the first untrusted hop", () => {
    const trust = proxyaddr.compile("10.0.0.0/8");
    const trusted = request("10.0.0.9", "198.51.100.66, 10.0.0.8");
    expect(proxyaddr(trusted, trust)).toBe("198.51.100.66");
    expect(proxyaddr.all(trusted, trust)).toEqual(["10.0.0.9", "10.0.0.8", "198.51.100.66"]);
    expect(proxyaddr(request("10.0.0.9", "198.51.100.66, 203.0.113.7"), trust)).toBe("203.0.113.7");
  });

  it("retains exact mapped-address trust and direct-peer behavior", () => {
    const trust = proxyaddr.compile("::ffff:10.23.4.5/128");
    expect(trust("10.23.4.5", 0)).toBe(true);
    expect(trust("10.23.4.6", 0)).toBe(false);
    expect(proxyaddr(request("10.23.4.5"), trust)).toBe("10.23.4.5");
    expect(proxyaddr(request("203.0.113.7"), trust)).toBe("203.0.113.7");
  });
});
