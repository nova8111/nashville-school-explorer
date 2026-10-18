"""Fetch authoritative public data and publish a validated Nashville school bundle.

The pipeline intentionally publishes no demo records. Run with --refresh to acquire
current sources. A failed refresh leaves the last valid public JSON untouched.
"""
from __future__ import annotations
import argparse, json, re, shutil, sys, time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin
import requests
from bs4 import BeautifulSoup
import pandas as pd

ROOT=Path(__file__).resolve().parent
DATA=ROOT/'data'; RAW=DATA/'raw'; CACHE=DATA/'cache'; PROCESSED=DATA/'processed'; PUBLIC=ROOT/'public'/'data'
TDOE_PAGE='https://www.tn.gov/education/districts/federal-programs-and-oversight/data/data-downloads.html'
SOURCES={
 'letter_grade':{'label':'TDOE 2024-25 School Letter Grades','pattern':r'2024-25_A-F_Letter_Grade_File\.xlsx','year':'2024-25'},
 'tvaas':{'label':'TDOE 2024-25 Schoolwide TVAAS Composite','pattern':r'2025_tvaas_school_composite\.xlsx','year':'2024-25'},
 'assessment':{'label':'TDOE 2025 school accountability proficiency','pattern':r'school_release_file_suppressed_2025\.xlsx','year':'2025'},
 'membership':{'label':'TDOE 2024-25 School Profile (enrollment and grade span)','pattern':r'school-profile-2024-2025\.xlsx','year':'2024-25'},
}
NCES_URL='https://nces.ed.gov/opengis/rest/services/K12_School_Locations/EDGE_GEOCODE_PUBLICSCH_2324/MapServer/0/query'
CENSUS_ZCTA_URL='https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_zcta_national.zip'
ZIP_SEEDS={'37013':'Antioch','37027':'Brentwood / Davidson County edge','37115':'Madison','37138':'Old Hickory','37189':'Whites Creek','37201':'Downtown Nashville','37203':'Midtown Nashville','37204':'Green Hills','37205':'Belle Meade','37206':'East Nashville','37207':'North Nashville','37208':'Germantown','37209':'Sylvan Park','37210':'South Nashville','37211':'Nashville South','37212':'Vanderbilt','37214':'Donelson','37215':'Green Hills','37216':'Inglewood','37217':'Antioch','37218':'Bordeaux','37219':'Downtown Nashville','37220':'Oak Hill','37221':'Bellevue'}
SESSION=requests.Session(); SESSION.headers.update({'User-Agent':'NashvilleSchoolExplorer/1.0 (public education data research; contact via repository README)'})

def get(url:str,timeout:int=35)->requests.Response:
    error=None
    for attempt in range(3):
        try:
            r=SESSION.get(url,timeout=timeout); r.raise_for_status(); return r
        except requests.RequestException as exc:
            error=exc
            if attempt<2: time.sleep(1.5*(attempt+1))
    raise RuntimeError(f'Unable to retrieve {url}: {error}')

def source_links(html:str)->dict[str,str]:
    soup=BeautifulSoup(html,'html.parser'); out={}
    for key,spec in SOURCES.items():
        for a in soup.find_all('a',href=True):
            href=urljoin(TDOE_PAGE,a['href'])
            if re.search(spec['pattern'],href,re.I): out[key]=href; break
    return out

def normalize_state_id(value:Any)->str|None:
    if value is None or pd.isna(value): return None
    s=str(value).strip()
    if s.endswith('.0'): s=s[:-2]
    digits=re.sub(r'\D','',s)
    return digits.zfill(4) if digits else None

def normalize_lea_id(value:Any)->str|None:
    if value is None or pd.isna(value): return None
    digits=re.sub(r'\D','',str(value).strip())
    return str(int(digits)) if digits else None

def is_plausible_nashville_coordinate(lat:float,lon:float)->bool:
    # Broad sanity bounds; the authoritative source query already limits to Davidson County.
    return 36.0<=lat<=36.35 and -87.1<=lon<=-86.4

def parse_number(value:Any)->float|None:
    if value is None or pd.isna(value): return None
    s=str(value).strip()
    if not s or s.lower() in {'nan','n/a','na','-','—','null'}: return None
    if '*' in s or s.lower() in {'suppressed','suppression','withheld'}: return None
    s=s.replace('%','').replace(',','')
    try: return float(s)
    except ValueError: return None

def metric(value:Any,year:str,source_id:str,*,kind:str='number')->dict[str,Any]:
    raw='' if value is None or pd.isna(value) else str(value).strip()
    suppressed='*' in raw or raw.startswith('<') or raw.lower() in {'suppressed','withheld'}
    grade_value=raw.upper() if kind=='grade' and raw.upper() in {'A','B','C','D','F'} else None
    not_applicable=kind=='grade' and raw.lower().startswith('not eligible')
    parsed=grade_value if kind=='grade' else parse_number(value)
    status='suppressed' if suppressed else ('not_applicable' if not_applicable else ('reported' if parsed is not None else 'not_reported'))
    return {'value':parsed,'year':year,'status':status,'source_id':source_id}

def safe_write(path:Path,content:str)->None:
    path.parent.mkdir(parents=True,exist_ok=True); tmp=path.with_suffix(path.suffix+'.tmp');tmp.write_text(content,encoding='utf-8');tmp.replace(path)

def find_col(columns:list[Any],terms:list[str])->str|None:
    for col in columns:
        c=re.sub(r'[^a-z0-9]','',str(col).lower())
        if all(term in c for term in terms): return str(col)
    return None

def read_excel_tables(path:Path)->list[pd.DataFrame]:
    book=pd.ExcelFile(path)
    tables=[]
    for sheet in book.sheet_names:
        frame=pd.read_excel(path,sheet_name=sheet,dtype=object)
        frame=frame.dropna(how='all')
        if not frame.empty: tables.append(frame)
    return tables

def rows_from_file(path:Path,key:str,source_id:str,year:str)->list[dict[str,Any]]:
    rows=[]
    for frame in read_excel_tables(path):
        cols=list(frame.columns)
        idcol=next((c for c in cols if re.search(r'(school\s*(id|number|no\.?|code)|school_id|school number)',str(c),re.I)),None)
        if idcol is None: idcol=next((c for c in cols if re.fullmatch(r'(school|schoolid|schoolno|schno)',re.sub(r'[^a-z]','',str(c).lower()))),None)
        if idcol is None: continue
        namecol=next((c for c in cols if re.sub(r'[^a-z]','',str(c).lower())=='schoolname'),None)
        if namecol==idcol:namecol=None
        leacol=next((c for c in cols if re.sub(r'[^a-z]','',str(c).lower()) in {'system','districtnumber','districtno'}),None)
        if key=='letter_grade': valcol=next((c for c in cols if re.search(r'(letter grade|school grade|final grade|lg_grade)',str(c),re.I)),None)
        elif key=='tvaas': valcol=next((c for c in cols if re.search(r'(overall|composite)',str(c),re.I) and 'school' not in str(c).lower()),None)
        elif key=='assessment': valcol=next((c for c in cols if str(c).lower()=='pct_met_exceeded'),None)
        elif key=='membership': valcol=next((c for c in cols if str(c).strip().lower()=='total'),None)
        else: valcol=next((c for c in cols if re.search(r'(total enrollment|total membership|total students|enrollment)',str(c),re.I)),None)
        if key=='membership':
            grade_col=next((c for c in cols if str(c).strip().lower()=='grade'),None)
            if grade_col is not None and idcol is not None:
                count_col=next((c for c in cols if str(c).strip().lower()=='student_count'),None)
                if count_col:
                    spans={};school_meta={}
                    for _,r in frame.iterrows():
                        sid=normalize_state_id(r[idcol]); label=str(r[grade_col]).strip().upper()
                        if not sid or parse_number(r[count_col]) in (None,0):continue
                        num=-1 if label in {'PK','PRE-K','PREK'} else (0 if label in {'K','KG','KINDERGARTEN'} else (int(label) if label.isdigit() and 1<=int(label)<=12 else None))
                        if num is not None:
                            lea=normalize_lea_id(r[leacol]) if leacol else None;key=(lea,sid)
                            spans.setdefault(key,[]).append(num)
                            school_meta.setdefault(key,{'lea_id':lea,'name':str(r[namecol]).strip() if namecol and pd.notna(r[namecol]) else None})
                    for (lea,sid),values in spans.items():
                        lo,hi=min(values),max(values);show=lambda n:'PK' if n<0 else ('K' if n==0 else str(n))
                        rows.append({'state_school_id':sid,**school_meta[(lea,sid)],'source_id':source_id,'grades':{'min':lo,'max':hi,'display':f'{show(lo)}-{show(hi)}'}})
        if valcol is None: continue
        subject_col=next((c for c in cols if str(c).lower()=='subject'),None)
        group_col=next((c for c in cols if str(c).lower()=='student_group'),None)
        for _,r in frame.iterrows():
            sid=normalize_state_id(r[idcol]);
            if not sid: continue
            row={'state_school_id':sid,'lea_id':normalize_lea_id(r[leacol]) if leacol else None,'name':str(r[namecol]).strip() if namecol and pd.notna(r[namecol]) else None,'source_id':source_id}
            if key=='letter_grade': row['letter_grade']=metric(r[valcol],year,source_id,kind='grade')
            elif key=='tvaas': row['tvaas_growth_score']=metric(r[valcol],year,source_id)
            elif key=='membership': row['enrollment']=metric(r[valcol],year,source_id)
            elif key=='assessment':
                if group_col and str(r[group_col]).strip().casefold()!='all students': continue
                subject=str(r[subject_col]).strip().casefold() if subject_col and pd.notna(r[subject_col]) else ''
                field={'ela':'ela_proficiency','math':'math_proficiency'}.get(subject)
                if not field: continue
                row[field]=metric(r[valcol],year,source_id)
            rows.append(row)
    return rows

def acquire_nces(refresh:bool=True)->tuple[list[dict[str,Any]],dict[str,Any]]:
    cache=CACHE/'nces_2023-24_davidson.json'
    if not refresh and cache.exists():
        saved=json.loads(cache.read_text(encoding='utf-8'))
        return saved['schools'],{**saved['meta'],'status':'cached'}
    params={'where':"OPSTFIPS='47' AND CNTY='47037'",'outFields':'*','returnGeometry':'true','f':'json','outSR':'4326'}
    data=get(NCES_URL+'?'+requests.compat.urlencode(params),45).json()
    if data.get('error'): raise RuntimeError(f"NCES returned an error: {data['error']}")
    features=data.get('features',[])
    schools=[]
    for f in features:
        a=f.get('attributes',{}); g=f.get('geometry') or {}; x=g.get('x'); y=g.get('y')
        if x is None or y is None: continue
        lat,lon=float(y),float(x)
        if not is_plausible_nashville_coordinate(lat,lon): continue
        nces=str(a.get('NCESSCH') or a.get('ncessch') or '').strip()
        school={'nces_id':nces or None,'nces_lea_id':str(a.get('LEAID') or ''),'name':str(a.get('NAME') or a.get('name') or '').strip(),'state_school_id':None,'lea_id':'unknown','address':{'street':a.get('STREET') or a.get('street'),'city':a.get('CITY') or a.get('city') or 'Nashville','state':'TN','zip':str(a.get('ZIP') or a.get('zip') or '')[:5] or None},'grades':{'min':None,'max':None,'display':'Grade span unavailable'},'location':{'lat':lat,'lon':lon,'source':'NCES EDGE 2023-24 Public School Locations','verified':True},'type':'Public'}
        schools.append(school)
    meta={'source_url':NCES_URL,'year':'2023-24','retrieved_at':datetime.now(timezone.utc).isoformat(),'records':len(schools),'status':'downloaded'}
    safe_write(cache,json.dumps({'schools':schools,'meta':meta},ensure_ascii=False))
    return schools,meta

def acquire_zips(refresh:bool=True)->tuple[dict[str,dict[str,Any]],dict[str,Any]]:
    import zipfile,io
    cache=CACHE/'census_zcta_2024.zip'
    if refresh:
        response=get(CENSUS_ZCTA_URL,45);cache.write_bytes(response.content);payload=response.content
    elif cache.exists():payload=cache.read_bytes()
    else:raise RuntimeError('Census Gazetteer cache is missing; run an online refresh first.')
    with zipfile.ZipFile(io.BytesIO(payload)) as zf:
        member=next(n for n in zf.namelist() if n.lower().endswith('.txt'))
        df=pd.read_csv(zf.open(member),sep=r'\s*\t\s*',engine='python',dtype=str)
    zcol=next(c for c in df.columns if 'GEOID' in c.upper() or 'ZCTA5' in c.upper())
    latcol=next(c for c in df.columns if 'INTPTLAT' in c.upper());loncol=next(c for c in df.columns if 'INTPTLONG' in c.upper())
    out={}
    # Keep all Tennessee-numbered ZCTAs available for typed ZIP searches; only ZIP_SEEDS are suggestions.
    for _,r in df.iterrows():
        code=str(r[zcol]).strip()
        if code.startswith('37'):
            out[code]={'lat':float(r[latcol]),'lon':float(r[loncol]),'name':ZIP_SEEDS.get(code,'Tennessee ZIP area'),'coordinate_source':'US Census 2024 ZCTA Gazetteer','precision':'ZCTA internal point; approximate ZIP search origin','suggested':code in ZIP_SEEDS}
    return out,{'source_url':CENSUS_ZCTA_URL,'year':'2024','retrieved_at':datetime.now(timezone.utc).isoformat(),'records':len(out),'status':'downloaded' if refresh else 'cached'}

def build(refresh:bool=True)->dict[str,Any]:
    for p in (RAW,CACHE,PROCESSED,PUBLIC):p.mkdir(parents=True,exist_ok=True)
    manifest={'generated_at':datetime.now(timezone.utc).isoformat(),'status':'refresh_incomplete','sources':[],'policy':'Production output contains only source-verified records; no demo data.'}
    source_records:dict[str,list[dict[str,Any]]]={}; problems=[]
    links={}
    if refresh:
        try: links=source_links(get(TDOE_PAGE).text)
        except Exception as e: problems.append(f'TDOE source discovery failed: {e}')
    cached={}
    for key,spec in SOURCES.items():
        path=CACHE/f'{key}_{spec["year"].replace("/","-")}.xlsx'; sidecar=CACHE/f'{key}_metadata.json'; previous={}
        if sidecar.exists():
            try: previous=json.loads(sidecar.read_text(encoding='utf-8'))
            except (json.JSONDecodeError,OSError): previous={}
        url=links.get(key) or previous.get('source_url'); retrieved_at=previous.get('retrieved_at'); status='unavailable'
        if url and refresh:
            try:
                r=get(url);raw=RAW/(url.rsplit('/',1)[-1].split('?')[0]);raw.write_bytes(r.content);path.write_bytes(r.content);status='downloaded';retrieved_at=datetime.now(timezone.utc).isoformat();safe_write(sidecar,json.dumps({'source_url':url,'retrieved_at':retrieved_at}))
            except Exception as e: problems.append(f'{spec["label"]}: {e}')
        if path.exists():
            try:
                recs=rows_from_file(path,key,key,spec['year']);source_records[key]=recs;status='downloaded' if status=='downloaded' else 'cached';cached[key]=str(path.relative_to(ROOT))
                if not recs: problems.append(f'{spec["label"]}: workbook parsed but no recognized school ID/metric fields were found')
            except Exception as e: problems.append(f'{spec["label"]}: workbook parse failed: {e}');status='invalid'
        manifest['sources'].append({'id':key,'name':spec['label'],'source_url':url or TDOE_PAGE,'discovery_url':TDOE_PAGE,'academic_year':spec['year'],'retrieved_at':retrieved_at,'status':status,'records_parsed':len(source_records.get(key,[])),'cached_file':cached.get(key)})
    try: nces,ncesmeta=acquire_nces(refresh)
    except Exception as e: nces=[];ncesmeta={'status':'unavailable','records':0,'source_url':NCES_URL,'year':'2023-24'};problems.append(f'NCES locations unavailable: {e}')
    manifest['sources'].append({'id':'nces_locations','name':'NCES EDGE 2023-24 Public School Locations','academic_year':ncesmeta['year'],'source_url':NCES_URL,**ncesmeta})
    try: zips,zipmeta=acquire_zips(refresh)
    except Exception as e: zips={};zipmeta={'status':'unavailable','records':0,'source_url':CENSUS_ZCTA_URL,'year':'2024'};problems.append(f'Census ZCTA gazetteer unavailable: {e}')
    manifest['sources'].append({'id':'census_zcta','name':'US Census 2024 ZCTA Gazetteer','academic_year':'2024','source_url':CENSUS_ZCTA_URL,**zipmeta})
    # The NCES point service has no Tennessee school-number field; use a unique exact school-name join.
    merged={}
    for item in nces:
        sid=item.get('state_school_id'); ncesid=item.get('nces_id')
        key=f'TN-{item.get("lea_id") or "unknown"}-{sid}' if sid else f'NCES-{ncesid}'
        item['id']=key; item['lea_id']=item.get('lea_id') or 'unknown'
        item['academic_metrics']={k:{'value':None,'year':None,'status':'unavailable','source_id':None} for k in ['ela_proficiency','math_proficiency','tvaas_growth_score','letter_grade','graduation_rate','enrollment']}
        item['programs']=[];item['zoning_status']=None;merged[key]=item
    by_state={s['state_school_id']:s for s in merged.values() if s.get('state_school_id')}
    unmatched=0;out_of_scope=0;ambiguous=[]
    name_index:dict[str,list[dict[str,Any]]]={}
    for s in merged.values(): name_index.setdefault(re.sub(r'[^a-z0-9]','',s['name'].casefold()),[]).append(s)
    for source_key,recs in source_records.items():
        for row in recs:
            # Current public geography is Davidson County; its state district is Metro Nashville (LEA 190).
            # Do not attach statewide similarly named schools from a different district.
            if row.get('lea_id') and row['lea_id']!='190':
                out_of_scope+=1;continue
            s=by_state.get(row['state_school_id'])
            if s is None:
                # Ignore punctuation and case, but never use approximate/fuzzy matches.
                name_key=re.sub(r'[^a-z0-9]','',row['name'].casefold()) if row.get('name') else ''
                possible=name_index.get(name_key,[])
                # TDOE system 190 (Metro Nashville) maps to NCES LEA 4703180.
                if row.get('lea_id')=='190':
                    nces_candidates=[x for x in possible if x.get('nces_lea_id')=='4703180']
                    if len(nces_candidates)==1:possible=nces_candidates
                s=possible[0] if len(possible)==1 else None
                if len(possible)>1:ambiguous.append({'source':source_key,'school_id':row['state_school_id'],'name':row.get('name')})
            if s is None:
                if row.get('lea_id')=='190' or (row.get('name') and re.sub(r'[^a-z0-9]','',row['name'].casefold()) in name_index):unmatched+=1
                else:out_of_scope+=1
                continue
            if s.get('state_school_id') and s['state_school_id']!=row['state_school_id']:
                ambiguous.append({'source':source_key,'school_id':row['state_school_id'],'name':row.get('name'),'reason':'exact name matched a record with a conflicting state ID'});continue
            if not s.get('state_school_id'):
                s['state_school_id']=row['state_school_id']
                s['lea_id']=row.get('lea_id') or 'unknown'
                if row.get('lea_id'):s['id']=f"TN-{row['lea_id']}-{row['state_school_id']}"
            for field in ('ela_proficiency','math_proficiency','tvaas_growth_score','letter_grade','enrollment'):
                if field in row:s['academic_metrics'][field]=row[field]
            if 'grades' in row:s['grades']=row['grades']
    schools=sorted(merged.values(),key=lambda x:x['name'].casefold())
    id_counts=pd.Series([s['id'] for s in schools]).value_counts() if schools else pd.Series(dtype=int)
    duplicates=sorted(id_counts[id_counts>1].index.tolist())
    if duplicates:problems.append(f'Duplicate canonical school identifiers: {duplicates}')
    quality={'generated_at':manifest['generated_at'],'source_files_discovered':sum(bool(x.get('source_url') and x.get('source_url')!=TDOE_PAGE) for x in manifest['sources']),'source_files_successfully_downloaded':sum(x.get('status') in {'downloaded','cached'} for x in manifest['sources']),'latest_academic_year_by_dataset':{x['id']:x.get('academic_year') for x in manifest['sources']},'total_schools_discovered':len(nces),'total_schools_included':len(schools),'total_schools_excluded':max(0,len(nces)-len(schools)),'schools_missing_coordinates':sum(not s['location']['verified'] for s in schools),'schools_missing_grade_span':sum(s['grades']['min'] is None for s in schools),'schools_missing_academic_metrics':sum(all(m['value'] is None for m in s['academic_metrics'].values()) for s in schools),'duplicate_identifiers':duplicates,'unmatched_source_records':unmatched,'out_of_scope_source_records':out_of_scope,'ambiguous_school_matches':ambiguous,'verified_geocode_percentage':round(100*sum(s['location']['verified'] for s in schools)/len(schools),1) if schools else None,'valid_source_reference_percentage':100 if schools else None,'critical_validation_failures':problems,'metric_coverage':{k:sum(m['value'] is not None and m['status']=='reported' for m in (s['academic_metrics'][k] for s in schools)) for k in ['ela_proficiency','math_proficiency','tvaas_growth_score','letter_grade','graduation_rate','enrollment']}}
    if not schools: manifest['status']='no_verified_school_records'
    elif problems: manifest['status']='partial'
    else:manifest['status']='complete'
    # A failed or unparseable refresh must not erase the last valid publication.
    existing=PROCESSED/'nashville_schools.json'
    if problems and existing.exists():
        try: previous=json.loads(existing.read_text(encoding='utf-8'))
        except (json.JSONDecodeError,OSError): previous=[]
        if previous:
            manifest['status']='refresh_rejected_previous_data_preserved'
            safe_write(PROCESSED/'source_manifest.json',json.dumps(manifest,indent=2,ensure_ascii=False))
            safe_write(DATA/'source_manifest.json',json.dumps(manifest,indent=2,ensure_ascii=False))
            safe_write(DATA/'quality_report.json',json.dumps(quality,indent=2,ensure_ascii=False))
            safe_write(PUBLIC/'source_manifest.json',json.dumps(manifest,indent=2,ensure_ascii=False))
            return {'manifest':manifest,'quality':quality}
    # Publish atomically only if the data is structurally valid; empty is valid and clearly marked.
    for s in schools:
        if not s['id'] or not s['name'] or (s['location']['verified'] and not is_plausible_nashville_coordinate(s['location']['lat'],s['location']['lon'])):
            raise ValueError(f'Critical school validation failure: {s.get("id")}')
    safe_write(PROCESSED/'nashville_schools.json',json.dumps(schools,indent=2,ensure_ascii=False))
    safe_write(PROCESSED/'nashville_zipcodes.json',json.dumps(zips,indent=2,ensure_ascii=False))
    safe_write(PROCESSED/'source_manifest.json',json.dumps(manifest,indent=2,ensure_ascii=False))
    safe_write(DATA/'source_manifest.json',json.dumps(manifest,indent=2,ensure_ascii=False))
    safe_write(DATA/'quality_report.json',json.dumps(quality,indent=2,ensure_ascii=False))
    for name in ['nashville_schools.json','nashville_zipcodes.json','source_manifest.json']:
        src=PROCESSED/name
        safe_write(PUBLIC/name,src.read_text(encoding='utf-8'))
    return {'manifest':manifest,'quality':quality}

def main()->int:
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--offline',action='store_true',help='Reprocess locally cached files without retrieving source updates');args=parser.parse_args()
    try:
        result=build(refresh=not args.offline);print(json.dumps({'status':result['manifest']['status'],'schools':result['quality']['total_schools_included'],'coverage':result['quality']['metric_coverage'],'issues':result['quality']['critical_validation_failures']},indent=2));return 0
    except Exception as e:print(f'Data pipeline failed: {e}',file=sys.stderr);return 1
if __name__=='__main__':raise SystemExit(main())
