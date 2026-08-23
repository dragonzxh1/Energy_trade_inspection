"""Versioned contracts for the structured Telegram input boundary."""

from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


MARKET_PIPELINE_SCHEMA_VERSION = "telegram-input.v1"
SOURCE_DOCUMENT_SCHEMA_VERSION = "source-document.v1"
MARKET_FACT_SCHEMA_VERSION = "market-fact.v1"
MARKET_METRIC_SCHEMA_VERSION = "market-metric.v1"
MARKET_SIGNAL_SCHEMA_VERSION = "market-signal.v1"


class MarketPipelineMode(str, Enum):
    LEGACY = "legacy"
    SHADOW = "shadow"
    REVIEW = "review"
    ACTIVE = "active"


class AttachmentMessageType(str, Enum):
    TEXT = "text"
    DOCUMENT = "document"
    IMAGE = "image"
    LINK = "link"
    FORWARD = "forward"


class StrictContract(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class TelegramMessage(StrictContract):
    telegram_chat_id: str = Field(min_length=1)
    telegram_message_id: str = Field(min_length=1)
    telegram_message_date: datetime
    sender_name: str | None = None
    forwarded_from: str | None = None
    message_text: str | None = None
    message_type: AttachmentMessageType
    reply_to_message_id: str | None = None
    telegram_message_url: str | None = None
    raw_payload_path: str | None = None
    raw_payload: dict[str, Any] | None = None
    ingested_at: datetime

    @field_validator("telegram_message_date", "ingested_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("datetime must include a timezone")
        return value


class TelegramAttachment(StrictContract):
    telegram_file_id: str | None = None
    attachment_name: str = Field(min_length=1)
    attachment_path: str = Field(min_length=1)
    attachment_mime_type: str = Field(min_length=1)
    attachment_hash: str = Field(pattern=r"^[a-fA-F0-9]{64}$")
    attachment_size_bytes: int = Field(ge=0)


class TelegramInput(StrictContract):
    schema_version: str = Field(default=MARKET_PIPELINE_SCHEMA_VERSION)
    pipeline_version: str = Field(default=MARKET_PIPELINE_SCHEMA_VERSION, min_length=1)
    pipeline_mode: MarketPipelineMode = MarketPipelineMode.SHADOW
    source_channel: str = Field(min_length=1)
    message: TelegramMessage
    attachment: TelegramAttachment

    @field_validator("schema_version")
    @classmethod
    def freeze_schema_version(cls, value: str) -> str:
        if value != MARKET_PIPELINE_SCHEMA_VERSION:
            raise ValueError(f"schema_version must be {MARKET_PIPELINE_SCHEMA_VERSION}")
        return value


class ParseMethod(str, Enum):
    PDF_TEXT = "pdf_text"
    PLAIN_TEXT = "plain_text"
    HTML = "html"
    PLATTS_TABLE = "platts_table"
    IMAGE_ONLY = "image_only"
    UNSUPPORTED = "unsupported"


class DocumentProcessingStatus(str, Enum):
    PARSED = "parsed"
    NEEDS_REVIEW = "needs_review"
    FAILED = "failed"


class DateCandidateSource(str, Enum):
    ASSESSMENT = "assessment_date"
    TITLE = "title_date"
    BODY = "body_date"
    PUBLISHED_AT = "published_at"
    FILENAME = "filename_date"
    TELEGRAM = "telegram_date"


class DateCandidate(StrictContract):
    value: date
    source: DateCandidateSource
    evidence: str = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)


class SourceIngestion(StrictContract):
    channel: str = "telegram"
    source_channel: str = Field(min_length=1)
    chat_id: str = Field(min_length=1)
    message_id: str = Field(min_length=1)
    message_date: datetime
    attachment_id: str | None = None

    @field_validator("message_date")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("datetime must include a timezone")
        return value


class SourceDocumentMetadata(StrictContract):
    publisher: str
    publisher_confidence: float = Field(ge=0, le=1)
    report_family: str
    report_title: str
    document_type: str
    published_at: datetime | None = None
    market_date: date
    market_date_confidence: float = Field(ge=0, le=1)
    market_date_reason: str = Field(min_length=1)
    date_candidates: list[DateCandidate]
    language: str
    regions: list[str]
    commodities: list[str]
    content_hash: str = Field(pattern=r"^[a-fA-F0-9]{64}$")


class ParsedTable(StrictContract):
    table_id: str
    source_id: str
    section_id: str | None = None
    table_index: int = Field(ge=0)
    title: str | None = None
    page_number: int | None = Field(default=None, ge=1)
    columns: list[str]
    rows: list[dict[str, str | None]]
    parse_method: str
    parse_confidence: float = Field(ge=0, le=1)


class DocumentSection(StrictContract):
    section_id: str
    source_id: str
    section_index: int = Field(ge=0)
    section_title: str
    page_start: int | None = Field(default=None, ge=1)
    page_end: int | None = Field(default=None, ge=1)
    region: str | None = None
    commodity: str | None = None
    section_type: str
    text: str
    table_ids: list[str] = Field(default_factory=list)
    classification_confidence: float = Field(ge=0, le=1)


class SourceContent(StrictContract):
    raw_text_path: str | None = None
    parsed_text: str
    sections: list[DocumentSection]
    tables: list[ParsedTable]
    parse_method: ParseMethod
    parse_confidence: float = Field(ge=0, le=1)


class SourceStatus(StrictContract):
    processing_status: DocumentProcessingStatus
    source_verified: bool
    needs_review: bool
    review_reasons: list[str]
    error_message: str | None = None


class SourceDocument(StrictContract):
    schema_version: str = SOURCE_DOCUMENT_SCHEMA_VERSION
    parser_version: str = SOURCE_DOCUMENT_SCHEMA_VERSION
    source_id: str
    ingestion: SourceIngestion
    document: SourceDocumentMetadata
    content: SourceContent
    status: SourceStatus

    @field_validator("schema_version")
    @classmethod
    def freeze_source_schema_version(cls, value: str) -> str:
        if value != SOURCE_DOCUMENT_SCHEMA_VERSION:
            raise ValueError(f"schema_version must be {SOURCE_DOCUMENT_SCHEMA_VERSION}")
        return value


class FactType(str, Enum):
    PRICE = "price"
    PRICE_CHANGE = "price_change"
    SPREAD = "spread"
    PREMIUM_DISCOUNT = "premium_discount"
    INVENTORY = "inventory"
    PRODUCTION = "production"
    REFINERY_RUN = "refinery_run"
    REFINERY_OUTAGE = "refinery_outage"
    SHIPMENT = "shipment"
    ARRIVAL = "arrival"
    TENDER = "tender"
    TRADE_FLOW = "trade_flow"
    DEMAND = "demand"
    SUPPLY = "supply"
    WEATHER = "weather"
    SANCTION = "sanction"
    POLICY = "policy"
    GEOPOLITICAL_EVENT = "geopolitical_event"
    FREIGHT = "freight"
    ARBITRAGE = "arbitrage"
    MARKET_SENTIMENT = "market_sentiment"
    SOURCE_COMMENTARY = "source_commentary"


class FactClass(str, Enum):
    SOURCE_FACT = "source_fact"
    CALCULATED_FACT = "calculated_fact"
    SUPPORTED_INFERENCE = "supported_inference"
    EDITORIAL_VIEW = "editorial_view"
    HYPOTHESIS = "hypothesis"


class FactDirection(str, Enum):
    UP = "up"
    DOWN = "down"
    FLAT = "flat"
    MIXED = "mixed"
    UNKNOWN = "unknown"


class VerificationStatus(str, Enum):
    PENDING = "pending"
    VERIFIED = "verified"
    NEEDS_REVIEW = "needs_review"
    REJECTED = "rejected"


class FactRiskLevel(str, Enum):
    NORMAL = "normal"
    ELEVATED = "elevated"
    HIGH = "high"
    CRITICAL = "critical"


class ValidationSeverity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    BLOCKING = "blocking"


class FactValidationIssue(StrictContract):
    rule_id: str
    severity: ValidationSeverity
    message: str
    field_name: str | None = None
    expected: str | None = None
    actual: str | None = None


class ConflictType(str, Enum):
    VALUE = "value_conflict"
    DIRECTION = "direction_conflict"
    DATE = "date_conflict"
    UNIT = "unit_conflict"
    SOURCE_ATTRIBUTION = "source_attribution_conflict"
    EVENT_SEVERITY = "event_severity_conflict"
    SUPPLY_DEMAND = "supply_demand_interpretation_conflict"


class FactConflict(StrictContract):
    conflict_type: ConflictType
    severity: FactRiskLevel
    left_fact_id: str
    right_fact_id: str
    conflict_key: str
    details: dict[str, Any]


class ExtractedFact(StrictContract):
    fact_type: FactType
    statement: str = Field(min_length=1)
    region: str | None = None
    country: str | None = None
    commodity: str | None = None
    benchmark: str | None = None
    value: float | None = None
    unit: str | None = None
    change_value: float | None = None
    change_unit: str | None = None
    direction: FactDirection = FactDirection.UNKNOWN
    time_basis: str | None = None
    evidence_text: str = Field(min_length=1)
    attribution: str | None = None
    uncertainty: str | None = None
    confidence: float = Field(ge=0, le=1)
    metadata: dict[str, Any] = Field(default_factory=dict)


class FactExtractionResult(StrictContract):
    schema_version: str = MARKET_FACT_SCHEMA_VERSION
    facts: list[ExtractedFact]

    @field_validator("schema_version")
    @classmethod
    def freeze_fact_schema_version(cls, value: str) -> str:
        if value != MARKET_FACT_SCHEMA_VERSION:
            raise ValueError(f"schema_version must be {MARKET_FACT_SCHEMA_VERSION}")
        return value


class MarketFact(StrictContract):
    schema_version: str = MARKET_FACT_SCHEMA_VERSION
    fact_id: str
    fact_hash: str = Field(pattern=r"^[a-fA-F0-9]{64}$")
    source_id: str
    section_id: str
    market_date: date
    published_at: datetime | None = None
    region: str | None = None
    country: str | None = None
    commodity: str | None = None
    benchmark: str | None = None
    fact_type: FactType
    fact_class: FactClass = FactClass.SOURCE_FACT
    statement: str
    value: float | None = None
    unit: str | None = None
    change_value: float | None = None
    change_unit: str | None = None
    direction: FactDirection = FactDirection.UNKNOWN
    time_basis: str | None = None
    evidence_text: str
    page_number: int | None = Field(default=None, ge=1)
    attribution: str | None = None
    uncertainty: str | None = None
    confidence: float = Field(ge=0, le=1)
    verification_status: VerificationStatus = VerificationStatus.PENDING
    risk_level: FactRiskLevel = FactRiskLevel.NORMAL
    supporting_fact_ids: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class MetricStatus(str, Enum):
    COMPUTED = "computed"
    INSUFFICIENT_DATA = "insufficient_data"


class MarketMetric(StrictContract):
    schema_version: str = MARKET_METRIC_SCHEMA_VERSION
    metric_id: str
    market_date: date
    commodity: str
    region: str | None = None
    benchmark: str
    metric_type: str
    value: float | None = None
    unit: str | None = None
    status: MetricStatus
    calculation_method: str
    calculation_version: str
    source_fact_ids: list[str]
    metadata: dict[str, Any] = Field(default_factory=dict)


class SignalDirection(str, Enum):
    BULLISH = "bullish"
    BEARISH = "bearish"
    NEUTRAL = "neutral"
    MIXED = "mixed"


class SignalStatus(str, Enum):
    TOP = "top_signal"
    SECONDARY = "secondary_signal"
    WEAK = "weak_signal"
    DISCARD = "discard"
    LOW = "low_signal"


class MarketSignal(StrictContract):
    schema_version: str = MARKET_SIGNAL_SCHEMA_VERSION
    signal_id: str
    market_date: date
    commodity: str
    region: str | None = None
    signal_type: str
    title: str
    summary: str
    direction: SignalDirection
    supporting_fact_ids: list[str]
    counter_fact_ids: list[str]
    metric_ids: list[str]
    confidence: float = Field(ge=0, le=1)
    score: int = Field(ge=0, le=100)
    score_breakdown: dict[str, int]
    support_dimensions: list[str]
    status: SignalStatus
    scoring_version: str


class CommodityKnowledgeCard(StrictContract):
    schema_version: str = "commodity-knowledge.v1"
    version: str
    updated_at: date
    commodity_id: str
    title: str
    aliases: list[str]
    market_definition: str
    core_benchmarks: list[str]
    core_prices_spreads: list[str]
    supply_sources: list[str]
    demand_centers: list[str]
    trade_flows: list[str]
    seasonality: list[str]
    substitutions: list[str]
    drivers: list[str]
    transmission_paths: list[str]
    validation_metrics: list[str]
    common_misreads: list[str]
    invalidation_conditions: list[str]
    data_gaps: list[str]


class ViewChangeType(str, Enum):
    CONTINUATION = "continuation"
    STRENGTHENING = "strengthening"
    WEAKENING = "weakening"
    REVERSAL = "reversal"
    DRIVER_SHIFT = "driver_shift"
    NEW_THEME = "new_theme"
    LOW_SIGNAL = "low_signal"


class ArticleMode(str, Enum):
    FAITHFUL_TRANSLATION = "faithful_translation"
    EVENT_BRIEF = "event_brief"
    MARKET_ANALYSIS = "market_analysis"
    MARKET_VIEW = "market_view"
    FACTUAL_BRIEF = "factual_brief"
    ARCHIVE_ONLY = "archive_only"


class SourceGenre(str, Enum):
    NEWS = "news"
    ANALYSIS = "analysis"
    COLUMN = "column"
    MARKET_REPORT = "market_report"
    INVESTIGATION = "investigation"


class ParagraphRole(str, Enum):
    OPENING = "opening"
    CLAIM = "claim"
    EVIDENCE = "evidence"
    COUNTERPOINT = "counterpoint"
    TRANSITION = "transition"
    CONCLUSION = "conclusion"


class EvidenceRelationship(str, Enum):
    SUPPORTS = "supports"
    REFUTES = "refutes"
    UPDATES = "updates"
    CONTEXTUALIZES = "contextualizes"


class ClaimType(str, Enum):
    CONFIRMED_FACT = "confirmed_fact"
    SOURCE_VIEW = "source_view"
    EXTERNAL_CONFIRMATION = "external_confirmation"
    EDITORIAL_INFERENCE = "editorial_inference"
    UNRESOLVED = "unresolved"


class StoryForm(str, Enum):
    SOURCE_CLOSE_READING = "source_close_reading"
    QUESTION_LED = "question_led"
    EVENT_TIMELINE = "event_timeline"
    MULTI_SOURCE_SYNTHESIS = "multi_source_synthesis"
    DATA_EXPLAINER = "data_explainer"
    VIEWPOINT_COMPARISON = "viewpoint_comparison"


class ParagraphExcerpt(StrictContract):
    schema_version: str = "paragraph-excerpt.v1"
    excerpt_id: str
    source_id: str
    section_id: str
    paragraph_role: ParagraphRole
    original_text: str = Field(min_length=1)
    literal_translation: str = ""
    publication_translation: str = ""
    previous_context: str = ""
    next_context: str = ""
    preserved_devices: list[str] = Field(default_factory=list)
    translation_review_status: str = Field(
        default="needs_review", pattern=r"^(pass|reject|needs_review)$"
    )


class ExternalEvidenceCandidate(StrictContract):
    schema_version: str = "external-evidence.v1"
    evidence_id: str
    market_date: date
    event_date: date | None = None
    published_at: datetime | None = None
    retrieved_at: datetime
    canonical_url: str = Field(min_length=1)
    content_hash: str = Field(pattern=r"^[a-fA-F0-9]{64}$")
    evidence_text_hash: str = Field(pattern=r"^[a-fA-F0-9]{64}$")
    source_title: str = Field(min_length=1)
    source_publisher: str = Field(min_length=1)
    source_tier: int = Field(ge=1, le=3)
    relationship: EvidenceRelationship
    claim_text: str = Field(min_length=1)
    evidence_text: str = Field(min_length=1)
    fact: ExtractedFact | None = None
    supporting_internal_fact_ids: list[str] = Field(default_factory=list)
    verification_status: str = Field(
        default="candidate",
        pattern=r"^(candidate|verified|needs_review|rejected|lead_only)$",
    )
    review_reasons: list[str] = Field(default_factory=list)


class ClaimLedgerEntry(StrictContract):
    schema_version: str = "claim-ledger.v1"
    claim_id: str
    claim_type: ClaimType
    claim_text: str = Field(min_length=1)
    supporting_fact_ids: list[str] = Field(default_factory=list)
    supporting_external_evidence_ids: list[str] = Field(default_factory=list)
    refuting_evidence_ids: list[str] = Field(default_factory=list)
    source_attribution: str | None = None
    market_date: date
    publishable: bool = False


class StoryBrief(StrictContract):
    schema_version: str = "story-brief.v1"
    story_brief_id: str
    market_date: date
    reader_question: str = Field(min_length=1)
    one_sentence_takeaway: str = Field(min_length=1)
    source_thesis: str = ""
    editorial_angle: str = ""
    new_information: list[str] = Field(default_factory=list)
    must_use_excerpt_ids: list[str] = Field(default_factory=list, max_length=8)
    external_context_ids: list[str] = Field(default_factory=list)
    allowed_inference_ids: list[str] = Field(default_factory=list)
    prohibited_claims: list[str] = Field(default_factory=list)
    story_form: StoryForm
    opening_strategy: str = ""
    ending_strategy: str = ""
    merged_candidate_ids: list[str] = Field(default_factory=list)


class EditorialSignalRef(StrictContract):
    signal_id: str
    signal_type: str
    direction: SignalDirection
    confidence: float = Field(ge=0, le=1)
    score: int = Field(ge=0, le=100)
    summary: str
    supporting_fact_ids: list[str]


class EditorialView(StrictContract):
    schema_version: str = "editorial-view.v2"
    view_id: str
    market_date: date
    main_thesis: str
    top_signal: EditorialSignalRef | None = None
    secondary_signals: list[EditorialSignalRef]
    counter_signals: list[EditorialSignalRef]
    view_change_type: ViewChangeType
    comparison_with_previous_day: str
    time_horizon: str = "1-5 trading days"
    supporting_fact_ids: list[str]
    invalidation_conditions: list[str]
    validation_metrics: list[str]
    uncertainties: list[str]
    publishable: bool
    evidence_ready: bool = False
    editorially_publishable: bool = False
    directional_signal_available: bool = False
    article_mode: ArticleMode = ArticleMode.ARCHIVE_ONLY
    publication_angle: str = ""
    evidence_strength: float = Field(default=0, ge=0, le=1)
    source_diversity: int = Field(default=0, ge=0)
    translation_candidates: list[str] = Field(default_factory=list)
    reader_value: int = Field(default=0, ge=0, le=100)
    audit_issues: list[str] = Field(default_factory=list)


class EditorialCandidate(StrictContract):
    schema_version: str = "editorial-candidate.v1"
    candidate_id: str
    market_date: date
    article_mode: ArticleMode
    headline_subject: str
    fact_ids: list[str] = Field(min_length=1, max_length=15)
    source_ids: list[str] = Field(default_factory=list)
    excerpt_ids: list[str] = Field(default_factory=list)
    newsworthiness_score: int = Field(ge=0, le=100)
    selection_reasons: list[str] = Field(default_factory=list)


class EvidenceBundle(StrictContract):
    schema_version: str = "evidence-bundle.v1"
    candidate_id: str
    market_date: date
    article_mode: ArticleMode
    core_fact_ids: list[str] = Field(default_factory=list, max_length=5)
    supply_trade_fact_ids: list[str] = Field(default_factory=list, max_length=4)
    price_fact_ids: list[str] = Field(default_factory=list, max_length=3)
    commentary_fact_ids: list[str] = Field(default_factory=list, max_length=3)
    source_ids: list[str] = Field(default_factory=list)
    excerpt_fact_ids: list[str] = Field(default_factory=list, max_length=6)
    reader_value_score: int = Field(ge=0, le=100)


class SourceDossier(StrictContract):
    schema_version: str = "source-dossier.v2"
    dossier_id: str
    source_id: str
    source_document_id: str
    market_date: date
    source_title: str
    source_genre: SourceGenre = SourceGenre.MARKET_REPORT
    central_question: str
    main_thesis: str = ""
    tone: str = "analytical"
    argument_pattern: list[str] = Field(default_factory=list)
    rhetorical_devices: list[str] = Field(default_factory=list)
    paragraph_functions: list[str] = Field(default_factory=list)
    uncertainty_language: list[str] = Field(default_factory=list)
    source_argument_map: list[dict[str, Any]] = Field(default_factory=list)
    translation_notes: list[str] = Field(default_factory=list)
    paragraph_excerpt_candidates: list[ParagraphExcerpt] = Field(default_factory=list)
    section_structure: list[str] = Field(default_factory=list)
    key_events: list[str] = Field(default_factory=list)
    high_value_section_ids: list[str] = Field(default_factory=list)
    translation_candidate_section_ids: list[str] = Field(default_factory=list)
    source_conclusions: list[str] = Field(default_factory=list)
    qualifications: list[str] = Field(default_factory=list)
    quick_read_inputs: list[str] = Field(default_factory=list)


class ArticleTopic(StrictContract):
    slug: str = Field(min_length=1)
    title_hint: str = Field(min_length=1)
    fact_ids: list[str] = Field(min_length=1)
    signal_ids: list[str] = Field(default_factory=list)
    rationale: str = Field(min_length=1)
    article_mode: ArticleMode = ArticleMode.MARKET_VIEW
    candidate_id: str | None = None
    evidence_bundle: EvidenceBundle | None = None
    topic_cluster_key: str | None = None
    merged_candidate_ids: list[str] = Field(default_factory=list)
    merge_reasons: list[str] = Field(default_factory=list)


class PublishedArticle(StrictContract):
    schema_version: str = "published-article.v1"
    article_id: str
    market_date: date
    editorial_view_id: str
    title: str
    summary: str
    markdown_path: str
    html_path: str
    source_mapping: dict[str, str]
    local_audit_passed: bool
    llm_review_passed: bool
    publication_status: str
    publication_reference: str | None = None
