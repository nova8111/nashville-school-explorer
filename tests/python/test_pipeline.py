import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
import pandas as pd
from data_pipeline import normalize_state_id,parse_number,metric,rows_from_file,is_plausible_nashville_coordinate

def test_school_id_normalization_preserves_digits():
    assert normalize_state_id(45)=='0045'
    assert normalize_state_id(' 0045.0 ')=='0045'

def test_suppression_is_not_zero():
    m=metric('**','2024','assessment')
    assert m['value'] is None and m['status']=='suppressed'
    assert parse_number('0')==0

def test_numeric_percent_and_unreported():
    assert parse_number('43.5%')==43.5
    assert metric('—','2024','x')['status']=='not_reported'

def test_unique_exact_name_crosswalk_primitive():
    records=[{'name':'North School'},{'name':'South School'}]
    found=[r for r in records if r['name'].casefold()=='north school']
    assert len(found)==1

def test_parses_tdoe_letter_grade_workbook_headers(tmp_path):
    path=tmp_path/'letter.xlsx'
    pd.DataFrame([{'year':2025,'system':190,'system_name':'Metro Nashville Public Schools','school':140,'school_name':'Test Elementary','lg_grade':'B'}]).to_excel(path,index=False)
    row=rows_from_file(path,'letter_grade','letter_grade','2024-25')[0]
    assert row['state_school_id']=='0140' and row['lea_id']=='190'
    assert row['letter_grade']['value']=='B' and row['letter_grade']['status']=='reported'

def test_parses_suppressed_assessment_as_missing_not_zero(tmp_path):
    path=tmp_path/'assessment.xlsx'
    pd.DataFrame([{'system':190,'school':140,'school_name':'Test Elementary','subject':'ELA','student_group':'All Students','pct_met_exceeded':'<5%'}]).to_excel(path,index=False)
    row=rows_from_file(path,'assessment','assessment','2025')[0]
    assert row['ela_proficiency']['value'] is None
    assert row['ela_proficiency']['status']=='suppressed'

def test_parses_profile_enrollment_and_grade_span(tmp_path):
    path=tmp_path/'profile.xlsx'
    with pd.ExcelWriter(path) as writer:
        pd.DataFrame([{'school_year':'2024-25','district_no':190,'school_no':140,'school_name':'Test Elementary','total':'320'}]).to_excel(writer,sheet_name='By Student Group',index=False)
        pd.DataFrame([{'school_year':'2024-25','district_no':190,'school_no':140,'school_name':'Test Elementary','grade':g,'student_count':n} for g,n in [('K',60),('1',70),('2',65)]]).to_excel(writer,sheet_name='By Grade Level',index=False)
    rows=rows_from_file(path,'membership','membership','2024-25')
    enrollment=next(r for r in rows if 'enrollment' in r)
    grades=next(r for r in rows if 'grades' in r)
    assert enrollment['enrollment']['value']==320
    assert enrollment['enrollment']['year']=='2024-25'
    assert grades['grades']['display']=='K-2'

def test_coordinate_sanity_bounds():
    assert is_plausible_nashville_coordinate(36.18,-86.74)
    assert not is_plausible_nashville_coordinate(40.7,-74.0)
