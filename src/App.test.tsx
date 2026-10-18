// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent } from '@testing-library/react';
import App from './App';

afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe('Nashville Explorer',()=>{
  it('renders a clear empty-data state without inventing results',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockImplementation(async(url:string)=>({ok:true,json:async()=>url.includes('zipcodes')?{'37206':{lat:36.179319,lon:-86.731083,name:'East Nashville',coordinate_source:'US Census 2024 ZCTA Gazetteer'}}:url.includes('manifest')?{}:[]})));
    render(<App/>);
    expect(screen.getByRole('heading',{name:/find the right school/i})).toBeTruthy();
    expect(await screen.findByText(/school data is not published yet/i)).toBeTruthy();
    expect(screen.getByLabelText(/search radius/i)).toBeTruthy();
  });
  it('loads a real campus record and filters it by school name',async()=>{
    const schools=JSON.parse(readFileSync(resolve(process.cwd(),'public/data/nashville_schools.json'),'utf8'));
    const zips=JSON.parse(readFileSync(resolve(process.cwd(),'public/data/nashville_zipcodes.json'),'utf8'));
    const manifest=JSON.parse(readFileSync(resolve(process.cwd(),'public/data/source_manifest.json'),'utf8'));
    vi.stubGlobal('fetch',vi.fn().mockImplementation(async(url:string)=>({ok:true,json:async()=>url.includes('zipcodes')?zips:url.includes('manifest')?manifest:schools})));
    render(<App/>);
    expect(await screen.findByRole('heading',{name:'Hattie Cotton Elementary'})).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Search school name'),{target:{value:'Hattie Cotton'}});
    expect(screen.getByRole('heading',{name:'Hattie Cotton Elementary'})).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Search school name'),{target:{value:'No Such School'}});
    expect(await screen.findByText(/no schools match this search/i)).toBeTruthy();
  });
});
