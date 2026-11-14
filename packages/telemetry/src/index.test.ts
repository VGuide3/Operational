import { describe, expect, it } from 'vitest';
import { AlertEngine, MetricsRegistry, redact, Logger, type LogRecord } from './index.js';

describe('telemetry', () => {
  it('redacts secret-looking fields recursively', () => {
    expect(redact({ privateKey: 'abc', nested: { apiKey: 'x', ok: 1 } })).toEqual({
      privateKey: '[redacted]',
      nested: { apiKey: '[redacted]', ok: 1 },
    });
  });

  it('emits structured log records', () => {
    const records: LogRecord[] = [];
    const logger = new Logger({ service: 'api' }, (r) => records.push(r));
    logger.child({ requestId: 'req_1' }).info('hello', { ok: true });
    expect(records).toHaveLength(1);
    expect(records[0]!.service).toBe('api');
    expect(records[0]!.requestId).toBe('req_1');
    expect(records[0]!.level).toBe('info');
  });

  it('renders prometheus text format', () => {
    const m = new MetricsRegistry();
    m.counter('ops_requests_total', { route: '/api/v1/me' }, 'requests');
    m.counter('ops_requests_total', { route: '/api/v1/me' });
    m.gauge('ops_relayer_balance_wei', 123);
    m.observe('ops_scan_seconds', 1.5);
    const text = m.render();
    expect(text).toContain('# TYPE ops_requests_total counter');
    expect(text).toContain('ops_requests_total{route="/api/v1/me"} 2');
    expect(text).toContain('ops_scan_seconds_count 1');
    expect(m.get('ops_requests_total', { route: '/api/v1/me' })).toBe(2);
  });

  it('fires alerts for configured conditions', () => {
    const m = new MetricsRegistry();
    m.gauge('ops_relayer_balance_wei', 0);
    m.counter('ops_approval_replay_total');
    const alerts = new AlertEngine().evaluate(m);
    expect(alerts.map((a) => a.ruleId)).toContain('relayer_balance_depletion');
    expect(alerts.map((a) => a.ruleId)).toContain('approval_replay');
  });
});
