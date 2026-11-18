import crypto from 'crypto';
import os from 'os';
import type { IncomingMessage } from 'http';
import type { SecurityConfig } from '../shared/types.ts';

export function normalizeIp(rawIp: string | undefined): string {
  if (!rawIp) return '127.0.0.1';
  let ip = rawIp.split(',')[0].trim();
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }
  if (ip === '::1') return '127.0.0.1';
  return ip;
}

export function extractRequestIp(req: IncomingMessage): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return normalizeIp(xff);
  }
  return normalizeIp(req.socket.remoteAddress);
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let num = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    num = (num << 8) | n;
  }
  return num >>> 0;
}

export function isIpAllowed(ip: string, allowedList: string[]): boolean {
  const cleanIp = normalizeIp(ip);
  // Always permit loopback so internal probes & health checks never lock out
  if (cleanIp === '127.0.0.1' || cleanIp === 'localhost') return true;

  for (const entry of allowedList) {
    const rule = normalizeIp(entry);
    if (!rule) continue;
    if (rule === '*') return true;
    if (rule === cleanIp) return true;

    // IPv4 CIDR matching (e.g. 203.0.113.0/24)
    if (rule.includes('/')) {
      const [baseStr, prefixStr] = rule.split('/');
      const prefix = Number(prefixStr);
      const baseInt = ipv4ToInt(baseStr);
      const targetInt = ipv4ToInt(cleanIp);
      if (baseInt !== null && targetInt !== null && Number.isInteger(prefix) && prefix >= 0 && prefix <= 32) {
        const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
        if ((baseInt & mask) === (targetInt & mask)) {
          return true;
        }
      }
    }
  }
  return false;
}

export function timingSafeTokenMatch(provided: string | undefined, expected: string): boolean {
  if (!expected) return true;
  if (!provided) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function detectHostIpv4(): string {
  const envPublic = process.env.PUBLIC_IP?.trim();
  if (envPublic) return envPublic;

  const nets = os.networkInterfaces();
  const candidates: string[] = [];
  for (const iface of Object.values(nets)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal && !addr.address.startsWith('169.254.')) {
        candidates.push(addr.address);
      }
    }
  }
  // Prefer non-RFC1918 public IPv4 if directly attached (like AWS Lightsail/EC2 with elastic or direct IP), otherwise first private IPv4
  const publicIp = candidates.find(
    (ip) =>
      !ip.startsWith('10.') &&
      !ip.startsWith('192.168.') &&
      !/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  );
  return publicIp ?? candidates[0] ?? '127.0.0.1';
}

export class ConnectionRateLimiter {
  private handshakeHistory = new Map<string, number[]>();

  checkAllowed(
    rawIp: string,
    activeCountFromIp: number,
    security: SecurityConfig
  ): { allowed: boolean; reason?: string } {
    const ip = normalizeIp(rawIp);

    if (security.ipWhitelistEnabled && security.enforceMinecraftIpWhitelist) {
      if (!isIpAllowed(ip, security.allowedIps)) {
        return { allowed: false, reason: `IP ${ip} not in allowlist` };
      }
    }

    if (ip !== '127.0.0.1' && activeCountFromIp >= security.maxConnectionsPerIp) {
      return {
        allowed: false,
        reason: `Max concurrent connections (${security.maxConnectionsPerIp}) reached for ${ip}`,
      };
    }

    const now = Date.now();
    const recent = (this.handshakeHistory.get(ip) ?? []).filter((t) => now - t < 60_000);
    if (ip !== '127.0.0.1' && recent.length >= security.maxHandshakesPerMinute) {
      return {
        allowed: false,
        reason: `Handshake rate limit exceeded (${security.maxHandshakesPerMinute}/min) for ${ip}`,
      };
    }
    recent.push(now);
    this.handshakeHistory.set(ip, recent);

    return { allowed: true };
  }
}
