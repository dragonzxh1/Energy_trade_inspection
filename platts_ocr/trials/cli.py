from __future__ import annotations

import argparse
import json
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from .adapters import ADAPTERS, parse_platts_summary
from .evaluation import comparison_markdown, evaluate_parser, write_error_crops


def _images(directory: Path) -> list[Path]:
    return sorted(path for path in directory.iterdir() if path.suffix.casefold() in {".jpg",".jpeg",".png"})


def _run_one_trial(arguments: tuple[Path, Path, str]) -> tuple[str, dict]:
    image, run_root, parser = arguments
    result = parse_platts_summary(image, parser=parser, output_dir=run_root/"raw")
    return image.stem, result.to_dict()


def _validate_workers(parsers: list[str], workers: int) -> None:
    if workers < 1:
        raise ValueError("workers must be at least 1")
    if workers > 1 and any(parser != "template_tesseract" for parser in parsers):
        raise ValueError("PaddleOCR and PP-StructureV3 must run with --workers 1")


def run_trials(samples: Path, output: Path, parsers: list[str], repeat: int, workers: int = 1) -> None:
    _validate_workers(parsers,workers)
    for run_number in range(1,repeat+1):
        run_root=output/f"run_{run_number}"
        for parser in parsers:
            parser_dir=run_root/parser; parser_dir.mkdir(parents=True,exist_ok=True)
            if workers == 1:
                adapter=ADAPTERS[parser]()
                results=(
                    (image.stem,adapter.parse_platts_summary(image,run_root/"raw").to_dict())
                    for image in _images(samples)
                )
            else:
                arguments=[(image,run_root,parser) for image in _images(samples)]
                executor=ProcessPoolExecutor(max_workers=workers)
                results=executor.map(_run_one_trial,arguments)
            try:
                for image_stem,result in results:
                    (parser_dir/f"{image_stem}.json").write_text(
                        json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8",
                    )
            finally:
                if workers != 1:
                    executor.shutdown()


def initialize_ground_truth(samples: Path, output: Path) -> None:
    output.mkdir(parents=True,exist_ok=True)
    for image in _images(samples):
        path=output/f"{image.stem}.json"
        if path.exists():
            continue
        path.write_text(json.dumps({
            "schema_version":"platts-summary-ground-truth.v1","image_id":image.stem,
            "verification_status":"pending_manual","reviewer":None,"verified_at":None,
            "market_date":None,"records":[],
        },ensure_ascii=False,indent=2),encoding="utf-8")


def evaluate(samples: Path, output: Path, ground_truth: Path, parsers: list[str]) -> None:
    evaluations=[evaluate_parser(ground_truth,output/"run_1",output/"run_2",parser) for parser in parsers]
    (output/"evaluation.json").write_text(json.dumps(evaluations,ensure_ascii=False,indent=2),encoding="utf-8")
    (output/"comparison.md").write_text(comparison_markdown(evaluations),encoding="utf-8")
    write_error_crops(evaluations,samples,output)


def main() -> None:
    parser=argparse.ArgumentParser(description="Isolated Platts Summary OCR comparison")
    parser.add_argument("command",choices=["run","init-ground-truth","evaluate"])
    parser.add_argument("--samples",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    parser.add_argument("--ground-truth",type=Path)
    parser.add_argument("--parsers",default=",".join(ADAPTERS))
    parser.add_argument("--repeat",type=int,default=2)
    parser.add_argument("--workers",type=int,default=1)
    args=parser.parse_args(); parsers=[value.strip() for value in args.parsers.split(",") if value.strip()]
    unknown=set(parsers)-set(ADAPTERS)
    if unknown: parser.error(f"unsupported parsers: {sorted(unknown)}")
    if args.command=="run":
        try:
            run_trials(args.samples,args.output,parsers,args.repeat,args.workers)
        except ValueError as error:
            parser.error(str(error))
    elif args.command=="init-ground-truth": initialize_ground_truth(args.samples,args.output)
    else:
        if not args.ground_truth: parser.error("--ground-truth is required for evaluate")
        evaluate(args.samples,args.output,args.ground_truth,parsers)


if __name__=="__main__": main()
