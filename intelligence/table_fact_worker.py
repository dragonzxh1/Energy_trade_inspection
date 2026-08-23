from __future__ import annotations
import argparse,os
from datetime import date
from psycopg import Connection
from intelligence.market_pipeline.table_fact_parser import sync_structured_table_facts

def main():
    parser=argparse.ArgumentParser(); parser.add_argument("--date-from",type=date.fromisoformat,required=True)
    parser.add_argument("--date-to",type=date.fromisoformat,required=True); args=parser.parse_args()
    with Connection.connect(os.environ["DATABASE_URL"]) as connection:
        print(sync_structured_table_facts(connection,args.date_from,args.date_to),flush=True)
if __name__=="__main__": main()
