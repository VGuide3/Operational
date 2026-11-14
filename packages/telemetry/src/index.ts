import { canonicalKeccak256 } from '@ops/core';

/**
 * Observability primitives: structured logs, Prometheus-style metrics, and
 * alert evaluation. These are transport-agnostic; services wire them to their
 * actual exporters (OTel, Prometheus, Sentry).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
  time: string;
  level: LogLevel;
  msg: string;
  [key: string]: unknown;
}

export type LogSink = (record: LogRecord) => void;

const defaultSink: LogSink = (record) => {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(record));
};

/** Structured logger. Redacts known-secret keys before emission. */
export class Logger {
  private readonly base: Record<string, unknown>;
  private readonly sink: LogSink;

  constructor(base: Record<string, unknown> = {}, sink: LogSink = defaultSink) {
    this.base = base;
    this.sink = sink;
  }

  child(extra: Record<string, unknown>): Logger {
    return new Logger({ ...this.base, ...extra }, this.sink);
  }

  private emit(level: LogLevel, msg: string, fields: Record<string, unknown> = {}): void {
    this.sink({
      time: new Date().toISOString(),
      level,
      msg,
      ...this.base,
      ...redact(fields),
    });
  }

  debug(msg: string, fields?: Record<string, unknown>) {
    this.emit('debug', msg, fields);
  }
  info(msg: string, fields?: Record<string, unknown>) {
    this.emit('info', msg, fields);
  }
  warn(msg: string, fields?: Record<string, unknown>) {
    this.emit('warn', msg, fields);
  }
  error(msg: string, fields?: Record<string, unknown>) {
    this.emit('error', msg, fields);
  }
}

const SECRET_KEY_PATTERN = /(privatekey|private_key|seed|mnemonic|secret|password|token|authorization|apikey|api_key)/i;

/** Replace secret-looking field values with a redaction marker. */
export function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SECRET_KEY_PATTERN.test(k)) {
      out[k] = '[redacted]';
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = redact(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Hash a PII-ish value (IP, user agent) so it can be stored lawfully. */
export function hashPii(value: string | undefined | null): string | null {
  if (!value) return null;
  return canonicalKeccak256({ v: value });
}

// --- Metrics ---------------------------------------------------------------

export type MetricKind = 'counter' | 'gauge' | 'histogram';

interface Series {
  name: string;
  kind: MetricKind;
  help: string;
  labels: Record<string, string>;
  value: number;
  count?: number;
  sum?: number;
}

export class MetricsRegistry {
  private series = new Map<string, Series>();

  private key(name: string, labels: Record<string, string>): string {
    const labelStr = Object.keys(labels)
      .sort()
      .map((k) => `${k}="${labels[k]}"`)
      .join(',');
    return `${name}{${labelStr}}`;
  }

  counter(name: string, labels: Record<string, string> = {}, help = ''): void {
    const k = this.key(name, labels);
    const existing = this.series.get(k);
    if (existing) existing.value += 1;
    else this.series.set(k, { name, kind: 'counter', help, labels, value: 1 });
  }

  gauge(name: string, value: number, labels: Record<string, string> = {}, help = ''): void {
    this.series.set(this.key(name, labels), { name, kind: 'gauge', help, labels, value });
  }

  observe(name: string, value: number, labels: Record<string, string> = {}, help = ''): void {
    const k = this.key(name, labels);
    const existing = this.series.get(k);
    if (existing) {
      existing.count = (existing.count ?? 0) + 1;
      existing.sum = (existing.sum ?? 0) + value;
    } else {
      this.series.set(k, { name, kind: 'histogram', help, labels, value: 0, count: 1, sum: value });
    }
  }

  get(name: string, labels: Record<string, string> = {}): number {
    return this.series.get(this.key(name, labels))?.value ?? 0;
  }

  /** Render in Prometheus text exposition format. */
  render(): string {
    const lines: string[] = [];
    const byName = new Map<string, Series[]>();
    for (const s of this.series.values()) {
      const arr = byName.get(s.name) ?? [];
      arr.push(s);
      byName.set(s.name, arr);
    }
    for (const [name, list] of byName) {
      if (list[0]!.help) lines.push(`# HELP ${name} ${list[0]!.help}`);
      lines.push(`# TYPE ${name} ${list[0]!.kind}`);
      for (const s of list) {
        if (s.kind === 'histogram') {
          lines.push(`${name}_count${this.labelStr(s.labels)} ${s.count}`);
          lines.push(`${name}_sum${this.labelStr(s.labels)} ${s.sum}`);
        } else {
          lines.push(`${name}${this.labelStr(s.labels)} ${s.value}`);
        }
      }
    }
    return lines.join('\n') + '\n';
  }

  private labelStr(labels: Record<string, string>): string {
    const entries = Object.entries(labels);
    if (entries.length === 0) return '';
    return `{${entries.map(([k, v]) => `${k}="${v}"`).join(',')}}`;
  }
}

// --- Alerts ----------------------------------------------------------------

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AlertRule {
  id: string;
  description: string;
  severity: AlertSeverity;
  /** Evaluate against the current metric snapshot. Returns true when firing. */
  evaluate(metrics: MetricsRegistry): boolean;
}

export interface Alert {
  ruleId: string;
  severity: AlertSeverity;
  description: string;
  firedAt: string;
}

/** The alert conditions listed in the README. */
export function defaultAlertRules(): AlertRule[] {
  return [
    {
      id: 'signature_verification_failures',
      description: 'Repeated signature-verification failures',
      severity: 'critical',
      evaluate: (m) => m.get('ops_signature_verify_failures_total') >= 5,
    },
    {
      id: 'unexpected_contract_upgrade',
      description: 'Unexpected contract upgrades or bytecode changes',
      severity: 'critical',
      evaluate: (m) => m.get('ops_contract_bytecode_changes_total') >= 1,
    },
    {
      id: 'unlimited_approval',
      description: 'Unlimited approval creation',
      severity: 'warning',
      evaluate: (m) => m.get('ops_unlimited_approvals_total') >= 1,
    },
    {
      id: 'high_value_transfer',
      description: 'High-value transfer attempts',
      severity: 'warning',
      evaluate: (m) => m.get('ops_high_value_transfers_total') >= 1,
    },
    {
      id: 'approval_replay',
      description: 'Telegram approval replay or quorum anomalies',
      severity: 'critical',
      evaluate: (m) => m.get('ops_approval_replay_total') >= 1,
    },
    {
      id: 'relayer_balance_depletion',
      description: 'Relayer balance depletion',
      severity: 'critical',
      evaluate: (m) => m.get('ops_relayer_balance_wei') < 1e16,
    },
    {
      id: 'scanner_staleness',
      description: 'Scanner data staleness beyond threshold',
      severity: 'warning',
      evaluate: (m) => m.get('ops_scan_staleness_seconds') > 900,
    },
    {
      id: 'audit_chain_discontinuity',
      description: 'Audit-chain hash discontinuity',
      severity: 'critical',
      evaluate: (m) => m.get('ops_audit_chain_broken') >= 1,
    },
  ];
}

export class AlertEngine {
  constructor(private readonly rules: AlertRule[] = defaultAlertRules()) {}

  evaluate(metrics: MetricsRegistry): Alert[] {
    const fired: Alert[] = [];
    for (const rule of this.rules) {
      if (rule.evaluate(metrics)) {
        fired.push({
          ruleId: rule.id,
          severity: rule.severity,
          description: rule.description,
          firedAt: new Date().toISOString(),
        });
      }
    }
    return fired;
  }
}
