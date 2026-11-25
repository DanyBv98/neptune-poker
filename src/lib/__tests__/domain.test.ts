import { describe, expect, it } from 'vitest';
import { cleanTitle, deriveKind, eligibleTracks, parseTicketLine, suggestCard, sumEstimates, trackStats, tracksFor } from '../domain';
import type { Vote } from '../types';

describe('deriveKind', () => {
  it.each([
    ['[FE] Login page', 'FE', true],
    ['[be] refund API', 'BE', true],
    ['[QA] regression pass', 'QA', true],
    ['[AQA] e2e for checkout', 'QA', true],
    ['[FE][BE] Payments', 'FS', true],
    ['(Fullstack) Search', 'FS', true],
    ['[Full-stack] Search', 'FS', true],
    ['[BE] [No QA] cron cleanup', 'BE', false],
    ['[FE][NOQA] copy change', 'FE', false],
    ['Plain ticket', 'UNSET', true],
    ['NEP-12 [FE] [QA] form', 'FE', true],
  ])('%s → %s', (title, kind, qa) => {
    expect(deriveKind(title)).toEqual({ kind, qaNeeded: qa });
  });
  it('cleans tags for display', () => {
    expect(cleanTitle('[FE][BE] Payments')).toBe('Payments');
    expect(cleanTitle('[AQA] - e2e')).toBe('e2e');
  });
  it('pulls URLs out of pasted lines', () => {
    expect(parseTicketLine('- [BE] Refund endpoint https://jira.example.com/browse/NEP-142')).toEqual({
      title: '[BE] Refund endpoint', url: 'https://jira.example.com/browse/NEP-142', kind: 'BE', qaNeeded: true,
    });
  });
});

describe('who votes', () => {
  it('FE ticket with QA', () => {
    const t = tracksFor('FE', true);
    expect(t).toEqual(['FE', 'QA']);
    expect(eligibleTracks(['FE'], t)).toEqual(['FE']);
    expect(eligibleTracks(['FS'], t)).toEqual(['FE']);
    expect(eligibleTracks(['BE'], t)).toEqual([]);
    expect(eligibleTracks(['QA'], t)).toEqual(['QA']);
  });
  it('fullstack ticket gives FS devs two votes', () => {
    const t = tracksFor('FS', false);
    expect(t).toEqual(['FE', 'BE']);
    expect(eligibleTracks(['FS'], t)).toEqual(['FE', 'BE']);
    expect(eligibleTracks(['BE'], t)).toEqual(['BE']);
    expect(eligibleTracks(['QA'], t)).toEqual([]);
  });
  it('QA-only ticket', () => {
    expect(tracksFor('QA', false)).toEqual(['QA']);
  });
});

describe('stats', () => {
  const v = (member_id: string, value: string): Vote => ({ id: member_id, round_id: 'r', member_id, track: 'FE', value });
  it('average, median, outliers, suggestion', () => {
    const s = trackStats('FE', [v('a', '3'), v('b', '5'), v('c', '13'), v('d', '?')], 'fibonacci');
    expect(s.avg).toBeCloseTo(7);
    expect(s.median).toBe(5);
    expect(s.suggestion).toBe('8');
    expect(s.low.map((x) => x.member_id)).toEqual(['a']);
    expect(s.high.map((x) => x.member_id)).toEqual(['c']);
    expect(s.consensus).toBe(false);
  });
  it('consensus', () => {
    expect(trackStats('FE', [v('a', '5'), v('b', '5')], 'fibonacci').consensus).toBe(true);
  });
  it('rounds ties up', () => {
    expect(suggestCard(4, 'fibonacci')).toBe('5');
    expect(suggestCard(0.7, 'modified')).toBe('½');
  });
  it('sums', () => {
    expect(sumEstimates({ FE: '3', BE: '5', QA: '2' }, 'fibonacci')).toBe(10);
  });
});
