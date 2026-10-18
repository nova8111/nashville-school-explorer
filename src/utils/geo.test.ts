import {describe,it,expect} from 'vitest';
import {haversineMiles} from './geo';
describe('haversineMiles',()=>{it('returns zero at the same point',()=>expect(haversineMiles({lat:36,lon:-86},{lat:36,lon:-86})).toBe(0));it('calculates a known Nashville distance',()=>{const d=haversineMiles({lat:36.1627,lon:-86.7816},{lat:36.1772,lon:-86.749});expect(d).toBeGreaterThan(2);expect(d).toBeLessThan(2.5);});});
