# Platts OCR - Template-based OCR for Platts Summary Screenshots

Extracts structured pricing data (mid prices, changes, codes, spreads, conversions)
from Platts Summary screenshots using **template-based ROI cropping + Tesseract OCR**.

## Why not full-table OCR?

Full-table OCR (like table-transformers, PaddleOCR table mode) often fails on Platts
images because:
- Font is very small
- Multiple tables packed closely
- Complex formatting with sub-rows, grey prices, and mixed units
- VLM/LLM hallucinate codes and prices

Our approach: **template defines table structure, OCR only reads cell values**.

## Installation

### 1. Install Tesseract OCR

**Windows:**
Download installer from: https://github.com/UB-Mannheim/tesseract/wiki
Run the installer. Note the installation path (usually `C:\Program Files\Tesseract-OCR`).

**Linux (Ubuntu/Debian):**
```bash
sudo apt-get install tesseract-ocr
```

**macOS:**
```bash
brew install tesseract
```

### 2. Install Python dependencies

```bash
pip install -r requirements.txt
```

### 3. (Optional) Install fallback OCR engines

For RapidOCR fallback:
```bash
pip install rapidocr-onnxruntime
```

For PaddleOCR fallback (heavier, not recommended for 4U4G):
```bash
pip install paddleocr
```

## Quick Start

```bash
# Process a single image
python extract.py --input samples/sample1.jpg --output output/platts.xlsx --debug

# Fast template/OCR smoke test: only date + first few ULSD cells
python extract.py --input samples/sample1.jpg --output output/quick.xlsx --csv output/quick_csv --debug --max-rois 12

# Segmentation QA only: generate regions/cells without OCR
python extract.py --input samples/sample1.jpg --output output/segment_only.xlsx --debug --segment-only

# Tune one table without waiting for the whole page
python extract.py --input samples/sample1.jpg --output output/ulsd.xlsx --debug --only-table ULSD_10ppm

# Process a folder of images
python extract.py --input "C:\Users\...\platts data" --output output/platts.xlsx --csv output/csv/

# With fallback engine
python extract.py --input samples --engine tesseract --fallback-engine rapidocr
```

## Project Structure

```
platts_ocr/
  extract.py              # Main CLI entry point
  requirements.txt
  README.md
  config/
    template.yaml         # Table structure and ROI coordinates
  src/
    __init__.py
    image_preprocess.py   # Scale, deskew, binarize, sharpen, align
    template_align.py      # Relative-to-absolute coordinate mapping
    roi.py                 # Extract cell ROIs from image
    ocr_engines.py         # Multi-strategy Tesseract (PSM 6/7/8/13 x 8 preprocess)
    parsers.py             # Regex cleaners for amounts, codes, dates
    validators.py          # Business rules + cross-date verification
    exporters.py           # Excel (multi-sheet) and CSV output
    debug_utils.py         # Save aligned images, ROI crops, overlay
  samples/                 # Sample Platts images
  output/                  # Output Excel/CSV files
  tests/                   # Unit tests
```

## How It Works

1. **Preprocess**: crop to the detected content border -> scale 3x -> deskew -> resize to the scaled template canvas. Perspective alignment is optional with `--align-mode perspective`.
2. **Region segmentation**: Generate a per-image table/region map (`debug/segments/regions_*.csv/json`)
3. **Cell segmentation**: Generate a per-image OCR cell table (`debug/segments/cells_*.csv/json`)
4. **Multi-strategy OCR**: For each generated cell, try the strongest preprocessing variants across field-specific PSM modes
5. **Parse & Validate**: Regex clean → business rule check → cross-date verification
6. **Export**: Multi-sheet Excel + CSV

## Tuning the Template

1. Run with `--debug` flag
2. Open `output/debug/overlay_*.png` to see ROI boxes overlaid on the image
3. Open `output/debug/rois/` to see individual cell crops
4. Adjust coordinates in `config/template.yaml`
5. Re-run to verify

Recommended loop:

```bash
python extract.py --input samples/sample1.jpg --output output/segment_only.xlsx --debug --segment-only
python extract.py --input samples/sample1.jpg --output output/quick.xlsx --debug --max-rois 12
python extract.py --input samples/sample1.jpg --output output/ulsd.xlsx --debug --only-table ULSD_10ppm
python extract.py --input samples --output output/platts.xlsx --csv output/csv --debug
```

Start with `--segment-only` whenever the screenshot layout changes. Check
`output/debug/segmentation_*.jpg` first; only run OCR after the region boxes and
cell boxes align across the whole page.

Use the default `--align-mode border-resize` for daily screenshots with
small cropping jitter. It detects the outer content border, normalizes it to the
template canvas, and then snaps each configured table bbox to nearby table lines.
Use `--align-mode resize` to skip border cropping, and use `--align-mode perspective`
only when the source image is photographed or visibly skewed.

QR/ad areas are configured under `ignore_regions` in `config/template.yaml` and
are masked white before OCR/debug output. This keeps the page coordinate system
stable while removing non-data regions.

### Coordinate System

All coordinates are **relative fractions** (0.0 to 1.0):

```yaml
tables:
  - id: ULSD_10ppm
    bbox: [0.003, 0.06, 0.24, 0.50]  # [x1, y1, x2, y2] relative to full image
    columns:
      code: [0.38, 0.57]               # [x1, x2] relative to table bbox
      mid: [0.57, 0.78]
      change: [0.78, 0.98]
    rows:
      - name: "FOB Med"
        y: [0.10, 0.175]               # [y1, y2] relative to table bbox
```

## Performance Notes (4U4G CPU)

- **Scale factor 3**: Required for readable text, uses ~200MB memory per image
- **Tesseract**: 1 worker recommended, ~2-5 seconds per cell
- **Processing time**: ~30-60 seconds per image with ~200 cells
- **Do NOT** load multiple PaddleOCR instances simultaneously

## Output Sheets

- **prices**: All price table data (date, table, row, code, mid, change, extra)
- **spreads**: Cross-market arbitrage values
- **conversions**: MT/bbl conversion factors
- **review_items**: Items flagged for human review

## License

Internal use.
