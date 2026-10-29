import axios, { AddressFamily, LookupAddress } from 'axios';
import * as dns from 'node:dns';
import * as ipaddr from 'ipaddr.js';

const UNSAFE_RANGES = [
  'private',
  'loopback',
  'linkLocal',
  'uniqueLocal',
  'unspecified',
];

function assertIpIsSafe(ip: string, hostname: string): void {
  if (UNSAFE_RANGES.includes(ipaddr.parse(ip).range())) {
    throw new Error(
      `SSRF blocked: refusing to connect to private address ${ip} (host ${hostname})`,
    );
  }
}

function assertHostnameIsSafe(hostname: string): void {
  if (ipaddr.isValid(hostname)) assertIpIsSafe(hostname, hostname);
}

function toAxiosLookupAddress(
  address: string | dns.LookupAddress[],
): LookupAddress | LookupAddress[] {
  if (typeof address === 'string') return address;
  return address.map((a) => ({
    address: a.address,
    family: a.family as AddressFamily,
  }));
}

function safeLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (
    err: Error | null,
    address: LookupAddress | LookupAddress[],
    family?: AddressFamily,
  ) => void,
): void {
  dns.lookup(hostname, options, (err, address, family) => {
    const resolved = toAxiosLookupAddress(address);
    if (err) return callback(err, resolved, family as AddressFamily);

    try {
      const addresses = Array.isArray(address)
        ? address.map((a) => a.address)
        : [address];
      addresses.forEach((addr) => assertIpIsSafe(addr, hostname));
      callback(null, resolved, family as AddressFamily);
    } catch (blockErr: unknown) {
      callback(blockErr instanceof Error ? blockErr : new Error(String(blockErr)), resolved, family as AddressFamily);
    }
  });
}

/**
 * Đọc URL một cách an toàn chống SSRF (Server-Side Request Forgery).
 * Validate IP ở cả initial request lẫn từng redirect hop, chặn dải IP nội bộ và metadata.
 */
export async function readUrlSafely(url: string): Promise<Buffer> {
  assertHostnameIsSafe(new URL(url).hostname);

  const response = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: 10_000,
    maxRedirects: 5,
    maxContentLength: 10 * 1024 * 1024,
    lookup: safeLookup,
    beforeRedirect: (redirectOptions) =>
      assertHostnameIsSafe(redirectOptions.hostname),
  });
  return Buffer.from(response.data);
}
