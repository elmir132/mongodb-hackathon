from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class FactCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subject: str = Field(min_length=1, max_length=500)
    predicate: str = Field(min_length=1, max_length=250)
    value: Any
    source: str | None = Field(default=None, max_length=1000)
    confidence: float | None = Field(default=None, ge=0, le=1)


class FactResponse(FactCreate):
    id: str
    created_at: datetime


class StateRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conflict_text: str = Field(min_length=1, max_length=20_000)
    project_id: str = Field(min_length=1, max_length=250)
    context: dict[str, Any] = Field(default_factory=dict)


class StateResponse(BaseModel):
    revision: int
    value: dict[str, Any]
    overrides: dict[str, Any]
    updated_at: datetime


class OverrideCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str = Field(min_length=1, max_length=250)
    value: Any
    reason: str = Field(min_length=1, max_length=2000)


class OverrideResponse(OverrideCreate):
    created_at: datetime


class EventResponse(BaseModel):
    id: str
    kind: str
    data: dict[str, Any]
    created_at: datetime


class HealthResponse(BaseModel):
    status: Literal["ok"]
    storage_mode: Literal["memory", "mongodb"]
    environment: str
