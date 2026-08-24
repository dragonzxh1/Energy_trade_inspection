"""Deterministic historical price metrics; no model arithmetic."""

from __future__ import annotations

import math
import statistics
import uuid
from dataclasses import dataclass
from datetime import date

from .contracts import MARKET_METRIC_SCHEMA_VERSION, MarketMetric, MetricStatus


METRIC_CALCULATION_VERSION = "price-metrics.v1"
METRIC_NAMESPACE = uuid.UUID("bc269ce6-354a-43bc-9f10-54d08866e3c0")


@dataclass(frozen=True)
class PricePoint:
    market_date: date
    value: float
    unit: str
    fact_id: str


def _metric(
    *, market_date: date, commodity: str, region: str | None, benchmark: str,
    metric_type: str, value: float | None, unit: str | None, required: int,
    points: list[PricePoint], method: str, metadata: dict | None = None,
) -> MarketMetric:
    status = MetricStatus.COMPUTED if value is not None else MetricStatus.INSUFFICIENT_DATA
    seed = f"{market_date}|{commodity}|{region}|{benchmark}|{metric_type}|{METRIC_CALCULATION_VERSION}"
    return MarketMetric(
        metric_id=f"METRIC-{uuid.uuid5(METRIC_NAMESPACE, seed)}", market_date=market_date,
        commodity=commodity, region=region, benchmark=benchmark, metric_type=metric_type,
        value=value, unit=unit, status=status, calculation_method=method,
        calculation_version=METRIC_CALCULATION_VERSION,
        source_fact_ids=[point.fact_id for point in points],
        metadata={"required_observations": required, "available_observations": len(points), **(metadata or {})},
    )


def calculate_price_metrics(
    points: list[PricePoint], *, commodity: str, region: str | None, benchmark: str
) -> list[MarketMetric]:
    ordered = sorted(points, key=lambda point: point.market_date)
    if not ordered:
        raise ValueError("at least one price point is required")
    current = ordered[-1]
    result: list[MarketMetric] = []

    def difference(metric_type: str, lag: int) -> None:
        available = ordered[-(lag + 1):]
        value = current.value - ordered[-(lag + 1)].value if len(ordered) > lag else None
        result.append(_metric(
            market_date=current.market_date, commodity=commodity, region=region, benchmark=benchmark,
            metric_type=metric_type, value=value, unit=current.unit, required=lag + 1,
            points=available, method=f"current value minus value {lag} observations earlier",
        ))

    difference("daily_change", 1)
    difference("change_3d", 3)
    difference("change_5d", 5)
    difference("change_20d", 20)
    previous = ordered[-2] if len(ordered) >= 2 else None
    pct = ((current.value / previous.value) - 1) * 100 if previous and previous.value != 0 else None
    result.append(_metric(
        market_date=current.market_date, commodity=commodity, region=region, benchmark=benchmark,
        metric_type="daily_change_pct", value=pct, unit="%", required=2,
        points=ordered[-2:], method="(current / previous - 1) * 100",
    ))

    for window in (5, 20):
        window_points = ordered[-window:]
        complete = len(window_points) == window
        values = [point.value for point in window_points]
        mean = statistics.fmean(values) if complete else None
        result.append(_metric(
            market_date=current.market_date, commodity=commodity, region=region, benchmark=benchmark,
            metric_type=f"rolling_mean_{window}d", value=mean, unit=current.unit,
            required=window, points=window_points, method=f"arithmetic mean of latest {window} observations",
        ))
        if window == 20:
            std = statistics.pstdev(values) if complete else None
            result.append(_metric(
                market_date=current.market_date, commodity=commodity, region=region, benchmark=benchmark,
                metric_type="rolling_std_20d", value=std, unit=current.unit, required=20,
                points=window_points, method="population standard deviation of latest 20 observations",
            ))
            z_score = (current.value - mean) / std if mean is not None and std and not math.isclose(std, 0) else None
            result.append(_metric(
                market_date=current.market_date, commodity=commodity, region=region, benchmark=benchmark,
                metric_type="z_score_20d", value=z_score, unit=None, required=20,
                points=window_points, method="(current - rolling_mean_20d) / rolling_std_20d",
            ))
            percentile = (
                100 * sum(value <= current.value for value in values) / len(values) if complete else None
            )
            result.append(_metric(
                market_date=current.market_date, commodity=commodity, region=region, benchmark=benchmark,
                metric_type="percentile_20d", value=percentile, unit="%", required=20,
                points=window_points, method="percentage of latest 20 observations <= current",
            ))
            for metric_type, value in (
                ("new_20d_high", 1.0 if complete and current.value == max(values) else (0.0 if complete else None)),
                ("new_20d_low", 1.0 if complete and current.value == min(values) else (0.0 if complete else None)),
            ):
                result.append(_metric(
                    market_date=current.market_date, commodity=commodity, region=region, benchmark=benchmark,
                    metric_type=metric_type, value=value, unit=None, required=20,
                    points=window_points, method=f"current equals latest 20 observation {'maximum' if 'high' in metric_type else 'minimum'}",
                ))

    up_days = down_days = 0
    for earlier, later in zip(reversed(ordered[:-1]), reversed(ordered[1:])):
        if later.value > earlier.value and down_days == 0:
            up_days += 1
        elif later.value < earlier.value and up_days == 0:
            down_days += 1
        else:
            break
    for metric_type, value in (("consecutive_up_days", up_days), ("consecutive_down_days", down_days)):
        result.append(_metric(
            market_date=current.market_date, commodity=commodity, region=region, benchmark=benchmark,
            metric_type=metric_type, value=float(value), unit="days", required=1,
            points=ordered[-(max(up_days, down_days) + 1):], method="count consecutive directional observation changes",
        ))
    return result
