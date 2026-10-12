import {expect,test} from 'vitest';
import {fromZoned,reminderPresets} from './issueAutomation';
test('wall-clock conversion follows the installation zone',()=>{expect(fromZoned('2026-10-16','09:00','Asia/Tashkent').toISOString()).toBe('2026-10-16T04:00:00.000Z');});
test('DST gap is invalid instead of silently moving the reminder',()=>{expect(Number.isNaN(fromZoned('2027-03-14','02:30','America/New_York').getTime())).toBe(true);});
test('next-month reminder clamps the day and keeps local nine oclock',()=>{const choices=reminderPresets(new Date('2027-01-31T14:00:00Z'),'Asia/Tashkent','2027-02-10');expect(choices.find(x=>x[0]==='month')![1]!.toISOString()).toBe('2027-02-28T04:00:00.000Z');expect(choices.find(x=>x[0]==='beforeDue')![1]!.toISOString()).toBe('2027-02-09T04:00:00.000Z');});
test('hour offsets stay exact across local midnight',()=>{const choices=reminderPresets(new Date('2026-10-11T18:45:00Z'),'Asia/Tashkent');expect(choices[0][1]!.toISOString()).toBe('2026-10-11T19:45:00.000Z');expect(choices.find(x=>x[0]==='beforeDue')![1]).toBeNull();});
