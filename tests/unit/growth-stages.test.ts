import { expect, it } from 'vitest';
import { growthStage, growthStages, eventGrowthStage, selectGrowthChild } from '@/mobile/src/design/growth-stages';
it('uses clamped birthday anniversaries without month-end drift', () => {
  expect(growthStage('2024-01-31', '1')).toMatchObject({from:'2024-01-31',before:'2024-02-29'});
  expect(growthStage('2024-01-31', '2')).toMatchObject({from:'2024-02-29',before:'2024-03-31'});
  expect(growthStage('2024-02-29', '13')).toMatchObject({from:'2025-02-28',before:'2025-03-29'});
  expect(growthStage('2026-02-30', '1')).toBeNull();
  expect(growthStage('2026-01-01', '0')).toBeNull();
});
it('assigns day-precise memories in the family timezone across DST', () => {
  expect(eventGrowthStage('2026-02-08','2026-03-08T04:59:00Z','exact','America/New_York')?.key).toBe('1');
  expect(eventGrowthStage('2026-02-08','2026-03-08T05:00:00Z','exact','America/New_York')?.key).toBe('2');
  expect(eventGrowthStage('2026-01-31','2026-02-27T16:00:00Z','date_only','Asia/Shanghai')?.key).toBe('2');
  for (const precision of ['unknown','month','year']) expect(eventGrowthStage('2026-01-31','2026-02-01T00:00:00Z',precision,'UTC')).toBeNull();
  expect(eventGrowthStage('2026-01-31','2026-01-30T00:00:00Z','exact','UTC')).toBeNull();
  expect(growthStages('2026-01-31',new Date('2026-02-28T00:00:00Z'),'UTC').map(s=>s.key)).toEqual(['birth','1','2']);
  expect(growthStages('2027-01-01',new Date('2026-02-28T00:00:00Z'),'UTC')).toEqual([]);
});
it('defaults only to the sole child or uniquely named Xiaomei', () => {
  const child = {id:'a',displayName:'宝宝',isChild:true};
  const other = {id:'b',displayName:'姐姐',isChild:true};
  expect(selectGrowthChild([child,{id:'adult',displayName:'小美',isChild:false}])).toEqual(child);
  expect(selectGrowthChild([child,other])).toBeNull();
  expect(selectGrowthChild([child,{...other,displayName:'小美'}])?.id).toBe('b');
  expect(selectGrowthChild([ {...child,displayName:'小美'}, {...other,displayName:'小美'} ])).toBeNull();
});
