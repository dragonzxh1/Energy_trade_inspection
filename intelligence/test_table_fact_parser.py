from __future__ import annotations
import unittest
from intelligence.market_pipeline.table_fact_parser import parse_daily_table_cells

class TableFactParserTest(unittest.TestCase):
    def test_tracks_unit_markers_and_parses_only_assessment_rows(self):
        column="Daily Carbon Intensity Premium\nAsia $/bbl"
        rows=[{column:"Gasoline Unl 92 FOB Singapore Cargo ALCEJ00 0.400"},
              {column:"United States Gulf Coast ¢/gal"},
              {column:"ULSD USGC Prompt Pipeline ALCER00 1.260"}]
        facts=parse_daily_table_cells([column],rows)
        self.assertEqual([(f["commodity"],f["unit"],f["value"]) for f in facts],
                         [("gasoline","usd/bbl",0.4),("diesel","cents/gal",1.26)])

if __name__=="__main__": unittest.main()
