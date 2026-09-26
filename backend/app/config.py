from typing import Literal

from pydantic import AliasChoices, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="CHRONICLE_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: str = "development"
    storage_mode: Literal["memory", "mongodb"] = "memory"
    mongodb_uri: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices("MONGODB_URI", "CHRONICLE_MONGODB_URI"),
    )
    mongodb_database: str = Field(
        default="chronicle",
        validation_alias=AliasChoices("MONGODB_DB", "CHRONICLE_MONGODB_DATABASE"),
    )
    precedent_store: Literal["memory", "atlas"] = Field(
        default="memory", validation_alias="PRECEDENT_STORE"
    )
    voyage_api_key: SecretStr | None = Field(default=None, validation_alias="VOYAGE_API_KEY")
    voyage_embedding_model: str = Field(
        default="voyage-4", validation_alias="VOYAGE_EMBEDDING_MODEL"
    )
    mongodb_precedents_collection: str = Field(
        default="precedents", validation_alias="MONGODB_PRECEDENTS_COLLECTION"
    )
    mongodb_vector_index: str = Field(
        default="precedents_vector_index", validation_alias="MONGODB_VECTOR_INDEX"
    )
    events_poll_interval: float = Field(default=0.5, gt=0, le=30)
